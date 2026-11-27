/* LineMarks content script: selection toolbar, highlight, restore-on-load.
 * Loaded after anchor.js + storage.js (classic scripts share globals).
 */
(function () {
  "use strict";
  const A = globalThis.LineMarksAnchor;
  const S = globalThis.LineMarksStorage;
  const B = () => (typeof browser !== "undefined" && browser.runtime ? browser : chrome);

  const HIGHLIGHT_ATTR = "data-linemarks-id";
  let restoredIds = new Set();
  let toolbarEl = null;
  let toastEl = null;
  let observer = null;

  // ---------- highlight rendering ----------
  function colorCss(colorId) {
    const c = (S.COLORS.find((x) => x.id === colorId) || S.COLORS[0]).css;
    return c;
  }

  function supportsCustomHighlight() {
    return typeof CSS !== "undefined" && CSS.highlights;
  }

  function paintRange(range, id, colorId) {
    if (supportsCustomHighlight()) {
      try {
        const h = new Highlight(range.cloneRange());
        const name = "linemarks-" + colorId;
        if (CSS.highlights.has(name)) CSS.highlights.get(name).add(range.cloneRange());
        else CSS.highlights.set(name, h);
        return true;
      } catch { /* fall through to mark */ }
    }
    // <mark> fallback: wrap extracted contents.
    try {
      const mark = document.createElement("mark");
      mark.setAttribute(HIGHLIGHT_ATTR, id);
      mark.className = "linemarks-mark linemarks-" + colorId;
      mark.setAttribute("aria-label", "Bookmarked line");
      mark.style.background = colorCss(colorId);
      mark.style.pointerEvents = "none";
      const frag = range.extractContents();
      mark.appendChild(frag);
      range.insertNode(mark);
      return true;
    } catch {
      return false;
    }
  }

  function flashRange(range, colorId) {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const r = range.getBoundingClientRect();
    const box = document.createElement("div");
    box.className = "linemarks-flash" + (reduce ? " static" : "");
    box.style.cssText = `position:fixed;left:${r.left - 4}px;top:${r.top - 4}px;width:${r.width + 8}px;height:${r.height + 8}px;outline:3px solid ${colorCss(colorId)};border-radius:4px;pointer-events:none;z-index:2147483646;`;
    document.documentElement.appendChild(box);
    if (!reduce) {
      box.animate([{ opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }, { opacity: 0.2 }, { opacity: 1 }], { duration: 1200 });
    }
    setTimeout(() => box.remove(), 1400);
  }

  function scrollToRange(range, colorId) {
    try {
      const el = range.startContainer.nodeType === Node.ELEMENT_NODE
        ? range.startContainer : range.startContainer.parentElement;
      (el || document.body).scrollIntoView({ block: "center", behavior: "smooth" });
    } catch { /* noop */ }
    flashRange(range, colorId);
    // Move keyboard focus / announce.
    try {
      const t = range.startContainer.parentElement;
      if (t) {
        t.setAttribute("tabindex", "-1");
        t.setAttribute("aria-label", "Bookmarked line: " + range.toString().slice(0, 140));
        t.focus({ preventScroll: true });
      }
    } catch { /* noop */ }
  }

  // ---------- restore ----------
  async function restoreAll(autoScroll) {
    let rows = [];
    try {
      rows = await S.forUrl(location.href).then(async (exact) => {
        if (exact.length) return exact;
        const canon = A.canonicalUrl(location.href);
        if (canon === location.href) return [];
        return S.forUrl(canon);
      });
    } catch { return; }
    if (!rows.length) return;
    let orphans = [];
    for (const bm of rows) {
      if (restoredIds.has(bm.id)) continue;
      const { range, method } = A.resolveAnchor(bm.anchor, document);
      if (range) {
        paintRange(range, bm.id, bm.color);
        restoredIds.add(bm.id);
        bm._range = range;
      } else if (method === "orphan") {
        orphans.push(bm);
        try { await S.updateBookmark(bm.id, { status: "orphaned" }); } catch { /* noop */ }
      }
    }
    // Auto-scroll to latest (respect hash override + setting).
    const hashId = (location.hash.match(/linemarks=([\w-]+)/) || [])[1];
    const target = rows.find((b) => b.id === hashId && b._range) ||
      (autoScroll === false ? null : rows.find((b) => b._range));
    if (target && target._range) {
      setTimeout(() => scrollToRange(target._range, target.color), 350);
    }
  }

  function armRescan(autoScroll) {
    // Debounced MutationObserver rescan for lazy/SPAs.
    let t = null;
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => {
      clearTimeout(t);
      t = setTimeout(() => restoreAll(false), 800);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => { try { observer.disconnect(); } catch {} }, 30000);
    void autoScroll;
  }

  // ---------- toolbar ----------
  function removeToolbar() {
    if (toolbarEl) { toolbarEl.remove(); toolbarEl = null; }
  }

  function showToolbar(anchorRect, defaultColor, onSave, onNote) {
    removeToolbar();
    const bar = document.createElement("div");
    bar.className = "linemarks-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Save line bookmark");
    const dots = S.COLORS.map((c) =>
      `<button data-color="${c.id}" title="${c.label}" aria-label="Color ${c.label}" style="--dot:${c.css}" class="lm-dot${c.id === defaultColor ? " sel" : ""}"></button>`
    ).join("");
    bar.innerHTML =
      `<button class="lm-save">Save</button><span class="lm-dots">${dots}</span>` +
      `<button class="lm-note" title="Add note" aria-label="Add note">✎</button>`;
    document.documentElement.appendChild(bar);
    let picked = defaultColor;
    bar.addEventListener("click", (e) => {
      const d = e.target.closest("[data-color]");
      if (d) {
        picked = d.dataset.color;
        bar.querySelectorAll(".lm-dot").forEach((x) => x.classList.toggle("sel", x === d));
        return;
      }
      if (e.target.closest(".lm-note")) { onNote(picked); return; }
      if (e.target.closest(".lm-save")) { onSave(picked, ""); removeToolbar(); }
    });
    const top = Math.max(8, anchorRect.top - 44);
    bar.style.cssText = `position:fixed;left:${Math.min(Math.max(8, anchorRect.left), innerWidth - 260)}px;top:${top}px;z-index:2147483647;`;
    toolbarEl = bar;
    const first = bar.querySelector(".lm-save");
    if (first) first.focus({ preventScroll: true });
  }

  function showToast(msg, onUndo) {
    hideToast();
    const t = document.createElement("div");
    t.className = "linemarks-toast";
    t.setAttribute("role", "status");
    t.textContent = msg;
    if (onUndo) {
      const u = document.createElement("button");
      u.textContent = "Undo";
      u.onclick = () => { onUndo(); hideToast(); };
      t.appendChild(u);
    }
    document.documentElement.appendChild(t);
    toastEl = t;
    setTimeout(hideToast, 8000);
  }
  function hideToast() { if (toastEl) { toastEl.remove(); toastEl = null; } }

  async function unpaintBookmark(id) {
    restoredIds.delete(id);
    try {
      const sel = `mark[${HIGHLIGHT_ATTR}="${CSS.escape(id)}"]`;
      document.querySelectorAll(sel).forEach((m) => {
        m.replaceWith(...m.childNodes);
      });
      try { document.body.normalize(); } catch {}
    } catch {}
    try { if (supportsCustomHighlight()) CSS.highlights.clear(); } catch {}
    restoredIds.clear();
    await restoreAll(false);
  }

  function normText(s) {
    return (s || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  function showRemoveToolbar(anchorRect, bm) {
    removeToolbar();
    const bar = document.createElement("div");
    bar.className = "linemarks-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", "Remove line bookmark");
    bar.innerHTML = `<span class="lm-already">Already saved</span><button class="lm-remove">Remove</button>`;
    document.documentElement.appendChild(bar);
    bar.addEventListener("click", async (e) => {
      if (!e.target.closest(".lm-remove")) return;
      const gone = await S.removeBookmark(bm.id).catch(() => null);
      await unpaintBookmark(bm.id);
      removeToolbar();
      showToast("Bookmark removed.", gone ? async () => {
        await S.addBookmark(gone).catch(() => {});
        restoredIds.clear();
        try { if (supportsCustomHighlight()) CSS.highlights.clear(); } catch {}
        await restoreAll(false);
      } : null);
      try { await B().runtime.sendMessage({ type: "LINEMARKS_REMOVED", id: bm.id, url: location.href }); } catch {}
    });
    const top = Math.max(8, anchorRect.top - 44);
    bar.style.cssText = `position:fixed;left:${Math.min(Math.max(8, anchorRect.left), innerWidth - 260)}px;top:${top}px;z-index:2147483647;`;
    toolbarEl = bar;
    const btn = bar.querySelector(".lm-remove");
    if (btn) btn.focus({ preventScroll: true });
  }

  async function saveCurrent(colorId, note) {
    let anchor = A.serializeSelection(document);
    if (!anchor) anchor = A.serializeViewportCenter(document);
    if (!anchor) { showToast("Nothing to save on this page."); return null; }
    const bm = await S.addBookmark({
      url: location.href,
      canonicalUrl: anchor.canonicalUrl,
      title: document.title || location.href,
      domain: location.hostname,
      anchor, snippet: anchor.quote.exact.slice(0, 500),
      color: colorId || (await S.getSettings()).defaultColor,
      note: note || "",
    });
    const { range } = A.resolveAnchor(bm.anchor, document);
    if (range) { paintRange(range, bm.id, bm.color); restoredIds.add(bm.id); }
    try { await B().runtime.sendMessage({ type: "LINEMARKS_SAVED", id: bm.id, url: location.href }); } catch {}
    return bm;
  }

  // ---------- events ----------
  document.addEventListener("mouseup", async (e) => {
    if (toolbarEl && toolbarEl.contains(e.target)) return;
    setTimeout(async () => {
      const sel = document.getSelection();
      if (!sel || sel.isCollapsed || !sel.toString().trim()) return;
      const r = sel.getRangeAt(0);
      const rect = r.getBoundingClientRect();
      // If this exact text is already bookmarked on this page, offer Remove.
      try {
        const rows = await S.forUrl(location.href).catch(() => []);
        const needle = normText(sel.toString());
        const existing = rows.find((b) => normText(b.snippet) === needle ||
          normText(b.anchor && b.anchor.quote && b.anchor.quote.exact) === needle);
        if (existing) { showRemoveToolbar(rect, existing); return; }
      } catch {}
      let settings = { defaultColor: "yellow" };
      try { settings = await S.getSettings(); } catch {}
      showToolbar(rect, settings.defaultColor,
        async (color) => {
          const bm = await saveCurrent(color, "");
          if (bm) showToast("Saved ✓", async () => { await S.removeBookmark(bm.id); });
        },
        async (color) => {
          const note = prompt("Add a note (plain text):", "") || "";
          const bm = await saveCurrent(color, note.slice(0, 2000));
          if (bm) showToast("Saved ✓", async () => { await S.removeBookmark(bm.id); });
        });
    }, 30);
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { removeToolbar(); hideToast(); }
  });
  document.addEventListener("scroll", () => removeToolbar(), { passive: true, capture: true });
  document.addEventListener("mousedown", (e) => {
    if (toolbarEl && !toolbarEl.contains(e.target)) removeToolbar();
  }, true);

  // Hash click-to-scroll: #linemarks=<id>
  window.addEventListener("hashchange", async () => {
    const id = (location.hash.match(/linemarks=([\w-]+)/) || [])[1];
    if (!id) return;
    const rows = await S.loadAll().catch(() => []);
    const bm = rows.find((b) => b.id === id);
    if (!bm) return;
    const { range } = A.resolveAnchor(bm.anchor, document);
    if (range) scrollToRange(range, bm.color);
    else showToast("Couldn't find the line — showing saved quote.");
  });

  // ---------- messages from popup/background ----------
  (function listen() {
    try {
      B().runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        (async () => {
          if (msg.type === "LINEMARKS_SAVE_SELECTION") {
            const bm = await saveCurrent(msg.color, msg.note);
            sendResponse({ ok: !!bm, id: bm && bm.id });
          } else if (msg.type === "LINEMARKS_RESUME") {
            const rows = (await S.forUrl(location.href).catch(() => []))
              .sort((a, b) => b.createdAt - a.createdAt);
            const bm = rows[0];
            if (!bm) { sendResponse({ ok: false, reason: "none" }); return; }
            const { range } = A.resolveAnchor(bm.anchor, document);
            if (range) { scrollToRange(range, bm.color); sendResponse({ ok: true, id: bm.id }); }
            else {
              try { await S.updateBookmark(bm.id, { status: "orphaned" }); } catch {}
              sendResponse({ ok: false, reason: "orphan", quote: bm.snippet });
            }
          } else if (msg.type === "LINEMARKS_JUMP") {
            const { range, method } = A.resolveAnchor(msg.anchor, document);
            if (range) { scrollToRange(range, msg.color || "yellow"); sendResponse({ ok: true }); }
            else sendResponse({ ok: false, reason: "orphan" });
            void method;
          } else if (msg.type === "LINEMARKS_REMOVED") {
            if (msg.id) await unpaintBookmark(msg.id);
            sendResponse({ ok: true });
          } else if (msg.type === "LINEMARKS_SELECTION_INFO") {
            const sel = document.getSelection();
            sendResponse({ hasSelection: !!(sel && !sel.isCollapsed && sel.toString().trim()), text: (sel ? sel.toString() : "").slice(0, 200) });
          }
        })();
        return true;
      });
    } catch { /* noop */ }
  })();

  // ---------- boot ----------
  (async function boot() {
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", boot, { once: true });
      return;
    }
    let autoScroll = true;
    try { autoScroll = (await S.getSettings()).autoScroll !== false; } catch {}
    const settle = () => restoreAll(autoScroll);
    if (document.readyState === "complete") setTimeout(settle, 300);
    else window.addEventListener("load", () => setTimeout(settle, 300), { once: true });
    setTimeout(settle, 1200); // second pass for slow DOM
    armRescan(autoScroll);
  })();
})();
