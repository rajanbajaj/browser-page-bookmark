/* LineMarks dashboard: full library (search/filter/group/sort/jump/delete/export/import). */
(function () {
  "use strict";
  const S = globalThis.LineMarksStorage;
  const B = () => (typeof browser !== "undefined" && browser.runtime ? browser : chrome);
  const $ = (id) => document.getElementById(id);

  let all = [];
  let editingId = null;
  let editColor = "yellow";
  let searchT = null;

  function toast(msg, onUndo) {
    const t = $("toast");
    t.hidden = false;
    t.replaceChildren();
    t.append(document.createTextNode(msg));
    if (onUndo) {
      const u = document.createElement("button");
      u.textContent = "Undo";
      u.onclick = async () => { await onUndo(); t.hidden = true; await reload(); };
      t.appendChild(u);
    }
    clearTimeout(t._t);
    t._t = setTimeout(() => { t.hidden = true; }, 8000);
  }

  function currentFilters() {
    return {
      q: $("search").value, domain: $("fDomain").value, color: $("fColor").value,
      tag: $("fTag").value, status: $("fStatus").value, date: $("fDate").value,
      sort: $("sortSel").value,
    };
  }

  function fillFilterOptions() {
    const dSel = $("fDomain"), tSel = $("fTag"), cSel = $("fColor");
    const keep = (sel) => sel.value;
    const kd = keep(dSel), kt = keep(tSel), kc = keep(cSel);
    dSel.replaceChildren();
    {
      const o = document.createElement("option"); o.value = ""; o.textContent = "All domains"; dSel.appendChild(o);
    }
    for (const d of S.allDomains(all)) {
      const o = document.createElement("option"); o.value = d; o.textContent = d; dSel.appendChild(o);
    }
    tSel.replaceChildren();
    {
      const o = document.createElement("option"); o.value = ""; o.textContent = "All tags"; tSel.appendChild(o);
    }
    for (const t of S.allTags(all)) {
      const o = document.createElement("option"); o.value = t; o.textContent = "#" + t; tSel.appendChild(o);
    }
    if (!cSel.options.length || cSel.options.length <= 1) {
      for (const c of S.COLORS) {
        const o = document.createElement("option"); o.value = c.id; o.textContent = c.label; cSel.appendChild(o);
      }
    }
    dSel.value = kd; tSel.value = kt; cSel.value = kc;
  }

  async function jump(bm) {
    const settings = await S.getSettings().catch(() => ({ openJumpIn: "new" }));
    const url = bm.url + "#linemarks=" + bm.id;
    // Try jumping in an already-open tab first.
    try {
      const tabs = await B().tabs.query({}).catch(() => []);
      const open = (tabs || []).find((t) => t.url && t.url.split("#")[0] === bm.url.split("#")[0]);
      if (open && open.id != null) {
        try {
          await B().tabs.sendMessage(open.id, { type: "LINEMARKS_JUMP", anchor: bm.anchor, color: bm.color });
          await B().tabs.update(open.id, { active: true });
          await B().windows.update(open.windowId, { focused: true }).catch(() => {});
          return;
        } catch {
          await B().tabs.update(open.id, { url, active: true });
          return;
        }
      }
    } catch {}
    if (settings.openJumpIn === "current") {
      const [cur] = await B().tabs.query({ active: true, currentWindow: true }).catch(() => []);
      if (cur && cur.id != null) { await B().tabs.update(cur.id, { url }); return; }
    }
    await B().tabs.create({ url });
  }

  function snippetEl(bm) {
    const p = document.createElement("p");
    p.className = "snippet";
    p.textContent = bm.snippet || "(empty)";
    return p;
  }

  function rowNode(bm) {
    const li = document.createElement("li");
    li.className = "brow" + (bm.status === "orphaned" ? " orphan" : "");
    const c = S.COLORS.find((x) => x.id === bm.color) || S.COLORS[0];

    const dot = document.createElement("span");
    dot.className = "cdot"; dot.style.background = c.css; dot.title = c.label;

    const main = document.createElement("div");
    main.className = "bmain";
    main.appendChild(snippetEl(bm));
    const meta = document.createElement("div");
    meta.className = "bmeta";
    meta.textContent = `${bm.title} · ${S.relTime(bm.createdAt)}`;
    main.appendChild(meta);
    if ((bm.tags || []).length) {
      const tags = document.createElement("div");
      tags.className = "tags";
      for (const t of bm.tags) {
        const chip = document.createElement("button");
        chip.className = "tag"; chip.textContent = "#" + t;
        chip.onclick = () => { $("fTag").value = t; render(); };
        tags.appendChild(chip);
      }
      main.appendChild(tags);
    }
    if (bm.note) {
      const n = document.createElement("div");
      n.className = "note"; n.textContent = bm.note;
      main.appendChild(n);
    }
    if (bm.status === "orphaned") {
      const chip = document.createElement("span");
      chip.className = "chip warn"; chip.textContent = "moved/removed";
      main.appendChild(chip);
      const q = document.createElement("blockquote");
      q.textContent = bm.snippet;
      main.appendChild(q);
    }

    const acts = document.createElement("div");
    acts.className = "acts";
    const mk = (label, fn, cls) => {
      const b = document.createElement("button");
      b.textContent = label; if (cls) b.className = cls;
      b.addEventListener("click", fn);
      acts.appendChild(b);
      return b;
    };
    mk("Jump", () => jump(bm), "secondary");
    mk("Edit", () => openEdit(bm));
    mk("Copy", async () => {
      try { await navigator.clipboard.writeText(bm.snippet || ""); toast("Quote copied."); }
      catch { toast("Copy failed."); }
    });
    if (bm.status === "orphaned") mk("Re-anchor", () => toast("Select the new text on the page, then save — old row can be deleted."));
    mk("Delete", async () => {
      const gone = await S.removeBookmark(bm.id);
      await reload();
      toast("Deleted.", async () => { if (gone) await S.addBookmark(gone); });
    }, "danger");
    li.append(dot, main, acts);
    return li;
  }

  function render() {
    const f = currentFilters();
    const rows = S.applyFilters(all, f);
    $("countLine").textContent = `${rows.length} of ${all.length}`;
    const g = $("groups");
    g.replaceChildren();
    $("emptyState").hidden = all.length !== 0;
    $("noMatch").hidden = !(all.length && !rows.length);
    // Group by domain -> page(url).
    const byDomain = new Map();
    for (const b of rows) {
      if (!byDomain.has(b.domain)) byDomain.set(b.domain, new Map());
      const pages = byDomain.get(b.domain);
      if (!pages.has(b.canonicalUrl)) pages.set(b.canonicalUrl, []);
      pages.get(b.canonicalUrl).push(b);
    }
    for (const [domain, pages] of byDomain) {
      const det = document.createElement("details");
      det.open = true;
      const sum = document.createElement("summary");
      const n = [...pages.values()].reduce((a, x) => a + x.length, 0);
      sum.textContent = `${domain} (${pages.size} page${pages.size === 1 ? "" : "s"}) — ${n} save${n === 1 ? "" : "s"}`;
      det.appendChild(sum);
      for (const [curl, list] of pages) {
        const pdet = document.createElement("details");
        pdet.open = true;
        const psum = document.createElement("summary");
        psum.className = "page-sum";
        psum.textContent = `${list[0].title} — ${curl}`;
        const del = document.createElement("button");
        del.className = "danger linklike";
        del.textContent = "Delete page";
        del.onclick = async (e) => {
          e.preventDefault();
          if (!confirm(`Delete ${list.length} bookmark(s) on this page?`)) return;
          const gone = await S.removeWhere((b) => b.canonicalUrl === curl);
          await reload();
          toast(`Deleted ${gone.length}.`, async () => { for (const b of gone) await S.addBookmark(b); });
        };
        psum.appendChild(del);
        pdet.appendChild(psum);
        const ul = document.createElement("ul");
        ul.className = "brows";
        for (const bm of list) ul.appendChild(rowNode(bm));
        pdet.appendChild(ul);
        det.appendChild(pdet);
      }
      g.appendChild(det);
    }
  }

  function openEdit(bm) {
    editingId = bm.id;
    editColor = bm.color;
    $("editNote").value = bm.note || "";
    $("editTags").value = (bm.tags || []).join(", ");
    const row = $("editColors");
    row.replaceChildren();
    for (const c of S.COLORS) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "dot" + (c.id === editColor ? " sel" : "");
      b.style.setProperty("--dot", c.css);
      b.title = c.label; b.setAttribute("aria-label", "Color " + c.label);
      b.onclick = () => {
        editColor = c.id;
        row.querySelectorAll(".dot").forEach((x) => x.classList.remove("sel"));
        b.classList.add("sel");
      };
      row.appendChild(b);
    }
    $("editDlg").showModal();
  }

  async function reload() {
    all = await S.loadAll().catch(() => []);
    fillFilterOptions();
    render();
  }

  document.addEventListener("DOMContentLoaded", async () => {
    const settings = await S.getSettings().catch(() => S.DEFAULT_SETTINGS);
    $("sortSel").value = settings.sort || "recent";
    document.documentElement.dataset.theme =
      settings.theme === "auto" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : settings.theme;

    $("search").addEventListener("input", () => {
      clearTimeout(searchT);
      searchT = setTimeout(render, 150);
    });
    for (const id of ["fDomain", "fColor", "fTag", "fStatus", "fDate", "sortSel"]) {
      $(id).addEventListener("change", async () => {
        if (id === "sortSel") await S.saveSettings({ sort: $("sortSel").value }).catch(() => {});
        render();
      });
    }
    document.addEventListener("keydown", (e) => {
      if (e.key === "/" && document.activeElement !== $("search")) {
        e.preventDefault(); $("search").focus();
      }
    });
    $("clearBtn").addEventListener("click", () => {
      $("search").value = "";
      for (const id of ["fDomain", "fColor", "fTag", "fStatus"]) $(id).value = "";
      $("fDate").value = "all";
      render();
    });
    $("themeBtn").addEventListener("click", async () => {
      const cur = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = cur;
      await S.saveSettings({ theme: cur }).catch(() => {});
    });
    $("editForm").addEventListener("close", async () => {
      if ($("editDlg").returnValue !== "default" || !editingId) return;
      await S.updateBookmark(editingId, {
        color: editColor,
        note: $("editNote").value.slice(0, 2000),
        tags: $("editTags").value.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean).slice(0, 10),
      });
      editingId = null;
      await reload();
    });
    $("exportBtn").addEventListener("click", async () => {
      const blob = new Blob([S.exportJson(all)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "linemarks-export.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    });
    $("importBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", async () => {
      const f = $("importFile").files[0];
      if (!f) return;
      try {
        const payload = JSON.parse(await f.text());
        const { added, skipped } = await S.importJson(payload);
        await reload();
        toast(`Imported ${added}, skipped ${skipped}.`);
      } catch (e) {
        toast("Import failed: " + (e.message || e));
      }
      $("importFile").value = "";
    });
    await reload();
  });
})();
