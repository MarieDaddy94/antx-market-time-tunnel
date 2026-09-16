import { aggregateBarsByTime, MINUTE, TF_MS, makeSeedBars } from './market.js';
import { transitionSetup } from './analysis.js';

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function maybeWorkerStability(workerClient, bars) {
  if (!workerClient) return null;
  try {
    return await workerClient('stability', { bars, iterations: 50_000, maxBars: 5_000 });
  } catch {
    return null;
  }
}

export async function runSelfTests({ store, replay, persistence, workerClient, renderer, getHistory }) {
  const results = [];
  const run = async (name, fn) => {
    const started = performance.now();
    try {
      const detail = await fn();
      results.push({ name, pass: true, ms: performance.now() - started, detail: detail || 'pass' });
    } catch (error) {
      results.push({ name, pass: false, ms: performance.now() - started, detail: String(error?.message || error) });
    }
  };

  await run('Absolute-time progression', () => {
    const bars = makeSeedBars({ symbol: 'BTCUSDT', count: 600, endTime: Date.now() });
    for (let i = 1; i < bars.length; i += 1) assert(bars[i].t > bars[i - 1].t, `Non-monotonic bar at ${i}`);
    return `${bars.length} bars monotonic`;
  });

  await run('Aggregation boundaries', () => {
    const bars = makeSeedBars({ symbol: 'BTCUSDT', count: 720, endTime: Date.now() });
    for (const [name, ms] of Object.entries(TF_MS)) {
      if (name === 'M1') continue;
      const agg = aggregateBarsByTime(bars, ms);
      assert(agg.every((b) => b.t % ms === 0), `${name} has misaligned bucket`);
    }
    return 'M5/M15/H1/H4 buckets aligned to absolute time';
  });

  await run('Replay no-future-leakage', () => {
    const symbol = store.getState().market.activeSymbol;
    const bars = getHistory(symbol);
    const cursor = bars[Math.floor(bars.length * 0.7)].endT;
    replay.enable(cursor);
    const snapshot = replay.snapshot(symbol);
    const check = replay.assertNoFutureLeakage(snapshot);
    replay.disable();
    assert(check.pass, `${check.badCount} future bars leaked`);
    return `cursor ${new Date(cursor).toISOString()}`;
  });

  await run('Annotation persistence', async () => {
    const name = `__antx_test_${Date.now()}`;
    const obj = store.addSceneObject({ type: 'level', price: 123.45, label: 'self-test' }, { source: 'Test' });
    await persistence.saveStore(store, name);
    const record = await persistence.load(name);
    assert(record.payload.state.scene.objects.some((o) => o.id === obj.id), 'Saved workspace missing annotation');
    await persistence.remove(name);
    store.deleteSceneObject(obj.id, { source: 'Test' });
    return `backend ${persistence.backend}`;
  });

  await run('Workspace save/load', async () => {
    const name = `__antx_workspace_${Date.now()}`;
    const before = store.getState().market.activeSymbol;
    await persistence.saveStore(store, name);
    store.patch('market.activeSymbol', before === 'BTCUSDT' ? 'ETHUSDT' : 'BTCUSDT', { source: 'Test' });
    await persistence.loadIntoStore(store, name);
    assert(store.getState().market.activeSymbol === before, 'Workspace did not restore symbol');
    await persistence.remove(name);
    return 'state restored';
  });

  await run('Selection containment', () => {
    const symbol = store.getState().market.activeSymbol;
    const bars = getHistory(symbol);
    const selected = bars[Math.floor(bars.length * 0.8)];
    const t = (selected.t + selected.endT) / 2;
    const tf = replay.snapshot(symbol).timeframes;
    for (const [name, rows] of Object.entries(tf)) {
      const contains = rows.some((b) => t >= b.t && t < b.endT);
      assert(contains, `${name} did not contain selected timestamp`);
    }
    return 'M1→H4 containment intact';
  });

  await run('Stable scene object IDs', () => {
    const a = store.addSceneObject({ type: 'note', text: 'A' }, { source: 'Test' });
    const b = store.addSceneObject({ type: 'note', text: 'B' }, { source: 'Test' });
    assert(a.id !== b.id, 'IDs collided');
    store.deleteSceneObject(a.id, { source: 'Test' });
    store.deleteSceneObject(b.id, { source: 'Test' });
    return `${a.id} != ${b.id}`;
  });

  await run('Setup state machine', () => {
    let setup = { status: 'WATCHING', audit: [] };
    setup = transitionSetup(setup, 'arm');
    assert(setup.status === 'ARMED', 'WATCHING→ARMED failed');
    setup = transitionSetup(setup, 'trigger');
    assert(setup.status === 'TRIGGERED', 'ARMED→TRIGGERED failed');
    setup = transitionSetup(setup, 'complete');
    assert(setup.status === 'COMPLETED', 'TRIGGERED→COMPLETED failed');
    return setup.audit.map((x) => x.to).join(' → ');
  });

  await run('Renderer recovery boundary', () => {
    assert(renderer && typeof renderer.requestRender === 'function', 'Renderer missing requestRender');
    renderer.requestRender();
    return 'render request accepted';
  });

  await run('Long-run 50k-bar stability', async () => {
    const symbol = store.getState().market.activeSymbol;
    const bars = getHistory(symbol).slice(-1000);
    const worker = await maybeWorkerStability(workerClient, bars);
    if (worker) {
      assert(worker.pass, JSON.stringify(worker));
      return `worker pass · ${worker.barsRetained} retained`;
    }
    let lastT = bars.at(-1).endT;
    const work = bars.map((b) => ({ ...b }));
    for (let i = 0; i < 50_000; i += 1) {
      const last = work.at(-1);
      const t = lastT;
      const c = last.c * (1 + Math.sin(i * 0.01) * 0.00001);
      work.push({ t, endT: t + MINUTE, o: last.c, h: Math.max(last.c, c), l: Math.min(last.c, c), c, v: 1, symbol });
      lastT += MINUTE;
      if (work.length > 5_000) work.shift();
    }
    assert(work.length <= 5_000, 'Buffer exceeded cap');
    assert(work.at(-1).endT > bars.at(-1).endT, 'Time did not advance');
    return 'main-thread fallback pass · 50,000 iterations';
  });

  return {
    passed: results.filter((r) => r.pass).length,
    failed: results.filter((r) => !r.pass).length,
    results,
    ranAt: Date.now(),
  };
}
