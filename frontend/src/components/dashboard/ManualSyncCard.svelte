<script>
  import MappingPicker from './MappingPicker.svelte';
  import SyncControls from './SyncControls.svelte';

  let {
    config,
    activeMappings,
    isReady,
    saveConfig,
    triggerSync,
    syncStatus,
    syncDetails,
    isBackendSyncing,
    cooldown,
  } = $props();

  let selectedMappings = $state([]);
</script>

<article>
  <header class="dash-header">
    <strong>Manual Sync Engine</strong>
    <span class="badge">{activeMappings.length} Active Routes</span>
  </header>

  {#if !isReady}
    <div style="padding: 1rem 0;">
      <mark>⚠️ Configuration Incomplete</mark>
      <p style="margin-top: 0.5rem;"><small>Please configure your API connections first.</small></p>
    </div>
  {:else}
    <div class="dash-grid">
      <div class="col-picker">
        <MappingPicker {config} {activeMappings} bind:selectedMappings />
      </div>

      <div class="col-action">
        <SyncControls
          {config}
          {saveConfig}
          {triggerSync}
          {syncStatus}
          {syncDetails}
          {isBackendSyncing}
          {cooldown}
          {isReady}
          {selectedMappings}
        />
      </div>
    </div>
  {/if}
</article>

<style>
  .dash-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
    flex-wrap: wrap;
    background-color: var(--pico-form-element-background-color);
  }

  .badge {
    font-size: 0.75rem;
    background: var(--pico-primary-background);
    color: var(--pico-primary-inverse);
    padding: 0.2rem 0.6rem;
    border-radius: 1rem;
    white-space: nowrap;
    font-weight: bold;
  }

  .dash-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: 2rem;
    padding-top: 1rem;
  }

  .col-picker {
    overflow: hidden;
  }
</style>
