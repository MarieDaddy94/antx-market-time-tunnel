import './styles.css';
import { AppStore } from './core/store.js';
import {
  SimulatedMarketProvider,
  deriveTimeframes,
  buildMarketEvents,
  buildSessionRegions,
  createSyntheticLiquidity,
  computeReturns,
  correlation,
} from './core/market.js';
import {
  buildStructureObjects,
  buildEvidence,
  findSimilarWindows,
  calculateForwardStats,
  riskModel,
} from './core/analysis.js';
import { createSceneAPI, createCommandRouter } from './core/scene.js';
import { ReplayEngine } from './core/replay.js';
import { WorkspacePersistence } from './core/persistence.js';
import { CanvasTunnelRenderer } from './render/CanvasRenderer.js';
import { ThreeTunnelRenderer, canUseWebGL } from './render/ThreeRenderer.js';
import { BackTesterAdapter } from './integrations/backtester.js';
import { runSelfTests } from './core/tests.js';

const store = new AppStore();
const persistence = new WorkspacePersistence();
const provider = new SimulatedMarketProvider();
const backtester = new BackTesterAdapter();
const sceneAPI = createSceneAPI(store);
window.ANTXScene = sceneAPI;
window.ANTXStore = store;

const app = document.querySelector('#app');
app.innerHTML = `
  <div class="shell">
    <header class="topbar">
      <div class="brand"><div class="brandmark">A</div><div><strong>ANTX</strong><span>Market Time Tunnel</span></div></div>
      <div class="topnav"><b>Trade</b><span>Replay</span><span>Research</span><span>Scene API</span><span>Diagnostics</span></div>
      <div class="runtime-chip"><span class="pulse"></span><span id="runtimeMode">LIVE · simulated</span></div>
    </header>

    <div class="body-grid">
      <aside class="leftbar">
        <div class="section-title">Markets</div>
        <div id="symbolList" class="symbol-list"></div>

        <div class="card compact">
          <div class="card-head"><b>Workspace</b><span id="workspaceDirty">clean</span></div>
          <input id="workspaceName" class="text-input" value="Default Workspace" />
          <div class="two-col">
            <button id="saveWorkspace" class="small-btn primary">Save</button>
            <button id="loadWorkspace" class="small-btn">Load</button>
          </div>
          <select id="workspaceList" class="select-input"></select>
        </div>

        <div class="card compact">
          <div class="card-head"><b>Cross-market</b><span>descriptive</span></div>
          <select id="compareSymbol" class="select-input"></select>
          <div class="metric-row"><span>Return correlation</span><b id="corrValue">—</b></div>
          <div class="metric-row"><span>Window</span><b>200 M1</b></div>
        </div>

        <div class="card compact">
          <div class="card-head"><b>Data source</b><span>demo/import</span></div>
          <div class="metric-row"><span>Provider</span><b id="providerName">simulated</b></div>
          <label class="file-label">Import BackTester case<input id="backtesterInput" type="file" accept="application/json,.json" /></label>
          <div id="backtesterStatus" class="muted-line">No imported cases</div>
        </div>
      </aside>

      <main class="main">
        <section class="market-strip">
          <div><div id="marketName" class="market-name">BTCUSDT</div><div class="muted-line">Canonical M1 → M5 → M15 → H1 → H4</div></div>
          <div><div id="marketPrice" class="big-price">—</div><div class="positive">SIMULATED LIVE FEED</div></div>
          <div class="strip-metrics">
            <div><span>Bars</span><b id="barCount">—</b></div>
            <div><span>Objects</span><b id="objectCount">0</b></div>
            <div><span>Render</span><b id="renderPathLabel">Canvas</b></div>
            <div><span>Replay</span><b id="replayState">Live</b></div>
          </div>
        </section>

        <section class="control-row">
          <div id="tfControls" class="button-group">
            <button data-tf="M1" class="active">M1</button><button data-tf="M5">M5</button><button data-tf="M15">M15</button><button data-tf="H1">H1</button><button data-tf="H4">H4</button>
          </div>
          <div class="button-group">
            <button id="showAllTF">All TF</button><button id="soloTF">Solo</button><button id="expandDepth">Expand Z</button><button id="decompose">Decompose</button><button id="collapseDecompose">Collapse</button>
          </div>
          <div class="button-group">
            <button id="rendererToggle">GPU Preview</button><button id="runStructure">Analyze Structure</button><button id="guidedMode">Guided Tour</button><button id="nextGuide">Next Step</button>
          </div>
        </section>

        <section class="stage-wrap">
          <div id="gpuLayer" class="gpu-layer hidden"></div>
          <canvas id="chartCanvas"></canvas>
          <div class="stage-hud top-left"><b>X</b> time · <b>Y</b> price · <b>Z</b> timeframe</div>
          <div class="stage-hud top-right" id="selectionHud">Click a candle to synchronize hierarchy</div>
          <div class="stage-hud bottom-left">Drag = orbit · wheel = zoom · scene objects keep provenance + revision history</div>
        </section>

        <section class="timeline-card">
          <div class="timeline-head">
            <div><b>Replay / Time Machine</b><span id="replayTime">live</span></div>
            <div class="button-group tight"><button id="replayToggle">Enter Replay</button><button id="stepBack">◀ Bar</button><button id="playReplay">Play</button><button id="stepForward">Bar ▶</button><button id="exitReplay">Live</button></div>
          </div>
          <input id="replaySlider" type="range" min="0" max="1000" value="1000" />
          <div class="replay-footer"><select id="replaySpeed"><option value="0.5">0.5×</option><option value="1" selected>1×</option><option value="2">2×</option><option value="5">5×</option><option value="10">10×</option><option value="30">30×</option></select><span>Chronology-safe: bars at/after the cursor are excluded.</span></div>
        </section>
      </main>

      <aside class="rightbar">
        <details open class="panel"><summary>Assistant / Voice</summary>
          <div id="chatLog" class="chat-log"></div>
          <textarea id="assistantInput" class="assistant-input" placeholder='Try: “support at 23800”, “decompose that candle”, “bullish scenario”, “solo H1”'></textarea>
          <div class="three-col"><button id="assistantSend" class="small-btn primary">Send</button><button id="voiceButton" class="small-btn">Voice</button><button id="assistantClear" class="small-btn">Clear AI objects</button></div>
          <div id="voiceStatus" class="muted-line"></div>
        </details>

        <details open class="panel"><summary>Evidence / Structure</summary>
          <div class="toggle-grid" id="analysisToggles"></div>
          <div id="evidenceList" class="evidence-list"></div>
        </details>

        <details class="panel"><summary>Object Manager</summary>
          <div class="object-toolbar"><select id="objectSourceFilter"><option value="all">All sources</option><option>Manual</option><option>Assistant</option><option>Strategy Engine</option><option>BackTester Import</option></select><button id="undoBtn" class="small-btn">Undo</button><button id="redoBtn" class="small-btn">Redo</button></div>
          <div id="objectList" class="object-list"></div>
        </details>

        <details class="panel"><summary>Similarity Research</summary>
          <button id="runSimilarity" class="small-btn primary full">Find Similar 60-bar Windows</button>
          <div id="similaritySummary" class="research-box">No similarity run yet.</div>
          <div id="similarityList" class="object-list"></div>
        </details>

        <details class="panel"><summary>Setup / Risk</summary>
          <div class="two-col"><input id="riskPercent" class="text-input" value="0.5" /><span class="input-label">% equity risk</span></div>
          <div class="three-col"><button id="createLongSetup" class="small-btn positive-btn">Long setup</button><button id="createShortSetup" class="small-btn negative-btn">Short setup</button><button id="addDemoTrade" class="small-btn">Demo trade</button></div>
          <div id="setupList" class="object-list"></div>
        </details>

        <details class="panel"><summary>Scenarios</summary>
          <div class="two-col"><button id="bullScenario" class="small-btn positive-btn">Bullish scenario</button><button id="bearScenario" class="small-btn negative-btn">Bearish scenario</button></div>
          <div id="scenarioList" class="object-list"></div>
        </details>

        <details class="panel"><summary>Diagnostics</summary>
          <div id="diagnostics" class="diagnostics"></div>
        </details>

        <details class="panel"><summary>Self Tests</summary>
          <button id="runTests" class="small-btn primary full">Run Self Tests</button>
          <div id="testResults" class="test-results">Not run.</div>
        </details>
      </aside>
    </div>
  </div>
`;

const canvas = document.querySelector('#chartCanvas');
const gpuLayer = document.querySelector('#gpuLayer');
const canvasRenderer = new CanvasTunnelRenderer(canvas, store);
let gpuRenderer = null;
let renderPath = 'canvas';

const worker = new Worker(new URL('./workers/analysis-worker.js', import.meta.url), { type: 'module' });
let workerId = 0;
const workerWaiters = new Map();
worker.onmessage = ({ data }) => {
  const waiter = workerWaiters.get(data.id);
  if (!waiter) return;
  workerWaiters.delete(data.id);
  data.ok ? waiter.resolve(data.result) : waiter.reject(new Error(data.error));
};
worker.onerror = (event) => {
  store.patch('runtime.workerStatus', 'error', { markDirty: false });
  store.patch('runtime.lastError', String(event.message || 'Worker error'), { markDirty: false });
};
const workerClient = (type, payload) => new Promise((resolve, reject) => {
  const id = ++workerId;
  workerWaiters.set(id, { resolve, reject });
  worker.postMessage({ id, type, payload });
});
store.patch('runtime.workerStatus', 'ready', { markDirty: false });

const replay = new ReplayEngine({
  store,
  getHistory: (symbol) => provider.getHistory(symbol),
  onFrame: (snapshot) => renderSnapshot(snapshot),
});

const getMarketContext = () => {
  const symbol = store.getState().market.activeSymbol;
  const snapshot = replay.getState().enabled ? replay.snapshot(symbol) : provider.snapshot(symbol);
  return { symbol, snapshot, activeBars: snapshot.timeframes[store.getState().scene.activeTimeframe] || snapshot.bars };
};
const commandRouter = createCommandRouter({ store, sceneAPI, getMarketContext });

function renderSnapshot(snapshot = getMarketContext().snapshot) {
  canvasRenderer.setData(snapshot);
  if (gpuRenderer?.enabled) gpuRenderer.setData(snapshot);
  updateMarketHeader(snapshot);
}

function updateMarketHeader(snapshot) {
  const state = store.getState();
  const last = snapshot.bars.at(-1);
  document.querySelector('#marketName').textContent = state.market.activeSymbol;
  document.querySelector('#marketPrice').textContent = last ? last.c.toLocaleString(undefined, { maximumFractionDigits: 4 }) : '—';
  document.querySelector('#barCount').textContent = snapshot.bars.length;
  document.querySelector('#objectCount').textContent = state.scene.objects.length;
  document.querySelector('#replayState').textContent = state.replay.enabled ? 'Replay' : 'Live';
  document.querySelector('#replayTime').textContent = state.replay.enabled && state.replay.cursor ? new Date(state.replay.cursor).toLocaleString() : 'live';
}

function updateSymbolUI() {
  const state = store.getState();
  const list = document.querySelector('#symbolList');
  list.innerHTML = state.market.symbols.map((symbol) => {
    const last = provider.getHistory(symbol).at(-1);
    return `<button class="symbol-row ${symbol === state.market.activeSymbol ? 'active' : ''}" data-symbol="${symbol}"><span><b>${symbol}</b><small>${symbol.includes('USDT') ? 'crypto' : symbol === 'NAS100' ? 'index' : 'metal'}</small></span><strong>${last ? last.c.toLocaleString(undefined, { maximumFractionDigits: 2 }) : '—'}</strong></button>`;
  }).join('');
  for (const button of list.querySelectorAll('[data-symbol]')) {
    button.onclick = () => switchSymbol(button.dataset.symbol);
  }
  const compare = document.querySelector('#compareSymbol');
  compare.innerHTML = state.market.symbols.filter((x) => x !== state.market.activeSymbol).map((x) => `<option value="${x}">${x}</option>`).join('');
  updateCorrelation();
}

function switchSymbol(symbol) {
  replay.disable();
  store.transact('Switch symbol', (state) => {
    state.market.activeSymbol = symbol;
    state.scene.selectedCandle = null;
    state.scene.selectedObjectId = null;
  }, { reversible: false, source: 'UI' });
  refreshMarketModels();
  updateSymbolUI();
  renderSnapshot(provider.snapshot(symbol));
}

function refreshMarketModels() {
  const state = store.getState();
  const symbol = state.market.activeSymbol;
  const bars = provider.getHistory(symbol);
  store.transact('Refresh derived market models', (s) => {
    s.market.liquidity[symbol] = createSyntheticLiquidity(bars.slice(-360));
    s.market.events = buildMarketEvents(new Date(bars.at(-1)?.t || Date.now()));
    s.market.sessions = buildSessionRegions(new Date(bars.at(-1)?.t || Date.now()));
  }, { reversible: false, source: 'Market' });
}

function updateCorrelation() {
  const state = store.getState();
  const other = document.querySelector('#compareSymbol').value;
  if (!other) return;
  const a = computeReturns(provider.getHistory(state.market.activeSymbol));
  const b = computeReturns(provider.getHistory(other));
  document.querySelector('#corrValue').textContent = correlation(a, b).toFixed(3);
}

document.querySelector('#compareSymbol').onchange = updateCorrelation;

provider.subscribe((event) => {
  if (event.type === 'tick') {
    store.transact('Market tick', (state) => {
      state.runtime.ticksProcessed += 1;
      state.market.ticks[event.symbol] = event.tick;
      const flows = state.market.orderFlow[event.symbol] || [];
      flows.push(event.orderFlow);
      if (flows.length > 250) flows.shift();
      state.market.orderFlow[event.symbol] = flows;
    }, { reversible: false, source: 'Market' });
    if (event.symbol === store.getState().market.activeSymbol) {
      canvasRenderer.pushOrderFlow(event.orderFlow);
    }
  }
  if (event.type === 'bar') {
    if (!store.getState().replay.enabled && event.symbol === store.getState().market.activeSymbol) {
      refreshMarketModels();
      renderSnapshot(provider.snapshot(event.symbol));
    }
    updateSymbolUI();
  }
});
provider.start();

function appendChat(role, text) {
  const log = document.querySelector('#chatLog');
  const div = document.createElement('div');
  div.className = `chat ${role}`;
  div.textContent = text;
  log.appendChild(div);
  while (log.children.length > 100) log.removeChild(log.firstChild);
  log.scrollTop = log.scrollHeight;
}

function sendAssistant(text = document.querySelector('#assistantInput').value.trim()) {
  if (!text) return;
  appendChat('user', text);
  const reply = commandRouter(text);
  appendChat('assistant', reply);
  document.querySelector('#assistantInput').value = '';
  renderSnapshot();
}

document.querySelector('#assistantSend').onclick = () => sendAssistant();
document.querySelector('#assistantInput').addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') sendAssistant();
});
document.querySelector('#assistantClear').onclick = () => {
  sceneAPI.clearAnalysis({ sources: ['Assistant'] });
  appendChat('assistant', 'Cleared Assistant-authored scene objects.');
};

function setupVoice() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const button = document.querySelector('#voiceButton');
  const status = document.querySelector('#voiceStatus');
  if (!SpeechRecognition) {
    button.disabled = true;
    status.textContent = 'Browser speech recognition is unavailable; text control remains active.';
    return;
  }
  const recognition = new SpeechRecognition();
  recognition.continuous = false;
  recognition.interimResults = false;
  recognition.lang = 'en-US';
  recognition.onstart = () => { status.textContent = 'Listening…'; button.classList.add('active'); };
  recognition.onend = () => { status.textContent = 'Voice idle'; button.classList.remove('active'); };
  recognition.onerror = (e) => { status.textContent = `Voice error: ${e.error}`; };
  recognition.onresult = (e) => {
    const transcript = e.results[0][0].transcript;
    document.querySelector('#assistantInput').value = transcript;
    sendAssistant(transcript);
  };
  button.onclick = () => recognition.start();
  status.textContent = 'Voice command available.';
}
setupVoice();

function buildAnalysisToggles() {
  const container = document.querySelector('#analysisToggles');
  const toggles = store.getState().analysis.toggles;
  container.innerHTML = Object.entries(toggles).map(([key, enabled]) => `<label><input type="checkbox" data-analysis-toggle="${key}" ${enabled ? 'checked' : ''}/><span>${key}</span></label>`).join('');
  for (const input of container.querySelectorAll('[data-analysis-toggle]')) {
    input.onchange = () => {
      store.patch(['analysis', 'toggles', input.dataset.analysisToggle], input.checked, { source: 'UI' });
      renderSnapshot();
    };
  }
}

async function runStructureAnalysis() {
  const { snapshot } = getMarketContext();
  const bars = snapshot.timeframes[store.getState().scene.activeTimeframe] || snapshot.bars;
  let result;
  try {
    result = await workerClient('structure', { bars, timeframe: store.getState().scene.activeTimeframe });
  } catch {
    result = { objects: buildStructureObjects(bars), evidence: buildEvidence({ bars, timeframe: store.getState().scene.activeTimeframe }) };
  }
  store.transact('Replace strategy structure', (state) => {
    state.scene.objects = state.scene.objects.filter((o) => o.source !== 'Strategy Engine');
    for (const object of result.objects.slice(-350)) {
      state.scene.objects.push({ id: store.nextId(object.type), visible: true, locked: false, group: 'structure', createdAt: Date.now(), updatedAt: Date.now(), revision: 1, source: 'Strategy Engine', ...object });
    }
    state.analysis.evidence = result.evidence;
  }, { source: 'Strategy Engine' });
  renderSnapshot();
}
document.querySelector('#runStructure').onclick = runStructureAnalysis;

function renderEvidence() {
  const list = document.querySelector('#evidenceList');
  list.innerHTML = store.getState().analysis.evidence.map((e) => `<button class="evidence ${e.pass ? 'pass' : 'fail'}" data-evidence="${e.id}"><span>${e.pass ? '✓' : '○'} ${e.label}</span><small>${e.detail}</small></button>`).join('') || '<div class="muted-line">Run structure analysis to populate evidence.</div>';
  for (const button of list.querySelectorAll('[data-evidence]')) {
    button.onclick = () => sceneAPI.showEvidence([button.dataset.evidence]);
  }
}

function renderObjectManager() {
  const source = document.querySelector('#objectSourceFilter').value;
  const objects = store.getState().scene.objects.filter((o) => source === 'all' || o.source === source).slice(-160).reverse();
  const list = document.querySelector('#objectList');
  list.innerHTML = objects.map((o) => `<div class="object-row" data-object="${o.id}"><div><b>${o.label || o.type}</b><small>${o.source} · r${o.revision || 1}</small></div><div class="object-actions"><button data-act="focus">◎</button><button data-act="toggle">${o.visible ? '◉' : '○'}</button><button data-act="lock">${o.locked ? '🔒' : '🔓'}</button><button data-act="rename">✎</button><button data-act="delete">×</button></div></div>`).join('') || '<div class="muted-line">No scene objects.</div>';
  for (const row of list.querySelectorAll('[data-object]')) {
    const id = row.dataset.object;
    row.querySelector('[data-act="focus"]').onclick = () => sceneAPI.focusObject(id);
    row.querySelector('[data-act="toggle"]').onclick = () => store.updateSceneObject(id, (o) => ({ visible: !o.visible }), { source: 'Manual' });
    row.querySelector('[data-act="lock"]').onclick = () => store.updateSceneObject(id, (o) => ({ locked: !o.locked }), { source: 'Manual' });
    row.querySelector('[data-act="rename"]').onclick = () => {
      const current = store.getState().scene.objects.find((o) => o.id === id);
      const label = prompt('Object label', current?.label || current?.type || 'Object');
      if (label) store.updateSceneObject(id, { label }, { source: 'Manual' });
    };
    row.querySelector('[data-act="delete"]').onclick = () => store.deleteSceneObject(id, { source: 'Manual' });
  }
}
document.querySelector('#objectSourceFilter').onchange = renderObjectManager;
document.querySelector('#undoBtn').onclick = () => store.undo();
document.querySelector('#redoBtn').onclick = () => store.redo();

async function runSimilarity() {
  const { snapshot } = getMarketContext();
  const bars = snapshot.bars;
  let result;
  try {
    result = await workerClient('similarity', { bars, anchorEndIndex: bars.length - 1, windowSize: 60, topK: 12, horizonBars: 30 });
  } catch {
    const matches = findSimilarWindows(bars, bars.length - 1, 60, 12);
    result = { matches, stats: calculateForwardStats(matches, bars, 30) };
  }
  store.transact('Similarity research', (state) => {
    state.analysis.similarity = { source: 'demo/local', matches: result.matches, stats: result.stats };
  }, { reversible: false, source: 'Research' });
  renderSimilarity();
}
document.querySelector('#runSimilarity').onclick = runSimilarity;

function renderSimilarity() {
  const result = store.getState().analysis.similarity;
  const stats = result.stats;
  document.querySelector('#similaritySummary').innerHTML = stats ? `<b>${stats.sampleSize} matched windows</b><span>Median MFE ${(stats.medianMFE * 100).toFixed(2)}%</span><span>Median MAE ${(stats.medianMAE * 100).toFixed(2)}%</span><span>Median close ${(stats.medianClose * 100).toFixed(2)}%</span><small>${stats.note}</small>` : 'No similarity run yet.';
  document.querySelector('#similarityList').innerHTML = (result.matches || []).slice(0, 12).map((m, i) => `<button class="similarity-row" data-index="${i}"><b>#${i + 1} ${(m.similarity * 100).toFixed(1)}%</b><small>${new Date(m.startTime).toLocaleString()}</small></button>`).join('');
}

function createSetup(direction) {
  const { snapshot, symbol } = getMarketContext();
  const last = snapshot.bars.at(-1);
  if (!last) return;
  const span = Math.max(last.h - last.l, last.c * 0.001);
  const entry = last.c;
  const stop = direction === 'long' ? entry - span : entry + span;
  const target1 = direction === 'long' ? entry + span * 1.5 : entry - span * 1.5;
  const target2 = direction === 'long' ? entry + span * 2.5 : entry - span * 2.5;
  store.patch('trading.risk.riskPercent', Number(document.querySelector('#riskPercent').value) || 0.5, { source: 'UI' });
  sceneAPI.createSetup({ label: `${symbol} ${direction} setup`, symbol, direction, entry, stop, targets: [target1, target2], evidence: store.getState().analysis.evidence, timeframeAlignment: ['H1', 'M15', 'M5', 'M1'] });
}
document.querySelector('#createLongSetup').onclick = () => createSetup('long');
document.querySelector('#createShortSetup').onclick = () => createSetup('short');
document.querySelector('#addDemoTrade').onclick = () => {
  const { snapshot, symbol } = getMarketContext();
  const last = snapshot.bars.at(-1); if (!last) return;
  const span = Math.max(last.h - last.l, last.c * 0.001);
  store.transact('Add demo trade', (state) => state.trading.trades.push({ id: store.nextId('trade'), symbol, side: 'LONG', entry: last.c, stop: last.c - span, targets: [last.c + span * 1.5, last.c + span * 2.5], demo: true, openedAt: Date.now() }), { source: 'Demo' });
};

function renderSetups() {
  document.querySelector('#setupList').innerHTML = store.getState().trading.setups.slice(-12).reverse().map((s) => `<div class="object-row"><div><b>${s.label}</b><small>${s.status} · risk $${s.risk.riskBudget.toFixed(0)} · units ${s.risk.units.toFixed(3)}</small></div><div class="object-actions"><button data-setup="${s.id}" data-event="arm">Arm</button><button data-setup="${s.id}" data-event="trigger">Trigger</button><button data-setup="${s.id}" data-event="complete">Done</button></div></div>`).join('') || '<div class="muted-line">No setup objects.</div>';
  for (const b of document.querySelectorAll('[data-setup]')) b.onclick = () => sceneAPI.updateSetup(b.dataset.setup, b.dataset.event);
}

document.querySelector('#bullScenario').onclick = () => sendAssistant('bullish scenario');
document.querySelector('#bearScenario').onclick = () => sendAssistant('bearish scenario');
function renderScenarios() {
  document.querySelector('#scenarioList').innerHTML = store.getState().trading.scenarios.slice(-10).reverse().map((s) => `<div class="object-row"><div><b>${s.label}</b><small>${s.bias} · confirm ${s.confirmation.toFixed(2)} · invalidate ${s.invalidation.toFixed(2)}</small></div><span class="scenario-tag">scenario</span></div>`).join('') || '<div class="muted-line">No scenario branches.</div>';
}

function startGuidedTour() {
  const steps = [
    { timeframe: 'H4', text: 'Start with H4 context and major structure.' },
    { timeframe: 'H1', text: 'Move to H1 projected support/resistance.' },
    { timeframe: 'M15', text: 'Inspect M15 structure and displacement.' },
    { timeframe: 'M5', text: 'Inspect M5 retest/confirmation behavior.' },
    { timeframe: 'M1', text: 'Finish at M1 execution detail.' },
  ];
  sceneAPI.startGuidedExplanation(steps);
  applyGuideStep(steps[0]);
}
function applyGuideStep(step) {
  if (!step) return;
  store.patch('scene.activeTimeframe', step.timeframe, { source: 'Assistant' });
  store.transact('Guide visibility', (state) => {
    for (const tf of Object.keys(state.scene.timeframeVisibility)) state.scene.timeframeVisibility[tf] = tf === step.timeframe;
  }, { reversible: false, source: 'Assistant' });
  appendChat('assistant', step.text);
  syncTFButtons();
  renderSnapshot();
}
document.querySelector('#guidedMode').onclick = startGuidedTour;
document.querySelector('#nextGuide').onclick = () => applyGuideStep(sceneAPI.nextGuideStep());

function syncTFButtons() {
  const active = store.getState().scene.activeTimeframe;
  for (const b of document.querySelectorAll('#tfControls [data-tf]')) b.classList.toggle('active', b.dataset.tf === active);
}
for (const b of document.querySelectorAll('#tfControls [data-tf]')) b.onclick = () => {
  store.patch('scene.activeTimeframe', b.dataset.tf, { source: 'UI' }); syncTFButtons();
};
document.querySelector('#showAllTF').onclick = () => store.transact('Show all timeframes', (state) => { for (const tf of Object.keys(state.scene.timeframeVisibility)) state.scene.timeframeVisibility[tf] = true; }, { reversible: false, source: 'UI' });
document.querySelector('#soloTF').onclick = () => sceneAPI.soloTimeframe(store.getState().scene.activeTimeframe);
document.querySelector('#expandDepth').onclick = () => store.patch('scene.expandedSpacing', (x) => !x, { source: 'UI' });
document.querySelector('#decompose').onclick = () => {
  const selected = store.getState().scene.selectedCandle;
  if (!selected) return appendChat('assistant', 'Select a candle first.');
  const result = sceneAPI.decomposeCandle({ timeframe: selected.timeframe, time: selected.time });
  appendChat('assistant', result ? `Expanded ${result.parentTimeframe} into ${result.childTimeframe}.` : 'M1 cannot be decomposed further.');
};
document.querySelector('#collapseDecompose').onclick = () => sceneAPI.collapseDecomposition();

canvas.addEventListener('pointerdown', (e) => {
  canvas.dataset.downX = e.offsetX; canvas.dataset.downY = e.offsetY;
});
canvas.addEventListener('pointerup', (e) => {
  const dx = e.offsetX - Number(canvas.dataset.downX || e.offsetX), dy = e.offsetY - Number(canvas.dataset.downY || e.offsetY);
  if (Math.hypot(dx, dy) > 8) return;
  const hit = canvasRenderer.hitTest(e.offsetX, e.offsetY);
  if (!hit) return;
  const selected = { timeframe: hit.timeframe, time: (hit.bar.t + hit.bar.endT) / 2, price: hit.bar.c, bar: hit.bar };
  store.transact('Select candle', (state) => {
    state.scene.selectedCandle = selected;
    state.scene.activeTimeframe = hit.timeframe;
    state.assistant.context.lastSelectedCandle = selected;
  }, { reversible: false, source: 'UI' });
  document.querySelector('#selectionHud').textContent = `${hit.timeframe} · ${new Date(selected.time).toLocaleString()} · ${selected.price.toFixed(2)}`;
  syncTFButtons();
});

let orbiting = false, lastPointer = null;
canvas.addEventListener('pointerdown', (e) => { orbiting = true; lastPointer = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture?.(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!orbiting || !lastPointer) return;
  const dx = e.clientX - lastPointer.x, dy = e.clientY - lastPointer.y;
  lastPointer = { x: e.clientX, y: e.clientY };
  store.transact('Orbit camera', (state) => {
    state.scene.camera.yaw += dx * 0.005;
    state.scene.camera.pitch = Math.max(-0.45, Math.min(0.6, state.scene.camera.pitch + dy * 0.003));
  }, { reversible: false, source: 'UI' });
});
canvas.addEventListener('pointerup', () => { orbiting = false; lastPointer = null; });
canvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  store.transact('Zoom camera', (state) => { state.scene.camera.zoom = Math.max(0.55, Math.min(1.8, state.scene.camera.zoom * (e.deltaY > 0 ? 0.92 : 1.08))); }, { reversible: false, source: 'UI' });
}, { passive: false });

function toggleRenderer() {
  if (renderPath === 'canvas') {
    if (!canUseWebGL()) return appendChat('assistant', 'WebGL2 is unavailable; staying on stable Canvas renderer.');
    if (!gpuRenderer) gpuRenderer = new ThreeTunnelRenderer(gpuLayer, store);
    if (!gpuRenderer.enabled) return appendChat('assistant', 'GPU initialization failed; Canvas fallback remains active.');
    renderPath = 'gpu';
    gpuLayer.classList.remove('hidden');
    canvas.classList.add('hidden');
    gpuRenderer.setData(getMarketContext().snapshot);
  } else {
    renderPath = 'canvas';
    gpuLayer.classList.add('hidden');
    canvas.classList.remove('hidden');
  }
  document.querySelector('#renderPathLabel').textContent = renderPath === 'gpu' ? 'Three.js' : 'Canvas';
  document.querySelector('#rendererToggle').textContent = renderPath === 'gpu' ? 'Stable Canvas' : 'GPU Preview';
  store.patch('runtime.renderPath', renderPath, { markDirty: false });
}
document.querySelector('#rendererToggle').onclick = toggleRenderer;

function syncReplaySlider() {
  const r = store.getState().replay;
  if (!r.minTime || !r.maxTime || !r.cursor) return;
  const ratio = (r.cursor - r.minTime) / Math.max(1, r.maxTime - r.minTime);
  document.querySelector('#replaySlider').value = Math.round(ratio * 1000);
}
document.querySelector('#replayToggle').onclick = () => { replay.enable(); syncReplaySlider(); renderSnapshot(replay.snapshot()); };
document.querySelector('#exitReplay').onclick = () => { replay.disable(); renderSnapshot(provider.snapshot(store.getState().market.activeSymbol)); };
document.querySelector('#playReplay').onclick = () => {
  if (store.getState().replay.playing) { replay.pause(); document.querySelector('#playReplay').textContent = 'Play'; }
  else { replay.play(); document.querySelector('#playReplay').textContent = 'Pause'; }
};
document.querySelector('#stepBack').onclick = () => replay.stepBars(-1);
document.querySelector('#stepForward').onclick = () => replay.stepBars(1);
document.querySelector('#replaySpeed').onchange = (e) => replay.setSpeed(Number(e.target.value));
document.querySelector('#replaySlider').oninput = (e) => {
  const r = store.getState().replay;
  if (!r.enabled) replay.enable();
  const t = r.minTime + (Number(e.target.value) / 1000) * (r.maxTime - r.minTime);
  replay.seek(t);
};

async function refreshWorkspaceList() {
  const rows = await persistence.list();
  document.querySelector('#workspaceList').innerHTML = rows.map((r) => `<option value="${r.name}">${r.name} · ${new Date(r.updatedAt).toLocaleString()}</option>`).join('');
}
document.querySelector('#saveWorkspace').onclick = async () => {
  const name = document.querySelector('#workspaceName').value.trim() || 'Default Workspace';
  await persistence.saveStore(store, name); await refreshWorkspaceList();
};
document.querySelector('#loadWorkspace').onclick = async () => {
  const name = document.querySelector('#workspaceList').value;
  if (!name) return;
  await persistence.loadIntoStore(store, name); updateSymbolUI(); buildAnalysisToggles(); syncTFButtons(); renderSnapshot();
};

const btInput = document.querySelector('#backtesterInput');
btInput.onchange = async () => {
  const file = btInput.files?.[0]; if (!file) return;
  try {
    const raw = JSON.parse(await file.text());
    const imported = backtester.importCase(raw);
    document.querySelector('#backtesterStatus').textContent = `${imported.label} · ${imported.bars.length} bars · research-only`;
    store.transact('Import BackTester scene annotations', (state) => {
      for (const a of imported.annotations.slice(0, 200)) state.scene.objects.push({ id: store.nextId(a.type || 'bt'), visible: true, locked: false, createdAt: Date.now(), updatedAt: Date.now(), revision: 1, source: 'BackTester Import', ...a });
    }, { source: 'BackTester Import' });
  } catch (error) {
    document.querySelector('#backtesterStatus').textContent = `Import error: ${error.message}`;
  }
};

async function runTestsUI() {
  const box = document.querySelector('#testResults');
  box.textContent = 'Running…';
  const result = await runSelfTests({ store, replay, persistence, workerClient, renderer: canvasRenderer, getHistory: (s) => provider.getHistory(s) });
  box.innerHTML = `<div class="test-summary ${result.failed ? 'bad' : 'good'}">${result.passed} passed · ${result.failed} failed</div>${result.results.map((r) => `<div class="test-row ${r.pass ? 'pass' : 'fail'}"><b>${r.pass ? '✓' : '×'} ${r.name}</b><span>${r.ms.toFixed(1)} ms</span><small>${typeof r.detail === 'string' ? r.detail : JSON.stringify(r.detail)}</small></div>`).join('')}`;
}
document.querySelector('#runTests').onclick = runTestsUI;

function renderDiagnostics() {
  const state = store.getState();
  const snapshot = getMarketContext().snapshot;
  document.querySelector('#diagnostics').innerHTML = [
    ['Provider', state.runtime.provider],
    ['Mode', state.runtime.mode],
    ['Worker', state.runtime.workerStatus],
    ['Render path', state.runtime.renderPath],
    ['Render cost', `${state.runtime.renderMs.toFixed(2)} ms`],
    ['Observed FPS', state.runtime.fps.toFixed(1)],
    ['Ticks processed', state.runtime.ticksProcessed.toLocaleString()],
    ['M1 bars', snapshot.bars.length.toLocaleString()],
    ['Scene objects', state.scene.objects.length],
    ['Setups', state.trading.setups.length],
    ['Scenarios', state.trading.scenarios.length],
    ['Workspace storage', persistence.backend],
    ['GPU supported', String(canUseWebGL())],
    ['Last error', state.runtime.lastError || 'none'],
  ].map(([k, v]) => `<div class="metric-row"><span>${k}</span><b>${v}</b></div>`).join('');
}

store.subscribe((state, meta) => {
  document.querySelector('#runtimeMode').textContent = `${state.runtime.mode.toUpperCase()} · ${state.runtime.provider}`;
  document.querySelector('#workspaceDirty').textContent = state.workspace.dirty ? 'unsaved' : 'saved';
  document.querySelector('#objectCount').textContent = state.scene.objects.length;
  renderEvidence();
  renderObjectManager();
  renderSetups();
  renderScenarios();
  renderDiagnostics();
  syncReplaySlider();
  if (!['Runtime metrics', 'Market tick'].includes(meta?.label)) {
    canvasRenderer.requestRender();
    gpuRenderer?.render();
  }
});

buildAnalysisToggles();
refreshMarketModels();
updateSymbolUI();
refreshWorkspaceList();
renderSnapshot(provider.snapshot(store.getState().market.activeSymbol));
renderEvidence();
renderObjectManager();
renderSetups();
renderScenarios();
renderDiagnostics();
appendChat('assistant', 'ANTX scene control is online. I can mark levels/zones, focus objects, decompose selected HTF candles, create scenarios, and drive guided timeframe walkthroughs.');
