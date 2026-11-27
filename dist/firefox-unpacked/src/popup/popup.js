/* LineMarks popup: quick save + recent 10 + continue reading. */
(function () {
  "use strict";
  const S = globalThis.LineMarksStorage;
  const B = () => (typeof browser !== "undefined" && browser.runtime ? browser : chrome);

  const $ = (id) => document.getElementById(id);
  let tab = null;
  let picked = "yellow";
  let lastSavedId = null;
  let undoTimer = null;

  function renderColors(defaultColor) {
    picked = defaultColor;
    const row = $("colorRow");
    row.replaceChildren();
    for (const c of S.COLORS) {
      const b = document.createElement("button");
      b.className = "dot" + (c.id === picked ? " sel" : "");
      b.style.setProperty("--dot", c.css);
      b.title = c.label;
      b.setAttribute("aria-label", "Color " + c.label);
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", c.id === picked ? "true" : "false");
      b.addEventListener("click", () => {
        picked = c.id;
        row.querySelectorAll(".dot").forEach((x) => { x.classList.remove("sel"); x.setAttribute("aria-checked", "false"); });
        b.classList.add("sel");
        b.setAttribute("aria-checked", "true");
      });
      row.appendChild(b);
    }
  }

  function status(msg, isErr) {
    const el = $("statusLine");
    el.textContent = msg;
    el.classList.toggle("err", !!isErr);
  }

  async function unpaintInTab(id) {
    try {
      if (tab && tab.id != null) await B().tabs.sendMessage(tab.id, { type: "LINEMARKS_REMOVED", id });
    } catch {}
  }

  async function removeOne(bm) {
    const gone = await S.removeBookmark(bm.id);
    if (bm.id === lastSavedId) lastSavedId = null;
    await unpaintInTab(bm.id);
    await refresh();
    status("Removed. (" + (gone ? (gone.snippet || "").slice(0, 60) : "bookmark") + ")");
  }

  function rowHtml(bm) {
    const li = document.createElement("li");
    li.className = "rrow";
    const dot = document.createElement("span");
    dot.className = "cdot";
    const c = S.COLORS.find((x) => x.id === bm.color) || S.COLORS[0];
    dot.style.background = c.css;
    dot.title = c.label;
    const tx = document.createElement("button");
    tx.className = "rtext";
    tx.textContent = (bm.snippet || "(empty)").slice(0, 120);
    tx.title = "Jump to line";
    tx.addEventListener("click", () => jump(bm));
    const tm = document.createElement("span");
    tm.className = "rtime";
    tm.textContent = S.relTime(bm.createdAt);
    const rm = document.createElement("button");
    rm.className = "rremove";
    rm.textContent = "✕";
    rm.title = "Remove this bookmark";
    rm.setAttribute("aria-label", "Remove bookmark: " + (bm.snippet || "").slice(0, 80));
    rm.addEventListener("click", (e) => { e.stopPropagation(); removeOne(bm); });
    if (bm.status === "orphaned") {
      const chip = document.createElement("span");
      chip.className = "chip warn";
      chip.textContent = "moved";
      li.append(dot, tx, chip, tm, rm);
    } else {
      li.append(dot, tx, tm, rm);
    }
    return li;
  }

  async function jump(bm) {
    const settings = await S.getSettings().catch(() => ({ openJumpIn: "current" }));
    const targetUrl = bm.url + "#linemarks=" + bm.id;
    if (!tab || tab.url === bm.url || settings.openJumpIn === "current") {
      try {
        if (tab && tab.id != null && tab.url && tab.url.split("#")[0] === bm.url.split("#")[0]) {
          await B().tabs.sendMessage(tab.id, { type: "LINEMARKS_JUMP", anchor: bm.anchor, color: bm.color });
          window.close();
          return;
        }
      } catch {}
    }
    if (settings.openJumpIn === "current" && tab && tab.id != null) {
      await B().tabs.update(tab.id, { url: targetUrl });
    } else {
      await B().tabs.create({ url: targetUrl });
    }
    window.close();
  }

  async function refresh() {
    const [t] = await B().tabs.query({ active: true, currentWindow: true });
    tab = t || null;
    const settings = await S.getSettings().catch(() => S.DEFAULT_SETTINGS);
    renderColors(settings.defaultColor || "yellow");
    if (!tab || !tab.url) {
      $("pageTitle").textContent = "LineMarks";
      return;
    }
    try {
      const u = new URL(tab.url);
      $("pageTitle").textContent = tab.title || u.hostname;
      $("pageDomain").textContent = u.hostname;
    } catch {
      $("pageTitle").textContent = tab.title || "LineMarks";
    }
    const canon = tab.url.split("#")[0];
    const all = await S.loadAll().catch(() => []);
    const onPage = all.filter((b) => b.url === tab.url || b.canonicalUrl === canon || (b.url || "").split("#")[0] === canon)
      .sort((a, b) => b.createdAt - a.createdAt);
    $("resumeBtn").hidden = onPage.length === 0;
    const rl = $("recentList");
    rl.replaceChildren();
    if (!onPage.length) {
      const li = document.createElement("li");
      li.className = "empty";
      li.textContent = "No saves on this page yet — select text and save.";
      rl.appendChild(li);
    } else {
      onPage.slice(0, 10).forEach((b) => rl.appendChild(rowHtml(b)));
    }
    const ll = $("latestList");
    ll.replaceChildren();
    all.sort((a, b) => b.createdAt - a.createdAt).slice(0, 5).forEach((b) => ll.appendChild(rowHtml(b)));
  }

  async function doSave() {
    status("");
    const note = $("noteInput").value.slice(0, 2000);
    if (!tab || tab.id == null) { status("No active tab.", true); return; }
    try {
      const res = await B().tabs.sendMessage(tab.id, { type: "LINEMARKS_SAVE_SELECTION", color: picked, note });
      if (res && res.ok) {
        lastSavedId = res.id;
        const btn = $("saveBtn");
        btn.textContent = "Saved ✓ (Undo)";
        btn.onclick = async () => {
          if (lastSavedId) { await S.removeBookmark(lastSavedId); lastSavedId = null; }
          btn.textContent = "💾 Save this line";
          btn.onclick = doSave;
          await refresh();
        };
        clearTimeout(undoTimer);
        undoTimer = setTimeout(() => {
          btn.textContent = "💾 Save this line";
          btn.onclick = doSave;
          lastSavedId = null;
        }, 8000);
        $("noteInput").value = "";
        await refresh();
      } else {
        status("Nothing to save on this page.", true);
      }
    } catch (e) {
      status("Can't save here (page blocks extensions).", true);
    }
  }

  document.addEventListener("DOMContentLoaded", () => {
    $("saveBtn").onclick = doSave;
    $("noteInput").addEventListener("keydown", (e) => { if (e.key === "Enter") doSave(); });
    $("resumeBtn").addEventListener("click", async () => {
      try { await B().tabs.sendMessage(tab.id, { type: "LINEMARKS_RESUME" }); window.close(); }
      catch { status("Couldn't resume on this page.", true); }
    });
    $("libraryBtn").addEventListener("click", async () => {
      const url = B().runtime.getURL("src/dashboard/dashboard.html");
      await B().tabs.create({ url });
      window.close();
    });
    refresh().catch((e) => status(String(e && e.message || e), true));
  });
})();
