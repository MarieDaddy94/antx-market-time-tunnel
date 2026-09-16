import { TF_MS, buildVolumeProfile, createSyntheticLiquidity } from '../core/market.js';

const TF_ORDER = ['M1', 'M5', 'M15', 'H1', 'H4'];
const TF_COLOR = { M1: '#49d9ff', M5: '#4f9fff', M15: '#6684ff', H1: '#a777ff', H4: '#ff75c5' };

const rgba = (hex, a) => {
  const h = hex.replace('#', '');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
};
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

export class CanvasTunnelRenderer {
  constructor(canvas, store) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.store = store;
    this.data = null;
    this.requested = false;
    this.lastFrame = performance.now();
    this.errorCount = 0;
    this.hits = [];
    this.orderFlowParticles = [];
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(canvas.parentElement);
    this.resize();
  }

  setData(snapshot) {
    this.data = snapshot;
    this.requestRender();
  }

  pushOrderFlow(flow) {
    this.orderFlowParticles.push({ ...flow, born: performance.now() });
    if (this.orderFlowParticles.length > 250) this.orderFlowParticles.splice(0, this.orderFlowParticles.length - 250);
    this.requestRender();
  }

  resize() {
    const rect = this.canvas.parentElement.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.width = rect.width;
    this.height = rect.height;
    this.requestRender();
  }

  requestRender() {
    if (this.requested) return;
    this.requested = true;
    requestAnimationFrame((t) => this.frame(t));
  }

  frame(now) {
    this.requested = false;
    const start = performance.now();
    try {
      this.draw(now);
      const renderMs = performance.now() - start;
      const dt = Math.max(1, now - this.lastFrame);
      this.lastFrame = now;
      this.store.transact('Runtime metrics', (state) => {
        state.runtime.renderMs = renderMs;
        state.runtime.fps = 1000 / dt;
      }, { reversible: false, source: 'Renderer' });
    } catch (error) {
      this.errorCount += 1;
      this.store.transact('Render recovery', (state) => {
        state.runtime.lastError = String(error?.message || error);
      }, { reversible: false, source: 'Renderer' });
      console.error('Canvas renderer recovered from error', error);
    }
    if (this.orderFlowParticles.some((p) => now - p.born < 1400)) this.requestRender();
  }

  computeBounds(bars) {
    const replay = this.store.getState().replay;
    const cursor = replay.enabled ? replay.cursor : this.data?.cursor || bars.at(-1)?.endT;
    const span = 360 * 60_000;
    const end = cursor || Date.now();
    const start = end - span;
    const visible = bars.filter((b) => b.endT > start && b.t < end);
    const low = visible.length ? Math.min(...visible.map((b) => b.l)) : 0;
    const high = visible.length ? Math.max(...visible.map((b) => b.h)) : 1;
    return { start, end, low, high: high > low ? high : low + 1, visible };
  }

  projectFactory(bounds) {
    const state = this.store.getState();
    const camera = state.scene.camera;
    const spacing = state.scene.expandedSpacing ? 8 : 5.4;
    const yaw = camera.yaw ?? -0.45;
    const pitch = camera.pitch ?? 0.16;
    const zoom = camera.zoom ?? 1;
    const focusZ = camera.focusZ ?? 8;
    const worldX = (time) => ((time - bounds.start) / (bounds.end - bounds.start) - 0.5) * 38;
    const worldY = (price) => ((price - bounds.low) / (bounds.high - bounds.low)) * 14;
    const layerZ = (tf) => TF_ORDER.indexOf(tf) * spacing;
    const project = (x, y, z) => {
      z -= focusZ;
      const cy = Math.cos(yaw), sy = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
      const x1 = x * cy - z * sy;
      const z1 = x * sy + z * cy;
      const y1 = y * cp - z1 * sp;
      const z2 = y * sp + z1 * cp;
      const cam = 34;
      const depth = cam + z2;
      if (depth <= 3) return null;
      const f = Math.min(this.width, this.height) * 1.43 * zoom;
      return { x: this.width * 0.5 + (x1 * f) / depth, y: this.height * 0.65 - (y1 * f) / depth, depth };
    };
    return { worldX, worldY, layerZ, project, spacing };
  }

  line(a, b, color, width = 1, dash = []) {
    if (!a || !b) return;
    const c = this.ctx;
    c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.strokeStyle = color; c.lineWidth = width; c.setLineDash(dash); c.stroke(); c.setLineDash([]);
  }

  poly(points, fill, stroke, width = 1) {
    if (!points || points.some((p) => !p)) return;
    const c = this.ctx;
    c.beginPath(); c.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) c.lineTo(points[i].x, points[i].y);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (stroke) { c.strokeStyle = stroke; c.lineWidth = width; c.stroke(); }
  }

  label(text, p, color = '#dce6ef', size = 10, align = 'left') {
    if (!p) return;
    const c = this.ctx;
    c.font = `600 ${size}px system-ui`; c.textAlign = align; c.textBaseline = 'middle'; c.fillStyle = color; c.fillText(text, p.x, p.y);
  }

  drawLayer(tf, bars, bounds, geom, alpha = 1) {
    const { worldX, worldY, layerZ, project } = geom;
    const z = layerZ(tf), color = TF_COLOR[tf];
    this.poly([project(-19, 0, z), project(19, 0, z), project(19, 14, z), project(-19, 14, z)], rgba(color, 0.025 * alpha), rgba(color, 0.26 * alpha));
    for (let i = 0; i <= 6; i += 1) this.line(project(-19, (i * 14) / 6, z), project(19, (i * 14) / 6, z), rgba(color, 0.08 * alpha), 0.7);
    this.label(tf, project(-18.5, 14.6, z), color, tf === 'M1' ? 13 : 11);

    for (const bar of bars) {
      if (bar.endT <= bounds.start || bar.t >= bounds.end) continue;
      const center = (bar.t + bar.endT) / 2;
      const x = worldX(center);
      const width = Math.max(0.035, ((bar.endT - bar.t) / (bounds.end - bounds.start)) * 38 * 0.68);
      const yo = worldY(bar.o), yc = worldY(bar.c), yh = worldY(bar.h), yl = worldY(bar.l);
      const up = bar.c >= bar.o, col = up ? '#31e6a2' : '#ff6179';
      const selected = this.store.getState().scene.selectedCandle;
      const isSelected = selected?.timeframe === tf && selected.time >= bar.t && selected.time < bar.endT;
      this.line(project(x, yl, z), project(x, yh, z), rgba(col, 0.78 * alpha), isSelected ? 2.2 : 1);
      const y0 = Math.min(yo, yc), y1 = Math.max(yo, yc);
      const body = [project(x - width / 2, y0, z), project(x + width / 2, y0, z), project(x + width / 2, Math.max(y0 + 0.08, y1), z), project(x - width / 2, Math.max(y0 + 0.08, y1), z)];
      this.poly(body, rgba(col, 0.82 * alpha), isSelected ? '#ecfbff' : rgba(col, alpha), isSelected ? 1.4 : 0.7);
      if (body.every(Boolean)) {
        const xs = body.map((p) => p.x), ys = body.map((p) => p.y);
        this.hits.push({ type: 'candle', timeframe: tf, bar, x0: Math.min(...xs) - 3, x1: Math.max(...xs) + 3, y0: Math.min(...ys) - 4, y1: Math.max(...ys) + 4, depth: body[0].depth });
      }
    }
  }

  drawSessions(bounds, geom) {
    const state = this.store.getState();
    if (!state.analysis.toggles.sessions) return;
    const { worldX, project } = geom;
    for (const session of state.market.sessions || []) {
      const start = Math.max(bounds.start, session.start), end = Math.min(bounds.end, session.end);
      if (end <= start) continue;
      const x1 = worldX(start), x2 = worldX(end);
      this.poly([project(x1, 0, 0), project(x2, 0, 0), project(x2, 14, 0), project(x1, 14, 0)], rgba(session.color, 0.035), rgba(session.color, 0.12));
      this.label(session.label, project((x1 + x2) / 2, 13.7, 0), rgba(session.color, 0.8), 8, 'center');
    }
  }

  drawEvents(bounds, geom) {
    const state = this.store.getState();
    if (!state.analysis.toggles.events) return;
    const { worldX, project, layerZ } = geom;
    for (const event of state.market.events || []) {
      if (event.t < bounds.start || event.t > bounds.end) continue;
      const x = worldX(event.t);
      const col = event.importance === 'high' ? '#ff6179' : '#ffca5c';
      this.line(project(x, 0, 0), project(x, 14, layerZ('H4')), rgba(col, 0.65), 1.2, [4, 4]);
      this.label(event.label, project(x, 14.4, 0), col, 8, 'center');
    }
  }

  drawStructureObjects(bounds, geom) {
    const state = this.store.getState();
    const { worldX, worldY, layerZ, project } = geom;
    const hidden = new Set(state.scene.hiddenTypes || []);
    for (const object of state.scene.objects) {
      if (!object.visible || hidden.has(object.type)) continue;
      const color = object.color || (object.direction === 'bullish' ? '#31e6a2' : object.direction === 'bearish' ? '#ff6179' : '#ffca5c');
      const tf = object.timeframe || 'M1';
      const z = layerZ(tf);
      if (object.type === 'level' || ['previousDayHigh', 'previousDayLow', 'previousDayClose', 'swingHigh', 'swingLow', 'BOS', 'CHoCH', 'equalHighs', 'equalLows', 'liquiditySweep'].includes(object.type)) {
        const price = object.price;
        if (!Number.isFinite(price)) continue;
        const y = worldY(price);
        this.line(project(-19, y, z), project(19, y, z), rgba(color, 0.7), 1, object.type === 'level' ? [] : [4, 4]);
        if (object.label || object.type) this.label(object.label || object.type, project(-18.6, y + 0.15, z), color, 8);
      } else if (['zone', 'demand', 'supply', 'FVG', 'orderBlock'].includes(object.type)) {
        const low = object.low, high = object.high;
        if (!Number.isFinite(low) || !Number.isFinite(high)) continue;
        const y1 = worldY(low), y2 = worldY(high);
        this.poly([project(-18.5, y1, z), project(18.5, y1, z), project(18.5, y2, z), project(-18.5, y2, z)], rgba(color, 0.08), rgba(color, 0.3));
        this.label(object.label || object.type, project(-18.2, y2 + 0.12, z), color, 8);
      } else if (object.type === 'timeMarker') {
        if (object.time < bounds.start || object.time > bounds.end) continue;
        const x = worldX(object.time);
        this.line(project(x, 0, 0), project(x, 14, layerZ('H4')), color, 1, [4, 4]);
      } else if (object.type === 'note') {
        if (object.time < bounds.start || object.time > bounds.end) continue;
        const p = project(worldX(object.time), worldY(object.price), z);
        if (p) { this.label(`● ${object.text}`, { x: p.x + 8, y: p.y - 12 }, color, 9); }
      } else if (object.type === 'path') {
        const pts = (object.points || []).filter((p) => p.time >= bounds.start && p.time <= bounds.end).map((p) => project(worldX(p.time), worldY(p.price), z));
        for (let i = 1; i < pts.length; i += 1) this.line(pts[i - 1], pts[i], color, 1.5);
      } else if (object.type === 'displacement') {
        if (object.time < bounds.start || object.time > bounds.end) continue;
        const x = worldX(object.time);
        this.line(project(x, worldY(object.p1), z), project(x, worldY(object.p2), z), color, 2.5);
      }
    }
  }

  drawProjectedStructure(bounds, geom) {
    const state = this.store.getState();
    if (!state.analysis.toggles.projectedStructure) return;
    const { worldY, project, layerZ } = geom;
    const bars = this.data?.timeframes?.H1 || [];
    const visible = bars.filter((b) => b.endT > bounds.start && b.t < bounds.end);
    if (!visible.length) return;
    const levels = [
      { price: Math.max(...visible.map((b) => b.h)), color: '#ff6179', label: 'H1 projected resistance' },
      { price: Math.min(...visible.map((b) => b.l)), color: '#31e6a2', label: 'H1 projected support' },
    ];
    for (const l of levels) {
      const touches = visible.filter((b) => Math.abs(b.h - l.price) / Math.max(l.price, 1e-9) < 0.0015 || Math.abs(b.l - l.price) / Math.max(l.price, 1e-9) < 0.0015).length;
      const opacity = clamp(0.07 + touches * 0.025, 0.07, 0.22);
      const y = worldY(l.price);
      this.poly([project(-19, y, 0), project(19, y, 0), project(19, y, layerZ('H4') + 1), project(-19, y, layerZ('H4') + 1)], rgba(l.color, opacity), rgba(l.color, opacity + 0.18));
      this.label(`${l.label} · ${touches} touch${touches === 1 ? '' : 'es'}`, project(-18.6, y + 0.2, 0), l.color, 8);
    }
  }

  drawVolumeProfile(bounds, geom) {
    const state = this.store.getState();
    if (!state.analysis.toggles.volumeProfile) return;
    const profile = buildVolumeProfile(bounds.visible, 26);
    const max = Math.max(1, ...profile.map((p) => p.volume));
    const { worldY, project } = geom;
    for (const bin of profile) {
      const y = worldY((bin.priceLow + bin.priceHigh) / 2);
      const x0 = 16.5, x1 = 16.5 + (bin.volume / max) * 3.2;
      this.line(project(x0, y, 0), project(x1, y, 0), 'rgba(73,217,255,.22)', 3);
    }
  }

  drawLiquidity(bounds, geom) {
    const state = this.store.getState();
    if (!state.analysis.toggles.heatmap) return;
    const heat = state.market.liquidity[state.market.activeSymbol] || createSyntheticLiquidity(bounds.visible);
    const max = Math.max(1, ...heat.map((x) => x.bid + x.ask + x.liquidation));
    const { worldY, project, layerZ } = geom;
    for (const row of heat) {
      const strength = (row.bid + row.ask + row.liquidation) / max;
      const y = worldY(row.price);
      this.line(project(-19, y, layerZ('M5')), project(19, y, layerZ('H4')), `rgba(255,202,92,${0.025 + strength * 0.12})`, 1 + strength * 2);
    }
  }

  drawOrderFlow(bounds, geom, now) {
    const state = this.store.getState();
    if (!state.analysis.toggles.orderFlow) return;
    const { worldX, worldY, project } = geom;
    this.orderFlowParticles = this.orderFlowParticles.filter((p) => now - p.born < 1600);
    for (const p of this.orderFlowParticles) {
      if (p.symbol !== state.market.activeSymbol || p.t < bounds.start || p.t > bounds.end) continue;
      const age = (now - p.born) / 1600;
      const pos = project(worldX(p.t), worldY(p.price) + age * 1.2, 0);
      if (!pos) continue;
      const radius = (p.aggressive ? 5 : 2.5) * (1 - age * 0.5);
      this.ctx.beginPath(); this.ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2); this.ctx.fillStyle = p.side === 'buy' ? rgba('#31e6a2', 1 - age) : rgba('#ff6179', 1 - age); this.ctx.fill();
    }
  }

  drawSelectedHierarchy(bounds, geom) {
    const selected = this.store.getState().scene.selectedCandle;
    if (!selected) return;
    const { worldX, worldY, layerZ, project } = geom;
    const pts = [];
    for (const tf of TF_ORDER) {
      const rows = this.data?.timeframes?.[tf] || [];
      const bar = rows.find((b) => selected.time >= b.t && selected.time < b.endT);
      if (!bar) continue;
      pts.push({ tf, p: project(worldX((bar.t + bar.endT) / 2), worldY(bar.c), layerZ(tf)) });
    }
    for (let i = 1; i < pts.length; i += 1) this.line(pts[i - 1].p, pts[i].p, 'rgba(73,217,255,.4)', 1.2, [3, 4]);
    for (const { tf, p } of pts) { if (!p) continue; this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 3.3, 0, Math.PI * 2); this.ctx.fillStyle = TF_COLOR[tf]; this.ctx.fill(); }
  }

  drawDecomposition(bounds, geom) {
    const d = this.store.getState().scene.decomposition;
    if (!d || !this.data) return;
    const parentRows = this.data.timeframes[d.parentTimeframe] || [];
    const parent = parentRows.find((b) => d.time >= b.t && d.time < b.endT);
    if (!parent) return;
    const children = (this.data.timeframes[d.childTimeframe] || []).filter((b) => b.t >= parent.t && b.endT <= parent.endT);
    const { worldX, worldY, layerZ, project } = geom;
    const z = layerZ(d.parentTimeframe) + 1.8;
    for (const child of children) {
      const x = worldX((child.t + child.endT) / 2);
      const p = project(x, worldY(child.c), z);
      if (p) { this.ctx.beginPath(); this.ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); this.ctx.fillStyle = TF_COLOR[d.childTimeframe]; this.ctx.fill(); }
    }
    this.label(`${d.parentTimeframe} → ${d.childTimeframe} (${children.length})`, project(worldX(parent.t), worldY(parent.h) + 0.5, z), TF_COLOR[d.childTimeframe], 9);
  }

  drawTrades(bounds, geom) {
    const state = this.store.getState();
    const { worldY, project } = geom;
    for (const trade of state.trading.trades) {
      const entryY = worldY(trade.entry);
      this.line(project(-18.5, entryY, 0), project(18.5, entryY, 0), '#49d9ff', 1.2);
      this.label(`${trade.demo ? 'DEMO ' : ''}${trade.side} entry`, project(-18.2, entryY + 0.12, 0), '#49d9ff', 8);
      if (trade.stop) this.line(project(-18.5, worldY(trade.stop), 0), project(18.5, worldY(trade.stop), 0), '#ff6179', 1, [4, 4]);
      for (const target of trade.targets || []) this.line(project(-18.5, worldY(target), 0), project(18.5, worldY(target), 0), '#31e6a2', 1, [4, 4]);
    }
  }

  drawMinimap(bounds) {
    const x = 14, y = 96, w = 132, h = 62;
    const c = this.ctx;
    c.fillStyle = 'rgba(8,13,19,.78)'; c.fillRect(x, y, w, h); c.strokeStyle = '#1e3344'; c.strokeRect(x, y, w, h);
    c.fillStyle = '#8397aa'; c.font = '600 8px system-ui'; c.fillText('SCENE NAVIGATOR', x + 7, y + 10);
    const camera = this.store.getState().scene.camera;
    const zx = clamp((camera.focusZ || 0) / 25, 0, 1);
    const px = x + 10 + zx * (w - 20);
    c.strokeStyle = 'rgba(73,217,255,.35)'; c.beginPath(); c.moveTo(x + 10, y + 34); c.lineTo(x + w - 10, y + 34); c.stroke();
    c.fillStyle = '#49d9ff'; c.beginPath(); c.arc(px, y + 34, 4, 0, Math.PI * 2); c.fill();
    c.fillStyle = '#72879a'; c.fillText('M1', x + 7, y + 53); c.fillText('H4', x + w - 21, y + 53);
  }

  draw(now) {
    const c = this.ctx;
    c.clearRect(0, 0, this.width, this.height);
    c.fillStyle = '#060a0f'; c.fillRect(0, 0, this.width, this.height);
    if (!this.data?.bars?.length) {
      this.label('Waiting for market data…', { x: this.width / 2, y: this.height / 2 }, '#8ca0b5', 13, 'center');
      return;
    }

    const bounds = this.computeBounds(this.data.bars);
    const geom = this.projectFactory(bounds);
    this.hits = [];

    this.drawSessions(bounds, geom);
    this.drawEvents(bounds, geom);
    this.drawProjectedStructure(bounds, geom);
    this.drawLiquidity(bounds, geom);

    const state = this.store.getState();
    const visibility = state.scene.timeframeVisibility;
    for (let i = TF_ORDER.length - 1; i >= 0; i -= 1) {
      const tf = TF_ORDER[i];
      if (!visibility[tf]) continue;
      this.drawLayer(tf, this.data.timeframes[tf] || [], bounds, geom, 1);
    }

    this.drawVolumeProfile(bounds, geom);
    this.drawStructureObjects(bounds, geom);
    this.drawTrades(bounds, geom);
    this.drawSelectedHierarchy(bounds, geom);
    this.drawDecomposition(bounds, geom);
    this.drawOrderFlow(bounds, geom, now);
    this.drawMinimap(bounds);
  }

  hitTest(x, y) {
    let best = null;
    for (const hit of this.hits) {
      if (x >= hit.x0 && x <= hit.x1 && y >= hit.y0 && y <= hit.y1) {
        if (!best || hit.depth < best.depth) best = hit;
      }
    }
    return best;
  }

  destroy() {
    this.resizeObserver.disconnect();
  }
}
