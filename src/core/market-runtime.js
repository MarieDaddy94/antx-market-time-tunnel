import { deriveTimeframes } from './market.js';

export class MarketRuntime {
  constructor({ manager, store }) {
    this.manager = manager;
    this.store = store;
    this.listeners = new Set();
    this.unsubscribe = null;
    this.activeSymbol = store.getState().market.activeSymbol;
    this.lastSnapshot = null;
  }

  start() {
    if (this.unsubscribe) return;
    this.unsubscribe = this.manager.subscribe((event) => this.handleEvent(event));
    this.refresh(this.activeSymbol);
  }

  stop() {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  setActiveSymbol(symbol) {
    this.activeSymbol = symbol;
    this.refresh(symbol);
  }

  getHistory(symbol = this.activeSymbol) {
    return this.manager.getHistory(symbol);
  }

  snapshot(symbol = this.activeSymbol) {
    const providerSnapshot = this.manager.snapshot(symbol);
    if (providerSnapshot?.bars?.length) {
      const snapshot = {
        ...providerSnapshot,
        provider: this.manager.providerNameFor(symbol),
        timeframes: providerSnapshot.timeframes || deriveTimeframes(providerSnapshot.bars),
      };
      this.lastSnapshot = snapshot;
      return snapshot;
    }
    const bars = this.getHistory(symbol) || [];
    const snapshot = {
      symbol,
      provider: this.manager.providerNameFor(symbol),
      bars,
      timeframes: deriveTimeframes(bars),
    };
    this.lastSnapshot = snapshot;
    return snapshot;
  }

  refresh(symbol = this.activeSymbol) {
    const snapshot = this.snapshot(symbol);
    this.store.transact('Market runtime refresh', (state) => {
      state.runtime.provider = snapshot.provider;
      state.runtime.marketSource = snapshot.provider;
      state.runtime.providerDiagnostics = this.manager.diagnostics();
    }, { reversible: false, source: 'Market Runtime' });
    this.emit({ type: 'snapshot', snapshot });
    return snapshot;
  }

  handleEvent(event) {
    if (!event?.symbol && !['provider-preference', 'fallback', 'status', 'error'].includes(event?.type)) return;

    this.store.transact('Market runtime event', (state) => {
      state.runtime.providerDiagnostics = this.manager.diagnostics();
      if (event.symbol === state.market.activeSymbol) {
        state.runtime.provider = this.manager.providerNameFor(event.symbol);
        state.runtime.marketSource = state.runtime.provider;
      }
      if (event.type === 'error' || event.type === 'fallback') {
        state.runtime.lastError = String(event.error || event.reason || 'Provider fallback');
      }
    }, { reversible: false, source: 'Market Runtime' });

    if (event.symbol === this.activeSymbol && ['tick', 'bar'].includes(event.type)) {
      this.emit({ ...event, snapshot: this.snapshot(this.activeSymbol) });
    } else if (['provider-preference', 'fallback', 'status'].includes(event.type)) {
      this.emit({ ...event, snapshot: this.refresh(this.activeSymbol) });
    } else {
      this.emit(event);
    }
  }

  diagnostics() {
    return {
      activeSymbol: this.activeSymbol,
      activeProvider: this.manager.providerNameFor(this.activeSymbol),
      bars: this.getHistory(this.activeSymbol)?.length || 0,
      provider: this.manager.diagnostics(),
    };
  }
}
