const clone = (value) => structuredClone(value);

export function createInitialState() {
  return {
    runtime: {
      provider: 'simulated',
      mode: 'live',
      renderPath: 'auto',
      workerStatus: 'starting',
      lastError: null,
      startedAt: Date.now(),
      renderMs: 0,
      fps: 0,
      ticksProcessed: 0,
    },
    market: {
      activeSymbol: 'BTCUSDT',
      symbols: ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'NAS100', 'XAUUSD'],
      ticks: {},
      bars: {},
      orderFlow: {},
      liquidity: {},
      events: [],
      sessions: [],
    },
    replay: {
      enabled: false,
      playing: false,
      cursor: null,
      speed: 1,
      minTime: null,
      maxTime: null,
      followLive: true,
    },
    scene: {
      objects: [],
      selectedObjectId: null,
      selectedCandle: null,
      hiddenTypes: [],
      sourceFilter: 'all',
      decomposition: null,
      camera: { yaw: -0.45, pitch: 0.16, zoom: 1, focusZ: 8, target: null },
      timeframeVisibility: { M1: true, M5: true, M15: true, H1: true, H4: true },
      activeTimeframe: 'M1',
      expandedSpacing: false,
      guidedExplanation: null,
    },
    analysis: {
      toggles: {
        swings: true,
        bos: true,
        choch: true,
        displacement: true,
        fvg: true,
        orderBlocks: true,
        liquiditySweeps: true,
        equalHighLow: true,
        supplyDemand: true,
        previousDay: true,
        sessionLevels: true,
        openingRange: true,
        vwap: true,
        heatmap: true,
        orderFlow: true,
        volumeProfile: true,
        projectedStructure: true,
        events: true,
        sessions: true,
      },
      evidence: [],
      similarity: { matches: [], stats: null, source: 'demo' },
      crossMarket: {},
    },
    trading: {
      account: { equity: 100000, balance: 100000, dailyDrawdownLimit: 5000, maxDrawdownLimit: 10000, demo: true },
      trades: [],
      setups: [],
      scenarios: [],
      risk: { riskPercent: 0.5, maxOpenRiskPercent: 2 },
    },
    assistant: {
      messages: [],
      context: { lastSelectedObjectId: null, lastSelectedCandle: null, aliases: {} },
      voiceEnabled: false,
    },
    workspace: {
      name: 'Default Workspace',
      dirty: false,
      lastSavedAt: null,
    },
  };
}

export class AppStore {
  constructor(initial = createInitialState()) {
    this.state = clone(initial);
    this.listeners = new Set();
    this.history = [];
    this.future = [];
    this.maxHistory = 200;
    this.revisions = new Map();
  }

  getState() {
    return this.state;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(meta = {}) {
    for (const listener of this.listeners) listener(this.state, meta);
  }

  setState(next, meta = {}) {
    this.state = typeof next === 'function' ? next(this.state) : next;
    this.state.workspace.dirty = meta.markDirty !== false;
    this.emit(meta);
  }

  patch(path, value, meta = {}) {
    const keys = Array.isArray(path) ? path : String(path).split('.');
    const next = clone(this.state);
    let node = next;
    for (let i = 0; i < keys.length - 1; i++) node = node[keys[i]];
    node[keys.at(-1)] = typeof value === 'function' ? value(node[keys.at(-1)]) : value;
    this.setState(next, meta);
  }

  transact(label, mutator, { reversible = true, source = 'system' } = {}) {
    const before = clone(this.state);
    const next = clone(this.state);
    mutator(next);
    if (reversible) {
      this.history.push({ label, source, before, after: clone(next), at: Date.now() });
      if (this.history.length > this.maxHistory) this.history.shift();
      this.future = [];
    }
    next.workspace.dirty = true;
    this.state = next;
    this.emit({ label, source });
  }

  undo() {
    const entry = this.history.pop();
    if (!entry) return false;
    this.future.push({ ...entry, before: clone(entry.before), after: clone(entry.after) });
    this.state = clone(entry.before);
    this.emit({ label: `Undo ${entry.label}`, source: 'history' });
    return true;
  }

  redo() {
    const entry = this.future.pop();
    if (!entry) return false;
    this.history.push({ ...entry, before: clone(entry.before), after: clone(entry.after) });
    this.state = clone(entry.after);
    this.emit({ label: `Redo ${entry.label}`, source: 'history' });
    return true;
  }

  nextId(prefix = 'obj') {
    if (!this._idCounter) this._idCounter = 0;
    this._idCounter += 1;
    return `${prefix}_${Date.now().toString(36)}_${this._idCounter.toString(36)}`;
  }

  addSceneObject(object, { source = 'Manual', reversible = true } = {}) {
    const obj = {
      id: object.id || this.nextId(object.type || 'obj'),
      visible: true,
      locked: false,
      group: null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      source,
      rationale: object.rationale || '',
      evidence: object.evidence || [],
      revision: 1,
      ...object,
    };
    this.transact(`Add ${obj.type}`, (state) => {
      state.scene.objects.push(obj);
      state.scene.selectedObjectId = obj.id;
      state.assistant.context.lastSelectedObjectId = obj.id;
    }, { reversible, source });
    this.revisions.set(obj.id, [clone(obj)]);
    return obj;
  }

  updateSceneObject(id, patch, { source = 'Manual' } = {}) {
    let updated = null;
    this.transact(`Update ${id}`, (state) => {
      const index = state.scene.objects.findIndex((o) => o.id === id);
      if (index < 0) return;
      const current = state.scene.objects[index];
      updated = {
        ...current,
        ...(typeof patch === 'function' ? patch(current) : patch),
        updatedAt: Date.now(),
        revision: (current.revision || 1) + 1,
      };
      state.scene.objects[index] = updated;
    }, { source });
    if (updated) {
      const versions = this.revisions.get(id) || [];
      versions.push(clone(updated));
      if (versions.length > 50) versions.shift();
      this.revisions.set(id, versions);
    }
    return updated;
  }

  deleteSceneObject(id, { source = 'Manual' } = {}) {
    this.transact(`Delete ${id}`, (state) => {
      state.scene.objects = state.scene.objects.filter((o) => o.id !== id);
      if (state.scene.selectedObjectId === id) state.scene.selectedObjectId = null;
    }, { source });
  }

  getObjectRevisions(id) {
    return clone(this.revisions.get(id) || []);
  }

  restoreObjectRevision(id, revisionNumber) {
    const versions = this.revisions.get(id) || [];
    const target = versions.find((v) => v.revision === revisionNumber);
    if (!target) return false;
    this.updateSceneObject(id, clone(target), { source: 'History' });
    return true;
  }

  serialize() {
    return clone({ state: this.state, revisions: [...this.revisions.entries()] });
  }

  hydrate(payload) {
    this.state = clone(payload.state || payload);
    this.revisions = new Map(payload.revisions || []);
    this.history = [];
    this.future = [];
    this.emit({ label: 'Hydrate workspace', source: 'persistence' });
  }
}
