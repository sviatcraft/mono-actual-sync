<script>
  let { config, saveConfig, triggerSync, syncStatus, isBackendSyncing, cooldown, isReady, selectedMappings } =
    $props();

  const PRESETS = [
    { label: '7d', days: 7 },
    { label: '14d', days: 14 },
    { label: '30d', days: 30 },
    { label: '90d', days: 90 },
  ];

  let mode = $state(config?.manualSyncMode || 'quick');
  let customDays = $state(config?.daysToSyncManual || 7);
  let selectedMonth = $state(config?.manualMonth || getCurrentMonth());
  let dateFrom = $state(config?.manualDateFrom || defaultDateFrom());
  let dateTo = $state(config?.manualDateTo || todayISO());

  function todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function defaultDateFrom() {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function getCurrentMonth() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }

  function generateMonths() {
    const months = [];
    const now = new Date();
    for (let i = 0; i < 12; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const label = d.toLocaleString('default', { month: 'long', year: 'numeric' });
      months.push({ value, label });
    }
    return months;
  }

  function monthToDateRange(monthStr) {
    const [year, month] = monthStr.split('-').map(Number);
    const from = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const to = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
    const today = todayISO();
    return { dateFrom: from, dateTo: to > today ? today : to };
  }

  const months = generateMonths();

  let dateRangeValid = $derived(dateFrom && dateTo && dateFrom <= dateTo);

  function persistMode() {
    config.manualSyncMode = mode;
    if (mode === 'quick') {
      config.daysToSyncManual = customDays;
    } else if (mode === 'month') {
      config.manualMonth = selectedMonth;
    } else {
      config.manualDateFrom = dateFrom;
      config.manualDateTo = dateTo;
    }
    if (typeof saveConfig === 'function') saveConfig();
  }

  function handleSync() {
    const mappings = selectedMappings.map(({ monoCardId, actualAccountId }) => ({ monoCardId, actualAccountId }));

    if (mode === 'quick') {
      triggerSync(mappings, { daysToSync: customDays });
    } else if (mode === 'month') {
      const range = monthToDateRange(selectedMonth);
      triggerSync(mappings, range);
    } else {
      triggerSync(mappings, { dateFrom, dateTo });
    }
  }

  function selectPreset(days) {
    customDays = days;
    config.daysToSyncManual = days;
    if (typeof saveConfig === 'function') saveConfig();
  }

  function changeDays(delta) {
    const nextVal = customDays + delta;
    if (nextVal >= 1 && nextVal <= 366) {
      customDays = nextVal;
      config.daysToSyncManual = customDays;
      if (typeof saveConfig === 'function') saveConfig();
    }
  }

  function syncButtonLabel() {
    if (cooldown > 0) return `⏳ Cooldown: ${cooldown}s`;
    if (syncStatus === 'success') return '✅ Sync Triggered!';
    if (syncStatus === 'error') return '❌ Sync Failed';
    if (mode === 'quick') return `🔄 Sync Last ${customDays} Days`;
    if (mode === 'month') {
      const m = months.find((m) => m.value === selectedMonth);
      return `🔄 Sync ${m?.label || selectedMonth}`;
    }
    return `🔄 Sync Range`;
  }

  let canSync = $derived(
    isReady && !isBackendSyncing && cooldown === 0 && selectedMappings.length > 0 &&
    (mode !== 'daterange' || dateRangeValid)
  );
</script>

<div class="sync-controls" style="padding: 0.25rem 0 1rem;">

  <div class="segmented-control" role="group">
    <button
      class="seg-btn"
      class:active={mode === 'quick'}
      onclick={() => { mode = 'quick'; persistMode(); }}
      type="button"
    >Quick</button>
    <button
      class="seg-btn"
      class:active={mode === 'month'}
      onclick={() => { mode = 'month'; persistMode(); }}
      type="button"
    >By Month</button>
    <button
      class="seg-btn"
      class:active={mode === 'daterange'}
      onclick={() => { mode = 'daterange'; persistMode(); }}
      type="button"
    >Custom Range</button>
  </div>

  {#if mode === 'quick'}
    <div class="tab-content">
      <div class="preset-row">
        {#each PRESETS as preset}
          <button
            type="button"
            class="preset-btn"
            class:active={customDays === preset.days}
            onclick={() => selectPreset(preset.days)}
            disabled={!isReady || isBackendSyncing}
          >{preset.label}</button>
        {/each}
      </div>
      
      <fieldset role="group" style="margin-bottom: 0; margin-top: 0.75rem;">
        <button 
          type="button" 
          class="secondary outline stepper-btn" 
          onclick={() => changeDays(-1)}
          disabled={customDays <= 1 || !isReady || isBackendSyncing}
          aria-label="Decrease days"
        >
          &minus;
        </button>
        
        <div class="stepper-display">
          {customDays} Day{customDays === 1 ? '' : 's'}
        </div>
        
        <button 
          type="button" 
          class="secondary outline stepper-btn" 
          onclick={() => changeDays(1)}
          disabled={customDays >= 366 || !isReady || isBackendSyncing}
          aria-label="Increase days"
        >
          &plus;
        </button>
      </fieldset>
    </div>
  {/if}

  {#if mode === 'month'}
    <div class="tab-content">
      <select
        bind:value={selectedMonth}
        disabled={!isReady || isBackendSyncing}
        onchange={() => {
          config.manualMonth = selectedMonth;
          if (typeof saveConfig === 'function') saveConfig();
        }}
        aria-label="Select month"
        style="margin-bottom: 0;"
      >
        {#each months as m}
          <option value={m.value}>{m.label}</option>
        {/each}
      </select>
      <small style="color: var(--pico-muted-color); display: block; margin-top: 0.35rem;">
        {(() => { const r = monthToDateRange(selectedMonth); return `${r.dateFrom} → ${r.dateTo}`; })()}
      </small>
    </div>
  {/if}

  {#if mode === 'daterange'}
    <div class="tab-content">
      <div class="date-range-row">
        <div class="date-field">
          <label for="sync-from"><small>From</small></label>
          <input
            id="sync-from"
            type="date"
            bind:value={dateFrom}
            max={dateTo || todayISO()}
            disabled={!isReady || isBackendSyncing}
            onchange={() => {
              config.manualDateFrom = dateFrom;
              if (typeof saveConfig === 'function') saveConfig();
            }}
          />
        </div>
        <div class="date-field">
          <label for="sync-to"><small>To</small></label>
          <input
            id="sync-to"
            type="date"
            bind:value={dateTo}
            min={dateFrom}
            max={todayISO()}
            disabled={!isReady || isBackendSyncing}
            onchange={() => {
              config.manualDateTo = dateTo;
              if (typeof saveConfig === 'function') saveConfig();
            }}
          />
        </div>
      </div>
      {#if dateFrom && dateTo && dateFrom > dateTo}
        <small style="color: var(--pico-del-color);">"From" must be before "To".</small>
      {/if}
    </div>
  {/if}

  <form
    onsubmit={(e) => {
      e.preventDefault();
      handleSync();
    }}
    style="margin-top: 1rem;"
  >
    <button
      type="submit"
      aria-busy={syncStatus === 'syncing' || isBackendSyncing}
      disabled={!canSync}
      style="width: 100%;"
    >
      {syncButtonLabel()}
    </button>
  </form>

  {#if selectedMappings.length === 0}
    <p style="margin-top: 0.75rem; margin-bottom: 0; color: var(--pico-del-color); text-align: center;">
      <small>Select at least 1 mapping to sync.</small>
    </p>
  {/if}
</div>

<style>
  .segmented-control {
    display: flex;
    border: 1px solid var(--pico-form-element-border-color);
    border-radius: var(--pico-border-radius);
    overflow: hidden;
    margin-bottom: 0.75rem;
  }

  .seg-btn {
    flex: 1;
    padding: 0.4rem 0.5rem;
    border: none;
    border-radius: 0;
    background: transparent;
    color: var(--pico-contrast);
    font-size: 0.8rem;
    font-weight: 600;
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    margin: 0;
  }

  .seg-btn:not(:last-child) {
    border-right: 1px solid var(--pico-form-element-border-color);
  }

  .seg-btn.active {
    background: var(--pico-primary-background);
    color: var(--pico-secondary-inverse)
  }

  .seg-btn:hover:not(.active) {
    background: var(--pico-form-element-background-color);
  }

  .tab-content {
    padding: 0.25rem 0;
  }

  .preset-row {
    display: flex;
    gap: 0.4rem;
  }

  .preset-btn {
    flex: 1;
    padding: 0.35rem 0.5rem;
    font-size: 0.8rem;
    font-weight: 600;
    border: 1px solid var(--pico-form-element-border-color);
    border-radius: var(--pico-border-radius);
    background: transparent;
    color: var(--pico-contrast);
    cursor: pointer;
    transition: background 0.15s, color 0.15s;
    margin: 0;
  }

  .preset-btn.active {
    background: var(--pico-primary-background);
    color: var(--pico-secondary-inverse);
    border-color: var(--pico-primary-background);
  }

  .preset-btn:hover:not(.active):not(:disabled) {
    background: var(--pico-form-element-background-color);
  }

  /* New Stepper CSS */
  .stepper-btn {
    flex: 0 0 3rem; /* Fixed width for the plus/minus buttons */
    font-size: 1.2rem;
    font-weight: bold;
    padding: 0;
  }

  .stepper-display {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    border-top: 1px solid var(--pico-form-element-border-color);
    border-bottom: 1px solid var(--pico-form-element-border-color);
    background: var(--pico-form-element-background-color);
    font-size: 0.9rem;
    font-weight: bold;
    color: var(--pico-contrast);
  }

  .date-range-row {
    display: flex;
    gap: 0.75rem;
  }

  .date-field {
    flex: 1;
  }

  .date-field label {
    margin-bottom: 0.15rem;
  }

  .date-field input {
    margin-bottom: 0;
  }
</style>