import { SimulatedMarketProvider } from './market.js';
import { BinancePublicProvider } from '../integrations/binance.js';

export class ProviderManager {
  constructor({
    simulated = new SimulatedMarketProvider(),
    liveCrypto = new BinancePublicProvider(),
    preferLiveCrypto = true,
  } = {}) {
    this.simulated = simulated;
    this.liveCrypto = liveCrypto;
    this.preferLiveCrypto = preferLiveCrypto;
    this.listeners = new Set();
    this.activeBySymbol = new Map();
    this.started = false;
    this.unsubscribers = [];
    this.lastError = null;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  providerFor(symbol) {
    if (this.preferLiveCrypto && this.liveCrypto.supports(symbol) && this.liveCrypto.status === 'live') {
      return this.liveCrypto;
    }
    return this.simulated;
  }

  providerNameFor(symbol) {
    return this.providerFor(symbol).name;
  }

  getHistory(symbol) {
    const provider = this.providerFor(symbol);
    const live = provider.getHistory(symbol);
    if (live?.length) return live;
    return this.simulated.getHistory(symbol);
  }

  snapshot(symbol) {
    const provider = this.providerFor(symbol);
    const snapshot = provider.snapshot?.(symbol);
    if (snapshot?.bars?.length) return snapshot;
    return this.simulated.snapshot(symbol);
  }

  setPreferLiveCrypto(enabled) {
    this.preferLiveCrypto = Boolean(enabled);
    this.emit({ type: 'provider-preference', preferLiveCrypto: this.preferLiveCrypto });
  }

  async start() {
    if (this.started) return;
    this.started = true;

    this.unsubscribers.push(this.simulated.subscribe((event) => {
      const active = this.providerFor(event.symbol);
      if (active === this.simulated || event.type === 'status' || event.type === 'error') {
        this.emit({ ...event, provider: this.simulated.name });
      }
    }));

    this.unsubscribers.push(this.liveCrypto.subscribe((event) => {
      if (event.type === 'error') this.lastError = event.error;
      if (event.type === 'status') {
        for (const symbol of this.liveCrypto.symbols) {
          this.activeBySymbol.set(symbol, this.providerNameFor(symbol));
        }
      }
      this.emit({ ...event, provider: this.liveCrypto.name });
    }));

    this.simulated.start();
    try {
      await this.liveCrypto.start();
    } catch (error) {
      this.lastError = error;
      this.emit({
        type: 'fallback',
        provider: this.simulated.name,
        reason: String(error?.message || error),
        symbols: [...this.liveCrypto.symbols],
      });
    }
  }

  stop() {
    this.started = false;
    this.simulated.stop();
    this.liveCrypto.stop();
    for (const unsubscribe of this.unsubscribers.splice(0)) unsubscribe?.();
  }

  diagnostics() {
    return {
      started: this.started,
      preferLiveCrypto: this.preferLiveCrypto,
      liveCryptoStatus: this.liveCrypto.status,
      liveCryptoLastMessageAt: this.liveCrypto.lastMessageAt,
      simulatedRunning: Boolean(this.simulated.timer),
      lastError: this.lastError ? String(this.lastError?.message || this.lastError) : null,
      activeBySymbol: Object.fromEntries(
        [...new Set([...Object.keys(this.simulated.symbols || {}), ...this.liveCrypto.symbols])]
          .map((symbol) => [symbol, this.providerNameFor(symbol)]),
      ),
    };
  }
}
