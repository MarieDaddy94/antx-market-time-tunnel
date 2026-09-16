const SAFE_METHODS = new Set([
  'addLevel', 'addZone', 'addTimeMarker', 'drawPath', 'attachNote',
  'highlightCandles', 'focusTime', 'focusPrice', 'focusObject', 'moveCamera',
  'soloTimeframe', 'fadeTimeframe', 'clearAnalysis', 'createSetup', 'updateSetup',
  'createScenario', 'showEvidence', 'startGuidedExplanation', 'nextGuideStep',
  'decomposeCandle', 'collapseDecomposition', 'aliasObject',
]);

function assertCommand(command) {
  if (!command || typeof command !== 'object') throw new Error('Assistant bridge command must be an object');
  if (!SAFE_METHODS.has(command.method)) throw new Error(`Scene method not allowed: ${command.method}`);
  if (command.args != null && typeof command.args !== 'object') throw new Error('Command args must be an object');
}

export class AssistantSceneBridge {
  constructor({ sceneAPI, commandRouter, store, allowedOrigins = [location.origin] }) {
    this.sceneAPI = sceneAPI;
    this.commandRouter = commandRouter;
    this.store = store;
    this.allowedOrigins = new Set(allowedOrigins);
    this.listeners = new Set();
    this.started = false;
    this.boundMessage = (event) => this.onMessage(event);
    this.boundCustomEvent = (event) => this.receive(event.detail, { source: 'custom-event' });
  }

  start() {
    if (this.started) return;
    this.started = true;
    window.addEventListener('message', this.boundMessage);
    window.addEventListener('antx:assistant-command', this.boundCustomEvent);
    window.ANTXBridge = {
      receive: (payload) => this.receive(payload, { source: 'window-api' }),
      routeText: (text) => this.routeText(text, { source: 'window-api' }),
      getSnapshot: () => this.snapshot(),
      getCapabilities: () => [...SAFE_METHODS],
    };
  }

  stop() {
    if (!this.started) return;
    this.started = false;
    window.removeEventListener('message', this.boundMessage);
    window.removeEventListener('antx:assistant-command', this.boundCustomEvent);
    if (window.ANTXBridge) delete window.ANTXBridge;
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    for (const listener of this.listeners) listener(event);
  }

  snapshot() {
    const state = this.store.getState();
    return {
      symbol: state.market.activeSymbol,
      replay: state.replay,
      selectedObjectId: state.scene.selectedObjectId,
      selectedCandle: state.scene.selectedCandle,
      activeTimeframe: state.scene.activeTimeframe,
      camera: state.scene.camera,
      evidence: state.analysis.evidence,
      objectCount: state.scene.objects.length,
      setupCount: state.trading.setups.length,
      scenarioCount: state.trading.scenarios.length,
    };
  }

  async onMessage(event) {
    if (!this.allowedOrigins.has('*') && !this.allowedOrigins.has(event.origin)) return;
    const data = event.data;
    if (!data || data.channel !== 'ANTX_ASSISTANT') return;
    const id = data.id || crypto.randomUUID();
    try {
      const result = await this.receive(data.payload, { source: `postMessage:${event.origin}` });
      event.source?.postMessage({ channel: 'ANTX_ASSISTANT_RESULT', id, ok: true, result }, event.origin);
    } catch (error) {
      event.source?.postMessage({ channel: 'ANTX_ASSISTANT_RESULT', id, ok: false, error: String(error?.message || error) }, event.origin);
    }
  }

  async receive(payload, meta = {}) {
    if (typeof payload === 'string') return this.routeText(payload, meta);
    if (Array.isArray(payload)) {
      const results = [];
      for (const command of payload) results.push(await this.execute(command, meta));
      return results;
    }
    return this.execute(payload, meta);
  }

  routeText(text, meta = {}) {
    const result = this.commandRouter(String(text));
    this.emit({ type: 'text-command', text, result, ...meta });
    return result;
  }

  async execute(command, meta = {}) {
    assertCommand(command);
    const fn = this.sceneAPI[command.method];
    if (typeof fn !== 'function') throw new Error(`Scene API method missing: ${command.method}`);
    const result = await fn(command.args || {});
    this.emit({ type: 'scene-command', command, result, ...meta });
    return result;
  }
}

export function createAssistantBridge(options) {
  const bridge = new AssistantSceneBridge(options);
  bridge.start();
  return bridge;
}
