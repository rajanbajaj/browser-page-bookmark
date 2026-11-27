/* LineMarks background service worker (MV3, stateless, event-driven).
 * Listeners registered at top level; persist eagerly; rehydrate per event.
 */
const B = (typeof browser !== "undefined" && browser.runtime) ? browser : chrome;
const isChrome = !!(typeof chrome !== "undefined" && chrome.runtime && !((typeof browser !== "undefined") && browser.runtime && browser.runtime.getBrowserInfo));

const MENU_SAVE = "linemarks-save-line";
const ANCHOR_LIB = "../lib/anchor.js";
const STORAGE_LIB = "../lib/storage.js";

async function storage() {
  // Service worker cannot rely on window globals from classic scripts; use
  // storage API directly here.
  return B.storage;
}

function domainOf(url) {
  try { return new URL(url).hostname; } catch { return ""; }
}

async function getRows() {
  const s = await storage();
  const got = await s.local.get("bookmarks/v1");
  const raw = got["bookmarks/v1"];
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.bookmarks || [];
  return list;
}

async function updateBadge(tabId, url) {
  try {
    if (!url || !/^https?:/.test(url)) {
      await B.action.setBadgeText({ text: "", tabId }).catch(() => {});
      return;
    }
    const rows = await getRows();
    const canon = url.split("#")[0];
    const n = rows.filter((b) => b.url === url || b.canonicalUrl === canon || b.url.split("#")[0] === canon).length;
    if (B.action && B.action.setBadgeText) {
      await B.action.setBadgeText({ text: n ? String(n) : "", tabId }).catch(() => {});
      await B.action.setBadgeBackgroundColor({ color: "#7048e8", tabId }).catch(() => {});
    }
  } catch { /* noop */ }
}

// ---------- install: context menu + alarm ----------
B.runtime.onInstalled.addListener(async () => {
  try {
    await B.contextMenus.removeAll();
    B.contextMenus.create({
      id: MENU_SAVE,
      title: "Bookmark this line",
      contexts: ["selection", "page"],
    });
  } catch { /* noop */ }
  try { B.alarms.create("linemarks-housekeeping", { periodInMinutes: 60 * 24 }); } catch {}
});

B.runtime.onStartup.addListener(async () => {
  try {
    await B.contextMenus.removeAll();
    B.contextMenus.create({ id: MENU_SAVE, title: "Bookmark this line", contexts: ["selection", "page"] });
  } catch { /* noop */ }
});

B.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== MENU_SAVE || !tab || tab.id == null) return;
  try {
    await B.tabs.sendMessage(tab.id, { type: "LINEMARKS_SAVE_SELECTION" });
    await updateBadge(tab.id, tab.url);
  } catch {
    // Content script not injected (e.g. chrome:// or not yet loaded): inject then retry.
    try {
      await B.scripting.executeScript({ target: { tabId: tab.id }, files: ["src/lib/anchor.js", "src/lib/storage.js", "src/content.js"] });
      await B.tabs.sendMessage(tab.id, { type: "LINEMARKS_SAVE_SELECTION" });
    } catch { /* page not scriptable */ }
  }
});

B.commands.onCommand.addListener(async (cmd, tab) => {
  if (cmd !== "save-line") return;
  const t = tab || (await B.tabs.query({ active: true, currentWindow: true }).catch(() => []))[0];
  if (!t || t.id == null) return;
  try {
    await B.tabs.sendMessage(t.id, { type: "LINEMARKS_SAVE_SELECTION" });
    await updateBadge(t.id, t.url);
  } catch {
    try {
      await B.scripting.executeScript({ target: { tabId: t.id }, files: ["src/lib/anchor.js", "src/lib/storage.js", "src/content.js"] });
      await B.tabs.sendMessage(t.id, { type: "LINEMARKS_SAVE_SELECTION" });
    } catch { /* noop */ }
  }
});

// Content script notifies us after save so the badge updates.
B.runtime.onMessage.addListener(async (msg, sender) => {
  if (msg && msg.type === "LINEMARKS_SAVED" && sender.tab && sender.tab.id != null) {
    await updateBadge(sender.tab.id, sender.tab.url || msg.url);
  }
  if (msg && msg.type === "LINEMARKS_OPEN_DASHBOARD") {
    const url = B.runtime.getURL("src/dashboard/dashboard.html") + (msg.hash || "");
    const openIn = msg.openIn || "new";
    if (openIn === "current" && sender.tab && sender.tab.id != null) {
      await B.tabs.update(sender.tab.id, { url });
    } else {
      await B.tabs.create({ url });
    }
    return { ok: true };
  }
  return undefined;
});

// Resume-on-visit: tell the tab to restore (content script also self-restores;
// this covers badge + late injection). Debounced by the content script itself.
B.tabs.onUpdated.addListener(async (tabId, change, tab) => {
  if (change.status !== "complete" || !tab.url || !/^https?:/.test(tab.url)) return;
  await updateBadge(tabId, tab.url);
});
B.tabs.onActivated.addListener(async ({ tabId }) => {
  try {
    const tab = await B.tabs.get(tabId);
    await updateBadge(tabId, tab.url);
  } catch { /* noop */ }
});

void isChrome;
void domainOf;
void ANCHOR_LIB;
void STORAGE_LIB;
