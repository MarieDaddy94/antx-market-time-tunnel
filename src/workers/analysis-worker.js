import { deriveTimeframes } from '../core/market.js';
import { buildStructureObjects, buildEvidence, findSimilarWindows, calculateForwardStats } from '../core/analysis.js';

function runLongStability({ bars, iterations = 50_000, maxBars = 5_000 }) {
  if (!bars.length) return { pass: false, reason: 'No seed bars' };
  const work = bars.map((b) => ({ ...b }));
  let t = work.at(-1).endT;
  let lastT = t;
  let monotonic = true;
  for (let i = 0; i < iterations; i += 1) {
    const last = work.at(-1);
    const amp = Math.max(Math.abs(last.c) * 0.0001, 0.0001);
    const c = Math.max(0.0001, last.c + (Math.sin(i * 0.177) * amp + (i % 7 - 3) * amp * 0.03));
    work.push({ t, endT: t + 60_000, o: last.c, h: Math.max(last.c, c) + amp * 0.4, l: Math.min(last.c, c) - amp * 0.4, c, v: 1, symbol: last.symbol });
    t += 60_000;
    if (t <= lastT) monotonic = false;
    lastT = t;
    if (work.length > maxBars) work.shift();
  }
  const tf = deriveTimeframes(work);
  const aligned = Object.entries(tf).every(([name, rows]) => {
    const ms = { M1: 60_000, M5: 300_000, M15: 900_000, H1: 3_600_000, H4: 14_400_000 }[name];
    return rows.every((b) => b.t % ms === 0 || name === 'M1');
  });
  return {
    pass: monotonic && aligned && work.length <= maxBars,
    monotonic,
    aligned,
    barsRetained: work.length,
    lastTime: work.at(-1).endT,
    timeframeCounts: Object.fromEntries(Object.entries(tf).map(([k, v]) => [k, v.length])),
  };
}

self.onmessage = (event) => {
  const { id, type, payload } = event.data || {};
  try {
    let result;
    if (type === 'derive') {
      result = deriveTimeframes(payload.bars);
    } else if (type === 'structure') {
      result = {
        objects: buildStructureObjects(payload.bars),
        evidence: buildEvidence({ bars: payload.bars, timeframe: payload.timeframe || 'M1' }),
      };
    } else if (type === 'similarity') {
      const matches = findSimilarWindows(payload.bars, payload.anchorEndIndex, payload.windowSize, payload.topK);
      result = { matches: matches.map(({ bars, ...rest }) => rest), stats: calculateForwardStats(matches, payload.bars, payload.horizonBars) };
    } else if (type === 'stability') {
      result = runLongStability(payload);
    } else {
      throw new Error(`Unknown worker message type: ${type}`);
    }
    self.postMessage({ id, ok: true, result });
  } catch (error) {
    self.postMessage({ id, ok: false, error: String(error?.stack || error?.message || error) });
  }
};
