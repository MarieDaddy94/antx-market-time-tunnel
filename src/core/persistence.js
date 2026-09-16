const DB_NAME = 'antx-market-time-tunnel';
const DB_VERSION = 1;
const STORE = 'workspaces';

function openDB() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB unavailable'));
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'name' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function txRequest(db, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const store = tx.objectStore(STORE);
    let request;
    try {
      request = operation(store);
    } catch (error) {
      reject(error);
      return;
    }
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export class WorkspacePersistence {
  constructor(prefix = 'antx.workspace.') {
    this.prefix = prefix;
    this.backend = 'indexeddb';
  }

  async save(name, payload) {
    const record = { name, payload, updatedAt: Date.now() };
    try {
      const db = await openDB();
      await txRequest(db, 'readwrite', (store) => store.put(record));
      db.close();
      this.backend = 'indexeddb';
    } catch {
      localStorage.setItem(this.prefix + name, JSON.stringify(record));
      this.backend = 'localstorage';
    }
    return record;
  }

  async load(name) {
    try {
      const db = await openDB();
      const record = await txRequest(db, 'readonly', (store) => store.get(name));
      db.close();
      if (record) {
        this.backend = 'indexeddb';
        return record;
      }
    } catch {
      // fallback below
    }
    const raw = localStorage.getItem(this.prefix + name);
    this.backend = 'localstorage';
    return raw ? JSON.parse(raw) : null;
  }

  async list() {
    try {
      const db = await openDB();
      const records = await txRequest(db, 'readonly', (store) => store.getAll());
      db.close();
      this.backend = 'indexeddb';
      return records.sort((a, b) => b.updatedAt - a.updatedAt);
    } catch {
      this.backend = 'localstorage';
      return Object.keys(localStorage)
        .filter((key) => key.startsWith(this.prefix))
        .map((key) => JSON.parse(localStorage.getItem(key)))
        .sort((a, b) => b.updatedAt - a.updatedAt);
    }
  }

  async remove(name) {
    try {
      const db = await openDB();
      await txRequest(db, 'readwrite', (store) => store.delete(name));
      db.close();
    } catch {
      localStorage.removeItem(this.prefix + name);
    }
  }

  async saveStore(store, name = store.getState().workspace.name) {
    const payload = store.serialize();
    const record = await this.save(name, payload);
    store.transact('Workspace saved', (state) => {
      state.workspace.name = name;
      state.workspace.dirty = false;
      state.workspace.lastSavedAt = record.updatedAt;
    }, { reversible: false, source: 'Persistence' });
    return record;
  }

  async loadIntoStore(store, name) {
    const record = await this.load(name);
    if (!record) throw new Error(`Workspace not found: ${name}`);
    store.hydrate(record.payload);
    store.transact('Workspace loaded', (state) => {
      state.workspace.name = name;
      state.workspace.dirty = false;
      state.workspace.lastSavedAt = record.updatedAt;
    }, { reversible: false, source: 'Persistence' });
    return record;
  }
}
