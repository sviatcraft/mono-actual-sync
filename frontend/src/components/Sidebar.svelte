<script>
  let { activeTab = $bindable() } = $props();

  function setTab(tab) {
    activeTab = tab;
  }
</script>

<aside class="app-nav">
  <nav>    
    <ul class="nav-links">
      <li>
        <a href="#dashboard"
           onclick={(e) => { e.preventDefault(); setTab('dashboard'); }}
           aria-current={activeTab === 'dashboard' ? 'page' : undefined}
           class={activeTab !== 'dashboard' ? 'secondary' : ''}>
          <span class="icon">🏠</span> 
          <span class="label">Dashboard</span>
        </a>
      </li>
      
      <li>
        <a href="#connections"
           onclick={(e) => { e.preventDefault(); setTab('connections'); }}
           aria-current={activeTab === 'connections' ? 'page' : undefined}
           class={activeTab !== 'connections' ? 'secondary' : ''}>
          <span class="icon">🔌</span> 
          <span class="label">Connections</span>
        </a>
      </li>
      
      <li>
        <a href="#mapping"
           onclick={(e) => { e.preventDefault(); setTab('mapping'); }}
           aria-current={activeTab === 'mapping' ? 'page' : undefined}
           class={activeTab !== 'mapping' ? 'secondary' : ''}>
          <span class="icon">🔗</span> 
          <span class="label">Mapping</span>
        </a>
      </li>
    </ul>
  </nav>
</aside>

<style>
  .app-nav {
    position: fixed;
    bottom: 0;
    left: 0;
    right: 0;
    z-index: 100;
    background-color: var(--pico-background-color);
    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.2);
    padding: 0.5rem;
    border-top: 1px solid var(--pico-muted-border-color);
  }

  .nav-links {
    display: flex;
    flex-direction: row;
    justify-content: space-around;
    align-items: start;
    margin: 0;
    padding: 0;
  }

  .nav-links li {
    list-style: none;
    flex: 1;
    text-align: center;
  }

  .nav-links a {
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 0.5rem 0.25rem;
    border-radius: var(--pico-border-radius);
    text-decoration: none;
    transition: background-color 0.2s;
    font-size: 0.75rem;
  }

  .nav-links a.secondary:hover {
    background-color: var(--pico-form-element-background-color);
  }

  .icon {
    font-size: 1.25rem;
    margin-bottom: 0.25rem;
  }

  @media (min-width: 1024px) {
    .app-nav {
      position: static;
      width: 250px;
      flex-shrink: 0;
      bottom: auto;
      box-shadow: none;
      background-color: transparent;
      border-top: none;
      padding: 0;
    }

    .app-nav > nav {
      position: sticky;
      top: 120px;
    }

    .nav-links {
      flex-direction: column;
      gap: 0.25rem;
    }

    .nav-links li {
      text-align: left;
    }

    .nav-links a {
      flex-direction: row;
      font-size: 1rem;
      padding: 0.5rem 1rem;
    }

    .icon {

      font-size: 1rem;
      margin-bottom: 0;
      margin-right: 0.75rem;
    }
  }
</style>
