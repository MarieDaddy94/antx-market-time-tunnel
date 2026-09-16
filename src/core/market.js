export const MINUTE = 60_000;
export const TF_MS = {
  M1: MINUTE,
  M5: 5 * MINUTE,
  M15: 15 * MINUTE,
  H1: 60 * MINUTE,
  H4: 240 * MINUTE,
};

export const DEFAULT_SYMBOLS = {
  BTCUSDT: { price: 67_234.5, volatility: 0.00018, tickSize: 0.1 },
  ETHUSDT: { price: 3_265.18, volatility: 0.00024, tickSize: 0.01 },
  SOLUSDT: { price: 187.24, volatility: 0.00035, tickSize: 0.01 },
  NAS100: { price: 23_850, volatility: 0.00015, tickSize: 0.1 },
  XAUUSD: { price: 3_685, volatility: 0.00012, tickSize: 0.01 },
};

const seeded = (n) => {
  const x = Math.sin(n * 12.9898 + 78.233) * 43758.5453;
  return x - Math.floor(x);
};

export function aggregateBarsByTime(bars, timeframeMs) {
  const out = [];
  let bucket = null;
  for (const bar of bars) {
    const bucketTime = Math.floor(bar.t / timeframeMs) * timeframeMs;
    if (!bucket || bucket.t !== bucketTime) {
      bucket = {
        t: bucketTime,
        endT: bucketTime + timeframeMs,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
        count: 1,
      };
      out.push(bucket);
    } else {
      bucket.h = Math.max(bucket.h, bar.h);
      bucket.l = Math.min(bucket.l, bar.l);
      bucket.c = bar.c;
      bucket.v += bar.v;
      bucket.count += 1;
    }
  }
  for (const bar of out) bar.v /= Math.max(1, bar.count);
  return out;
}

export function deriveTimeframes(m1Bars) {
  return Object.fromEntries(
    Object.entries(TF_MS).map(([name, ms]) => [name, name === 'M1' ? m1Bars : aggregateBarsByTime(m1Bars, ms)]),
  );
}

export function makeSeedBars({ symbol, count = 1440, endTime = Date.now(), meta = DEFAULT_SYMBOLS[symbol] }) {
  const cfg = meta || { price: 100, volatility: 0.0002, tickSize: 0.01 };
  const start = Math.floor((endTime - count * MINUTE) / MINUTE) * MINUTE;
  const bars = [];
  let p = cfg.price * 0.97;
  for (let i = 0; i < count; i += 1) {
    const wave = Math.sin(i * 0.075) * cfg.volatility * 1.8 + Math.sin(i * 0.019) * cfg.volatility * 2.3;
    const shock = (seeded(i + symbol.length * 17) - 0.485) * cfg.volatility * 7;
    const drift = cfg.price * (wave + shock + cfg.volatility * 0.03);
    const o = p;
    const c = Math.max(cfg.tickSize, o + drift);
    const range = cfg.price * cfg.volatility * (0.8 + seeded(i + 900) * 2.4);
    const h = Math.max(o, c) + range;
    const l = Math.max(cfg.tickSize, Math.min(o, c) - range * (0.7 + seeded(i + 1300) * 0.6));
    const t = start + i * MINUTE;
    bars.push({ t, endT: t + MINUTE, o, h, l, c, v: 0.3 + seeded(i + 2100) * 2.5, symbol });
    p = c;
  }
  return bars;
}

export class MarketDataProvider {
  constructor(name = 'provider') {
    this.name = name;
    this.listeners = new Set();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  start() {}
  stop() {}
  getHistory() { return []; }
}

export class SimulatedMarketProvider extends MarketDataProvider {
  constructor({ symbols = DEFAULT_SYMBOLS, seedBars = 1440, tickIntervalMs = 350, newBarEveryTicks = 12, maxBars = 5000 } = {}) {
    super('simulated');
    this.symbols = symbols;
    this.seedBars = seedBars;
    this.tickIntervalMs = tickIntervalMs;
    this.newBarEveryTicks = newBarEveryTicks;
    this.maxBars = maxBars;
    this.histories = new Map();
    this.tickCounter = 0;
    this.timer = null;
    this.orderFlowSeq = 0;
    this.initialize();
  }

  initialize() {
    const end = Math.floor(Date.now() / MINUTE) * MINUTE;
    for (const [symbol, meta] of Object.entries(this.symbols)) {
      this.histories.set(symbol, makeSeedBars({ symbol, count: this.seedBars, endTime: end, meta }));
    }
  }

  getHistory(symbol) {
    return this.histories.get(symbol) || [];
  }

  snapshot(symbol) {
    const bars = this.getHistory(symbol);
    return { symbol, provider: this.name, bars, timeframes: deriveTimeframes(bars) };
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.step(), this.tickIntervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  step() {
    this.tickCounter += 1;
    for (const [symbol, meta] of Object.entries(this.symbols)) {
      const bars = this.histories.get(symbol);
      const last = bars.at(-1);
      const amp = Math.max(meta.tickSize, meta.price * meta.volatility * 0.7);
      const aggression = (Math.random() - 0.48) * amp;
      const nextPrice = Math.max(meta.tickSize, last.c + aggression);
      last.c = nextPrice;
      last.h = Math.max(last.h, nextPrice);
      last.l = Math.min(last.l, nextPrice);
      last.v = Math.min(20, last.v + Math.random() * 0.03);

      const side = aggression >= 0 ? 'buy' : 'sell';
      const orderFlow = {
        id: `flow_${this.orderFlowSeq += 1}`,
        symbol,
        t: Date.now(),
        price: nextPrice,
        side,
        size: 0.2 + Math.random() * 5,
        aggressive: Math.abs(aggression) > amp * 0.35,
      };
      this.emit({ type: 'tick', symbol, tick: { t: Date.now(), price: nextPrice, size: orderFlow.size, side }, orderFlow });

      if (this.tickCounter % this.newBarEveryTicks === 0) {
        const t = last.endT;
        const o = nextPrice;
        const c = Math.max(meta.tickSize, o + (Math.random() - 0.48) * amp * 1.6);
        const range = amp * (0.8 + Math.random() * 1.7);
        bars.push({
          t,
          endT: t + MINUTE,
          o,
          h: Math.max(o, c) + range,
          l: Math.max(meta.tickSize, Math.min(o, c) - range),
          c,
          v: 0.25 + Math.random() * 1.5,
          symbol,
        });
        while (bars.length > this.maxBars) bars.shift();
        this.emit({ type: 'bar', symbol, bar: bars.at(-1), timeframes: deriveTimeframes(bars) });
      }
    }
  }
}

export function createSyntheticLiquidity(bars, { levels = 28 } = {}) {
  if (!bars.length) return [];
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const span = hi - lo || 1;
  return Array.from({ length: levels }, (_, i) => {
    const price = lo + (span * i) / (levels - 1);
    const proximity = bars.reduce((acc, bar) => acc + (Math.abs(bar.c - price) < span * 0.035 ? 1 : 0), 0);
    return {
      price,
      bid: Math.max(0, proximity * (0.5 + seeded(i + 88))),
      ask: Math.max(0, proximity * (0.5 + seeded(i + 188))),
      liquidation: proximity * seeded(i + 288),
    };
  });
}

export function buildVolumeProfile(bars, bins = 32) {
  if (!bars.length) return [];
  const lo = Math.min(...bars.map((b) => b.l));
  const hi = Math.max(...bars.map((b) => b.h));
  const step = (hi - lo || 1) / bins;
  const profile = Array.from({ length: bins }, (_, i) => ({
    priceLow: lo + i * step,
    priceHigh: lo + (i + 1) * step,
    volume: 0,
  }));
  for (const bar of bars) {
    const typical = (bar.h + bar.l + bar.c) / 3;
    const index = Math.max(0, Math.min(bins - 1, Math.floor((typical - lo) / step)));
    profile[index].volume += bar.v;
  }
  return profile;
}

export function buildMarketEvents(baseDate = new Date()) {
  const d = new Date(baseDate);
  d.setSeconds(0, 0);
  const events = [];
  const add = (hour, minute, label, category, importance = 'medium') => {
    const t = new Date(d);
    t.setHours(hour, minute, 0, 0);
    events.push({ id: `evt_${hour}_${minute}_${category}`, t: t.getTime(), label, category, importance, source: 'Demo event model' });
  };
  add(8, 30, 'Macro release window', 'macro', 'high');
  add(9, 30, 'US cash open', 'session', 'high');
  add(10, 0, 'Scheduled data window', 'macro', 'medium');
  add(14, 0, 'Policy/event window', 'macro', 'high');
  return events;
}

export function buildSessionRegions(baseDate = new Date()) {
  const d = new Date(baseDate);
  d.setSeconds(0, 0);
  const at = (h, m = 0) => { const x = new Date(d); x.setHours(h, m, 0, 0); return x.getTime(); };
  return [
    { id: 'asia', label: 'Asia', start: at(18), end: at(23, 59), color: '#4f9fff' },
    { id: 'london', label: 'London', start: at(2), end: at(7), color: '#a777ff' },
    { id: 'ny_premarket', label: 'NY Premarket', start: at(7), end: at(9, 30), color: '#ffca5c' },
    { id: 'ny_open', label: 'NY Open', start: at(9, 30), end: at(11), color: '#31e6a2' },
    { id: 'lunch', label: 'Lunch', start: at(11, 30), end: at(13, 30), color: '#7b8da1' },
    { id: 'power_hour', label: 'Power Hour', start: at(15), end: at(16), color: '#ff75c5' },
  ];
}

export function computeReturns(bars, limit = 200) {
  const slice = bars.slice(-limit);
  const returns = [];
  for (let i = 1; i < slice.length; i += 1) returns.push((slice[i].c - slice[i - 1].c) / slice[i - 1].c);
  return returns;
}

export function correlation(a, b) {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const x = a.slice(-n), y = b.slice(-n);
  const mx = x.reduce((s, v) => s + v, 0) / n;
  const my = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < n; i += 1) {
    const vx = x[i] - mx, vy = y[i] - my;
    num += vx * vy; dx += vx * vx; dy += vy * vy;
  }
  return dx && dy ? num / Math.sqrt(dx * dy) : 0;
}
