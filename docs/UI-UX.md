# UI/UX — wireframe description (browser-page-bookmark)

Three views, one action model. Every save/edit/delete path funnels through the
same storage + anchoring code; views differ only in presentation.

## View 1 — Popup quick-save (320px, `popup.html`)

```
+----------------------------------+
| ● Page title (ellipsis, 1 line)  |
|   domain.com                     |
+----------------------------------+
| [ 💾 Save this line      ]       |
|   Select text, or saves viewport |
|   center line                    |
| Colors: (y)(g)(b)(p)(o)          |
| Note: [ Add a note...        ]   |
+----------------------------------+
| [ ▶ Resume last ]  [ Library → ] |
+----------------------------------+
```

- Fixed 320px wide, ~420px tall; opens instantly from cache.
- "Save this line": primary button; saves selection if present else
  viewport-center line; success swaps button to "Saved ✓" + Undo (8s).
- Color row: 5 radio dots with names (not color-only) for a11y.
- Note: single-line input, Enter saves with bookmark.
- Footer: "Resume last" (hidden when no saves for URL) jumps to latest anchor;
  "Library →" opens dashboard.
- Edge states: orphan chip ("Original line moved — Jump shows saved quote");
  error toast on quota/import failure.

## View 2 — Dashboard library (full page, `dashboard.html`)

```
+------------------------------------------------------+
| 🔖 LineMarks   [ / Search...            ] ⚙ 🌙      |
| Filters: [Domain ▾][Color ▾][Tag ▾][Status][Date]    |
| Sort: (Recent ▾)   12 of 48    [Export][Import]      |
+------------------------------------------------------+
| ▼ domain.com (3 pages)                    12 saves   |
|   ▸ Page title — /some/article     4 saves · 2h ago |
|     ● snippet line clamp (2 lines)…  [Jump][Edit]…   |
|       #tag1 #tag2 · note preview · "moved" chip?     |
|     ○ snippet…                                       |
|   ▸ Another page…                                    |
| ▼ other.org (1 page)                       2 saves   |
+------------------------------------------------------+
```

- Header: brand, search (`/` focuses, debounced 150ms), filter bar (composable
  domain/color/tag/status/date), sort, Export/Import, theme toggle.
- Body: domain groups (collapsible, sticky headers) → page groups → rows.
- Row anatomy-US (left→right): color dot+label, snippet (2-line clamp),
  title/URL small gray ellipsis, tag chips, note preview (1 line), relative
  time, overflow actions Jump / Edit (inline form: color+note+tags) /
  Copy quote / Delete (undo toast).
- Orphan row: amber "moved/removed" chip + saved quote block + [Re-anchor]
  (binds current selection) and [Delete].
- Empty states: full-empty onboarding card (3 save ways); no-match card with
  "Clear search" button; per-group counts always visible.
- Responsive: single column <640px; actions collapse to a `⋯` menu; 44px
  targets on touch. Dark mode via `prefers-color-scheme` + manual override.

## View 3 — Inline toolbar (content script, in-page)

```
   Selected text ............
  +--------------------------+
  | [Save] (y)(g)(b)(p)(o) ✎ |
  +--------------------------+
        ...rest of page...
  [Toast bottom-right: Saved ✓ (Undo)]
```

- Appears above/below a non-collapsed text selection (clamped to viewport);
  buttons: Save, 5 mini color dots, note pencil (expands 1-line input).
- Behavior: Esc / click-away / scroll dismisses; never steals selection;
  `pointer-events` confined to the toolbar; `z-index` above page chrome;
  `prefers-reduced-motion` respected for toast/flash.
- Restore flash: target lines pulse 3× over ~1.2s with color outline, then
  settle to the steady highlight; keyboard focus moves to the anchor region
  with an `aria-label` ("Bookmarked line: <snippet>").

## Cross-view rules

- One code path per action (save/jump/edit/delete/import/export); views are
  thin renderers over `storage.local` + anchor resolver.
- Every destructive action confirms or undoes (delete → 8s undo toast;
  bulk domain delete → confirm dialog).
- All text user-generated content rendered as text (no raw HTML injection).
