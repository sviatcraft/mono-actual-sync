<script>
  import { onMount } from 'svelte';
  
  import Header from './components/Header.svelte';
  import Sidebar from './components/Sidebar.svelte';
  import Dashboard from './components/Dashboard.svelte';
  import Connections from './components/Connections.svelte';
  import Mapping from './components/Mapping.svelte';

  // State Management
  let currentView = $state('dashboard');
  let isLoading = $state(true);
  let saveStatus = $state('');
  let syncStatus = $state('');
  let syncDetails = $state(null);
  let isBackendSyncing = $state(false);
  let syncTriggeredByUser = $state(false);
  let cooldown = $state(0);
  let cooldownTimer;
  let syncPollTimer;
  
  let theme = $state('dark'); 

  let config = $state({
    monoToken: '',
    actualUrl: '',
    actualPassword: '',
    actualSyncId: '',
    cards: [],
    daysToSyncManual: 7,
    useNodeCron: false,
    cronInterval: 'hourly',
    accountCache: { monoCards: [], actualAccounts: [] }
  });

  let isConnected = $state(false);
  let hasMappings = $state(false); 

  // In Docker we serve the frontend from the same Express server, so same-origin
  // relative URLs Just Work. In local dev, Vite proxies `/api` to the backend.
  const API_URL = '/api';

  onMount(async () => {
    const storedTheme = localStorage.getItem('theme');
    if (storedTheme) {
      theme = storedTheme;
    } else if (window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) {
      theme = 'light';
    }
    document.documentElement.setAttribute('data-theme', theme);

    try {
      const response = await fetch(`${API_URL}/config`);
      if (response.ok) {
        const fetchedData = await response.json();
        
        if (fetchedData.cooldown && fetchedData.cooldown > 0) {
          startCooldown(fetchedData.cooldown);
        }
        
        delete fetchedData.cooldown;
        
        config = { ...config, ...fetchedData };
        
        isConnected = !!config.monoToken && !!config.actualUrl;
  
        hasMappings = config.cards && config.cards.filter(c => c.monoCardId && c.actualAccountId).length > 0;
        
        if (!isConnected) {
          currentView = 'connections';
        } else if (!hasMappings) {
          currentView = 'mapping';     
        }
      }
    } catch {
      // Config fetch failed — will show default UI
    } finally {
      isLoading = false;
    }

    startSyncStatusPolling();
  });

  function toggleTheme(e) {
    if (e) e.preventDefault();
    theme = theme === "light" ? "dark" : "light";
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }
  
  function startCooldown(seconds) {
    cooldown = seconds;
    clearInterval(cooldownTimer);
    cooldownTimer = setInterval(() => {
      cooldown = Math.max(0, cooldown - 1);
      if (cooldown === 0) {
        clearInterval(cooldownTimer);
        cooldownTimer = undefined;
      }
    }, 1000);
  }

  async function fetchApiData(configToTest = config) {
    if (cooldown > 0) return { success: false, error: `Rate limit active. Wait ${cooldown}s.` };
    
    try {
      const res = await fetch(`${API_URL}/fetch-accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(configToTest)
      });
      const data = await res.json();
      
      if (res.ok) {
        config.accountCache = data.data; 
        
        startCooldown(60); 
        return { success: true };
      } else if (res.status === 429) {
        startCooldown(data.waitTime); 
        return { success: false, error: data.error };
      } else {
        return { success: false, error: data.error || 'Verification failed.' };
      }
    } catch (e) {
      return { success: false, error: 'Network communication error.' };
    }
  }

  async function saveConfig() {
    saveStatus = 'saving';
    try {
      const res = await fetch(`${API_URL}/config`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        saveStatus = 'saved';
        setTimeout(() => saveStatus = '', 3000);
        
        const newlyConnected = !!config.monoToken && !!config.actualUrl;
        const newlyMapped = config.cards && config.cards.filter(c => c.monoCardId && c.actualAccountId).length > 0;

        if (newlyMapped && !hasMappings && currentView === 'mapping') {
           setTimeout(() => currentView = 'dashboard', 1000);
        }
        if (!newlyConnected && currentView !== 'connections') {
           currentView = 'connections';
        }

        isConnected = newlyConnected;
        hasMappings = newlyMapped;
      } else {
        saveStatus = 'error';
      }
    } catch (e) {
      saveStatus = 'error';
    }
  }

  async function triggerSync(selectedMappings, options = {}) {
    if (cooldown > 0) return; 
    syncTriggeredByUser = true;
    syncStatus = 'syncing';
    try {
      const hasSelection = Array.isArray(selectedMappings);
      const body = {};
      if (hasSelection) body.selectedMappings = selectedMappings;
      if (options.dateFrom && options.dateTo) {
        body.dateFrom = options.dateFrom;
        body.dateTo = options.dateTo;
      }
      const res = await fetch(`${API_URL}/sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok || res.status === 202) {
        pollSyncStatus();
      } else if (res.status === 429) {
        const data = await res.json();
        startCooldown(data.waitTime);
        syncStatus = 'error';
      } else {
        syncStatus = 'error';
      }
    } catch (e) {
      syncStatus = 'error';
    }
  }

  async function pollSyncStatus() {
    try {
      const res = await fetch(`${API_URL}/sync-status`);
      const data = await res.json();

      const prevIsSyncing = isBackendSyncing;

      if (data && 'progress' in data) {
        syncDetails = data.progress;
      }
      if (data && typeof data.isSyncing === 'boolean') {
        isBackendSyncing = data.isSyncing;
      }

	      // Apply "completion" UI side-effects:
	      // - on a real transition syncing → not syncing
	      // - OR if the sync finished before our first poll (fast failure/success)
	      const justFinished =
	        (prevIsSyncing && !data.isSyncing) ||
	        (syncTriggeredByUser && syncStatus === 'syncing' && !data.isSyncing && Boolean(data?.progress?.finishedAtMs));
	      if (justFinished) {
	        if (syncTriggeredByUser || syncStatus === 'syncing') {
	          const phase = data?.progress?.phase;
	          if (phase === 'error') {
	            syncStatus = 'error';
	            setTimeout(() => (syncStatus = ''), 5000);
	          } else {
	            syncStatus = 'success';
	            startCooldown(60);
	            setTimeout(() => (syncStatus = ''), 3000);
	          }
	        }
	        syncTriggeredByUser = false;
	      }
	    } catch (e) {
      if (syncTriggeredByUser) {
        syncStatus = 'error';
      }
    }
  }

  function startSyncStatusPolling() {
    clearInterval(syncPollTimer);
    pollSyncStatus();
    syncPollTimer = setInterval(pollSyncStatus, 3000);
  }
</script>

<Header {toggleTheme} />

<main class="container-fluid app-layout">
  
  {#if isLoading}
    <div style="width: 100%; text-align: center; margin-top: 10vh;">
      <p aria-busy="true">Loading system configuration...</p>
    </div>
  {:else}
    
    {#if isConnected && hasMappings}
      <Sidebar bind:activeTab={currentView} />
    {/if}

    <section class="app-content">

      {#if currentView === 'dashboard'}
        <Dashboard
          bind:config={config}
          {saveConfig}
          {saveStatus}
          {triggerSync}
          {syncStatus}
          {syncDetails}
          {isBackendSyncing}
          {cooldown}
        />
      
      {:else if currentView === 'connections'}
        <Connections 
          bind:config={config} 
          {saveConfig} 
          {fetchApiData} 
          {cooldown} 
          changeView={(view) => currentView = view} 
        />
      
      {:else if currentView === 'mapping'}
        <Mapping 
          bind:config={config} 
          {saveConfig} 
          {saveStatus}
          {fetchApiData} 
          {cooldown}
          changeView={(view) => currentView = view} 
        />
      
      {/if}

    </section>
    
  {/if}
</main>

<style>
  /* Mobile First: Stack vertically and add bottom padding so the footer doesn't cover content */
  .app-layout {
    display: flex;
    flex-direction: column;
    gap: 1rem;
    padding-top: 1rem;
    padding-bottom: 5rem; /* Space for the mobile bottom nav */
    max-width: 1200px;
    margin: 0 auto;
  }

  .app-content {
    flex-grow: 1;
  }

  /* Desktop View: Switch back to the side-by-side flex layout */
  @media (min-width: 1024px) {
    .app-layout {
      flex-direction: row;
      gap: 2rem;
      padding-bottom: 4rem;
    }
  }
</style>
