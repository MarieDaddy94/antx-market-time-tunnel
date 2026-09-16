import { riskModel, transitionSetup, createScenario } from './analysis.js';

export function createSceneAPI(store) {
  const api = {
    addLevel({ price, label = 'Level', timeframe = 'M1', color = '#ffca5c', source = 'Assistant', rationale = '' }) {
      return store.addSceneObject({ type: 'level', price, label, timeframe, color, rationale }, { source });
    },

    addZone({ low, high, label = 'Zone', timeframe = 'M1', color = '#ffca5c', source = 'Assistant', rationale = '' }) {
      return store.addSceneObject({ type: 'zone', low: Math.min(low, high), high: Math.max(low, high), label, timeframe, color, rationale }, { source });
    },

    addTimeMarker({ time, label = 'Time', color = '#ffca5c', source = 'Assistant' }) {
      return store.addSceneObject({ type: 'timeMarker', time, label, color }, { source });
    },

    drawPath({ points, label = 'Scenario path', color = '#49d9ff', source = 'Assistant', scenarioId = null }) {
      return store.addSceneObject({ type: 'path', points, label, color, scenarioId }, { source });
    },

    attachNote({ time, price, text, timeframe = 'M1', source = 'Assistant', color = '#49d9ff' }) {
      return store.addSceneObject({ type: 'note', time, price, text, timeframe, color }, { source });
    },

    highlightCandles({ times = [], timeframe = 'M1', label = 'Highlighted candles', source = 'Assistant' }) {
      return store.addSceneObject({ type: 'candleHighlight', times, timeframe, label, color: '#49d9ff' }, { source });
    },

    focusTime(time) {
      store.patch('scene.camera.target', { type: 'time', time }, { source: 'Assistant' });
    },

    focusPrice(price) {
      store.patch('scene.camera.target', { type: 'price', price }, { source: 'Assistant' });
    },

    focusObject(id) {
      const object = store.getState().scene.objects.find((o) => o.id === id);
      if (!object) return false;
      store.transact('Focus object', (state) => {
        state.scene.selectedObjectId = id;
        state.assistant.context.lastSelectedObjectId = id;
        state.scene.camera.target = { type: 'object', id };
      }, { reversible: false, source: 'Assistant' });
      return true;
    },

    moveCamera({ yaw, pitch, zoom, focusZ, target = null }) {
      store.transact('Move camera', (state) => {
        Object.assign(state.scene.camera, { yaw, pitch, zoom, focusZ, target });
      }, { reversible: false, source: 'Assistant' });
    },

    soloTimeframe(timeframe) {
      store.transact('Solo timeframe', (state) => {
        for (const key of Object.keys(state.scene.timeframeVisibility)) state.scene.timeframeVisibility[key] = key === timeframe;
        state.scene.activeTimeframe = timeframe;
      }, { reversible: false, source: 'Assistant' });
    },

    fadeTimeframe(timeframe, visible = false) {
      store.patch(['scene', 'timeframeVisibility', timeframe], visible, { source: 'Assistant' });
    },

    clearAnalysis({ sources = null, types = null } = {}) {
      store.transact('Clear analysis', (state) => {
        state.scene.objects = state.scene.objects.filter((o) => {
          const sourceMatch = !sources || sources.includes(o.source);
          const typeMatch = !types || types.includes(o.type);
          return !(sourceMatch && typeMatch);
        });
      }, { source: 'Assistant' });
    },

    createSetup({ label, symbol, direction, entry, stop, targets = [], invalidation = null, evidence = [], timeframeAlignment = [], source = 'Assistant' }) {
      const state = store.getState();
      const risk = riskModel({
        equity: state.trading.account.equity,
        entry,
        stop,
        riskPercent: state.trading.risk.riskPercent,
        maxDailyDrawdown: state.trading.account.dailyDrawdownLimit,
      });
      const setup = {
        id: store.nextId('setup'),
        type: 'setup',
        label,
        symbol,
        direction,
        entry,
        stop,
        targets,
        invalidation,
        evidence,
        timeframeAlignment,
        source,
        status: 'WATCHING',
        risk,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        audit: [],
      };
      store.transact('Create setup', (s) => {
        s.trading.setups.push(setup);
      }, { source });
      return setup;
    },

    updateSetup(id, event) {
      let updated = null;
      store.transact(`Setup ${event}`, (state) => {
        const i = state.trading.setups.findIndex((x) => x.id === id);
        if (i < 0) return;
        updated = transitionSetup(state.trading.setups[i], event);
        state.trading.setups[i] = updated;
      }, { source: 'Assistant' });
      return updated;
    },

    createScenario({ label, bias, confirmation, invalidation, path = [], source = 'Assistant' }) {
      const scenario = createScenario({ id: store.nextId('scenario'), label, bias, confirmation, invalidation, path, source });
      store.transact('Create scenario', (state) => {
        state.trading.scenarios.push(scenario);
      }, { source });
      return scenario;
    },

    showEvidence(evidenceIds = []) {
      store.transact('Show evidence', (state) => {
        state.analysis.evidence = state.analysis.evidence.map((e) => ({ ...e, highlighted: evidenceIds.includes(e.id) }));
      }, { reversible: false, source: 'Assistant' });
    },

    startGuidedExplanation(steps) {
      const guide = { id: store.nextId('guide'), steps, index: 0, startedAt: Date.now() };
      store.patch('scene.guidedExplanation', guide, { source: 'Assistant' });
      return guide;
    },

    nextGuideStep() {
      const guide = store.getState().scene.guidedExplanation;
      if (!guide) return null;
      const nextIndex = Math.min(guide.steps.length - 1, guide.index + 1);
      const next = { ...guide, index: nextIndex };
      store.patch('scene.guidedExplanation', next, { source: 'Assistant' });
      return next.steps[nextIndex];
    },

    decomposeCandle({ timeframe, time }) {
      const child = { H4: 'H1', H1: 'M15', M15: 'M5', M5: 'M1' }[timeframe];
      if (!child) return null;
      const decomposition = { id: store.nextId('decomp'), parentTimeframe: timeframe, childTimeframe: child, time, createdAt: Date.now() };
      store.patch('scene.decomposition', decomposition, { source: 'Assistant' });
      return decomposition;
    },

    collapseDecomposition() {
      store.patch('scene.decomposition', null, { source: 'Assistant' });
    },

    resolveReference(text) {
      const state = store.getState();
      const low = text.toLowerCase();
      if (low.includes('this level') || low.includes('that level') || low.includes('that object')) {
        return state.scene.objects.find((o) => o.id === state.assistant.context.lastSelectedObjectId) || null;
      }
      if (low.includes('that candle') || low.includes('this candle') || low.includes('the wick i clicked')) {
        return state.assistant.context.lastSelectedCandle || state.scene.selectedCandle || null;
      }
      if (low.includes('first sweep')) {
        return state.scene.objects.find((o) => o.type === 'liquiditySweep') || null;
      }
      for (const [alias, id] of Object.entries(state.assistant.context.aliases)) {
        if (low.includes(alias.toLowerCase())) return state.scene.objects.find((o) => o.id === id) || null;
      }
      return null;
    },

    aliasObject(id, alias) {
      store.transact('Alias object', (state) => {
        state.assistant.context.aliases[alias] = id;
      }, { reversible: false, source: 'Assistant' });
    },
  };

  return api;
}

export function createCommandRouter({ store, sceneAPI, getMarketContext }) {
  const parseNumber = (value) => Number(String(value).replace(/,/g, ''));

  return function route(text) {
    const raw = text.trim();
    const low = raw.toLowerCase();
    const context = getMarketContext();
    const selected = store.getState().scene.selectedCandle;

    if (/^clear( analysis| all)?$/.test(low)) {
      sceneAPI.clearAnalysis();
      return 'Cleared chart analysis objects.';
    }
    if (low === 'undo') return store.undo() ? 'Undid the last reversible action.' : 'Nothing to undo.';
    if (low === 'redo') return store.redo() ? 'Redid the last action.' : 'Nothing to redo.';

    const level = raw.match(/(support|resistance|level)\s+(?:at\s+)?([\d,.]+)/i);
    if (level) {
      const kind = level[1].toLowerCase();
      const price = parseNumber(level[2]);
      sceneAPI.addLevel({ price, label: kind, color: kind === 'support' ? '#31e6a2' : kind === 'resistance' ? '#ff6179' : '#ffca5c' });
      return `Marked ${kind} at ${price}.`;
    }

    const zone = raw.match(/(support|resistance|demand|supply)?\s*zone\s+([\d,.]+)\s*(?:to|-|through)\s*([\d,.]+)/i);
    if (zone) {
      const kind = (zone[1] || 'custom').toLowerCase();
      const lowPrice = parseNumber(zone[2]);
      const highPrice = parseNumber(zone[3]);
      const color = ['support', 'demand'].includes(kind) ? '#31e6a2' : ['resistance', 'supply'].includes(kind) ? '#ff6179' : '#ffca5c';
      sceneAPI.addZone({ low: lowPrice, high: highPrice, label: `${kind} zone`, color });
      return `Marked ${kind} zone ${lowPrice}–${highPrice}.`;
    }

    if (low.includes('note') && low.includes('here')) {
      const match = raw.match(/note\s+["“]?(.+?)["”]?\s+here/i);
      if (match && selected) {
        sceneAPI.attachNote({ time: selected.time, price: selected.price, text: match[1], timeframe: selected.timeframe });
        return `Attached note to the selected ${selected.timeframe} candle.`;
      }
      return 'Select a candle first, then use “note … here”.';
    }

    if (low.includes('solo ')) {
      const tf = ['M1', 'M5', 'M15', 'H1', 'H4'].find((x) => low.includes(x.toLowerCase()));
      if (tf) {
        sceneAPI.soloTimeframe(tf);
        return `Soloed ${tf}.`;
      }
    }

    if (low.includes('decompose') || low.includes('explode candle')) {
      if (!selected) return 'Select a higher-timeframe candle first.';
      const result = sceneAPI.decomposeCandle({ timeframe: selected.timeframe, time: selected.time });
      return result ? `Expanded ${selected.timeframe} into ${result.childTimeframe} components.` : 'M1 is already the lowest decomposition layer.';
    }

    if (low.includes('collapse')) {
      sceneAPI.collapseDecomposition();
      return 'Collapsed candle decomposition.';
    }

    if (low.includes('bullish scenario') || low.includes('bearish scenario')) {
      const bias = low.includes('bullish') ? 'bullish' : 'bearish';
      const last = context.activeBars.at(-1);
      const span = Math.max(last.h - last.l, last.c * 0.001);
      const confirmation = bias === 'bullish' ? last.h + span * 0.2 : last.l - span * 0.2;
      const invalidation = bias === 'bullish' ? last.l - span * 0.25 : last.h + span * 0.25;
      const scenario = sceneAPI.createScenario({ label: `${bias} scenario`, bias, confirmation, invalidation, path: [] });
      return `Created ${scenario.label} with confirmation ${confirmation.toFixed(2)} and invalidation ${invalidation.toFixed(2)}. It is a scenario, not a prediction.`;
    }

    const ref = sceneAPI.resolveReference(low);
    if (ref && (low.includes('focus') || low.includes('show me'))) {
      sceneAPI.focusObject(ref.id);
      return `Focused ${ref.label || ref.type}.`;
    }

    return 'I can mark levels/zones, focus objects, solo timeframes, decompose selected HTF candles, create scenarios, and control analysis objects. Use the preset controls for automated structure/similarity/replay actions.';
  };
}
