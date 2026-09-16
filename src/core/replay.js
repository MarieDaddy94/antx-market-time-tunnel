import { MINUTE, deriveTimeframes } from './market.js';

export class ReplayEngine {
  constructor({ store, getHistory, onFrame, intervalMs = 250 }) {
    this.store = store;
    this.getHistory = getHistory;
    this.onFrame = onFrame;
    this.intervalMs = intervalMs;
    this.timer = null;
  }

  getState() {
    return this.store.getState().replay;
  }

  setBounds(symbol) {
    const bars = this.getHistory(symbol);
    if (!bars.length) return;
    this.store.transact('Set replay bounds', (state) => {
      state.replay.minTime = bars[0].t;
      state.replay.maxTime = bars.at(-1).endT;
      if (!state.replay.cursor) state.replay.cursor = bars.at(-1).endT;
    }, { reversible: false, source: 'Replay' });
  }

  enable(time = null) {
    const symbol = this.store.getState().market.activeSymbol;
    this.setBounds(symbol);
    const replay = this.store.getState().replay;
    this.store.transact('Enable replay', (state) => {
      state.replay.enabled = true;
      state.replay.playing = false;
      state.replay.followLive = false;
      state.runtime.mode = 'replay';
      state.replay.cursor = time ?? replay.cursor ?? replay.maxTime;
    }, { reversible: false, source: 'Replay' });
    this.emit();
  }

  disable() {
    this.pause();
    this.store.transact('Disable replay', (state) => {
      state.replay.enabled = false;
      state.replay.playing = false;
      state.replay.followLive = true;
      state.runtime.mode = 'live';
    }, { reversible: false, source: 'Replay' });
    this.emit();
  }

  play() {
    if (!this.getState().enabled) this.enable();
    if (this.timer) return;
    this.store.patch('replay.playing', true, { source: 'Replay', markDirty: false });
    this.timer = setInterval(() => {
      const replay = this.getState();
      const advance = Math.max(MINUTE, MINUTE * replay.speed);
      const next = Math.min(replay.maxTime, replay.cursor + advance);
      this.seek(next);
      if (next >= replay.maxTime) this.pause();
    }, this.intervalMs);
  }

  pause() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.store.patch('replay.playing', false, { source: 'Replay', markDirty: false });
  }

  setSpeed(speed) {
    const allowed = [0.25, 0.5, 1, 2, 5, 10, 30, 60];
    const nearest = allowed.reduce((a, b) => Math.abs(b - speed) < Math.abs(a - speed) ? b : a);
    this.store.patch('replay.speed', nearest, { source: 'Replay', markDirty: false });
    return nearest;
  }

  stepBars(count = 1) {
    const replay = this.getState();
    if (!replay.enabled) this.enable();
    this.seek(replay.cursor + count * MINUTE);
  }

  seek(time) {
    const replay = this.getState();
    const cursor = Math.max(replay.minTime ?? time, Math.min(replay.maxTime ?? time, time));
    this.store.patch('replay.cursor', cursor, { source: 'Replay', markDirty: false });
    this.emit();
  }

  snapshot(symbol = this.store.getState().market.activeSymbol) {
    const replay = this.getState();
    const full = this.getHistory(symbol);
    const cursor = replay.enabled ? replay.cursor : full.at(-1)?.endT;
    const safeBars = full.filter((bar) => bar.t < cursor).map((bar) => {
      if (bar.endT <= cursor) return bar;
      return { ...bar, endT: cursor };
    });
    return {
      symbol,
      cursor,
      bars: safeBars,
      timeframes: deriveTimeframes(safeBars),
      futureBarsHidden: full.length - safeBars.length,
    };
  }

  emit() {
    const snapshot = this.snapshot();
    this.onFrame?.(snapshot);
    return snapshot;
  }

  assertNoFutureLeakage(snapshot = this.snapshot()) {
    const cursor = snapshot.cursor;
    const bad = Object.values(snapshot.timeframes).flat().filter((bar) => bar.t >= cursor);
    return { pass: bad.length === 0, badCount: bad.length, cursor };
  }

  destroy() {
    this.pause();
  }
}
