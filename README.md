# ANTX Market Time Tunnel

ANTX is a spatial market-analysis environment that treats **time, price, and timeframe as one synchronized scene**:

- **X = absolute market time**
- **Y = price**
- **Z = timeframe depth**

M1 is the canonical stream. M5, M15, H1, and H4 are derived from the same absolute timestamps so parent/child candle containment stays deterministic during live updates and replay.

## Current implementation

The repository replaces the original single-file prototype with a modular application architecture.

### Core architecture

- Central state engine separated from rendering
- Stable scene-object IDs
- Object revision history
- Undo / redo
- Workspace serialization
- IndexedDB persistence with localStorage fallback
- Simulated normalized market-data provider
- Adapter boundary for future broker/exchange/BackTester feeds
- Chronology-safe replay engine
- Web Worker analysis path
- Stable Canvas renderer
- Optional Three.js / WebGL renderer with graceful fallback
- Visible diagnostics and self-test harness

### Market Time Tunnel

- M1 / M5 / M15 / H1 / H4 spatial layers
- Absolute-time candle aggregation
- Cross-timeframe containment highlighting
- Higher-timeframe structure projection
- Candle decomposition state (H4 → H1 → M15 → M5 → M1)
- Volume Profile geometry
- Synthetic liquidity heatmap
- Synthetic order-flow particles
- Session regions
- Timestamped event planes
- Scene mini-map / navigator
- Multi-symbol market switching
- Cross-market descriptive return correlation

### Structure intelligence

Implemented local/demo detectors include:

- swing highs / lows
- BOS
- CHoCH
- displacement
- FVG / imbalance
- order blocks
- liquidity sweeps
- equal highs / lows
- supply / demand
- VWAP calculation
- previous-day levels calculation
- opening-range calculation

Structure objects carry source/provenance and rationale metadata.

### Assistant scene control

`window.ANTXScene` exposes deterministic scene actions for future AI/chat bridges, including:

- `addLevel`
- `addZone`
- `addTimeMarker`
- `drawPath`
- `attachNote`
- `highlightCandles`
- `focusTime`
- `focusPrice`
- `focusObject`
- `moveCamera`
- `soloTimeframe`
- `fadeTimeframe`
- `clearAnalysis`
- `createSetup`
- `updateSetup`
- `createScenario`
- `showEvidence`
- `startGuidedExplanation`
- `decomposeCandle`
- `collapseDecomposition`
- conversational reference resolution
- object aliases

The in-app assistant currently uses a deterministic local command router. It is intentionally separate from any external LLM/API so the preview remains runnable without credentials.

### Replay / time machine

- Enter / exit replay
- Time scrubber
- Play / pause
- Step one bar backward / forward
- Replay speeds
- No-future-leakage reconstruction
- Multi-timeframe rebuilding at the replay cursor

### Research

- Local pattern feature vectors
- Similar historical-window search
- Descriptive match statistics
- MFE
- MAE
- median forward close
- positive-close rate

These values are **descriptive demo/local research**, not forecasts.

### Setups, scenarios, and risk

Setup objects use a state machine:

`WATCHING → ARMED → TRIGGERED → COMPLETED / INVALIDATED`

Setup data can include:

- entry
- stop
- targets
- invalidation
- evidence
- timeframe alignment
- risk budget
- position size estimate
- audit trail

Bullish and bearish paths are represented as **scenarios, not predictions**.

### Voice

The application feature-detects browser speech recognition. If supported, voice commands are routed into the same chart-command layer. If unsupported or permission-gated, text control remains fully functional.

### BackTester boundary

`src/integrations/backtester.js` implements a research-only case-import schema. The standalone web app does **not** claim live BackTester connectivity. Exported/historical cases can be normalized and inserted through this boundary until a real connector/backend is wired.

## Demo-data notice

The current standalone app uses simulated prices, order flow, liquidity, account data, and example event timing unless imported data is explicitly supplied. Demo values are intentionally separated from real provider adapters.

## Run locally

Requirements:

- Node.js 22+
- npm

```bash
npm install
npm run dev
```

Then open the local Vite URL shown in the terminal.

Production build:

```bash
npm run build
npm run preview
```

## Project layout

```text
.
├── index.html
├── package.json
├── src
│   ├── main.js
│   ├── styles.css
│   ├── core
│   │   ├── analysis.js
│   │   ├── market.js
│   │   ├── persistence.js
│   │   ├── replay.js
│   │   ├── scene.js
│   │   ├── store.js
│   │   └── tests.js
│   ├── integrations
│   │   └── backtester.js
│   ├── render
│   │   ├── CanvasRenderer.js
│   │   └── ThreeRenderer.js
│   └── workers
│       └── analysis-worker.js
└── .github/workflows/ci.yml
```

## Design rule

The renderer does **not** own trading logic.

The intended data flow is:

```text
provider / imported data
        ↓
central state + canonical M1
        ↓
workers / replay / analysis engines
        ↓
scene objects + evidence + setups
        ↓
Canvas or GPU renderer
```

This separation is what allows the system to grow without repeating the state drift and long-session freezes found in the early single-file prototypes.

## Safety / execution boundary

The app is currently a research and visualization environment. Demo trade objects do not route orders. Any future live-execution adapter should remain a separate, explicitly authorized subsystem with its own permissions and safeguards.
