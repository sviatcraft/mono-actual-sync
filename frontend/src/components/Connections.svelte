<script>
  let { config = $bindable(), saveConfig, fetchApiData, cooldown, changeView } = $props();

  let verifyState = $state('idle'); // idle | verifying | success | error
  let verifyError = $state('');

  async function handleVerifyAndSave() {
    verifyState = 'verifying';
    verifyError = '';

    const result = await fetchApiData(config);
    
    if (result.success) {
      await saveConfig();
      verifyState = 'success';
    } else {
      verifyState = 'error';
      verifyError = result.error;
    }
  }
</script>

<form onsubmit={(e) => { e.preventDefault(); handleVerifyAndSave(); }}>
  <hgroup>
    <h2>Connections</h2>
    <p>Configure your data source and destination servers.</p>
  </hgroup>

  <fieldset 
    disabled={verifyState === 'verifying' || verifyState === 'success'} 
    style="border: none; padding: 0; margin: 0;"
  >
    <article>
      <header>
        <strong>Destination: Actual Budget</strong>
      </header>
      
      <div class="grid">
        <label>
          Server URL
          <input 
            type="url" 
            bind:value={config.actualUrl} 
            placeholder="http://192.168.1.100:15006" 
            required 
          />
          <small>The local IP or domain of your Actual server.</small>
        </label>
        
        <label>
          Budget Sync ID
          <input 
            type="text" 
            bind:value={config.actualSyncId} 
            placeholder="My-Finances-183e" 
            required 
          />
          <small>Found in Actual Budget ➔ Settings ➔ Advanced.</small>
        </label>
      </div>

      <label>
        Server Password
        <input 
          type="text" 
          bind:value={config.actualPassword} 
          placeholder="Leave blank if no password" 
          style="-webkit-text-security: disc;" 
        />
      </label>
    </article>

    <article>
      <header>
        <strong>Source: Monobank API</strong>
      </header>
      
      <label>
        Personal Token
        <input 
          type="text" 
          bind:value={config.monoToken} 
          placeholder="u1_xxxxxxxxxxxxxxxxx" 
          style="-webkit-text-security: disc;" 
          required 
        />
        <small>Get this from <a href="https://api.monobank.ua/" target="_blank" rel="noopener noreferrer">api.monobank.ua</a></small>
      </label>
    </article>
  </fieldset>

  {#if verifyState === 'error'}
    <div style="margin-top: 1rem;">
      <mark style="background-color: var(--pico-del-color); color: #fff; display: block; padding: 0.5rem; border-radius: var(--pico-border-radius);">
        <strong>⚠️ Verification Failed:</strong> {verifyError}
      </mark>
    </div>
  {/if}

  <div style="margin-top: 1.5rem;">
    {#if verifyState === 'success'}
      
      <div style="display: flex; flex-wrap: wrap; gap: 1rem; justify-content: space-between; align-items: center; padding: 1rem 1.5rem; border: 1px solid var(--pico-ins-color); background-color: rgba(0, 150, 60, 0.05); border-radius: var(--pico-border-radius);">
        
        <div style="display: flex; align-items: center; gap: 1rem;">
          <div style="display: flex; align-items: center; justify-content: center; width: 2.5rem; height: 2.5rem; border-radius: 50%; background-color: var(--pico-ins-color); color: #fff; font-size: 1.25rem;">
            ✓
          </div>
          <div>
            <strong style="display: block; line-height: 1.2;">Securely Connected</strong>
            <small style="color: var(--pico-muted-color);">Authenticated with Monobank & Actual Budget</small>
          </div>
        </div>
        <button 
          type="button" 
          onclick={() => changeView('mapping')} 
          style="width: auto; margin: 0; padding: 0.5rem 1.5rem;"
        >
          Proceed to Card Mapping ➔
        </button>
      </div>

    {:else}
      <div style="display: flex; justify-content: flex-end;">
        <button 
          type="submit" 
          aria-busy={verifyState === 'verifying'}
          disabled={verifyState === 'verifying' || cooldown > 0}
          style="width: auto; padding: 0.5rem 1.5rem;"
        >
          {#if cooldown > 0}
            ⏳ Rate Limit Cooldown: {cooldown}s
          {:else if verifyState === 'verifying'}
            Connecting to APIs...
          {:else}
            💾 Save & Verify Connections
          {/if}
        </button>
      </div>
    {/if}
  </div>
</form>