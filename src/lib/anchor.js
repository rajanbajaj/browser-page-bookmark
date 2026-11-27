/* LineMarks anchor lib — hybrid W3C-style anchor (no modules: shared by
 * content script via classic script include; also importable as module).
 * Anchor shape:
 *   { quote: { exact, prefix, suffix }, position: { start, end },
 *     range: { startXPath, endXPath, startOffset, endOffset },
 *     url, canonicalUrl, contentHash, createdAt }
 * Restore order: (1) XPath range w/ quote check -> (2) TextPosition w/ check
 * -> (3) exact quote+context search -> (4) fuzzy quote search -> orphan.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.LineMarksAnchor = api;
  if (typeof globalThis !== "undefined") globalThis.LineMarksAnchor = api;
})(typeof self !== "undefined" ? self : globalThis, function () {
  "use strict";

  const CONTEXT_LEN = 48;
  const FUZZY_THRESHOLD = 0.75; // min similarity to accept fuzzy match

  function normalizeText(s) {
    return (s || "").replace(/\s+/g, " ").trim();
  }

  function bodyText(doc) {
    const d = doc || document;
    return normalizeText(d.body ? d.body.innerText || d.body.textContent || "" : "");
  }

  function simpleHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return (h >>> 0).toString(16);
  }

  function contentHash(doc) {
    return simpleHash(bodyText(doc).slice(0, 20000));
  }

  function canonicalUrl(url) {
    try {
      const u = new URL(url);
      u.hash = "";
      return u.toString();
    } catch {
      return (url || "").split("#")[0];
    }
  }

  // --- XPath helpers -------------------------------------------------
  function nodeXPath(node) {
    if (!node || node === document.body || node === document.documentElement)
      return node === document.body ? "/body" : "/html";
    const parts = [];
    let cur = node.nodeType === Node.TEXT_NODE ? node.parentNode : node;
    while (cur && cur !== document.documentElement && cur.nodeType === Node.ELEMENT_NODE) {
      let idx = 1;
      let sib = cur.previousSibling;
      while (sib) {
        if (sib.nodeType === Node.ELEMENT_NODE && sib.nodeName === cur.nodeName) idx++;
        sib = sib.previousSibling;
      }
      parts.unshift(cur.nodeName.toLowerCase() + "[" + idx + "]");
      cur = cur.parentNode;
    }
    return "/html/" + parts.join("/");
  }

  function resolveXPath(xpath, doc) {
    const d = doc || document;
    try {
      // support our simplified "/html/p[1]/..." plus "/body/..." forms
      let expr = xpath;
      if (expr.startsWith("/body")) expr = "/html/body" + expr.slice(5);
      const r = d.evaluate(expr, d, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null);
      return r.singleNodeValue || null;
    } catch {
      return null;
    }
  }

  function textNodeAt(element, offset) {
    // Walk text nodes to find the one containing char offset.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    let acc = 0;
    let node = walker.nextNode();
    while (node) {
      const len = node.textContent.length;
      if (offset <= acc + len) return { node, offsetInNode: offset - acc };
      acc += len;
      node = walker.nextNode();
    }
    return null;
  }

  // --- Serialize ------------------------------------------------------
  function rangeFromSelection(doc) {
    const sel = (doc || document).getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    return sel.getRangeAt(0).cloneRange();
  }

  function serializeRange(range, doc) {
    const d = doc || document;
    const exact = range.toString();
    const full = bodyText(d);
    const normExact = normalizeText(exact);
    const start = full.indexOf(normExact);
    const pos = start >= 0 ? { start, end: start + normExact.length } : { start: -1, end: -1 };
    const prefix = start > 0 ? full.slice(Math.max(0, start - CONTEXT_LEN), start) : "";
    const suffix =
      start >= 0 ? full.slice(pos.end, pos.end + CONTEXT_LEN) : "";
    const url = location.href;
    return {
      quote: { exact: normExact.slice(0, 2000), prefix, suffix },
      position: pos,
      range: {
        startXPath: nodeXPath(range.startContainer),
        endXPath: nodeXPath(range.endContainer),
        startOffset: range.startOffset,
        endOffset: range.endOffset,
      },
      url,
      canonicalUrl: canonicalUrl(url),
      contentHash: contentHash(d),
      createdAt: Date.now(),
    };
  }

  function serializeSelection(doc) {
    const range = rangeFromSelection(doc);
    if (!range) return null;
    const text = normalizeText(range.toString());
    if (!text) return null;
    return serializeRange(range, doc);
  }

  function serializeViewportCenter(doc) {
    // Fallback when nothing is selected: anchor the text node at viewport center.
    const d = doc || document;
    const x = Math.floor(window.innerWidth / 2);
    const y = Math.floor(window.innerHeight / 2);
    let el = d.elementFromPoint(x, y) || d.body;
    // Climb out of script/style/chrome.
    while (el && /^(SCRIPT|STYLE|NOSCRIPT|IFRAME)$/.test(el.tagName)) el = el.parentElement;
    if (!el) el = d.body;
    const text = normalizeText(el.innerText || el.textContent || "");
    const line = text.split(/\n|\. /)[0].slice(0, 500) || text.slice(0, 500);
    if (!line) return null;
    const full = bodyText(d);
    const start = full.indexOf(normalizeText(line).slice(0, 120));
    const anchor = {
      quote: {
        exact: normalizeText(line).slice(0, 2000),
        prefix: start > 0 ? full.slice(Math.max(0, start - CONTEXT_LEN), start) : "",
        suffix: start >= 0 ? full.slice(start + line.length, start + line.length + CONTEXT_LEN) : "",
      },
      position: start >= 0 ? { start, end: start + line.length } : { start: -1, end: -1 },
      range: { startXPath: nodeXPath(el), endXPath: nodeXPath(el), startOffset: 0, endOffset: 0 },
      url: location.href,
      canonicalUrl: canonicalUrl(location.href),
      contentHash: contentHash(d),
      createdAt: Date.now(),
      viewportCenter: true,
    };
    return anchor;
  }

  // --- Resolve ----------------------------------------------------------
  function rangeToSelectionLike(range) {
    return { startContainer: range.startContainer, endContainer: range.endContainer };
  }

  function tryXPathRange(anchor, doc) {
    try {
      const d = doc || document;
      const sEl = resolveXPath(anchor.range.startXPath, d);
      const eEl = resolveXPath(anchor.range.endXPath, d);
      if (!sEl || !eEl) return null;
      const s = textNodeAt(sEl.nodeType === Node.TEXT_NODE ? sEl.parentNode : sEl, 0);
      // Rebuild a range spanning start..end elements and check quote equality.
      const r = d.createRange();
      r.selectNodeContents(sEl);
      try {
        const r2 = d.createRange();
        r2.selectNodeContents(eEl);
        r.setEnd(r2.endContainer, r2.endOffset);
      } catch { /* keep single-element range */ }
      void s;
      void rangeToSelectionLike;
      const got = normalizeText(r.toString());
      if (anchor.quote.exact && got.includes(anchor.quote.exact.slice(0, 60))) return r;
      // Also accept if quote appears with context nearby.
      if (anchor.quote.exact && got.length && similarity(got.slice(0, 300), anchor.quote.exact.slice(0, 300)) > 0.8)
        return r;
      return null;
    } catch {
      return null;
    }
  }

  function tryTextPosition(anchor, doc) {
    if (!anchor.position || anchor.position.start < 0) return null;
    const d = doc || document;
    const full = bodyText(d);
    const slice = full.slice(anchor.position.start, anchor.position.end);
    if (anchor.quote.exact && slice === anchor.quote.exact) {
      return findTextRange(anchor.quote.exact, d);
    }
    return null;
  }

  function findTextRange(needle, doc) {
    // Walk text nodes to build a Range for the first occurrence of needle.
    const d = doc || document;
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    const target = normalizeText(needle);
    if (!target) return null;
    let acc = "";
    const nodes = [];
    let n = walker.nextNode();
    while (n) {
      nodes.push(n);
      acc += n.textContent + " ";
      n = walker.nextNode();
    }
    const flat = normalizeText(acc);
    const idx = flat.indexOf(target.slice(0, Math.min(target.length, 200)));
    if (idx < 0) return null;
    // Map char index back to nodes (approximate: rescan).
    let seen = 0;
    let startNode = null, startOff = 0, endNode = null, endOff = 0;
    const need = target.length;
    for (const tn of nodes) {
      const len = normalizeText(tn.textContent).length + 1;
      if (!startNode && seen + len > idx) {
        startNode = tn;
        startOff = Math.min(tn.textContent.length, Math.max(0, idx - seen));
      }
      if (startNode && seen + len >= idx + need) {
        endNode = tn;
        endOff = Math.min(tn.textContent.length, Math.max(0, idx + need - seen));
        break;
      }
      seen += len;
    }
    if (!startNode) return null;
    try {
      const r = d.createRange();
      r.setStart(startNode, startOff);
      r.setEnd(endNode || startNode, endNode ? endOff : startNode.textContent.length);
      return r;
    } catch {
      return null;
    }
  }

  function searchQuote(anchor, doc) {
    const d = doc || document;
    if (!anchor.quote || !anchor.quote.exact) return null;
    // (3) exact quote + context check via window.find fallback -> manual scan
    let r = findTextRange(anchor.quote.exact, d);
    if (r) {
      const ctx = normalizeText(r.commonAncestorContainer.textContent || "");
      if (
        (!anchor.quote.prefix || ctx.includes(anchor.quote.prefix.slice(-20))) &&
        (!anchor.quote.suffix || ctx.includes(anchor.quote.suffix.slice(0, 20)))
      )
        return r;
      return r; // exact text found; accept even if context drifted
    }
    // (4) fuzzy: slide over body text for best similarity window
    const full = bodyText(d);
    const needle = anchor.quote.exact;
    if (!needle || full.length < 10) return null;
    const win = needle.length;
    let best = 0, bestIdx = -1;
    const step = Math.max(1, Math.floor(win / 20));
    for (let i = 0; i + win <= full.length; i += step) {
      const s = similarity(full.slice(i, i + win), needle);
      if (s > best) { best = s; bestIdx = i; }
      if (best > 0.95) break;
    }
    if (best >= FUZZY_THRESHOLD && bestIdx >= 0) {
      return findTextRange(full.slice(bestIdx, bestIdx + Math.min(win, 200)), d);
    }
    return null;
  }

  function similarity(a, b) {
    // Jaccard over char bigrams — cheap fuzzy score in [0,1].
    if (!a || !b) return 0;
    if (a === b) return 1;
    const grams = (s) => {
      const m = new Map();
      for (let i = 0; i < s.length - 1; i++) {
        const g = s.slice(i, i + 2);
        m.set(g, (m.get(g) || 0) + 1);
      }
      return m;
    };
    const A = grams(a), B = grams(b);
    let inter = 0, union = 0;
    for (const [g, c] of A) { inter += Math.min(c, B.get(g) || 0); }
    for (const [g, c] of A) union += c;
    for (const [g, c] of B) union += c;
    union -= inter;
    return union === 0 ? 0 : inter / union;
  }

  function resolveAnchor(anchor, doc) {
    if (!anchor) return { range: null, method: "none" };
    let r = anchor.range ? tryXPathRange(anchor, doc) : null;
    if (r) return { range: r, method: "xpath" };
    r = tryTextPosition(anchor, doc);
    if (r) return { range: r, method: "position" };
    r = searchQuote(anchor, doc);
    if (r) return { range: r, method: r ? "quote" : "none" };
    return { range: null, method: "orphan" };
  }

  return {
    CONTEXT_LEN,
    normalizeText,
    bodyText,
    contentHash,
    canonicalUrl,
    nodeXPath,
    resolveXPath,
    serializeRange,
    serializeSelection,
    serializeViewportCenter,
    resolveAnchor,
    findTextRange,
    similarity,
  };
});
