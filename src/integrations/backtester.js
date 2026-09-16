export const BACKTESTER_CASE_SCHEMA_VERSION = 1;

export function normalizeBackTesterCase(input) {
  if (!input || typeof input !== 'object') throw new Error('BackTester case must be an object');
  const symbol = input.symbol || input.instrument || input.market;
  if (!symbol) throw new Error('BackTester case is missing symbol');
  const bars = input.bars || input.m1 || input.marketBars;
  if (!Array.isArray(bars) || !bars.length) throw new Error('BackTester case requires bars');

  const normalizedBars = bars.map((bar, index) => {
    const t = Number(bar.t ?? bar.time ?? bar.timestamp);
    const o = Number(bar.o ?? bar.open);
    const h = Number(bar.h ?? bar.high);
    const l = Number(bar.l ?? bar.low);
    const c = Number(bar.c ?? bar.close);
    const v = Number(bar.v ?? bar.volume ?? 1);
    if (![t, o, h, l, c].every(Number.isFinite)) throw new Error(`Invalid bar at index ${index}`);
    const endT = Number(bar.endT ?? bar.endTime ?? (t + 60_000));
    return { t, endT, o, h, l, c, v: Number.isFinite(v) ? v : 1, symbol };
  }).sort((a, b) => a.t - b.t);

  for (let i = 1; i < normalizedBars.length; i += 1) {
    if (normalizedBars[i].t <= normalizedBars[i - 1].t) throw new Error('BackTester bars must have strictly increasing timestamps');
  }

  return {
    schemaVersion: BACKTESTER_CASE_SCHEMA_VERSION,
    id: input.id || `bt_${symbol}_${normalizedBars[0].t}`,
    symbol,
    label: input.label || input.name || `${symbol} BackTester case`,
    source: 'BackTester Import',
    researchOnly: input.researchOnly ?? true,
    bars: normalizedBars,
    events: Array.isArray(input.events) ? input.events : [],
    annotations: Array.isArray(input.annotations) ? input.annotations : [],
    metadata: input.metadata || {},
  };
}

export function exportBackTesterCompatibleCase({ symbol, bars, label, events = [], annotations = [], metadata = {} }) {
  return {
    schemaVersion: BACKTESTER_CASE_SCHEMA_VERSION,
    id: `antx_${symbol}_${bars[0]?.t || Date.now()}`,
    symbol,
    label: label || `${symbol} ANTX case`,
    researchOnly: true,
    bars: bars.map(({ t, endT, o, h, l, c, v }) => ({ t, endT, o, h, l, c, v })),
    events,
    annotations,
    metadata: { ...metadata, exportedBy: 'ANTX Market Time Tunnel' },
  };
}

export class BackTesterAdapter {
  constructor() {
    this.name = 'backtester-import';
    this.cases = new Map();
  }

  importCase(raw) {
    const normalized = normalizeBackTesterCase(raw);
    this.cases.set(normalized.id, normalized);
    return normalized;
  }

  listCases() {
    return [...this.cases.values()].map(({ bars, ...rest }) => ({ ...rest, barCount: bars.length }));
  }

  getCase(id) {
    return this.cases.get(id) || null;
  }

  removeCase(id) {
    return this.cases.delete(id);
  }
}
