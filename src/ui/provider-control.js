export class ProviderControl {
  constructor({ manager, store }) {
    this.manager = manager;
    this.store = store;
    this.root = null;
    this.timer = null;
    this.unsubscribe = null;
  }

  mount(anchorSelector = '#providerName') {
    const anchor = document.querySelector(anchorSelector);
    const card = anchor?.closest('.card') || anchor?.parentElement;
    if (!card) return false;

    this.root = document.createElement('div');
    this.root.className = 'provider-control';
    this.root.innerHTML = `
      <div class="provider-control-grid">
        <label>
          <span>Market source</span>
          <select id="providerModeSelect" class="select-input">
            <option value="simulated">Simulated</option>
            <option value="live">Binance Live</option>
          </select>
        </label>
        <div class="provider-health">
          <span>Status</span>
          <b id="providerHealthText">starting</b>
        </div>
      </div>
      <div class="metric-row"><span>Active source</span><b id="providerActiveSource">simulated</b></div>
      <div class="metric-row"><span>Last live message</span><b id="providerLastMessage">—</b></div>
      <div class="metric-row"><span>Fallback reason</span><b id="providerFallbackReason">—</b></div>
      <div class="muted-line">Live crypto is public market data only. No account access or order routing.</div>
    `;
    card.appendChild(this.root);

    const select = this.root.querySelector('#providerModeSelect');
    select.value = this.manager.preferLiveCrypto ? 'live' : 'simulated';
    select.addEventListener('change', () => {
      this.manager.setPreferLiveCrypto(select.value === 'live');
      this.refresh();
      window.dispatchEvent(new CustomEvent('antx:provider-selection', {
        detail: { mode: select.value, diagnostics: this.manager.diagnostics() },
      }));
    });

    this.unsubscribe = this.manager.subscribe((event) => {
      if (['status', 'error', 'fallback', 'provider-preference', 'bar', 'tick'].includes(event.type)) this.refresh();
    });
    this.timer = setInterval(() => this.refresh(), 1500);
    this.refresh();
    return true;
  }

  refresh() {
    if (!this.root) return;
    const d = this.manager.diagnostics();
    const activeSymbol = this.store.getState().market.activeSymbol;
    const activeSource = this.manager.providerNameFor(activeSymbol);
    const health = d.liveCryptoStatus === 'live'
      ? (d.preferLiveCrypto ? 'live connected' : 'live ready')
      : (d.liveCryptoStatus || 'offline');

    this.root.querySelector('#providerHealthText').textContent = health;
    this.root.querySelector('#providerActiveSource').textContent = activeSource;
    this.root.querySelector('#providerLastMessage').textContent = d.liveCryptoLastMessageAt
      ? new Date(d.liveCryptoLastMessageAt).toLocaleTimeString()
      : '—';
    this.root.querySelector('#providerFallbackReason').textContent = d.lastError || '—';

    const providerName = document.querySelector('#providerName');
    if (providerName) providerName.textContent = activeSource;
    const runtimeMode = document.querySelector('#runtimeMode');
    if (runtimeMode) runtimeMode.textContent = `LIVE · ${activeSource}`;
  }

  destroy() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root?.remove();
    this.root = null;
  }
}

export function installProviderControl(options) {
  const control = new ProviderControl(options);
  control.mount();
  return control;
}
