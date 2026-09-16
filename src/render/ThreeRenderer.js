import * as THREE from 'three';

const TF_ORDER = ['M1', 'M5', 'M15', 'H1', 'H4'];
const TF_COLOR = { M1: 0x49d9ff, M5: 0x4f9fff, M15: 0x6684ff, H1: 0xa777ff, H4: 0xff75c5 };

export class ThreeTunnelRenderer {
  constructor(container, store) {
    this.container = container;
    this.store = store;
    this.data = null;
    this.enabled = false;
    this.root = new THREE.Group();
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x060a0f);
    this.scene.fog = new THREE.FogExp2(0x060a0f, 0.025);
    this.camera = new THREE.PerspectiveCamera(48, 1, 0.1, 1000);
    this.camera.position.set(26, 18, 34);
    this.scene.add(this.root);
    this.scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const dl = new THREE.DirectionalLight(0x9fd5ff, 1.8);
    dl.position.set(10, 22, 12);
    this.scene.add(dl);
    this.grid = new THREE.GridHelper(60, 30, 0x21435b, 0x122533);
    this.grid.position.y = -0.2;
    this.scene.add(this.grid);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.initRenderer();
  }

  initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
      this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
      this.renderer.domElement.className = 'gpu-canvas';
      this.container.appendChild(this.renderer.domElement);
      this.enabled = true;
      this.resize();
    } catch (error) {
      this.enabled = false;
      this.lastError = error;
    }
  }

  resize() {
    if (!this.enabled) return;
    const rect = this.container.getBoundingClientRect();
    this.camera.aspect = Math.max(1e-4, rect.width / Math.max(1, rect.height));
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(rect.width, rect.height, false);
    this.render();
  }

  clearRoot() {
    this.root.traverse((obj) => {
      if (obj.geometry) obj.geometry.dispose();
      if (obj.material) {
        if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose());
        else obj.material.dispose();
      }
    });
    this.root.clear();
  }

  setData(snapshot) {
    this.data = snapshot;
    this.rebuild();
  }

  rebuild() {
    if (!this.enabled || !this.data?.bars?.length) return;
    try {
      this.clearRoot();
      const state = this.store.getState();
      const cursor = state.replay.enabled ? state.replay.cursor : this.data.cursor || this.data.bars.at(-1).endT;
      const start = cursor - 360 * 60_000;
      const visible = this.data.bars.filter((b) => b.endT > start && b.t < cursor);
      if (!visible.length) return;
      const low = Math.min(...visible.map((b) => b.l));
      const high = Math.max(...visible.map((b) => b.h));
      const span = Math.max(1e-9, high - low);
      const worldX = (time) => ((time - start) / (cursor - start) - 0.5) * 38;
      const worldY = (price) => ((price - low) / span) * 14;
      const spacing = state.scene.expandedSpacing ? 8 : 5.4;

      TF_ORDER.forEach((tf, index) => {
        if (!state.scene.timeframeVisibility[tf]) return;
        const z = -index * spacing;
        const plane = new THREE.Mesh(
          new THREE.PlaneGeometry(40, 15),
          new THREE.MeshBasicMaterial({ color: TF_COLOR[tf], transparent: true, opacity: 0.04, side: THREE.DoubleSide }),
        );
        plane.position.set(0, 7, z - 0.25);
        this.root.add(plane);

        const bars = (this.data.timeframes[tf] || []).filter((b) => b.endT > start && b.t < cursor);
        for (const bar of bars) {
          const x = worldX((bar.t + bar.endT) / 2);
          const yo = worldY(bar.o), yc = worldY(bar.c), yh = worldY(bar.h), yl = worldY(bar.l);
          const width = Math.max(0.04, ((bar.endT - bar.t) / (cursor - start)) * 38 * 0.67);
          const up = bar.c >= bar.o;
          const color = up ? 0x31e6a2 : 0xff6179;
          const bodyHeight = Math.max(0.08, Math.abs(yc - yo));
          const body = new THREE.Mesh(
            new THREE.BoxGeometry(width, bodyHeight, 0.28),
            new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.08, roughness: 0.4 }),
          );
          body.position.set(x, Math.min(yo, yc) + bodyHeight / 2, z);
          body.userData = { type: 'candle', timeframe: tf, bar };
          this.root.add(body);

          const wickHeight = Math.max(0.1, yh - yl);
          const wick = new THREE.Mesh(
            new THREE.CylinderGeometry(0.015, 0.015, wickHeight, 5),
            new THREE.MeshBasicMaterial({ color }),
          );
          wick.position.set(x, (yh + yl) / 2, z);
          this.root.add(wick);
        }
      });

      this.applyCamera();
      this.render();
    } catch (error) {
      this.enabled = false;
      this.lastError = error;
      this.renderer?.domElement?.remove();
    }
  }

  applyCamera() {
    if (!this.enabled) return;
    const camera = this.store.getState().scene.camera;
    const radius = 36 / Math.max(0.5, camera.zoom || 1);
    const yaw = camera.yaw ?? -0.45;
    const pitch = camera.pitch ?? 0.16;
    const targetZ = -(camera.focusZ ?? 8);
    const x = Math.cos(pitch) * Math.sin(-yaw) * radius;
    const y = 7 + Math.sin(pitch + 0.35) * radius * 0.55;
    const z = Math.cos(pitch) * Math.cos(-yaw) * radius + targetZ;
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 7, targetZ * 0.45);
  }

  render() {
    if (!this.enabled) return;
    this.applyCamera();
    this.renderer.render(this.scene, this.camera);
  }

  destroy() {
    this.resizeObserver.disconnect();
    this.clearRoot();
    this.renderer?.dispose();
    this.renderer?.domElement?.remove();
  }
}

export function canUseWebGL() {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(window.WebGL2RenderingContext && canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}
