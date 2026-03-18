<script>
  import ManualSyncCard from './dashboard/ManualSyncCard.svelte';
  import BackgroundAutomationCard from './dashboard/BackgroundAutomationCard.svelte';
  import SyncProgressCard from './dashboard/SyncProgressCard.svelte';

  let {
    config = $bindable(),
    saveConfig,
    saveStatus,
    triggerSync,
    syncStatus,
    syncDetails,
    isBackendSyncing,
    cooldown,
  } = $props();

  let activeMappings = $derived(config?.cards?.filter(c => c.monoCardId && c.actualAccountId) || []);
  let isReady = $derived(!!config?.monoToken && !!config?.actualUrl);
  let progressStepStats = $state({});
</script>

<div class="dashboard-layout">
  <div class="cards-stack" style="display: flex; flex-direction: column; gap: 1.5rem;">
    
    <section>
      <BackgroundAutomationCard bind:config {saveConfig} {saveStatus} {isReady} />
    </section>

    <section>
      {#if isBackendSyncing || syncDetails?.startedAtMs}
        <div class="progress-wrapper" style="margin-bottom: 1.5rem;">
          <SyncProgressCard
            {config}
            {activeMappings}
            {syncDetails}
            {isBackendSyncing}
            stepStats={progressStepStats}
          />
        </div>
      {/if}
    </section>

    <section>
      <ManualSyncCard
        {config}
        {activeMappings}
        {isReady}
        {saveConfig}
        {triggerSync}
        {syncStatus}
        {syncDetails}
        {isBackendSyncing}
        {cooldown}
      />
    </section>

  </div>
</div>