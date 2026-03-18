<script>
  let { config = $bindable(), saveConfig, saveStatus, changeView, fetchApiData, cooldown } = $props();

  if (!config.cards || config.cards.length === 0) addMapping();

  let isConnected = $derived(!!config.monoToken && !!config.actualUrl);
  let sortedMonoCards = $derived(
    [...(config.accountCache?.monoCards ?? [])].sort((a, b) =>
      (a?.name ?? '').localeCompare(b?.name ?? '', undefined, { sensitivity: 'base' })
    )
  );
  let isFetching = $state(false);
  let fetchError = $state('');

  function addMapping() {
    if (!config.cards) config.cards = [];
    config.cards = [...config.cards, { monoCardId: '', actualAccountId: '' }];
  }

  function removeMapping(index) {
    config.cards = config.cards.filter((_, i) => i !== index);
  }

  async function handleManualFetch() {
    isFetching = true;
    fetchError = '';
    const result = await fetchApiData(config);
    if (!result.success) {
      fetchError = result.error;
    }
    isFetching = false;
  }
</script>

<div>
  <hgroup style="margin-bottom: 0;">
    <h2>Card Mapping</h2>
    <p>Link your Monobank cards to the correct accounts in Actual Budget.</p>
  </hgroup>
  
  {#if isConnected}
    <div style="margin-top: 1rem;">
      <button 
        type="button" 
        class="secondary outline" 
        style="width: auto; padding: 0.5rem 1rem;"
        onclick={handleManualFetch} 
        aria-busy={isFetching}
        disabled={cooldown > 0 || isFetching}
      >
        {cooldown > 0 ? `⏳ Wait ${cooldown}s` : '🔄 Fetch Latest Accounts Data'}
      </button>
    </div>
  {/if}

  {#if fetchError}
    <p style="color: var(--pico-del-color); margin-top: 1rem;"><small>⚠️ {fetchError}</small></p>
  {/if}

  {#if !isConnected}
    <article style="margin-top: 1.5rem;">
      <p style="margin-bottom: 1rem;">
        <mark>⚠️ Connect to Monobank and Actual first</mark><br />
        <small>Card mapping requires verified API credentials and a budget sync ID.</small>
      </p>
      <button type="button" class="secondary" style="width: auto;" onclick={() => changeView('connections')}>
        Go to Connections
      </button>
    </article>
  {:else}
    <form onsubmit={(e) => { e.preventDefault(); saveConfig(); }} style="margin-top: 1.5rem;">
      <article>
        <div class="overflow-auto">
          <table class="striped">
            <thead>
              <tr>
                <th scope="col" style="width: 45%;">Monobank Account</th>
                <th scope="col" style="width: 45%;">Actual Budget Account</th>
                <th scope="col" style="width: 10%; text-align: right;">Actions</th>
              </tr>
            </thead>
            <tbody>
              {#if !config.cards || config.cards.length === 0}
                <tr>
                  <td colspan="3" style="text-align: center; padding: 2rem;">
                    <em>No cards mapped yet. Click below to add one.</em>
                  </td>
                </tr>
              {:else}
                {#each config.cards as card, i}
                  <tr>
                    <td>
                      <select bind:value={card.monoCardId} style="margin-bottom: 0;" required>
                        <option value="" disabled>Select a source...</option>
                        
                        {#if config.accountCache.monoCards.length === 0 && card.monoCardId}
                           <option value={card.monoCardId}>{card.monoCardId} (Data not loaded)</option>
                        {/if}
                        
                        {#each sortedMonoCards as mono}
                          <option value={mono.id}>{mono.name}</option>
                        {/each}
                      </select>
                    </td>
                    <td>
                      <select bind:value={card.actualAccountId} style="margin-bottom: 0;" required>
                        <option value="" disabled>Select a destination...</option>
                        
                        {#if config.accountCache.actualAccounts.length === 0 && card.actualAccountId}
                           <option value={card.actualAccountId}>{card.actualAccountId} (Data not loaded)</option>
                        {/if}
                        
                        {#each config.accountCache.actualAccounts as actual}
                          <option value={actual.id}>{actual.name}</option>
                        {/each}
                      </select>
                    </td>
                    <td style="text-align: right; vertical-align: middle;">
                      <button 
                        type="button" 
                        class="secondary outline" 
                        style="margin-bottom: 0; padding: 0.5rem 1rem;"
                        disabled={config.cards.length <= 1}
                        aria-label={`Remove mapping ${i + 1}`}
                        title="Remove mapping"
                        onclick={() => removeMapping(i)}
                      >
                        ✕
                      </button>
                    </td>
                  </tr>
                {/each}
              {/if}
            </tbody>
          </table>
        </div>

        <div style="display: flex; justify-content: right;">
          <button type="button" class="contrast outline" onclick={addMapping} style="width: auto; margin-bottom: 0">
            + Add Card Mapping
          </button>
        </div>
      </article>

      <div style="display: flex; justify-content: flex-end; margin-top: 1.5rem;">
        <button type="submit" aria-busy={saveStatus === 'saving'} style="width: auto; padding: 0.5rem 1.5rem;">
          {#if saveStatus === 'saved'}✅ Mappings Saved{:else if saveStatus === 'error'}❌ Error Saving{:else}💾 Save Changes{/if}
        </button>
      </div>
    </form>
  {/if}
</div>
