/* LineMarks storage lib — browser.* with chrome fallback.
 * Schema v1: storage.local key "bookmarks/v1" -> Bookmark[].
 * Settings (tiny prefs) -> storage.sync with local fallback.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LineMarksStorage = api;
  if (typeof globalThis !== "undefined") globalThis.LineMarksStorage = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const SCHEMA_VERSION = 1;
  const BOOKMARKS_KEY = "bookmarks/v1";
  const SETTINGS_KEY = "settings/v1";
  const EXPORT_VERSION = 1;

  const COLORS = [
    { id: "yellow", label: "Yellow", css: "#ffe066" },
    { id: "green", label: "Green", css: "#8ce99a" },
    { id: "blue", label: "Blue", css: "#99d5ff" },
    { id: "pink", label: "Pink", css: "#ffb3d9" },
    { id: "orange", label: "Orange", css: "#ffbf69" },
  ];
  const COLOR_IDS = COLORS.map((c) => c.id);

  const DEFAULT_SETTINGS = {
    theme: "auto", // auto | light | dark
    defaultColor: "yellow",
    sort: "recent", // recent | oldest | domain
    declutterDefault: false,
    autoScroll: true, // "Don't auto-scroll, just badge"
    openJumpIn: "current", // current | new
  };

  // Shared in-memory fallback so non-extension callers (tests) see
  // persisted data across ext() calls.
  const fallbackMem = {};
  const fallbackArea = {
    get: async (k) => ({ [k]: fallbackMem[k] }),
    set: async (o) => Object.assign(fallbackMem, o),
    remove: async (k) => { delete fallbackMem[k]; },
  };

  function ext() {
    if (typeof browser !== "undefined" && browser && browser.storage) return browser;
    if (typeof chrome !== "undefined" && chrome && chrome.storage) {
      // Minimal promise wrapper around callback-style chrome.*.
      const wrap = (area) => ({
        get: (k) =>
          new Promise((res) => area.get(k, (v) => res(v || {}))),
        set: (o) => new Promise((res) => area.set(o, res)),
        remove: (k) => new Promise((res) => area.remove(k, res)),
      });
      return { storage: { local: wrap(chrome.storage.local), sync: chrome.storage.sync ? wrap(chrome.storage.sync) : wrap(chrome.storage.local), session: chrome.storage.session ? wrap(chrome.storage.session) : wrap(chrome.storage.local) }, _isChromeShim: true };
    }
    // Non-extension fallback (tests): shared in-memory.
    return { storage: { local: fallbackArea, sync: fallbackArea, session: fallbackArea }, _isMemory: true };
  }

  function api() {
    return ext();
  }

  function uid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "id-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 10);
  }

  function domainOf(url) {
    try { return new URL(url).hostname; } catch { return ""; }
  }

  function migrate(data) {
    // Pure migrate(old) -> new. v1 is the first schema: coerce rows.
    const rows = Array.isArray(data) ? data : data && Array.isArray(data.bookmarks) ? data.bookmarks : [];
    return rows
      .filter((b) => b && typeof b === "object" && b.url && b.anchor)
      .map((b) => ({
        id: b.id || uid(),
        url: b.url,
        canonicalUrl: b.canonicalUrl || b.url,
        title: b.title || b.url,
        domain: b.domain || domainOf(b.url),
        anchor: b.anchor,
        snippet: (b.snippet || (b.anchor.quote && b.anchor.quote.exact) || "").slice(0, 500),
        color: COLOR_IDS.includes(b.color) ? b.color : "yellow",
        note: (b.note || "").slice(0, 2000),
        tags: Array.isArray(b.tags) ? b.tags.map(String).map((t) => t.toLowerCase()).slice(0, 10) : [],
        createdAt: b.createdAt || Date.now(),
        updatedAt: b.updatedAt || b.createdAt || Date.now(),
        lastVisitedAt: b.lastVisitedAt || null,
        status: b.status === "orphaned" ? "orphaned" : "anchored",
        visits: b.visits || 0,
      }));
  }

  async function loadAll() {
    const b = api();
    const got = await b.storage.local.get(BOOKMARKS_KEY);
    const raw = got[BOOKMARKS_KEY];
    if (!raw) return [];
    if (Array.isArray(raw)) return migrate(raw);
    if (raw && Array.isArray(raw.bookmarks)) return migrate(raw.bookmarks);
    return [];
  }

  async function persistAll(rows) {
    const b = api();
    await b.storage.local.set({ [BOOKMARKS_KEY]: { version: SCHEMA_VERSION, bookmarks: rows } });
  }

  async function addBookmark(input) {
    const rows = await loadAll();
    const now = Date.now();
    const bm = {
      id: input.id || uid(),
      url: input.url,
      canonicalUrl: input.canonicalUrl || input.url,
      title: input.title || input.url,
      domain: input.domain || domainOf(input.url),
      anchor: input.anchor,
      snippet: (input.snippet || (input.anchor.quote && input.anchor.quote.exact) || "").slice(0, 500),
      color: COLOR_IDS.includes(input.color) ? input.color : DEFAULT_SETTINGS.defaultColor,
      note: (input.note || "").slice(0, 2000),
      tags: Array.isArray(input.tags) ? input.tags.map(String).map((t) => t.toLowerCase()).slice(0, 10) : [],
      createdAt: input.createdAt || now,
      updatedAt: now,
      lastVisitedAt: null,
      status: "anchored",
      visits: 0,
    };
    rows.unshift(bm);
    await persistAll(rows);
    return bm;
  }

  async function updateBookmark(id, patch) {
    const rows = await loadAll();
    const i = rows.findIndex((b) => b.id === id);
    if (i < 0) return null;
    const allowed = ["color", "note", "tags", "status", "lastVisitedAt", "visits", "title", "snippet"];
    for (const k of allowed) if (k in patch) rows[i][k] = patch[k];
    if (patch.color && !COLOR_IDS.includes(patch.color)) rows[i].color = "yellow";
    if (typeof rows[i].note === "string") rows[i].note = rows[i].note.slice(0, 2000);
    if (Array.isArray(rows[i].tags)) rows[i].tags = rows[i].tags.map(String).map((t) => t.toLowerCase()).slice(0, 10);
    rows[i].updatedAt = Date.now();
    await persistAll(rows);
    return rows[i];
  }

  async function removeBookmark(id) {
    const rows = await loadAll();
    const gone = rows.find((b) => b.id === id) || null;
    await persistAll(rows.filter((b) => b.id !== id));
    return gone;
  }

  async function removeWhere(pred) {
    const rows = await loadAll();
    const gone = rows.filter(pred);
    await persistAll(rows.filter((b) => !pred(b)));
    return gone;
  }

  async function forUrl(canonicalOrUrl) {
    const rows = await loadAll();
    return rows
      .filter((b) => b.url === canonicalOrUrl || b.canonicalUrl === canonicalOrUrl)
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  async function recent(limit) {
    const rows = await loadAll();
    return rows.sort((a, b) => b.createdAt - a.createdAt).slice(0, limit || 10);
  }

  function searchFilter(rows, q) {
    const query = (q || "").trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((b) =>
      [b.title, b.url, b.snippet, b.note, (b.tags || []).join(" ")]
        .join("\n").toLowerCase().includes(query)
    );
  }

  function applyFilters(rows, f) {
    let out = rows.slice();
    if (f.domain) out = out.filter((b) => b.domain === f.domain);
    if (f.color) out = out.filter((b) => b.color === f.color);
    if (f.tag) out = out.filter((b) => (b.tags || []).includes(f.tag));
    if (f.status) out = out.filter((b) => b.status === f.status);
    if (f.date && f.date !== "all") {
      const day = 864e5;
      const cutoff = Date.now() - (f.date === "today" ? day : f.date === "week" ? 7 * day : 30 * day);
      out = out.filter((b) => b.createdAt >= cutoff);
    }
    if (f.q) out = searchFilter(out, f.q);
    const sort = f.sort || "recent";
    out.sort((a, b) =>
      sort === "domain" ? a.domain.localeCompare(b.domain) || b.createdAt - a.createdAt
      : sort === "oldest" ? a.createdAt - b.createdAt
      : b.createdAt - a.createdAt
    );
    return out;
  }

  function exportJson(rows) {
    return JSON.stringify({ version: EXPORT_VERSION, bookmarks: rows }, null, 2);
  }

  function validateImport(payload) {
    if (!payload || typeof payload !== "object") return { ok: false, error: "Not a JSON object." };
    if (payload.version > EXPORT_VERSION) return { ok: false, error: "Unsupported file version " + payload.version + "." };
    if (!Array.isArray(payload.bookmarks)) return { ok: false, error: "Missing bookmarks array." };
    if (payload.bookmarks.length > 5000) return { ok: false, error: "File too large (>5000 bookmarks)." };
    return { ok: true };
  }

  async function importJson(payload) {
    const v = validateImport(payload);
    if (!v.ok) throw new Error(v.error);
    const rows = await loadAll();
    const ids = new Set(rows.map((b) => b.id));
    const incoming = migrate(payload.bookmarks);
    let added = 0, skipped = 0;
    for (const b of incoming) {
      if (ids.has(b.id)) { skipped++; continue; }
      rows.push(b);
      ids.add(b.id);
      added++;
    }
    rows.sort((a, b) => b.createdAt - a.createdAt);
    await persistAll(rows);
    return { added, skipped };
  }

  async function getSettings() {
    try {
      const b = api();
      const got = await b.storage.sync.get(SETTINGS_KEY);
      return Object.assign({}, DEFAULT_SETTINGS, got[SETTINGS_KEY] || {});
    } catch {
      return Object.assign({}, DEFAULT_SETTINGS);
    }
  }

  let saveT = null;
  async function saveSettings(patch) {
    // Debounced/batched writes (sync quota: 120/min).
    const cur = await getSettings();
    const next = Object.assign({}, cur, patch);
    clearTimeout(saveT);
    await new Promise((res) => {
      saveT = setTimeout(res, 120);
    });
    try {
      const b = api();
      await b.storage.sync.set({ [SETTINGS_KEY]: next });
    } catch {
      const b = api();
      await b.storage.local.set({ [SETTINGS_KEY]: next });
    }
    return next;
  }

  function allTags(rows) {
    const s = new Set();
    for (const b of rows) for (const t of b.tags || []) s.add(t);
    return [...s].sort();
  }

  function allDomains(rows) {
    return [...new Set(rows.map((b) => b.domain).filter(Boolean))].sort();
  }

  function relTime(ts) {
    const d = Date.now() - ts;
    if (d < 60e3) return "just now";
    if (d < 3600e3) return Math.floor(d / 60e3) + "m ago";
    if (d < 864e5) return Math.floor(d / 3600e3) + "h ago";
    if (d < 30 * 864e5) return Math.floor(d / 864e5) + "d ago";
    return new Date(ts).toLocaleDateString();
  }

  function esc(s) {
    return String(s == null ? "" : s);
  }

  return {
    SCHEMA_VERSION, BOOKMARKS_KEY, COLORS, COLOR_IDS, DEFAULT_SETTINGS,
    uid, domainOf, migrate, loadAll, persistAll, addBookmark, updateBookmark,
    removeBookmark, removeWhere, forUrl, recent, searchFilter, applyFilters,
    exportJson, validateImport, importJson, getSettings, saveSettings,
    allTags, allDomains, relTime, esc,
  };
});
