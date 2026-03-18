<script>
  let { config = $bindable(), saveConfig, saveStatus, isReady } = $props();

  const FREQUENCIES = [
    { value: 'daily', label: 'Daily', cron: '2:00 AM' },
    { value: 'hourly', label: 'Hourly', cron: 'every hour at :00' },
    { value: '30min', label: 'Every 30 min', cron: 'at :00 and :30' },
    { value: '15min', label: 'Every 15 min', cron: 'at :00, :15, :30, :45' },
  ];

  function getNextRunTime() {
    const interval = config?.cronInterval || 'hourly';
    const now = new Date();

    if (interval === 'daily') {
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 2, 0, 0);
      if (next <= now) next.setDate(next.getDate() + 1);
      return next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (interval === 'hourly') {
      const next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0);
      return next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    if (interval === '30min') {
      const mins = now.getMinutes();
      const nextMin = mins < 30 ? 30 : 0;
      const next = new Date(now);
      next.setMinutes(nextMin, 0, 0);
      if (nextMin === 0) next.setHours(next.getHours() + 1);
      return next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }

    const mins = now.getMinutes();
    const nextMin = Math.ceil((mins + 1) / 15) * 15;
    const next = new Date(now);
    if (nextMin >= 60) {
      next.setHours(next.getHours() + 1);
      next.setMinutes(0, 0, 0);
    } else {
      next.setMinutes(nextMin, 0, 0);
    }
    return next.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function save() {
    if (typeof saveConfig === 'function') saveConfig();
  }

  function selectFrequency(value) {
    config.cronInterval = value;
    save();
  }
</script>

<article>
  <header style="display: flex; justify-content: space-between; align-items: center; background-color: var(--pico-form-element-background-color);">
    <strong>Background Automation</strong>
    {#if config?.useNodeCron}
      <span style="font-size: 0.8rem; color: var(--pico-ins-color); font-weight: bold;">● Active</span>
    {:else}
      <span style="font-size: 0.8rem; color: var(--pico-del-color); font-weight: bold;">○ Disabled</span>
    {/if}
  </header>

  {#if !isReady}
    <p style="margin: 1rem 0 0; font-size: 0.85rem; color: var(--pico-muted-color);">
      <small>Automation will unlock once your Connections are configured.</small>
    </p>
  {:else}
    <div style="margin-top: 0.5rem;">
      <div class="automation-grid">
        
        <!-- Enable/Disable Toggle -->
        <div class="setting-row">
          <div>
            <label style="margin-bottom: 0.25rem;"><strong>Enable Automation</strong></label>
            <div style="font-size: 0.8rem; color: var(--pico-muted-color);">
              {#if config?.useNodeCron}
                Next run: <strong style="color: var(--pico-color);">~ {getNextRunTime()}</strong>
              {:else}
                Automatically sync transactions on a schedule.
              {/if}
            </div>
          </div>
          <div style="margin-left: 1rem;">
            <input type="checkbox" role="switch" bind:checked={config.useNodeCron} onchange={save} style="margin: 0;" />
          </div>
        </div>

        {#if config?.useNodeCron}
          <hr style="margin: 1rem 0;" />

          <!-- Frequency Selector -->
          <div>
            <label style="margin-bottom: 0.5rem; display: block;"><strong>Sync Frequency</strong></label>
            <div class="freq-row">
              {#each FREQUENCIES as freq}
                <button
                  type="button"
                  class="freq-btn"
                  class:active={(config.cronInterval || 'hourly') === freq.value}
                  onclick={() => selectFrequency(freq.value)}
                >{freq.label}</button>
              {/each}
            </div>
            <small style="color: var(--pico-muted-color); display: block; margin-top: 0.5rem;">
              Runs {FREQUENCIES.find((f) => f.value === (config.cronInterval || 'hourly'))?.cron || 'every hour'}
              &nbsp;·&nbsp; Syncs last <strong>7 days</strong> each run
            </small>
          </div>
        {/if}

      </div>
    </div>
  {/if}
</article>

<style>
  .automation-grid {
    display: flex;
    flex-direction: column;
  }

  .setting-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.5rem 0;
  }

  .freq-row {
    display: flex;
    gap: 0.4rem;
    flex-wrap: wrap;
  }

  .freq-btn {
    flex: 1;
    min-width: 80px;
    padding: 0.4rem 0.5rem;
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

  .freq-btn.active {
    background: var(--pico-primary-background);
    color: var(--pico-secondary-inverse);
    border-color: var(--pico-primary-background);
  }

  .freq-btn:hover:not(.active) {
    background: var(--pico-form-element-background-color);
  }
</style>