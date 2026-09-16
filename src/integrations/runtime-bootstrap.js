import { createAssistantBridge } from './assistant-bridge.js';
import { InteractionController } from '../ui/interaction-controller.js';
import { installProviderControl } from '../ui/provider-control.js';
import { installMicrostructurePanel } from '../ui/microstructure-panel.js';
import { ProviderManager } from '../core/provider-manager.js';
import { MarketRuntime } from '../core/market-runtime.js';

function waitForRuntime(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const check = () => {
      if (window.ANTXScene && window.ANTXStore) return resolve({ sceneAPI: window.ANTXScene, store: window.ANTXStore });
      if (performance.now() - started > timeoutMs) return reject(new Error('ANTX core runtime did not initialize'));
      requestAnimationFrame(check);
    };
    check();
  });
}

function externalTextRouter(sceneAPI, text) {
  const raw = String(text || '').trim();
  const low = raw.toLowerCase();
  const level = raw.match(/(support|resistance|level)\s+(?:at\s+)?([\d,.]+)/i);
  if (level) {
    const kind = level[1].toLowerCase();
    const price = Number(level[2].replace(/,/g, ''));
    sceneAPI.addLevel({
      price,
      label: kind,
      source: 'External Assistant',
      color: kind === 'support' ? '#31e6a2' : kind === 'resistance' ? '#ff6179' : '#ffca5c',
    });
    return `Marked ${kind} at ${price}.`;
  }
  const tf = ['M1', 'M5', 'M15', 'H1', 'H4'].find((name) => low.includes(`solo ${name.toLowerCase()}`));
  if (tf) {
    sceneAPI.soloTimeframe(tf);
    return `Soloed ${tf}.`;
  }
  if (low === 'clear analysis') {
    sceneAPI.clearAnalysis();
    return 'Cleared analysis objects.';
  }
  return 'External bridge accepted the message, but this text command is not mapped yet. Structured scene commands are fully supported.';
}

async function boot() {
  const { sceneAPI, store } = await waitForRuntime();
  const canvas = document.querySelector('#chartCanvas');

  const interaction = new InteractionController({ store, sceneAPI, canvas });
  interaction.start();

  const bridge = createAssistantBridge({
    sceneAPI,
    store,
    commandRouter: (text) => externalTextRouter(sceneAPI, text),
    allowedOrigins: [location.origin],
  });

  const providers = new ProviderManager({ preferLiveCrypto: false });
  const marketRuntime = new MarketRuntime({ manager: providers, store });
  const providerControl = installProviderControl({ manager: providers, store });
  const microstructurePanel = installMicrostructurePanel({ runtime: marketRuntime, store });

  providers.subscribe((event) => {
    if (event.type === 'error') {
      store.patch('runtime.lastError', String(event.error?.message || event.error || 'Live provider error'), { markDirty: false });
    }
    if (event.type === 'fallback') {
      store.patch('runtime.provider', 'simulated', { markDirty: false });
    }
    if (event.type === 'status' || event.type === 'provider-preference') {
      const symbol = store.getState().market.activeSymbol;
      store.patch('runtime.provider', providers.providerNameFor(symbol), { markDirty: false });
    }
  });

  marketRuntime.subscribe((event) => {
    if (event.type === 'snapshot' || event.type === 'bar' || event.type === 'provider-preference' || event.type === 'status') {
      window.dispatchEvent(new CustomEvent('antx:market-runtime', {
        detail: {
          type: event.type,
          provider: marketRuntime.diagnostics().activeProvider,
          symbol: marketRuntime.diagnostics().activeSymbol,
          snapshot: event.snapshot || marketRuntime.snapshot(),
        },
      }));
    }
  });

  try {
    await providers.start();
    marketRuntime.start();
  } catch (error) {
    console.warn('ANTX provider manager started with simulated fallback', error);
    marketRuntime.start();
  }

  window.ANTXProviders = providers;
  window.ANTXMarketRuntime = marketRuntime;
  window.ANTXProviderControl = providerControl;
  window.ANTXMicrostructure = microstructurePanel;
  window.ANTXInteraction = interaction;
  window.ANTXExternalBridge = bridge;

  window.dispatchEvent(new CustomEvent('antx:integration-ready', {
    detail: {
      bridge: true,
      interaction: true,
      providerSelector: true,
      marketRuntime: true,
      microstructure: true,
      liveProviderAvailable: providers.liveCrypto.status === 'live',
      liveProviderActive: providers.preferLiveCrypto && providers.liveCrypto.status === 'live',
      diagnostics: marketRuntime.diagnostics(),
    },
  }));
}

boot().catch((error) => {
  console.error('ANTX integration bootstrap failed', error);
  window.dispatchEvent(new CustomEvent('antx:integration-error', { detail: String(error?.message || error) }));
});
