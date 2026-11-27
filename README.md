# LineMarks — Line Bookmarks for Pages

Save the exact line you stopped at on any page. Auto-resume on revisit
(scroll + flash), highlight it, manage everything from a dashboard.

Vanilla MV3, no build: the extension runs unpacked straight from this repo.

## Load unpacked (dev)

**Chrome / Edge (MV3):**
1. Open `chrome://extensions` (or `edge://extensions`), enable **Developer mode**.
2. **Load unpacked** → select this folder (the one containing `manifest.json`).
3. Pin LineMarks, then right-click a selection → **Bookmark this line**,
   or press `Alt+Shift+B`, or select text and hit **Save** in the inline toolbar.

**Firefox (MV3):**
1. Open `about:debugging#/runtime/this-firefox` → **Load Temporary Add-on**.
2. Pick `manifest.json` (the `gecko.id` is already set for packaging).
3. Same flows as above. Permanent install needs signing (`npm run build` + `web-ext sign`).

**Safari:** requires the Xcode `safari-web-extension-converter` + App Store
distribution; background page behavior preferred over the service worker
(WebKit bug 270750). Smoke-test on Safari 26.x + iOS.

## Features

- 3 save entries: context menu, `Alt+Shift+B` shortcut, inline selection toolbar
- Hybrid anchor (quote + TextPosition + XPath range, W3C annotation style);
  restore order XPath→position→quote→fuzzy→orphan (never guesses)
- CSS Custom Highlight API with `<mark>` fallback; scroll + 3-pulse flash
- Auto-resume latest per URL (MutationObserver rescan for lazy/SPAs);
  badge count per page; `#linemarks=<id>` deep-link jump
- 5 colors, notes (≤2000 chars), tags (≤10, lowercase), edit in place
- Dashboard: search (150ms debounce), domain/color/tag/status/date filters,
  recent/oldest/A–Z sort, grouped domain→page→rows, copy quote, re-anchor hint
- Delete + undo toast (8s); page/domain bulk delete with confirm
- Export/import JSON `{ version, bookmarks }` with validation + `id` dedupe
- Settings (theme/sort/default color/auto-scroll, `storage.sync` + fallback)

## Project layout

```
manifest.json                 MV3 (action popup, content_scripts, SW, dashboard)
src/lib/anchor.js             hybrid anchor serialize/resolve (shared, no modules)
src/lib/storage.js            browser.* w/ chrome fallback, schema v1, CRUD/search/export
src/content.js                toolbar, highlight, restore, hash jump, messages
src/content-highlight.css     injected highlight/toolbar/toast styles
src/background.js             context menu, shortcut, badges, resume support
src/popup/                    quick save + recent 10 + continue reading
src/dashboard/                full library UI
src/styles.css                shared decluttered theme (+dark mode)
icons/icon-*.svg              placeholder icons (replace before store release)
scripts/build-zip.js          reproducible zip builder
```

## Scripts

- `npm run lint` — `node --check` all JS + manifest parse (+ `web-ext lint` if available)
- `npm run build` — reproducible `dist/linemarks-chromium.zip` (`zip -X`, sorted)
- `npm run package` — alias of build

**Firefox artifact:** `npx web-ext build --source-dir . --ignore-files 'node_modules/**' 'docs/**'` —
keep `browser_specific_settings.gecko.id`. **Unlisted signing:**
`npx web-ext sign --api-key $AMO_JWT_ISSUER --api-secret $AMO_JWT_SECRET`.

## Permissions (one-line justifications)

| Permission | Why |
|---|---|
| `storage` | On-device bookmark bodies + tiny prefs (local-first, no server) |
| `contextMenus` | "Bookmark this line" on selection/page |
| `scripting` | Retry injection on pages where the content script isn't loaded |
| `activeTab` | Save/resume in the tab the user invoked us on |
| `alarms` | Daily housekeeping tick (no `setInterval` in SW) |
| `http(s)://*/*` hosts | Run content scripts to anchor/highlight saved lines |

## Privacy

Local-first: all page data stays in `storage.local` on-device. No analytics,
no remote code, no third-party requests. Import/export is explicit user action
with schema validation. Delete anytime from popup/dashboard.
