# TGRMLither UI & Workflow Redesign Roadmap

**Scope:** durable interface architecture for an everyday local-first graphics workstation.  
**Baseline:** main at 0e55d2be78c98d04bf6cb5cd120c5f6125ce439d (2026-11-27).  
**Delivery rule:** work on feature branches; merge only after the browser matrix and visual review pass.

## Product principles

1. **Protect the user's work.** UI changes must not rewrite project formats, workspace settings, presets, palettes, backups or rendering behavior unless a migration is explicitly designed and tested.
2. **No surprise regressions.** Preserve Canvas/Worker rendering, the main-thread fallback, bounded resource handling, offline/PWA behavior and the standalone HTML export.
3. **Local-first by default.** Do not add analytics, accounts, remote processing or runtime dependencies for interface improvements.
4. **One obvious place for each task.** Primary actions stay visible; specialist controls remain contextual; duplicate controls must explain their specific scope rather than silently compete.
5. **Responsive is a product requirement.** Phone, tablet and desktop layouts are all first-class; touch targets, keyboard use and readable labels are tested continuously.
6. **Measure before consolidating.** Do not flatten or extract the legacy stylesheet until a reviewed screenshot baseline exists. CSS order is part of the current visual behavior.

## Stage 0 — Baseline and regression guardrails

**Status: implemented in this branch; screenshot review remains a human checkpoint.**

- Record the current UI across Editor, Presets, Shape Lab, Script Slayer, Batch and Video Lab.
- Exercise 320, 360, 390, 430, 768, 1024, 1280 and 1440 px viewport widths.
- Assert page width, primary upload action bounds, header overlap, inspector visibility and workspace switching.
- Capture workspace and inspector screenshots as GitHub Actions artifacts for review.
- Keep existing Chromium smoke tests and Chromium/Firefox/WebKit compatibility tests.

**Important boundary:** these screenshots are audit captures, not yet pixel-diff golden snapshots. Do not promote screenshots to golden baselines until they have been visually reviewed on the intended browsers; otherwise a broken layout could be blessed as correct.

**Acceptance:** no uncaught browser errors, no unexpected horizontal overflow, responsive assertions pass, screenshot artifact is available on every PR run.

## Stage 1 — CSS and component foundation

**Status: local CSS assets extracted byte-for-byte in original cascade order; selector/responsive consolidation remains staged.**

- Split the ordered CSS layers into local assets (base, XP shell, action priority, Animation Studio, and UI foundation) without changing declaration order. The XP theme link retains its id/media behavior.
- Add shared UI primitives for control sizing, sticky offsets, focus behavior, scroll targets and visually-hidden labels.
- Add a compact, contextual inspector jump bar so long Shape Lab and Script Slayer sections are navigable without changing control state.
- Keep all current theme and shell tokens intact.
- The CSS declarations and cascade order are preserved byte-for-byte; only the asset boundaries changed. The base sheet still contains accumulated responsive overrides that need a separate, screenshot-guided cleanup.
- Keep consolidating CSS into a documented order — tokens, reset/base, layout, shared components, workspace components, shell themes, responsive rules — one cascade group at a time. Compare screenshots after each group; never change declaration order casually. The standalone HTML bundler must inline every marked local stylesheet, and the PWA must precache them.

**Acceptance:** no functional control changes; all theme/shell choices remain selectable; no visual drift in reviewed screenshots; standalone HTML export contains all required styling.

## Stage 2 — Header, inspector and workspace ergonomics

**Status: foundational navigation and inspector/export ergonomics implemented; source-aware preset previews and deeper header restructuring remain.**

- Keep image loading as a prominent primary action and group secondary actions by frequency.
- Use contextual quick navigation for long inspector panels.
- Collapse specialist Shape Lab threshold/band/preset groups and Neo Glow detail controls behind native, keyboard-operable disclosures. Keep the Neo Glow master switch visible.
- Keep common PNG/JPEG/project shortcuts in the Inspector, put SVG/CMYK/print parameters in an advanced disclosure, and separate procedural motion from static export actions.
- Separate common controls from advanced controls without changing the saved settings model.
- Make section resets explicit and scoped; the current workspace reset must never be labelled as a group-only reset.
- Replace synthetic-only preset cards with source-aware previews in a later pass. Previews must be rendered off the main interaction path and cached with strict memory limits.
- Continue comparing all six workspaces, not just Editor.

**Acceptance:** frequent actions remain reachable in one or two steps, no hidden destructive action, settings persist identically before/after navigation, no mobile clipping.

## Stage 3 — Animation and export workflow coherence

**Status: audit findings documented; consolidation not yet attempted.**

- Keep Animation Studio as the central keyframe editor for Editor, Shape Lab and Script Slayer.
- Distinguish the specialized Script Slayer Neo Glow sweep from general parameter animation.
- Keep Video Lab's source-video timeline separate until it has a well-defined per-video keyframe model.
- Bring static image, vector, print, project and animation outputs under one export information architecture. Quick PNG/JPEG actions may remain, but the export center must be authoritative.
- Do not remove legacy motion controls until an equivalent workflow and regression test exist.

**Acceptance:** one clear export decision point, accurate codec capability messaging, deterministic export, cancellation and cleanup, unchanged project compatibility.

## Stage 4 — Accessibility, reliability and release discipline

**Status: dialog semantics, visible labels, focus trap/restore and inspector keyboard navigation implemented in this branch.**

- Every modal must have dialog semantics, a programmatic name, initial focus, focus containment, Escape behavior and focus restoration.
- Every form field must have a label or an accessible name; don't rely on placeholder text.
- Test keyboard-only use, reduced-motion settings, touch target size and custom-theme contrast.
- Add automated screenshot comparison only after reviewed reference images are committed.
- Keep browser compatibility coverage on Chromium, Firefox and WebKit and add new rendering tests only when they are deterministic across engines.

**Acceptance:** no keyboard trap outside an active dialog, no lost focus after close, no unlabeled interactive field, no unbounded animation/export work and all CI suites green.

## Current implementation notes

- The main app remains a single-page HTML document with ordered inline CSS and JavaScript. saveStandalone() currently inlines animation-engine.js; any future extraction of CSS or scripts must update this path and PWA caching in the same change.
- Rendering stays in the existing Canvas/Worker architecture. This roadmap is an interface and QA program, not a renderer rewrite.
- Existing project JSON and workspace storage remain the source of truth. UI navigation and dialog improvements must not write new persistent keys.
- The next high-risk change is the stylesheet consolidation. It must start from the visual audit artifacts, not from assumptions about which override is redundant.
