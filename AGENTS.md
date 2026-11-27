# AGENTS.md — browser-page-bookmark

> Line-level page bookmarks: save the exact line you stopped at on any page,
> auto-resume it on revisit, highlight it, and manage everything from a dashboard.

## 1. Stack

- **Runtime:** Vanilla JS (ES2022, no framework) + `webextension-polyfill`
  (`mozilla/webextension-polyfill`). Code to the promise-based `browser.*`
  namespace everywhere; the polyfill is a documented no-op on Chrome 148+.
- **Manifest:** Manifest V3 (MV3) only. Chrome/Edge are MV3-only
  (MV2 disabled July 2025, store removal Aug 31 2026); Firefox supports MV3
  (and keeps MV2 alive); Safari supports an MV3 subset. Never use MV2-only
  APIs (e.g. blocking `webRequest`); use `declarativeNetRequest` if needed.
- **Build:** Plain files (no bundler) by default. A Vite build is allowed but
  optional — if added, keep `manifest.json` at the zip root and keep a clean
  reproducible build (`npm ci && npm run build`) because AMO requires
  unobfuscated-source disclosure for bundled/minified code.
- **Lint/format:** `eslint` + `prettier`, plus `web-ext lint` as a required
  gate before every store submission.
- **Tests:** `vitest` (unit: anchoring, storage schema, migrations),
  `playwright` (popup/dashboard/content-script flows),
  `web-ext` (lint + `web-ext sign` for AMO unlisted/self-distributed channel).
- **Minimum versions:** new code targets `minimum_chrome_version: 148`
  (native `browser.*`), Edge 136+, Opera 121+, Firefox ESR-current,
  Safari 16.1+ (Text Fragments floor) / test on Safari 26.x + iOS.

## 2. Cross-browser shims

- Always call async extension APIs via `browser.*` (promises). For back-compat
  with Chrome ≤147, use the guard `globalThis.browser ?? chrome` or keep the
  polyfill; never mix callback-style `chrome.*` and `browser.*` in one file.
- **Background:** write a stateless, event-driven background script. Chrome/Edge
  require an MV3 service worker (ephemeral: no globals, no DOM, ~30s idle
  eviction, ~5-min max per event). Firefox also accepts background
  pages/scripts (persistent). Safari supports both `scripts`/`page` and
  `service_worker` but prefers a **non-persistent background page** — its
  service worker often never starts (WebKit bug 270750, incl. Safari 26.5.2).
  Rules: register listeners at top level, persist eagerly to
  `storage.local`, rehydrate per event, use `chrome.alarms` instead of
  `setInterval`, and keep `sidePanel` (Chrome) vs `sidebarAction` (Firefox)
  branches behind a feature check.
- **Safari packaging:** Safari requires the Xcode
  `safari-web-extension-converter` + App Store distribution. Expect tighter
  storage/background limits; smoke-test on Safari 26.x and iOS.
- **Side effects:** `webextension-polyfill` is a no-op on Chrome 148+, so
  shipping it costs nothing on modern Chrome while fixing older browsers.

## 3. Permissions policy

- Least privilege, single narrow purpose ("remember where you stopped
  reading"). Prefer `activeTab` over `tabs`/`<all_urls>`; use narrow
  `host_permissions` only where content scripts must run without an explicit
  user gesture, otherwise inject via `activeTab` + `scripting`.
- Every permission must have a one-line justification recorded in the store
  listing AND in reviewer notes. Remove unused permissions before release;
  `<all_urls>` triggers extra AMO scrutiny.
- Allowed baseline: `storage`, `contextMenus`, `alarms`, `scripting`,
  `activeTab`. `unlimitedStorage` only if corpora outgrow the 10 MB
  `storage.local` cap. `identity`/remote hosts: only for the sync milestone,
  behind `optional_permissions` requested at runtime.
- Never: remote code execution, `eval`/remote scripts, obfuscated builds,
  analytics without opt-in.

## 4. Anchoring convention (layered W3C selectors)

Never store bare line numbers or live DOM node refs — they break on reflow,
ad injection, or framework re-render. Each bookmark stores a **hybrid
anchor**:

```js
anchor = {
  quote:      { exact, prefix /* ~32–64 chars */, suffix },
  position:   { start, end },          // TextPositionSelector over normalized body text
  range:      { startXPath, endXPath, startOffset, endOffset }, // RangeSelector
  url, canonicalUrl, contentHash, createdAt
}
```

- Model: W3C Web Annotation Data Model (`TextQuoteSelector`,
  `TextPositionSelector`, `RangeSelector`/`XPathSelector`); reference pattern:
  Hypothesis / `@apache-annotator/dom` (3 selectors per annotation).
- Restore order: (1) XPath range **with quote-equality check** → (2) TextPosition
  with equality check → (3) exact quote+context search → (4) fuzzy quote search
  (Bitap/Myers-diff, threshold TBD by prototype) → else **orphan**: keep the
  bookmark listed with a "moved/removed" state; never guess.
- Render with the **CSS Custom Highlight API** (`CSS.highlights` +
  `::highlight()`) so highlights don't mutate the DOM; fall back to
  `<mark>`-wrapping (rangy `ClassApplier`/serialize pattern) on older browsers.
- Scroll-restore: `Range → scrollIntoView({ block: "center" })` + flash; prefer
  native URL Text Fragments (`#:~:text=`) where available (Chrome 80+,
  Safari 16.1+, Firefox 131+).
- Dynamic pages: re-run anchoring after DOM settles; debounced
  `MutationObserver` rescan for lazy content; anchor against
  Readability-cleaned text when a decluttered view is active.

## 5. Storage schema (`storage.local` first)

- `storage.local` (~10 MB default, 5 MB pre-Chrome-113; `unlimitedStorage`
  lifts the cap, no warning) holds all bookmark/highlight bodies. Large corpora
  graduate to IndexedDB; never put bodies in `storage.sync`.
- `storage.sync` (100 KB total / 8 KB per item / 512 items / 120 writes-min +
  1800/hr, requires sign-in) holds **tiny prefs only** (theme, default color,
  sort order) with try/catch quota fallback + debounced/batched writes.
- Schema (v1):

```js
// key: "bookmarks/v1" -> Bookmark[]
Bookmark = {
  id,                 // crypto.randomUUID()
  url, canonicalUrl, title, domain, favicon?,
  anchor,             // §4 hybrid anchor
  snippet,            // short plain-text excerpt for list/search (cap ~500 chars)
  color,              // highlight color id
  note?, tags?: string[],
  createdAt, updatedAt, lastVisitedAt,
  status: "anchored" | "orphaned",
  visits?: number
}
Settings = { theme, defaultColor, sort, declutterDefault } // sync, tiny
```

- Migrations: bump `SCHEMA_VERSION`, run a pure `migrate(old) -> new`
  function covered by a vitest; never lose user data on upgrade.
- Service worker is stateless: persist eagerly, rehydrate per event; transient
  state goes to `storage.session`.

## 6. Testing

- `vitest`: anchor equality/fuzzy fallback, orphan detection, storage
  migrations, import/export round-trip, quota-fallback paths.
- `playwright`: popup quick-save flow, dashboard search/filter/jump,
  content-script highlight + scroll + flash, empty states, orphan row.
- `web-ext lint` on every PR; `web-ext build` for the Firefox artifact;
  `web-ext sign` (JWT `AMO_JWT_ISSUER`/`AMO_JWT_SECRET`) for unlisted builds.
- Manual matrix before release: Chrome, Edge, Firefox (Release), Safari 26.x
  desktop + iOS, one JS-heavy SPA (reflow/orphan behavior).

## 7. Packaging / deploy per store

- One source tree → reproducible per-store zips (`zip -X`, exclude
  `node_modules/.git`): Chrome/Edge share the Chromium MV3 zip (strip
  top-level `key` and `update_url` for Edge); Firefox zip keeps
  `browser_specific_settings.gecko.id`; Safari via Xcode converter.
- **Chrome Web Store:** MV3-only, `manifest.json` at archive root, $5
  one-time dev fee, 2SV, listing + Privacy practices + Distribution tabs;
  review takes days–weeks (up-to-30-day publish deferral available). No
  obfuscation (plain minification OK), no remote code, per-data-type privacy
  disclosure (storage counts as user data → privacy policy URL required),
  per-permission justification, test-account/instructions to speed review.
- **AMO (Firefox):** mandatory Mozilla signing; `gecko.id` required for MV3;
  listed (public) vs unlisted/self-distributed (`web-ext sign`); manual review
  ~1–7 days; submit build sources separately when bundling/minifying;
  `<all_urls>` gets extra scrutiny.
- **Edge Add-ons:** Partner Center submission; 300×300 logo + screenshots
  (1280×800 and/or 640×480); certification up to ~7 business days;
  per-permission justification + privacy policy + remote-code declaration.
  (Registration-fee docs conflict — free vs legacy $19 — verify at enroll.)
- CI keeps per-store manifest tweaks + reviewer guide (`npm ci` + build steps)
  so minified `dist/` is reproducible; attach reviewer test instructions to
  every submission.

## 8. Security / privacy rules

- Local-first: all page data stays in `storage.local`/IndexedDB on-device. No
  analytics, no remote code, no third-party requests in MVP. Sync (if built)
  is opt-in, end-to-end documented, behind `optional_permissions`.
- Content scripts run with least privilege; never `eval()` page content;
  escape `snippet`/`note` on render (textContent, never innerHTML of user data).
- Import/export JSON is explicit user action only; validate schema on import,
  reject oversized/foreign payloads with a clear error, never auto-import.
- Privacy policy: disclose stored data types (URLs, quotes, notes), retention
  (until user deletes), and that storage counts as user data in CWS/AMO forms.
- Secrets (AMO JWT) live only in CI secrets, never in the repo; never read or
  print `.env` contents.
