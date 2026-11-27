# CSS Architecture

TGRMLither keeps one coherent visual cascade, but the CSS is split into local assets so the application can evolve without repeatedly editing the main HTML document.

## Load order

The stylesheet links in `index.html` are ordered deliberately:

1. `styles/base.css` — baseline tokens, layout, shared controls and the long-standing responsive rules.
2. `styles/xp-shell.css` — Windows XP Luna shell. Its link keeps the stable DOM id `xpShellStyles` and starts with `media="not all"`; the shell selector in JavaScript switches this media value at runtime.
3. `styles/action-priority.css` — preview action grouping.
4. `styles/animation-studio.css` — timeline and animation controls.
5. `styles/ui-foundation.css` — newest shared UI primitives, including Inspector quick navigation, dialog sizing and collapsible specialist groups.

The extraction preserved the original declaration text and order. It is an asset-boundary change, not a selector rewrite or a redesign. Do not alphabetize links or combine/reorder rules without checking both shells and the full responsive matrix.

## Offline and portable guarantees

Each local stylesheet is listed in `sw.js` so the service worker precaches it. Advance the `tgrmlither-vN` cache when changing app-shell assets.

Links marked `data-standalone-inline` are special: `saveStandalone()` fetches each local CSS asset and replaces the link with an equivalent `<style>` block before downloading `TGRMLither-offline.html`. The element id and media attribute are retained, so the XP/Studio shell toggle keeps working in the standalone file.

When adding a stylesheet:

- Add its link in `index.html` at the correct cascade position.
- Mark it with `data-standalone-inline`.
- Add the path to the service-worker `ASSETS` list and advance the cache.
- Extend `tests/css-assets.test.cjs` and the standalone-download assertions in `tests/smoke.cjs`.
- Keep the no-network standalone path for app CSS; external web-font loading remains optional with local system-font fallbacks.

## Next refactor boundary

The base sheet still contains legacy responsive overrides accumulated over multiple releases. Consolidate those only in small, reviewed groups. First inspect the screenshot artifact for all six workspaces, both shells and small/touch viewports. Do not remove a seemingly redundant rule until computed layout and relevant interaction tests prove it is redundant.
