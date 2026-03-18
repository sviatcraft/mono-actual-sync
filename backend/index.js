const express = require('express');
const cors = require('cors');
const fs = require('fs/promises');
const fsSync = require('fs');
const path = require('path');
const crypto = require('crypto');
const cron = require('node-cron');
const { z } = require('zod');

/** Polyfill: some `@actual-app/api` transitive deps assume a browser `navigator`. */
if (!globalThis.navigator) {
  globalThis.navigator = { userAgent: 'node' };
}

/** Prevent crashes from third-party unhandled background errors (e.g. Actual API). */
process.on('unhandledRejection', (reason, promise) => {
  const message = String(reason?.message || reason);
  if (message.includes('Cannot read properties of null') && message.includes('toLowerCase')) {
    console.warn(
      '⚠️ Caught unhandled promise rejection (Actual API): unexpected server response (often wrong Actual URL or proxy/server error).'
    );
    return;
  }
  console.warn('⚠️ Caught unhandled promise rejection (likely Actual API background worker):', message);
});

process.on('uncaughtException', (err) => {
  console.error('⚠️ Caught uncaught exception:', err?.stack || err?.message || err);
});

const { sync, fetchAccountsData, isSyncing, getSyncProgress } = require('./monobankService.js');

const app = express();
const PORT = process.env.PORT || 9191;

/**
 * CORS — disabled by default (same-origin).
 * Set `CORS_ORIGIN` or `CORS_ORIGINS` env vars to allow cross-origin access.
 */
const rawCorsOrigins = [
  process.env.CORS_ORIGIN,
  ...(process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',') : []),
]
  .map((s) => (s || '').trim())
  .filter(Boolean);

if (rawCorsOrigins.length > 0) {
  const allowedOrigins = new Set(rawCorsOrigins);
  app.use(
    '/api',
    cors({
      origin(origin, cb) {
        // Non-browser clients (curl, server-to-server) often send no Origin.
        if (!origin) return cb(null, false);
        if (allowedOrigins.has(origin)) return cb(null, true);
        return cb(null, false);
      },
      methods: ['GET', 'POST', 'OPTIONS'],
      optionsSuccessStatus: 204,
    })
  );
}
app.use(express.json());

// --- Static frontend (Docker / production) ---
const PUBLIC_DIR = path.join(__dirname, 'public');
app.use(express.static(PUBLIC_DIR));

const DATA_DIR = path.join(__dirname, 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

/** Writes config atomically via tmp file + rename to avoid partial writes. */
async function writeConfigAtomically(fileContent) {
  await fs.mkdir(DATA_DIR, { recursive: true });
  const tempPath = `${CONFIG_PATH}.tmp`;
  // Write to the temporary file first
  await fs.writeFile(tempPath, JSON.stringify(fileContent, null, 2), 'utf-8');
  // Atomically replace the old config with the new one
  await fs.rename(tempPath, CONFIG_PATH);
}

const DEFAULT_CONFIG = {
  monoUrl: 'https://api.monobank.ua',
  monoToken: '',
  actualUrl: 'http://192.168.1.100:15006',
  actualPassword: '',
  actualSyncId: '',
  cards: [{ monoCardId: '', actualAccountId: '' }],
  daysToSyncManual: 7,
  useNodeCron: false,
  cronInterval: 'hourly',
};

const CRON_EXPRESSIONS = {
  daily: '0 2 * * *',
  hourly: '0 * * * *',
  '30min': '0,30 * * * *',
  '15min': '0,15,30,45 * * * *',
};

const AUTOMATION_SYNC_DAYS = 7;

function nullishToUndefined(value) {
  return value === null || value === undefined ? undefined : value;
}

const cachedItemSchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .passthrough();

const configSchema = z
  .object({
    monoUrl: z.preprocess(nullishToUndefined, z.string().default(DEFAULT_CONFIG.monoUrl)),
    monoToken: z.preprocess(nullishToUndefined, z.string().default(DEFAULT_CONFIG.monoToken)),
    actualUrl: z.preprocess(nullishToUndefined, z.string().default(DEFAULT_CONFIG.actualUrl)),
    actualPassword: z.preprocess(nullishToUndefined, z.string().default(DEFAULT_CONFIG.actualPassword)),
    actualSyncId: z.preprocess(nullishToUndefined, z.string().default(DEFAULT_CONFIG.actualSyncId)),

    cards: z.preprocess(
      nullishToUndefined,
      z
        .array(
          z
            .object({
              monoCardId: z.preprocess(nullishToUndefined, z.string().default('')),
              actualAccountId: z.preprocess(nullishToUndefined, z.string().default('')),
            })
            .passthrough()
        )
        .default(DEFAULT_CONFIG.cards)
    ),

    daysToSyncManual: z.preprocess(
      nullishToUndefined,
      z.coerce.number().int().min(1).max(366).default(DEFAULT_CONFIG.daysToSyncManual)
    ),
    // Legacy field — kept for backward compat on load, ignored at runtime (auto-calculated)
    daysToSyncAutomation: z.preprocess(nullishToUndefined, z.coerce.number().int().min(1).max(366).optional()),
    useNodeCron: z.preprocess(nullishToUndefined, z.boolean().default(DEFAULT_CONFIG.useNodeCron)),
    cronInterval: z.preprocess(
      nullishToUndefined,
      z.enum(['daily', 'hourly', '30min', '15min']).default(DEFAULT_CONFIG.cronInterval)
    ),
    manualSyncMode: z.preprocess(nullishToUndefined, z.enum(['quick', 'month', 'daterange']).optional()),
    manualDateFrom: z.preprocess(nullishToUndefined, z.string().optional()),
    manualDateTo: z.preprocess(nullishToUndefined, z.string().optional()),
    manualMonth: z.preprocess(nullishToUndefined, z.string().optional()),

    accountCache: z.preprocess(
      nullishToUndefined,
      z
        .object({
          monoCards: z.preprocess(nullishToUndefined, z.array(cachedItemSchema).default([])),
          actualAccounts: z.preprocess(nullishToUndefined, z.array(cachedItemSchema).default([])),
        })
        .passthrough()
        .default({ monoCards: [], actualAccounts: [] })
    ),

    cacheDir: z.preprocess(nullishToUndefined, z.string().optional()),
    chunkSize: z.preprocess(nullishToUndefined, z.coerce.number().int().min(1).max(31).optional()),
  })
  .passthrough();

function validateConfigOr400(payload, res) {
  if (payload?.cards && Array.isArray(payload.cards)) {
    const hasLegacyField = payload.cards.some(
      (c) => c && typeof c === 'object' && 'actualAccountName' in c
    );
    if (hasLegacyField) {
      res.status(400).json({
        error: 'Invalid config',
        issues: [
          {
            path: 'cards[].actualAccountName',
            message: 'Unsupported field. Use cards[].actualAccountId instead.',
          },
        ],
      });
      return null;
    }
  }

  const result = configSchema.safeParse(payload);
  if (!result.success) {
    const issues = result.error.issues.map((i) => ({
      path: i.path.join('.') || 'config',
      message: i.message,
    }));
    res.status(400).json({ error: 'Invalid config', issues });
    return null;
  }
  const config = result.data;
  if ('cooldown' in config) delete config.cooldown;
  if ('daysToSync' in config) delete config.daysToSync;
  return config;
}

// --- Encryption ---
const SECRET_PATH = path.join(DATA_DIR, '.encryption_key');
let ENCRYPTION_KEY;

// Ensure the data directory exists before we try to read/write the key
if (!fsSync.existsSync(DATA_DIR)) {
  fsSync.mkdirSync(DATA_DIR, { recursive: true });
}

// Zero-Config: Load existing key or generate a new one
if (fsSync.existsSync(SECRET_PATH)) {
  const rawKey = fsSync.readFileSync(SECRET_PATH, 'utf-8').trim();
  ENCRYPTION_KEY = crypto.createHash('sha256').update(rawKey).digest();
  console.log('🔒 Loaded existing encryption key.');
} else {
  const rawKey = crypto.randomBytes(32).toString('hex');
  fsSync.writeFileSync(SECRET_PATH, rawKey, 'utf-8');
  ENCRYPTION_KEY = crypto.createHash('sha256').update(rawKey).digest();
  console.log('🔑 Generated new encryption key. Saved to data/.encryption_key');
}

const ALGORITHM = 'aes-256-gcm';
const PAYLOAD_VERSION = 'v2';

function encryptData(data) {
  // GCM should use a 12-byte IV (recommended for performance/security).
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
  const plaintext = JSON.stringify(data);
  const ciphertextHex = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]).toString('hex');
  const tagHex = cipher.getAuthTag().toString('hex');
  // Versioned payload: v2:<ivHex>:<tagHex>:<ciphertextHex>
  return `${PAYLOAD_VERSION}:${iv.toString('hex')}:${tagHex}:${ciphertextHex}`;
}

function decryptData(encryptedString) {
  const parts = String(encryptedString || '').split(':');

  // v2:<ivHex>:<tagHex>:<ciphertextHex>
  if (parts.length === 4 && parts[0] === PAYLOAD_VERSION) {
    const iv = Buffer.from(parts[1], 'hex');
    const tag = Buffer.from(parts[2], 'hex');
    const ciphertext = Buffer.from(parts[3], 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, ENCRYPTION_KEY, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
    return JSON.parse(decrypted);
  }

  throw new Error('Unsupported encrypted payload format');
}

// Rate-limit gatekeeper: enforce 60 s cooldown between Monobank calls
let lastMonoCall = 0;

// --- Cron ---
let activeCronTask = null;

function updateCronJob(config) {
  if (activeCronTask) {
    activeCronTask.stop();
    activeCronTask = null;
  }

  if (config.useNodeCron && config.monoToken && config.actualUrl) {
    const interval = config.cronInterval || 'hourly';
    const cronExpr = CRON_EXPRESSIONS[interval] || CRON_EXPRESSIONS.hourly;
    console.log(`⏱️ Cron started (${interval}: ${cronExpr})`);
    activeCronTask = cron.schedule(cronExpr, () => {
      if (isSyncing()) return;
      if (Date.now() - lastMonoCall < 60000) return;

      const previousLastMonoCall = lastMonoCall;
      lastMonoCall = Date.now();

      sync({ ...config, daysToSync: AUTOMATION_SYNC_DAYS }).catch((err) => {
        const safeToReleaseGatekeeper =
          err?.stage === 'config' ||
          err?.code === 'ACTUAL_BAD_RESPONSE' ||
          err?.code === 'ACTUAL_UNREACHABLE' ||
          err?.stage === 'actual_init' ||
          String(err?.message || '').startsWith('Actual Budget unreachable');
        if (safeToReleaseGatekeeper) {
          lastMonoCall = previousLastMonoCall;
        }
        console.error('Cron sync failed:', err.message);
      });
    });
  }
}

// --- API ROUTES ---

app.get('/api/sync-status', (req, res) => {
  res.json({ isSyncing: isSyncing(), progress: getSyncProgress() });
});

app.get('/api/config', async (req, res) => {
  // Calculate remaining rate-limit cooldown
  const now = Date.now();
  const timeSinceLastSync = now - lastMonoCall;
  const waitTime = timeSinceLastSync < 60000 ? Math.ceil((60000 - timeSinceLastSync) / 1000) : 0;

  try {
    const fileData = await fs.readFile(CONFIG_PATH, 'utf-8');
    const parsedFile = JSON.parse(fileData);
    const decryptedConfig = decryptData(parsedFile.encryptedPayload);
    
    // Inject the cooldown into the response
    res.json({ ...decryptedConfig, cooldown: waitTime });
  } catch (error) {
    if (error.code === 'ENOENT') {
      res.json({ ...DEFAULT_CONFIG, cooldown: waitTime });
    } else {
      console.error('⚠️ Could not decrypt config (likely an ENCRYPTION_KEY change). Falling back to default setup. Error:', error.message);
      res.json({ ...DEFAULT_CONFIG, cooldown: waitTime });
    }
  }
});

app.post('/api/config', async (req, res) => {
  try {
    const newConfig = validateConfigOr400(req.body, res);
    if (!newConfig) return;
    const encryptedString = encryptData(newConfig);
    const fileContent = { encryptedPayload: encryptedString };
    
    await fs.mkdir(DATA_DIR, { recursive: true });
    await writeConfigAtomically(fileContent);
    updateCronJob(newConfig);
    res.json({ success: true, message: 'Configuration saved successfully!' });
  } catch (error) {
    console.error('Failed to save configuration:', error.message);
    res.status(500).json({ error: 'Failed to save configuration' });
  }
});

app.post('/api/fetch-accounts', async (req, res) => {
  if (isSyncing()) {
    return res.status(409).json({ error: 'Sync in progress. Please wait for it to finish.' });
  }

  const config = validateConfigOr400(req.body, res);
  if (!config) return;

  const now = Date.now();
  const timeSinceLastSync = now - lastMonoCall;

  if (timeSinceLastSync < 60000) {
    const waitTime = Math.ceil((60000 - timeSinceLastSync) / 1000);
    return res.status(429).json({ 
      error: `Rate limit active. Please wait ${waitTime}s.`, waitTime 
    });
  }

  const previousLastMonoCall = lastMonoCall;
  lastMonoCall = Date.now();

  try {
    const data = await fetchAccountsData(config);
    
    config.accountCache = data;
    const encryptedString = encryptData(config);
    await writeConfigAtomically({ encryptedPayload: encryptedString });

    res.json({ success: true, data });
  } catch (error) {
    const message = String(error?.message || '');
    const safeToReleaseGatekeeper =
      message.startsWith('Actual Budget Error:') ||
      message.includes('busy syncing') ||
      message.includes('currently busy syncing');

    if (safeToReleaseGatekeeper) {
      lastMonoCall = previousLastMonoCall;
    }

    if (error.message === 'MONO_429') {
      lastMonoCall = Date.now();
      return res.status(429).json({ error: 'Monobank rejected request. Wait 60s.', waitTime: 60 });
    }
    console.error('Fetch accounts failed:', error.message);
    res.status(500).json({ error: error.message || 'Failed to fetch API data.' });
  }
});

app.post('/api/sync', async (req, res) => {
  if (isSyncing()) {
    return res.status(409).json({ error: 'Sync already running. Please wait for it to finish.' });
  }

  const selectedMappings = Array.isArray(req.body?.selectedMappings) ? req.body.selectedMappings : null;
  const reqDateFrom = req.body?.dateFrom;
  const reqDateTo = req.body?.dateTo;

  const now = Date.now();
  const timeSinceLastSync = now - lastMonoCall;

  if (timeSinceLastSync < 60000) {
    const waitTime = Math.ceil((60000 - timeSinceLastSync) / 1000);
    return res.status(429).json({ 
      error: `Rate limit active. Please wait ${waitTime} seconds.`, waitTime 
    });
  }

  const previousLastMonoCall = lastMonoCall;
  lastMonoCall = Date.now();

  try {
    const fileData = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = decryptData(JSON.parse(fileData).encryptedPayload);

    // Determine sync window: explicit date range vs. daysToSync
    if (reqDateFrom && reqDateTo) {
      const from = new Date(reqDateFrom + 'T00:00:00');
      const to = new Date(reqDateTo + 'T23:59:59');
      const today = new Date();
      today.setHours(23, 59, 59, 999);

      if (isNaN(from.getTime()) || isNaN(to.getTime())) {
        lastMonoCall = previousLastMonoCall;
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
      }
      if (from > to) {
        lastMonoCall = previousLastMonoCall;
        return res.status(400).json({ error: '"dateFrom" must be on or before "dateTo".' });
      }
      if (to > today) {
        lastMonoCall = previousLastMonoCall;
        return res.status(400).json({ error: '"dateTo" cannot be in the future.' });
      }
      const spanDays = Math.ceil((to - from) / (1000 * 60 * 60 * 24)) + 1;
      if (spanDays > 366) {
        lastMonoCall = previousLastMonoCall;
        return res.status(400).json({ error: 'Date range cannot exceed 366 days.' });
      }

      config.dateFrom = reqDateFrom;
      config.dateTo = reqDateTo;
      config.daysToSync = spanDays;
    } else {
      const daysToSyncManual = Number(config?.daysToSyncManual);
      const effectiveDaysToSync =
        Number.isInteger(daysToSyncManual) && daysToSyncManual >= 1 && daysToSyncManual <= 366 ? daysToSyncManual : 7;
      config.daysToSync = effectiveDaysToSync;
    }

    if (selectedMappings) {
      const keys = new Set(
        selectedMappings
          .filter((m) => m && typeof m === 'object' && m.monoCardId && m.actualAccountId)
          .map((m) => `${m.monoCardId}::${m.actualAccountId}`)
      );

      const filtered = (config.cards || []).filter(
        (c) => c?.monoCardId && c?.actualAccountId && keys.has(`${c.monoCardId}::${c.actualAccountId}`)
      );

      if (filtered.length === 0) {
        lastMonoCall = previousLastMonoCall;
        return res.status(400).json({ error: 'No mappings selected for sync. Select at least one active mapping.' });
      }

      config.cards = filtered;
    }
    
	    sync(config)
	      .catch(err => {
	        const safeToReleaseGatekeeper =
	          err?.stage === 'config' ||
	          err?.code === 'ACTUAL_URL_MISSING' ||
	          err?.code === 'ACTUAL_SYNC_ID_MISSING' ||
	          err?.code === 'ACTUAL_BAD_RESPONSE' ||
	          err?.code === 'ACTUAL_UNREACHABLE' ||
	          err?.stage === 'actual_init' ||
	          String(err?.message || '').startsWith('Actual Budget unreachable');
	        if (safeToReleaseGatekeeper) {
	          lastMonoCall = previousLastMonoCall;
	        }
	        console.error('Manual sync failed:', err.message);
	      });

	    res.status(202).json({ success: true, message: 'Sync process started.' });
	  } catch (error) {
	    lastMonoCall = previousLastMonoCall;
	    res.status(500).json({ error: 'Failed to read config or start sync.' });
  }
});

// SPA fallback: serve the frontend app for any non-API route.
// Keep this after API routes so it doesn't swallow `/api/*`.
app.get(/^\/(?!api\/).*/, async (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'), (err) => {
    if (err) res.status(404).send('Not found');
  });
});

// --- START SERVER ---
app.listen(PORT, async () => {
  console.log(`🚀 Backend API running on http://localhost:${PORT}`);
  try {
    const fileData = await fs.readFile(CONFIG_PATH, 'utf-8');
    const config = decryptData(JSON.parse(fileData).encryptedPayload);
    updateCronJob(config);
  } catch (err) {
    console.log('No valid config found on boot. Waiting for user setup.');
  }
});
