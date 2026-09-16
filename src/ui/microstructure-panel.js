export class MicrostructurePanel {
  constructor({ runtime, store, maxRows = 40 }) {
    this.runtime = runtime;
    this.store = store;
    this.maxRows = maxRows;
    this.root = null;
    this.unsubscribe = null;
    this.rows = [];
  }

  mount(anchorSelector = '#providerName') {
    const anchor = document.querySelector(anchorSelector);
    const card = anchor?.closest('.card') || anchor?.parentElement;
    if (!card) return false;

    this.root = document.createElement('div');
    this.root.className = 'microstructure-panel';
    this.root.innerHTML = `
      <div class="card-head"><b>Microstructure</b><span id="microstructureSource">—</span></div>
      <div class="metric-row"><span>Last trade</span><b id="microLastPrice">—</b></div>
      <div class="metric-row"><span>Aggressor</span><b id="microSide">—</b></div>
      <div class="metric-row"><span>Size</span><b id="microSize">—</b></div>
      <div class="metric-row"><span>Message age</span><b id="microAge">—</b></div>
      <div id="microTape" class="micro-tape"></div>
    `;
    card.appendChild(this.root);

    this.unsubscribe = this.runtime.subscribe((event) => this.handleEvent(event));
    this.refreshStatus();
    return true;
  }

  handleEvent(event) {
    if (!this.root) return;
    if (event.type === 'tick' && event.symbol === this.store.getState().market.activeSymbol) {
      const tick = event.tick || {};
      const flow = event.orderFlow || {};
      const row = {
        t: tick.t || flow.t || Date.now(),
        price: Number(tick.price ?? flow.price),
        side: tick.side || flow.side || '—',
        size: Number(tick.size ?? flow.size ?? 0),
        aggressive: Boolean(flow.aggressive),
      };
      this.rows.push(row);
      if (this.rows.length > this.maxRows) this.rows.splice(0, this.rows.length - this.maxRows);
      this.renderRow(row);
    }
    if (['snapshot', 'provider-preference', 'fallback', 'status', 'error', 'bar'].includes(event.type)) {
      this.refreshStatus();
    }
  }

  renderRow(row) {
    this.root.querySelector('#microLastPrice').textContent = Number.isFinite(row.price)
      ? row.price.toLocaleString(undefined, { maximumFractionDigits: 6 })
      : '—';
    const side = this.root.querySelector('#microSide');
    side.textContent = String(row.side || '—').toUpperCase() + (row.aggressive ? ' · AGGR' : '');
    side.className = row.side === 'buy' ? 'positive' : row.side === 'sell' ? 'negative' : '';
    this.root.querySelector('#microSize').textContent = Number.isFinite(row.size) ? row.size.toFixed(4) : '—';
    this.root.querySelector('#microAge').textContent = 'now';

    const tape = this.root.querySelector('#microTape');
    tape.innerHTML = this.rows.slice().reverse().map((item) => `
      <div class="micro-row ${item.side === 'buy' ? 'buy' : item.side === 'sell' ? 'sell' : ''}">
        <span>${new Date(item.t).toLocaleTimeString()}</span>
        <b>${Number.isFinite(item.price) ? item.price.toLocaleString(undefined, { maximumFractionDigits: 6 }) : '—'}</b>
        <span>${Number.isFinite(item.size) ? item.size.toFixed(3) : '—'}</span>
      </div>
    `).join('');
  }

  refreshStatus() {
    const d = this.runtime.diagnostics();
    this.root.querySelector('#microstructureSource').textContent = d.activeProvider;
    const last = d.provider.liveCryptoLastMessageAt;
    this.root.querySelector('#microAge').textContent = last
      ? `${Math.max(0, Math.round((Date.now() - last) / 1000))}s`
      : '—';
  }

  destroy() {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.root?.remove();
    this.root = null;
  }
}

export function installMicrostructurePanel(options) {
  const panel = new MicrostructurePanel(options);
  panel.mount();
  return panel;
}
