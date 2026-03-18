const fs = require('fs');
const path = require('path');

/**
 * Lazy-loads `@actual-app/api` to avoid crashes at boot
 * when transitive deps assume a browser `navigator`.
 */
let _actualApi = null;
function actualApi() {
  if (!_actualApi) {
    if (!globalThis.navigator) globalThis.navigator = { userAgent: 'node' };
    _actualApi = require('@actual-app/api');
  }
  return _actualApi;
}

/** Prevents concurrency crashes when cron sync and UI fetch collide. */
let isActualBusy = false;
let syncInProgress = false;

/** In-memory sync progress exposed to the frontend via `/api/sync-status`. */
let syncProgress = null;

function mappingKey(monoCardId, actualAccountId) {
  return `${monoCardId}::${actualAccountId}`;
}

function isLikelyNetworkFailureMessage(message) {
  const m = String(message || '').toLowerCase();
  return (
    m.includes('network-failure') ||
    m.includes('fetch failed') ||
    m.includes('econnrefused') ||
    m.includes('enotfound') ||
    m.includes('etimedout') ||
    m.includes('ehostunreach') ||
    m.includes('econnreset') ||
    m.includes('socket hang up')
  );
}

function makeStageError(message, { code, stage, cause } = {}) {
  const err = new Error(message);
  if (code) err.code = code;
  if (stage) err.stage = stage;
  if (cause) err.cause = cause;
  return err;
}

function wrapActualInitOrDownloadError(config, err, stage) {
  const raw = String(err?.message || err);
  const serverURL = config?.actualUrl;

  // A known upstream bug path: on some non-200 responses, the library does
  // `response.headers.get('content-type').toLowerCase()` without null checks.
  // This usually means the URL is wrong (not an Actual server) or a proxy/server
  // returned an unexpected empty response.
  if (
    raw.includes("Cannot read properties of null") &&
    raw.includes("toLowerCase")
  ) {
    return makeStageError(
      `Actual Budget at ${serverURL} returned an unexpected response (missing Content-Type). Verify Actual URL is correct and points to the Actual server (including the correct port).`,
      { code: 'ACTUAL_BAD_RESPONSE', stage, cause: err }
    );
  }

  if (isLikelyNetworkFailureMessage(raw)) {
    return makeStageError(
      `Actual Budget unreachable at ${serverURL}. Check that the server is running and reachable from this backend. (Details: ${raw})`,
      { code: 'ACTUAL_UNREACHABLE', stage, cause: err }
    );
  }

  if (raw.toLowerCase().includes('password')) {
    return makeStageError(`Actual Budget authentication failed (invalid password).`, {
      code: 'ACTUAL_AUTH_FAILED',
      stage,
      cause: err,
    });
  }

  if (raw.toLowerCase().includes('remote files')) {
    return makeStageError(
      `Actual Budget download failed. Check your Budget Sync ID and Password. (Details: ${raw})`,
      { code: 'ACTUAL_DOWNLOAD_FAILED', stage, cause: err }
    );
  }

  return makeStageError(`Actual Budget error: ${raw}`, { code: 'ACTUAL_ERROR', stage, cause: err });
}

function updateSyncProgress(patch) {
  if (!syncProgress) syncProgress = {};
  syncProgress = {
    ...syncProgress,
    ...patch,
    updatedAtMs: Date.now(),
  };
}

// --- Helpers ---

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toUnixSeconds(date) {
  return Math.floor(date.getTime() / 1000);
}

function toIsoDate(date) {
  return date.toISOString().slice(0, 10);
}

function toLocalIsoDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// --- Mono API ---

async function fetchMonoStatement(config, cardId, startUnix, endUnix) {
  let allTransactions = [];
  let currentEndUnix = endUnix;
  let hasMore = true;

  while (hasMore) {
    const url = `${config.monoUrl}/personal/statement/${cardId}/${startUnix}/${currentEndUnix}`;
    const response = await fetch(url, {
      headers: { 'X-Token': config.monoToken },
    });

    if (!response.ok) {
      throw new Error(`Mono API ${response.status} ${response.statusText}: ${url}`);
    }

    const data = await response.json();
    if (!Array.isArray(data)) {
      throw new Error(`Unexpected Mono response: ${JSON.stringify(data)}`);
    }

    allTransactions = allTransactions.concat(data);

    // Monobank returns max 500 per request; page through older transactions.
    if (data.length === 500) {
      currentEndUnix = data[data.length - 1].time;
      
      console.warn(`Mono pagination: hit 500-tx limit on card ${cardId}, sleeping 60 s…`);
      await sleep(60_000); 
    } else {
      hasMore = false;
    }
  }

  return allTransactions;
}

// --- Transform ---

function toActualTransactions(accountId, monoTransactions) {
  return monoTransactions.map((tx) => ({
    account: accountId,
    amount: Number(tx.amount),
    date: toLocalIsoDate(new Date(tx.time * 1000)),
    payee_name: tx.description,
    imported_id: String(tx.id),
  }));
}

// --- Sync ---

/**
 * Run a full sync: connect to Actual, iterate time chunks, fetch Monobank
 * statements for each mapped card, and import transactions.
 * @param {object} config - Decrypted app config with credentials and mappings.
 */
async function sync(config) {
  if (isActualBusy) {
    console.warn('Sync aborted: Actual API is currently in use by another process.');
    return; 
  }
  isActualBusy = true;
  syncInProgress = true;
  let syncError = null;
  let actualInitialized = false;
  
  // Set defaults for the backend environment
  const cacheDir = config.cacheDir || path.join(__dirname, 'data', '.cache');
  const chunkSize = config.chunkSize || 31; // Monobank allows max 31 days per request
  const plannedCards = (config.cards || []).filter((c) => c?.monoCardId && c?.actualAccountId);
  const plannedKeys = plannedCards.map((c) => mappingKey(c.monoCardId, c.actualAccountId));
  const rawDaysToSync = Number(config?.daysToSync);
  const daysToSync = Number.isInteger(rawDaysToSync) && rawDaysToSync >= 1 ? rawDaysToSync : 7;

  // Explicit date boundaries (from POST /api/sync date-range mode)
  const hasExplicitRange = config.dateFrom && config.dateTo;
  let rangeStartDate, rangeEndDate;
  if (hasExplicitRange) {
    rangeStartDate = new Date(config.dateFrom + 'T00:00:00');
    rangeEndDate = new Date(config.dateTo + 'T23:59:59');
  }

  const effectiveEndDate = hasExplicitRange ? rangeEndDate : new Date();
  const effectiveStartDate = hasExplicitRange
    ? rangeStartDate
    : (() => { const d = new Date(); d.setDate(d.getDate() - daysToSync); return d; })();
  const effectiveDays = Math.max(1, Math.ceil((effectiveEndDate - effectiveStartDate) / (1000 * 60 * 60 * 24)));

  const totalChunks = Math.max(1, Math.ceil(effectiveDays / chunkSize));
  const actualUrl = typeof config?.actualUrl === 'string' ? config.actualUrl.trim() : '';
  const actualPassword = typeof config?.actualPassword === 'string' ? config.actualPassword : '';
  const actualSyncId = typeof config?.actualSyncId === 'string' ? config.actualSyncId : '';

  updateSyncProgress({
    phase: 'init',
    startedAtMs: Date.now(),
    finishedAtMs: null,
    plannedKeys,
    chunk: { index: 0, total: totalChunks, startDate: null, endDate: null },
    currentKey: null,
    chunkCompletedKeys: [],
    chunkErrorKeys: [],
    lastStep: null,
    sleepUntilMs: null,
    sleepReason: null,
  });

  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  try {
    if (!actualUrl) {
      throw makeStageError(
        'Actual Budget URL is missing in config. Open Connections, set Actual URL, and save.',
        { code: 'ACTUAL_URL_MISSING', stage: 'config' }
      );
    }
    if (!actualSyncId) {
      throw makeStageError(
        'Actual Budget Sync ID is missing in config. Open Connections, set Budget Sync ID, and save.',
        { code: 'ACTUAL_SYNC_ID_MISSING', stage: 'config' }
      );
    }

    try {
      const maxAttempts = 3;
      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
          await actualApi().init({
            dataDir: cacheDir,
            serverURL: actualUrl,
            password: actualPassword,
          });
          actualInitialized = true;
          break;
        } catch (innerErr) {
          const msg = String(innerErr?.message || innerErr);
          const shouldRetry = isLikelyNetworkFailureMessage(msg) && attempt < maxAttempts;
          if (shouldRetry) {
            const waitMs = attempt === 1 ? 1000 : attempt === 2 ? 2000 : 4000;
            console.warn(
              `Actual init attempt ${attempt} failed (${msg}). Retrying in ${Math.ceil(waitMs / 1000)}s...`
            );
            updateSyncProgress({
              phase: 'init',
              initAttempt: attempt + 1,
              initLastError: msg,
              initRetryInMs: waitMs,
            });
            await sleep(waitMs);
            continue;
          }
          throw innerErr;
        }
      }
    } catch (err) {
      throw wrapActualInitOrDownloadError(config, err, 'actual_init');
    }

    try {
      await actualApi().downloadBudget(actualSyncId);
    } catch (err) {
      throw wrapActualInitOrDownloadError(config, err, 'actual_download');
    }

    // Build account lookup map (name/id → actual id)
    const accounts = await actualApi().getAccounts();
    const accountMap = new Map();
    for (const acc of accounts) {
      accountMap.set(acc.id.toUpperCase(), acc.id);
      accountMap.set(acc.name.toUpperCase(), acc.id);
    }

    let remaining = effectiveDays;
    let endDate = new Date(effectiveEndDate);
    let chunkIndex = 0;

    while (remaining > 0) {
      const chunk = Math.min(remaining, chunkSize);
      const startDate = new Date(endDate);
      startDate.setDate(endDate.getDate() - chunk);
      chunkIndex += 1;

      updateSyncProgress({
        phase: 'syncing',
        chunk: {
          index: chunkIndex,
          total: totalChunks,
          startDate: toIsoDate(startDate),
          endDate: toIsoDate(endDate),
        },
        currentKey: null,
        chunkCompletedKeys: [],
        chunkErrorKeys: [],
        sleepUntilMs: null,
        sleepReason: null,
      });

      console.log(`Sync chunk ${chunkIndex}/${totalChunks}: ${toIsoDate(startDate)} → ${toIsoDate(endDate)}`);

      const startUnix = toUnixSeconds(startDate);
      const endUnix = toUnixSeconds(endDate);
      const hasMoreChunks = remaining > chunk;

      for (let i = 0; i < plannedCards.length; i++) {
        const { monoCardId, actualAccountId } = plannedCards[i];
        const key = mappingKey(monoCardId, actualAccountId);
        updateSyncProgress({ phase: 'syncing', currentKey: key });

        const lookupKey = String(actualAccountId || '').toUpperCase();
        const actualId = accountMap.get(lookupKey);

        if (!actualId) {
          console.warn(`Account not found for "${actualAccountId}", skipping`);
          continue;
        }

        try {
          const monoData = await fetchMonoStatement(config, monoCardId, startUnix, endUnix);

          if (monoData.length === 0) {
            updateSyncProgress({
              lastStep: {
                key,
                ok: true,
                txCount: 0,
                added: 0,
                updated: 0,
                chunkIndex,
                finishedAtMs: Date.now(),
              },
              chunkCompletedKeys: [...(syncProgress?.chunkCompletedKeys || []), key],
            });
          } else {
            const txs = toActualTransactions(actualId, monoData);
            const result = await actualApi().importTransactions(actualId, txs);
            updateSyncProgress({
              lastStep: {
                key,
                ok: true,
                txCount: monoData.length,
                added: (result.added || []).length,
                updated: (result.updated || []).length,
                chunkIndex,
                finishedAtMs: Date.now(),
              },
              chunkCompletedKeys: [...(syncProgress?.chunkCompletedKeys || []), key],
            });
          }
        } catch (err) {
          console.error(`Failed card ${monoCardId}:`, err.message);
          updateSyncProgress({
            lastStep: {
              key,
              ok: false,
              errorMessage: String(err?.message || err),
              chunkIndex,
              finishedAtMs: Date.now(),
            },
            chunkErrorKeys: [...(syncProgress?.chunkErrorKeys || []), key],
          });
        }

        // Respect Mono rate limit (1 req / 60s) — skip sleep after the very last request
        const isLastCard = i === plannedCards.length - 1;
        if (!isLastCard || hasMoreChunks) {
          const until = Date.now() + 60_000;
          updateSyncProgress({ phase: 'sleeping', sleepUntilMs: until, sleepReason: 'mono_rate_limit' });
          await sleep(60_000);
          updateSyncProgress({ phase: 'syncing', sleepUntilMs: null, sleepReason: null });
        }
      }

      endDate = startDate;
      remaining -= chunk;
    }
  } catch (err) {
    syncError = err;
    updateSyncProgress({
      phase: 'error',
      errorStage: String(err?.stage || 'unknown'),
      errorMessage: String(err?.message || err),
      finishedAtMs: Date.now(),
      currentKey: null,
      sleepUntilMs: null,
      sleepReason: null,
    });
    throw err;
  } finally {
    try {
      if (actualInitialized) {
        await actualApi().shutdown();
      }
    } catch (err) {
      console.warn('⚠️ Actual API shutdown warning:', err.message);
    }
    isActualBusy = false;
    syncInProgress = false;
    if (!syncError) {
      updateSyncProgress({
        phase: 'done',
        finishedAtMs: Date.now(),
        currentKey: null,
        sleepUntilMs: null,
        sleepReason: null,
      });
    }
  }
}

// --- Account Fetching ---

const CURRENCY = { 980: 'UAH', 840: 'USD', 978: 'EUR', 985: 'PLN', 826: 'GBP' };
const getCur = (code) => CURRENCY[code] || code;
const getMasked = (iban) => iban ? iban.slice(0, 4) + '***' + iban.slice(-4) : 'Unknown';

/**
 * Fetch Actual accounts and Monobank client info for the mapping UI.
 * @param {object} config - Decrypted app config.
 * @returns {Promise<{monoCards: Array, actualAccounts: Array}>}
 */
async function fetchAccountsData(config) {
  if (isActualBusy) {
    throw new Error('System is currently busy syncing. Please wait a moment and try again.');
  }
  isActualBusy = true;
  let actualAccounts = [];
  let monoCards = [];
  let actualInitialized = false;
  let actualShutdown = false;

  async function shutdownActual() {
    if (!actualInitialized || actualShutdown) return;
    actualShutdown = true;
    try {
      await actualApi().shutdown();
    } catch (shutdownErr) {
      console.warn('⚠️ Actual API shutdown warning:', shutdownErr.message);
    }
  }

	  try {
	    // 1. Fetch Actual Budget accounts
	    const cacheDir = config.cacheDir || path.join(__dirname, 'data', '.cache');
	    if (!fs.existsSync(cacheDir)) fs.mkdirSync(cacheDir, { recursive: true });
	    const actualUrl = typeof config?.actualUrl === 'string' ? config.actualUrl.trim() : '';
	    const actualPassword = typeof config?.actualPassword === 'string' ? config.actualPassword : '';

	    try {
	      await actualApi().init({
	        dataDir: cacheDir,
	        serverURL: actualUrl,
	        password: actualPassword,
	      });
	      actualInitialized = true;
	    } catch (err) {
	      const msg = String(err?.message || err);
	      if (isLikelyNetworkFailureMessage(msg)) {
	        throw new Error(`Actual Budget Error: Could not reach server at ${config.actualUrl}. Check if it is running. (Details: ${msg})`);
	      }
	      throw new Error(`Actual Budget Error: Initialization failed. Check your Server URL. (${msg})`);
	    }

    try {
      await actualApi().downloadBudget(config.actualSyncId);
      const accounts = await actualApi().getAccounts();
      actualAccounts = accounts.map(a => ({ id: a.id, name: a.name }));
	    } catch (err) {
	      if (err.message.includes('remote files')) {
	        throw new Error(`Actual Budget Error: Check your Budget Sync ID and Password. (Details: ${err.message})`);
	      } else if (err.message.includes('password')) {
	        throw new Error(`Actual Budget Error: Invalid Server Password.`);
	      } else if (err.message.includes('fetch') || err.message.includes('network-failure')) {
	        throw new Error(`Actual Budget Error: Could not reach server at ${config.actualUrl}. Check if it is running.`);
	      }
	      throw new Error(`Actual Budget Error: ${err.message}`);
	    } finally {
      await shutdownActual();
    }

    // 2. Fetch Monobank client info
    const monoUrl = `${config.monoUrl}/personal/client-info`;
    let monoRes;
    
    try {
      monoRes = await fetch(monoUrl, {
        headers: { 'X-Token': config.monoToken },
      });
    } catch (err) {
      throw new Error(`Monobank Error: Network failure. Could not reach api.monobank.ua.`);
    }

    // Handle specific HTTP error codes from Monobank
    if (monoRes.status === 429) throw new Error('MONO_429');
    if (monoRes.status === 403) throw new Error('Monobank Error: Invalid Personal Token. Please check your API key.');
    if (!monoRes.ok) throw new Error(`Monobank Error: Unexpected response ${monoRes.status} ${monoRes.statusText}`);
    
    const monoData = await monoRes.json();

    // Parse Main Accounts
    if (monoData.accounts) {
      monoData.accounts.forEach(acc => {
        const pan = acc.maskedPan && acc.maskedPan.length > 0 ? acc.maskedPan[0] : getMasked(acc.iban);
        monoCards.push({ id: acc.id, name: `${getCur(acc.currencyCode)} ${acc.type} ${pan}` });
      });
    }
    
    // Parse Jars (Банки)
    if (monoData.jars) {
      monoData.jars.forEach(jar => {
        monoCards.push({ id: jar.id, name: `Jar: ${jar.title} (${getCur(jar.currencyCode)})` });
      });
    }
    
    // Parse Managed Clients (FOP Accounts)
    if (monoData.managedClients) {
      monoData.managedClients.forEach(client => {
        if (client.accounts) {
          client.accounts.forEach(acc => {
            const pan = acc.maskedPan && acc.maskedPan.length > 0 ? acc.maskedPan[0] : getMasked(acc.iban);
            monoCards.push({ id: acc.id, name: `FOP ${getCur(acc.currencyCode)} ${acc.type} ${pan}` });
          });
        }
      });
    }

    return { monoCards, actualAccounts };
  } finally {
    await shutdownActual();
    isActualBusy = false;
  }
}

function isSyncing() {
  return syncInProgress;
}

function getSyncProgress() {
  return syncProgress;
}

module.exports = { sync, fetchAccountsData, isSyncing, getSyncProgress };
