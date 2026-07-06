/**
 * Storage module — persists app data to server-side SQLite via API,
 * with localStorage as a local cache and fallback.
 *
 * Load methods are synchronous (return from in-memory cache).
 * Save methods write to localStorage immediately and fire off a
 * server API request in the background.
 *
 * Call Storage.init() once at startup to hydrate the cache from
 * the server (falls back to localStorage if server is unavailable).
 */
const Storage = {
  /** In-memory cache, populated by init() and kept in sync on every save. */
  _cache: {
    history: [],
    templates: [],
    groups: {},
    stats: { sent: 0, delivered: 0, failed: 0, received: 0 },
    config: null,
    archived: undefined,
  },

  /**
   * Hydrate the cache from the server API.
   * Falls back to localStorage if the server is unreachable.
   * Safe to call multiple times.
   */
  async init() {
    try {
      const res = await fetch('/api/data');
      if (res.ok) {
        const data = await res.json();
        this._cache.history = data.messages || [];
        this._cache.templates = data.templates || [];
        this._cache.groups = data.groups || {};
        this._cache.stats = data.stats || { sent: 0, delivered: 0, failed: 0, received: 0 };
        // Config is stored as individual keys in app_config table.
        // If no keys exist, getAllConfig() returns {} — treat as null.
        const cfg = data.config;
        this._cache.config = (cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0) ? cfg : null;
        return; // Server data is authoritative
      }
    } catch (_) {
      // Server unreachable — fall through to localStorage
    }

    // Fallback: hydrate from localStorage
    this._cache.history = this._fromLS('history', []);
    this._cache.templates = this._fromLS('templates', []);
    this._cache.groups = this._fromLS('groups', {});
    this._cache.stats = this._fromLS('stats', { sent: 0, delivered: 0, failed: 0, received: 0 });
    this._cache.config = this._fromLS('cfg', null);
  },

  // ── Helpers ──────────────────────────────────────────────────────────

  _toLS(key, value) {
    try { localStorage.setItem('sms_gateway_' + key, JSON.stringify(value)); } catch (_) {}
  },

  _fromLS(key, fallback) {
    try {
      const raw = localStorage.getItem('sms_gateway_' + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  },

  _post(endpoint, payload) {
    // Fire-and-forget — never reject the caller
    fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => { /* server unreachable — data already in localStorage */ });
  },

  _del(endpoint) {
    fetch(endpoint, { method: 'DELETE' }).catch(() => {});
  },

  // ── Messages ─────────────────────────────────────────────────────────

  loadHistory() {
    return this._cache.history;
  },

  saveHistory(history) {
    this._cache.history = history;
    this._toLS('history', history);
    this._post('/api/data/messages', { messages: history });
  },

  // ── Templates ────────────────────────────────────────────────────────

  loadTemplates() {
    return this._cache.templates;
  },

  saveTemplates(templates) {
    this._cache.templates = templates;
    this._toLS('templates', templates);
    this._post('/api/data/templates', { templates });
  },

  // ── Groups ───────────────────────────────────────────────────────────

  loadGroups() {
    return this._cache.groups;
  },

  saveGroups(groups) {
    this._cache.groups = groups;
    this._toLS('groups', groups);
    this._post('/api/data/groups', { groups });
  },

  // ── Archived Conversations ───────────────────────────────────────────

  loadArchived() {
    if (!this._cache.archived) {
      this._cache.archived = this._fromLS('archived', []);
    }
    return this._cache.archived;
  },

  saveArchived(archived) {
    this._cache.archived = archived;
    this._toLS('archived', archived);
  },

  // ── Config ───────────────────────────────────────────────────────────

  loadConfig() {
    return this._cache.config;
  },

  saveConfig(config) {
    this._cache.config = config;
    this._toLS('cfg', config);
    this._post('/api/data/config', { config });
  },

  clearConfig() {
    this._cache.config = null;
    localStorage.removeItem('sms_gateway_cfg');
    this._del('/api/data/config');
  },

  // ── Stats ────────────────────────────────────────────────────────────

  loadStats() {
    return this._cache.stats;
  },

  saveStats(stats) {
    this._cache.stats = stats;
    this._toLS('stats', stats);
    this._post('/api/data/stats', { stats });
  },

  // ── Clear all ────────────────────────────────────────────────────────

  clearAll() {
    this._cache.history = [];
    this._cache.templates = [];
    this._cache.groups = {};
    this._cache.stats = { sent: 0, delivered: 0, failed: 0, received: 0 };
    this._cache.config = null;
    this._cache.archived = [];

    // Clear localStorage
    const KEYS = ['history', 'templates', 'groups', 'cfg', 'stats', 'archived'];
    KEYS.forEach(k => localStorage.removeItem('sms_gateway_' + k));

    // Clear server
    this._del('/api/data');
  },
};
