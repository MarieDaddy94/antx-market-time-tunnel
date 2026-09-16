import { MINUTE } from './market.js';

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
const median = (xs) => {
  if (!xs.length) return 0;
  const a = [...xs].sort((x, y) => x - y);
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
};
const std = (xs) => {
  if (xs.length < 2) return 0;
  const m = avg(xs);
  return Math.sqrt(avg(xs.map((x) => (x - m) ** 2)));
};

export function detectSwings(bars, radius = 2) {
  const swings = [];
  for (let i = radius; i < bars.length - radius; i += 1) {
    const left = bars.slice(i - radius, i);
    const right = bars.slice(i + 1, i + radius + 1);
    const b = bars[i];
    if (left.every((x) => b.h > x.h) && right.every((x) => b.h >= x.h)) {
      swings.push({ id: `swh_${b.t}`, type: 'swingHigh', t: b.t, price: b.h, barIndex: i });
    }
    if (left.every((x) => b.l < x.l) && right.every((x) => b.l <= x.l)) {
      swings.push({ id: `swl_${b.t}`, type: 'swingLow', t: b.t, price: b.l, barIndex: i });
    }
  }
  return swings;
}

export function detectStructureBreaks(bars, swings = detectSwings(bars)) {
  const out = [];
  let lastHigh = null;
  let lastLow = null;
  let trend = 'neutral';
  const swingByIndex = new Map(swings.map((s) => [s.barIndex, s]));
  for (let i = 0; i < bars.length; i += 1) {
    const swing = swingByIndex.get(i);
    if (swing?.type === 'swingHigh') lastHigh = swing;
    if (swing?.type === 'swingLow') lastLow = swing;
    const b = bars[i];
    if (lastHigh && b.c > lastHigh.price && b.t > lastHigh.t) {
      const type = trend === 'down' ? 'CHoCH' : 'BOS';
      out.push({ id: `${type}_up_${b.t}`, type, direction: 'bullish', t: b.t, price: lastHigh.price, brokenSwingId: lastHigh.id });
      trend = 'up';
      lastHigh = null;
    }
    if (lastLow && b.c < lastLow.price && b.t > lastLow.t) {
      const type = trend === 'up' ? 'CHoCH' : 'BOS';
      out.push({ id: `${type}_dn_${b.t}`, type, direction: 'bearish', t: b.t, price: lastLow.price, brokenSwingId: lastLow.id });
      trend = 'down';
      lastLow = null;
    }
  }
  return out;
}

export function detectDisplacement(bars, lookback = 20, z = 1.6) {
  const ranges = bars.map((b) => Math.abs(b.c - b.o));
  const out = [];
  for (let i = lookback; i < bars.length; i += 1) {
    const baseline = ranges.slice(i - lookback, i);
    const mean = avg(baseline);
    const deviation = std(baseline);
    const body = ranges[i];
    if (body > mean + deviation * z) {
      out.push({
        id: `disp_${bars[i].t}`,
        type: 'displacement',
        direction: bars[i].c >= bars[i].o ? 'bullish' : 'bearish',
        t: bars[i].t,
        from: bars[i].o,
        to: bars[i].c,
        strength: deviation ? (body - mean) / deviation : body / Math.max(mean, 1e-9),
      });
    }
  }
  return out;
}

export function detectFVG(bars) {
  const out = [];
  for (let i = 2; i < bars.length; i += 1) {
    const a = bars[i - 2], c = bars[i];
    if (c.l > a.h) out.push({ id: `fvg_up_${c.t}`, type: 'FVG', direction: 'bullish', t: c.t, low: a.h, high: c.l });
    if (c.h < a.l) out.push({ id: `fvg_dn_${c.t}`, type: 'FVG', direction: 'bearish', t: c.t, low: c.h, high: a.l });
  }
  return out;
}

export function detectEqualHighLow(bars, tolerancePct = 0.0008) {
  const swings = detectSwings(bars, 2);
  const out = [];
  for (let i = 1; i < swings.length; i += 1) {
    const a = swings[i - 1], b = swings[i];
    if (a.type !== b.type) continue;
    const mid = (a.price + b.price) / 2;
    if (Math.abs(a.price - b.price) / Math.max(mid, 1e-9) <= tolerancePct) {
      out.push({ id: `eq_${a.type}_${b.t}`, type: a.type === 'swingHigh' ? 'equalHighs' : 'equalLows', t1: a.t, t2: b.t, price: mid });
    }
  }
  return out;
}

export function detectLiquiditySweeps(bars, swings = detectSwings(bars, 2)) {
  const out = [];
  for (const swing of swings) {
    const after = bars.slice(swing.barIndex + 1, swing.barIndex + 12);
    for (const b of after) {
      if (swing.type === 'swingHigh' && b.h > swing.price && b.c < swing.price) {
        out.push({ id: `sweep_hi_${b.t}`, type: 'liquiditySweep', direction: 'bearish', t: b.t, price: swing.price, swingId: swing.id });
        break;
      }
      if (swing.type === 'swingLow' && b.l < swing.price && b.c > swing.price) {
        out.push({ id: `sweep_lo_${b.t}`, type: 'liquiditySweep', direction: 'bullish', t: b.t, price: swing.price, swingId: swing.id });
        break;
      }
    }
  }
  return out;
}

export function detectSupplyDemand(bars, displacement = detectDisplacement(bars)) {
  const out = [];
  for (const d of displacement) {
    const i = bars.findIndex((b) => b.t === d.t);
    if (i <= 0) continue;
    const base = bars[i - 1];
    if (d.direction === 'bullish') {
      out.push({ id: `demand_${base.t}`, type: 'demand', t: base.t, low: base.l, high: Math.max(base.o, base.c), sourceDisplacement: d.id });
    } else {
      out.push({ id: `supply_${base.t}`, type: 'supply', t: base.t, low: Math.min(base.o, base.c), high: base.h, sourceDisplacement: d.id });
    }
  }
  return out.slice(-40);
}

export function detectOrderBlocks(bars, structure = detectStructureBreaks(bars)) {
  const out = [];
  for (const br of structure) {
    const i = bars.findIndex((b) => b.t === br.t);
    if (i < 2) continue;
    for (let j = i - 1; j >= Math.max(0, i - 6); j -= 1) {
      const b = bars[j];
      const opposite = br.direction === 'bullish' ? b.c < b.o : b.c > b.o;
      if (opposite) {
        out.push({ id: `ob_${br.direction}_${b.t}`, type: 'orderBlock', direction: br.direction, t: b.t, low: b.l, high: b.h, structureId: br.id });
        break;
      }
    }
  }
  return out.slice(-40);
}

export function computeVWAP(bars) {
  let pv = 0, volume = 0;
  return bars.map((b) => {
    const typical = (b.h + b.l + b.c) / 3;
    pv += typical * b.v;
    volume += b.v;
    return { t: b.t, value: volume ? pv / volume : typical };
  });
}

export function computePreviousDayLevels(bars) {
  if (!bars.length) return [];
  const byDay = new Map();
  for (const b of bars) {
    const d = new Date(b.t);
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
    const row = byDay.get(key) || { key, high: -Infinity, low: Infinity, close: b.c, start: b.t };
    row.high = Math.max(row.high, b.h);
    row.low = Math.min(row.low, b.l);
    row.close = b.c;
    byDay.set(key, row);
  }
  const days = [...byDay.values()].sort((a, b) => a.start - b.start);
  if (days.length < 2) return [];
  const prev = days.at(-2);
  return [
    { id: `pdh_${prev.key}`, type: 'previousDayHigh', price: prev.high },
    { id: `pdl_${prev.key}`, type: 'previousDayLow', price: prev.low },
    { id: `pdc_${prev.key}`, type: 'previousDayClose', price: prev.close },
  ];
}

export function computeOpeningRange(bars, minutes = 30) {
  if (!bars.length) return null;
  const lastDay = new Date(bars.at(-1).t);
  const start = new Date(lastDay);
  start.setHours(9, 30, 0, 0);
  const end = start.getTime() + minutes * MINUTE;
  const rows = bars.filter((b) => b.t >= start.getTime() && b.t < end);
  if (!rows.length) return null;
  return { id: `or_${start.toISOString().slice(0, 10)}`, type: 'openingRange', start: start.getTime(), end, high: Math.max(...rows.map((b) => b.h)), low: Math.min(...rows.map((b) => b.l)) };
}

export function buildEvidence({ bars, timeframe = 'M1' }) {
  if (!bars.length) return [];
  const swings = detectSwings(bars);
  const structure = detectStructureBreaks(bars, swings);
  const displacement = detectDisplacement(bars);
  const fvg = detectFVG(bars);
  const sweeps = detectLiquiditySweeps(bars, swings);
  const latest = bars.at(-1);
  const recentStructure = structure.at(-1);
  const recentDisplacement = displacement.at(-1);
  return [
    { id: `${timeframe}_trend`, label: `${timeframe} structure`, pass: Boolean(recentStructure), detail: recentStructure ? `${recentStructure.direction} ${recentStructure.type}` : 'No recent break' },
    { id: `${timeframe}_disp`, label: `${timeframe} displacement`, pass: Boolean(recentDisplacement && latest.t - recentDisplacement.t < 30 * MINUTE), detail: recentDisplacement ? `${recentDisplacement.direction} impulse` : 'No displacement' },
    { id: `${timeframe}_fvg`, label: `${timeframe} imbalance`, pass: Boolean(fvg.at(-1) && latest.t - fvg.at(-1).t < 60 * MINUTE), detail: fvg.at(-1) ? `${fvg.at(-1).direction} FVG` : 'No recent FVG' },
    { id: `${timeframe}_sweep`, label: `${timeframe} liquidity sweep`, pass: Boolean(sweeps.at(-1) && latest.t - sweeps.at(-1).t < 90 * MINUTE), detail: sweeps.at(-1) ? `${sweeps.at(-1).direction} sweep` : 'No recent sweep' },
  ];
}

export function buildStructureObjects(bars, source = 'Strategy Engine') {
  const swings = detectSwings(bars);
  const breaks = detectStructureBreaks(bars, swings);
  const displacement = detectDisplacement(bars);
  const fvg = detectFVG(bars);
  const eq = detectEqualHighLow(bars);
  const sweeps = detectLiquiditySweeps(bars, swings);
  const zones = detectSupplyDemand(bars, displacement);
  const obs = detectOrderBlocks(bars, breaks);
  const objects = [];
  for (const s of swings.slice(-80)) objects.push({ type: s.type, time: s.t, price: s.price, source, rationale: 'Detected local swing pivot' });
  for (const b of breaks.slice(-40)) objects.push({ type: b.type, direction: b.direction, time: b.t, price: b.price, source, rationale: `Close crossed prior ${b.direction === 'bullish' ? 'high' : 'low'} structure` });
  for (const d of displacement.slice(-40)) objects.push({ type: 'displacement', direction: d.direction, time: d.t, p1: d.from, p2: d.to, source, rationale: `Body expansion z-score ${d.strength.toFixed(2)}` });
  for (const g of fvg.slice(-50)) objects.push({ type: 'FVG', direction: g.direction, time: g.t, low: g.low, high: g.high, source, rationale: 'Three-candle price imbalance' });
  for (const e of eq.slice(-30)) objects.push({ type: e.type, t1: e.t1, t2: e.t2, price: e.price, source, rationale: 'Two swing points within tolerance' });
  for (const s of sweeps.slice(-30)) objects.push({ type: 'liquiditySweep', direction: s.direction, time: s.t, price: s.price, source, rationale: 'Price pierced swing and closed back through it' });
  for (const z of zones) objects.push({ type: z.type, time: z.t, low: z.low, high: z.high, source, rationale: 'Base candle preceding displacement' });
  for (const ob of obs) objects.push({ type: 'orderBlock', direction: ob.direction, time: ob.t, low: ob.low, high: ob.high, source, rationale: 'Opposing candle preceding structure break' });
  return objects;
}

export function featureVector(windowBars) {
  if (!windowBars.length) return [];
  const first = windowBars[0].c;
  const closes = windowBars.map((b) => (b.c - first) / first);
  const ranges = windowBars.map((b) => (b.h - b.l) / Math.max(b.c, 1e-9));
  const bodies = windowBars.map((b) => (b.c - b.o) / Math.max(b.o, 1e-9));
  const splits = 8;
  const vec = [];
  for (let i = 0; i < splits; i += 1) {
    const a = Math.floor((i * windowBars.length) / splits);
    const b = Math.max(a + 1, Math.floor(((i + 1) * windowBars.length) / splits));
    vec.push(avg(closes.slice(a, b)), avg(ranges.slice(a, b)), avg(bodies.slice(a, b)));
  }
  return vec;
}

export function cosineSimilarity(a, b) {
  const n = Math.min(a.length, b.length);
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < n; i += 1) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / Math.sqrt(aa * bb) : 0;
}

export function findSimilarWindows(bars, anchorEndIndex = bars.length - 1, windowSize = 60, topK = 12) {
  if (bars.length < windowSize * 3) return [];
  const anchorStart = Math.max(0, anchorEndIndex - windowSize + 1);
  const anchor = bars.slice(anchorStart, anchorEndIndex + 1);
  const target = featureVector(anchor);
  const candidates = [];
  for (let end = windowSize - 1; end < anchorStart - windowSize; end += Math.max(5, Math.floor(windowSize / 6))) {
    const start = end - windowSize + 1;
    const window = bars.slice(start, end + 1);
    candidates.push({ startIndex: start, endIndex: end, startTime: window[0].t, endTime: window.at(-1).endT, similarity: cosineSimilarity(target, featureVector(window)), bars: window });
  }
  return candidates.sort((a, b) => b.similarity - a.similarity).slice(0, topK);
}

export function calculateForwardStats(matches, allBars, horizonBars = 30) {
  const rows = [];
  for (const match of matches) {
    const entryIndex = match.endIndex;
    const entry = allBars[entryIndex]?.c;
    const forward = allBars.slice(entryIndex + 1, entryIndex + 1 + horizonBars);
    if (!entry || !forward.length) continue;
    const highs = forward.map((b) => (b.h - entry) / entry);
    const lows = forward.map((b) => (b.l - entry) / entry);
    const closes = forward.map((b) => (b.c - entry) / entry);
    rows.push({ similarity: match.similarity, mfe: Math.max(...highs), mae: Math.min(...lows), close: closes.at(-1), bars: forward.length });
  }
  return {
    sampleSize: rows.length,
    medianMFE: median(rows.map((r) => r.mfe)),
    medianMAE: median(rows.map((r) => r.mae)),
    medianClose: median(rows.map((r) => r.close)),
    positiveCloseRate: rows.length ? rows.filter((r) => r.close > 0).length / rows.length : 0,
    rows,
    note: 'Descriptive statistics over simulated/local historical matches; not a forecast.',
  };
}

export function riskModel({ equity, entry, stop, riskPercent = 0.5, pointValue = 1, maxDailyDrawdown = Infinity, currentDailyPnL = 0 }) {
  const riskBudget = equity * (riskPercent / 100);
  const stopDistance = Math.abs(entry - stop);
  const units = stopDistance > 0 ? riskBudget / (stopDistance * pointValue) : 0;
  const remainingDailyLoss = Math.max(0, maxDailyDrawdown + Math.min(0, currentDailyPnL));
  return {
    riskBudget,
    stopDistance,
    units,
    notional: units * entry * pointValue,
    remainingDailyLoss,
    exceedsRemainingDailyLoss: riskBudget > remainingDailyLoss,
  };
}

export function transitionSetup(setup, event, now = Date.now()) {
  const allowed = {
    WATCHING: { arm: 'ARMED', invalidate: 'INVALIDATED' },
    ARMED: { trigger: 'TRIGGERED', invalidate: 'INVALIDATED', reset: 'WATCHING' },
    TRIGGERED: { complete: 'COMPLETED', invalidate: 'INVALIDATED' },
    INVALIDATED: { reset: 'WATCHING' },
    COMPLETED: { reset: 'WATCHING' },
  };
  const next = allowed[setup.status]?.[event];
  if (!next) return setup;
  return { ...setup, status: next, updatedAt: now, audit: [...(setup.audit || []), { at: now, event, from: setup.status, to: next }] };
}

export function createScenario({ id, label, bias, confirmation, invalidation, path = [], source = 'Assistant' }) {
  return { id, type: 'scenario', label, bias, confirmation, invalidation, path, source, createdAt: Date.now(), prediction: false };
}
