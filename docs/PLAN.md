# PLAN — browser-page-bookmark

## 0. Goal

A cross-browser MV3 extension that remembers **the exact line you stopped at**
on any page, restores it on revisit (scroll + flash), and manages all saves in
a small, fast 3-view UI: **popup quick-save / dashboard library / inline
toolbar**.

## 1. MVP feature list

### 1.1 Save a line (3 entry points)
- **F1 — Context menu:** right-click a selection (or page) → "Bookmark this
  line". Works without opening the popup. Saves hybrid anchor (§4 of
  AGENTS.md) + snippet + title/domain/favicon + timestamp.
- **F2 — Keyboard shortcut:** `Alt+Shift+B` (configurable via
  `commands` API) saves the current selection, else the first visible line at
  the viewport center. Shows a transient "Saved ✓" toast in-page.
- **F3 — Selection popup:** selecting text shows a small inline toolbar near
  the selection: [Save] [color dot] [note]. Dismisses on Esc / click-away /
  scroll; never blocks text selection or page clicks.

### 1.2 Auto-resume last-read per URL
- **F4 — Revisit restore:** opening a URL with a bookmark auto-scrolls to the
  most recent anchor (`scrollIntoView({block:"center"})` + ~1.2s highlight
  flash) after DOM settles; debounced `MutationObserver` rescan covers lazy
  content. Honor a "Don't auto-scroll, just badge" setting.
- **F5 — Continue-reading badge:** toolbar icon shows a dot/count when the
  current page has saves; clicking jumps to the latest one.

### 1.3 Highlight colors
- **F6 — 5 colors:** yellow (default), green, blue, pink, orange. Color is set
  at save time (selection popup dot / popup swatch) and editable later.
  Render via CSS Custom Highlight API with `<mark>` fallback (§4 AGENTS.md).

### 1.4 Notes & tags
- **F7 — Note per bookmark:** one free-text note (plain text, ≤2000 chars),
  editable inline in dashboard and popup ("Add note" field).
- **F8 — Tags:** lowercase, max 10 per bookmark; autocomplete from existing
  tags; filterable in dashboard.

### 1.5 Dashboard: continue-reading list
- **F9 — Grouped list:** groups by page (title + URL), collapsible under
  domain headers. Sort: most-recent default; also A–Z domain, oldest.
- **F10 — Row actions:** jump-to-line, edit (color/note/tags), delete
  (with undo toast ~8s), copy quote.
- **F11 — Orphan rows:** anchors that no longer resolve stay listed with a
  "moved/removed" chip + saved quote visible; user can re-anchor (re-save at
  current selection) or delete.

### 1.6 Search / filter
- **F12 — Search:** substring over title, URL, snippet, note, tags
  (debounced, ~150ms). Empty-query shows full list.
- **F13 — Filters:** by domain (dropdown), color, tag, status
  (anchored/orphaned), date range (today/week/month). Filters compose with
  search; result count shown ("12 of 48").

### 1.7 Jump-to-line
- **F14 — Jump:** clicking a row (or popup "Resume") opens the page (new or
  existing tab per setting) → resolves anchor → scroll + flash. Failure lands
  on the page top with a "couldn't find the line — showing saved quote" notice
  and the orphan chip set.

### 1.8 Edit / delete
- **F15 — Edit:** color, note, tags editable in place; `updatedAt` bumped;
  anchor itself is immutable (re-save to move it).
- **F16 — Delete:** single delete + "delete all for this page/domain" with
  confirm; global undo toast for 8s after any delete.

### 1.9 Import / export JSON
- **F17 — Export:** one JSON file (`{ version: 1, bookmarks: [...] }`),
  download via dashboard button. Import validates schema version, runs
  migrations, skips/reports invalid rows, never duplicates on `id`.

## 2. Extensible (post-MVP, in priority order)

1. **E1 — Sync:** opt-in `storage.sync`-backed prefs now; full bookmark sync
   later (own backend or `chrome.storage.sync` sharding within quota, or
   `identity`-gated cloud). Must stay local-first by default.
2. **E2 — Full-text snippets:** longer captured context (configurable
   500→2000 chars) + snippet search ranking.
3. **E3 — Keyboard-first:** `j/k` navigate rows, `Enter` jump, `e` edit,
   `d` delete, `/` focus search, `1–5` set color; visible shortcut cheatsheet.
4. **E4 — Dark mode:** follows `prefers-color-scheme` + manual toggle stored
   in sync prefs; highlight colors stay legible in both.
5. **E5 — Decluttered 3-view UI (already the IA; polish here):**
   popup = quick-save only; dashboard = library management; inline toolbar =
   in-page save/annotate. No feature may live in two views with divergent
   behavior — one code path per action.

## 3. UI/UX spec

### 3.1 Popup (320px, action-first)
- Size 320×~420, opens in <100ms with cached data. Top: page title (1-line
  ellipsis) + domain. Middle: "Save this line" button (saves viewport-center
  line when no selection), color swatch row (5), note input (1-line, expands).
  Bottom: "Resume last" (if saves exist for this URL) + "Open library" link.
- States: no-selection hint ("Select text or save current position"),
  saved-confirmation (checkmark + Undo), orphan warning chip.

### 3.2 Dashboard (full page `dashboard.html`)
- Header: logo, search box (`/` focuses), filter bar (domain/color/tag/status/
  date), sort select, Export/Import buttons, dark-mode toggle.
- Body: domain groups → page groups → rows. Row: color dot, snippet (2-line
  clamp), title+URL (small, ellipsis), tags chips, note preview, timestamps
  (relative), actions (Jump/Edit/Delete/Copy). Sticky group headers.
- Performance: virtualize or paginate past ~500 rows; debounced search;
  batched anchor re-resolution off the critical path.

### 3.3 Content highlight style
- Custom Highlight API `::highlight(bookmark-yellow|...)` + `<mark>` fallback
  classes. Colors pass WCAG AA for text contrast in light+dark; flash animation
  = 3 pulses over ~1.2s, `prefers-reduced-motion` disables pulse (static
  outline instead). Highlights never capture clicks (`pointer-events: none`
  except the inline toolbar).

### 3.4 Empty states
- No bookmarks at all: friendly illustration + "Save your first line" with
  the 3 ways (right-click / shortcut / select text).
- No results for search/filter: "No matches — clear search" button.
- Page with no saves (popup): save CTA, not an error.

### 3.5 Accessibility (a11y)
- All actions keyboard-reachable with visible focus rings; toolbar/popup trap
  focus while open, Esc closes, focus returns to invoker.
- Highlights expose `aria-label` ("Bookmarked line: <snippet>"); flash is
  motion-safe; color is never the only signal (color dot + text label).
- Contrast AA, minimum 12px font in content UI, 44px touch targets on mobile
  Safari.

## 4. Milestones

- **M1 — Save + restore:** F1–F5, F14, hybrid anchor + Highlight API +
  `<mark>` fallback. Exit: save on 3 entry points, revisit scrolls+flashes.
- **M2 — Library:** F6–F13, F15–F16, dashboard + popup per §3. Exit: full
  CRUD, search/filter, colors/notes/tags.
- **M3 — Hardening:** F17, orphan states, MutationObserver rescan, a11y pass,
  vitest+playwright green, `web-ext lint` clean. Exit: store-ready zips.
- **M4 — Stores:** CWS + AMO + Edge submissions with reviewer guides.
- **Post-MVP:** E1–E5 in order.

## 5. Non-goals (MVP)

No accounts, no cloud sync, no collaboration/sharing, no PDF support, no
mobile-app companion, no AI summarization, no analytics.
