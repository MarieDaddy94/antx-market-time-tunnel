import { MarketDataProvider, MINUTE, deriveTimeframes } from '../core/market.js';

const DEFAULT_STREAM_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT'];
const REST_BASE = 'https://api.binance.com';
const WS_BASE = 'wss://stream.binance.com:9443/stream';

function normalizeBar(symbol, row) {
  return {
    t: Number(row[0]),
    endT: Number(row[0]) + MINUTE,
    o: Number(row[1]),
    h: Number(row[2]),
    l: Number(row[3]),
    c: Number(row[4]),
    v: Number(row[5]),
    symbol,
  };
}

function normalizeTrade(symbol, payload) {
  const price = Number(payload.p);
  const size = Number(payload.q);
  const side = payload.m ? 'sell' : 'buy';
  return {
    tick: { t: Number(payload.T || payload.E || Date.now()), price, size, side },
    orderFlow: {
      id: `binance_${symbol}_${payload.t ?? payload.a ?? payload.E}`,
      symbol,
      t: Number(payload.T || payload.E || Date.now()),
      price,
      size,
      side,
      aggressive: size >= 1,
      source: 'Binance public trade stream',
    },
  };
}

export class BinancePublicProvider extends MarketDataProvider {
  constructor({
    symbols = DEFAULT_STREAM_SYMBOLS,
    historyBars = 1000,
    maxBars = 5000,
    reconnectBaseMs = 1200,
    reconnectMaxMs = 30000,
  } = {}) {
    super('binance-public');
    this.symbols = symbols;
    this.historyBars = Math.min(1000, Math.max(100, historyBars));
    this.maxBars = maxBars;
    this.reconnectBaseMs = reconnectBaseMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.histories = new Map();
    this.socket = null;
    this.running = false;
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.status = 'idle';
    this.lastMessageAt = null;
  }

  supports(symbol) {
    return this.symbols.includes(symbol);
  }

  async initialize() {
    await Promise.all(this.symbols.map(async (symbol) => {
      const url = `${REST_BASE}/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=1m&limit=${this.historyBars}`;
      const response = await fetch(url, { cache: 'no-store' });
      if (!response.ok) throw new Error(`Binance history ${symbol}: HTTP ${response.status}`);
      const rows = await response.json();
      this.histories.set(symbol, rows.map((row) => normalizeBar(symbol, row)));
    }));
  }

  getHistory(symbol) {
    return this.histories.get(symbol) || [];
  }

  snapshot(symbol) {
    const bars = this.getHistory(symbol);
    return { symbol, provider: this.name, bars, timeframes: deriveTimeframes(bars) };
  }

  async start() {
    if (this.running) return;
    this.running = true;
    this.status = 'loading-history';
    this.emit({ type: 'status', provider: this.name, status: this.status });
    try {
      if (!this.symbols.every((s) => this.histories.has(s))) await this.initialize();
      this.status = 'connecting';
      this.emit({ type: 'status', provider: this.name, status: this.status });
      this.connect();
    } catch (error) {
      this.status = 'error';
      this.emit({ type: 'error', provider: this.name, error });
      this.scheduleReconnect();
      throw error;
    }
  }

  stop() {
    this.running = false;
    this.status = 'stopped';
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.socket) {
      this.socket.onclose = null;
      this.socket.close();
    }
    this.socket = null;
    this.emit({ type: 'status', provider: this.name, status: this.status });
  }

  connect() {
    if (!this.running) return;
    if (this.socket) {
      this.socket.onclose = null;
      try { this.socket.close(); } catch (_) {}
    }
    const streams = this.symbols.map((s) => `${s.toLowerCase()}@trade`).join('/');
    const socket = new WebSocket(`${WS_BASE}?streams=${streams}`);
    this.socket = socket;

    socket.onopen = () => {
      if (socket !== this.socket) return;
      this.reconnectAttempts = 0;
      this.status = 'live';
      this.emit({ type: 'status', provider: this.name, status: this.status });
    };

    socket.onmessage = (event) => {
      if (socket !== this.socket) return;
      this.lastMessageAt = Date.now();
      try {
        const envelope = JSON.parse(event.data);
        const payload = envelope.data || envelope;
        const symbol = payload.s;
        if (!symbol || !this.supports(symbol)) return;
        const { tick, orderFlow } = normalizeTrade(symbol, payload);
        this.applyTick(symbol, tick);
        this.emit({ type: 'tick', symbol, tick, orderFlow });
      } catch (error) {
        this.emit({ type: 'error', provider: this.name, error });
      }
    };

    socket.onerror = () => {
      this.emit({ type: 'error', provider: this.name, error: new Error('Binance WebSocket error') });
    };

    socket.onclose = () => {
      if (socket !== this.socket || !this.running) return;
      this.status = 'disconnected';
      this.emit({ type: 'status', provider: this.name, status: this.status });
      this.scheduleReconnect();
    };
  }

  scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    const delay = Math.min(this.reconnectMaxMs, this.reconnectBaseMs * (2 ** this.reconnectAttempts));
    this.reconnectAttempts += 1;
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = null;
      if (!this.running) return;
      try {
        await this.initialize();
        this.connect();
      } catch (error) {
        this.emit({ type: 'error', provider: this.name, error });
        this.scheduleReconnect();
      }
    }, delay);
  }

  applyTick(symbol, tick) {
    const bars = this.histories.get(symbol) || [];
    if (!bars.length) return;
    const minuteT = Math.floor(tick.t / MINUTE) * MINUTE;
    let last = bars.at(-1);

    if (minuteT > last.t) {
      const next = {
        t: minuteT,
        endT: minuteT + MINUTE,
        o: tick.price,
        h: tick.price,
        l: tick.price,
        c: tick.price,
        v: tick.size || 0,
        symbol,
      };
      bars.push(next);
      while (bars.length > this.maxBars) bars.shift();
      this.histories.set(symbol, bars);
      this.emit({ type: 'bar', symbol, bar: next, timeframes: deriveTimeframes(bars) });
      return;
    }

    if (minuteT < last.t) return;
    last.c = tick.price;
    last.h = Math.max(last.h, tick.price);
    last.l = Math.min(last.l, tick.price);
    last.v += tick.size || 0;
  }
}
