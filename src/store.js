// Storage layer. The app only talks to `store`; the adapter underneath is swappable.
// A future SupabaseAdapter just needs the same 5 async methods (+ optional subscribe()).
const DB = 'lite-notes', VER = 1;
function req(r) { return new Promise((ok, no) => { r.onsuccess = () => ok(r.result); r.onerror = () => no(r.error); }); }

export class IndexedDBAdapter {
  constructor() { this.db = null; }
  async open() {
    if (this.db) return this.db;
    const r = indexedDB.open(DB, VER);
    r.onupgradeneeded = () => { const d = r.result; d.createObjectStore('pages', { keyPath: 'id' }); d.createObjectStore('meta'); };
    this.db = await req(r); return this.db;
  }
  async tx(name, mode = 'readonly') { return (await this.open()).transaction(name, mode).objectStore(name); }
  async list() { return req((await this.tx('pages')).getAll()); }
  async put(page) { return req((await this.tx('pages', 'readwrite')).put(page)); }
  async putMany(pages) {
    const s = await this.tx('pages', 'readwrite'); pages.forEach(p => s.put(p));
    return new Promise((ok, no) => { s.transaction.oncomplete = ok; s.transaction.onerror = () => no(s.transaction.error); });
  }
  async remove(id) { return req((await this.tx('pages', 'readwrite')).delete(id)); }
  async getMeta(k) { return req((await this.tx('meta')).get(k)); }
  async setMeta(k, v) { return req((await this.tx('meta', 'readwrite')).put(v, k)); }
}

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export function newPage(o = {}) {
  const t = Date.now();
  return { id: uid(), parentId: null, title: '', icon: '', cover: '', order: t, content: { type: 'doc', content: [{ type: 'paragraph' }] }, text: '', createdAt: t, updatedAt: t, deleted: false, ...o };
}

export class Store {
  constructor(adapter) { this.a = adapter; this.pages = new Map(); this.subs = new Set(); }
  async load() { (await this.a.list()).forEach(p => this.pages.set(p.id, p)); return this; }
  on(fn) { this.subs.add(fn); return () => this.subs.delete(fn); }
  emit(e) { this.subs.forEach(f => f(e)); }
  all() { return [...this.pages.values()].filter(p => !p.deleted); }
  get(id) { const p = this.pages.get(id); return p && !p.deleted ? p : null; }
  children(pid) { return this.all().filter(p => (p.parentId || null) === (pid || null)).sort((a, b) => a.order - b.order); }
  ancestors(id) { const r = []; let p = this.get(id); while (p && p.parentId) { p = this.get(p.parentId); if (p) r.unshift(p); } return r; }
  descendants(id) { const r = []; const walk = i => this.children(i).forEach(c => { r.push(c); walk(c.id); }); walk(id); return r; }
  async save(page, { silent } = {}) { page.updatedAt = Date.now(); this.pages.set(page.id, page); await this.a.put(page); if (!silent) this.emit({ type: 'save', page }); return page; }
  async saveMany(pages) { pages.forEach(p => this.pages.set(p.id, p)); await this.a.putMany(pages); this.emit({ type: 'bulk' }); }
  async create(o) { return this.save(newPage(o)); }
  async remove(id) { const ids = [id, ...this.descendants(id).map(p => p.id)]; for (const i of ids) { this.pages.delete(i); await this.a.remove(i); } this.emit({ type: 'remove', ids }); }
  async move(id, parentId, order) { const p = this.get(id); if (!p) return; if (parentId === id || this.descendants(id).some(d => d.id === parentId)) return; p.parentId = parentId || null; if (order != null) p.order = order; await this.save(p); }
  meta(k) { return this.a.getMeta(k); } setMeta(k, v) { return this.a.setMeta(k, v); }
}
