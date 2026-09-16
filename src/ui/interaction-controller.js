const TF = ['M1', 'M5', 'M15', 'H1', 'H4'];

export class InteractionController {
  constructor({ store, sceneAPI, canvas }) {
    this.store = store;
    this.sceneAPI = sceneAPI;
    this.canvas = canvas;
    this.enabled = true;
    this.boundKeydown = (e) => this.onKeydown(e);
    this.boundWheel = (e) => this.onWheel(e);
    this.boundDblClick = () => this.resetCamera();
  }

  start() {
    window.addEventListener('keydown', this.boundKeydown);
    this.canvas?.addEventListener('wheel', this.boundWheel, { passive: false });
    this.canvas?.addEventListener('dblclick', this.boundDblClick);
  }

  stop() {
    window.removeEventListener('keydown', this.boundKeydown);
    this.canvas?.removeEventListener('wheel', this.boundWheel);
    this.canvas?.removeEventListener('dblclick', this.boundDblClick);
  }

  onWheel(event) {
    if (!this.enabled || !this.canvas?.contains(event.target)) return;
    event.preventDefault();
    const state = this.store.getState();
    const camera = state.scene.camera;
    const zoom = Math.max(0.5, Math.min(2.25, (camera.zoom || 1) * (event.deltaY > 0 ? 0.92 : 1.08)));
    this.sceneAPI.moveCamera({ ...camera, zoom });
  }

  onKeydown(event) {
    if (!this.enabled) return;
    const tag = event.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;

    const key = event.key.toLowerCase();
    if (['1','2','3','4','5'].includes(key)) {
      const tf = TF[Number(key) - 1];
      this.sceneAPI.soloTimeframe(tf);
      event.preventDefault();
      return;
    }
    if (key === '0') {
      this.store.transact('Show all timeframes', (state) => {
        for (const tf of TF) state.scene.timeframeVisibility[tf] = true;
      }, { reversible: false, source: 'Keyboard' });
      event.preventDefault();
      return;
    }
    if (key === 'r') {
      this.resetCamera();
      event.preventDefault();
      return;
    }
    if (key === 'f') {
      const id = this.store.getState().scene.selectedObjectId;
      if (id) this.sceneAPI.focusObject(id);
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'z') {
      event.shiftKey ? this.store.redo() : this.store.undo();
      event.preventDefault();
      return;
    }
    if ((event.ctrlKey || event.metaKey) && key === 'y') {
      this.store.redo();
      event.preventDefault();
      return;
    }
    if (key === 'escape') {
      this.sceneAPI.collapseDecomposition();
      this.store.patch('scene.selectedObjectId', null, { source: 'Keyboard', markDirty: false });
    }
  }

  resetCamera() {
    this.sceneAPI.moveCamera({ yaw: -0.45, pitch: 0.16, zoom: 1, focusZ: 8, target: null });
  }
}
