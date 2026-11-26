# TGRMLither 1.4 — Animation Studio & Dither Boy Capability Plan

## Goal

Turn TGRMLither from a still-image dithering editor with isolated short animations into a local-first graphics studio with reusable keyframe animation, temporal modulation, and production-ready sequence/video export. Preserve the existing renderer, workspaces, project format compatibility, Worker fallback, portable launcher, and offline PWA behaviour.

## Baseline

- Main baseline: 1.3.13 (commit `1ba5ae417e47d5c35482d8fd384324d9e3c532c0`).
- Existing capabilities retained: still-image algorithms and effect stacks, Shape Lab, Script Slayer, Batch, Video Lab, WebM recording, SVG/CMYK export, project JSON, local palettes and PWA.
- No proprietary Dither Boy code or assets are copied. The comparison uses the vendor's published feature descriptions only.

## Implementation stages

### Stage 0 — Baseline and compatibility guardrails
1. Keep all existing smoke and cross-browser tests green.
2. Keep new functionality local-only; do not introduce a backend, account, analytics, or third-party runtime dependency.
3. Put new animation primitives in a separate, testable `animation-engine.js` module.
4. Keep old project files importable and make all new project fields optional.

Acceptance: JavaScript syntax checks, existing Chromium/Firefox/WebKit tests, offline service-worker cache validation.

### Stage 1 — Universal animation model
1. Add a versioned animation clip with duration, FPS, loop flag and independent parameter tracks.
2. Support numeric, boolean and enumerated/string settings, including nested effect strengths, algorithm-layer opacity, and Shape Lab band controls.
3. Implement keyframe upsert/removal, deterministic interpolation and Linear / Ease In / Ease Out / Ease In-Out / Hold curves.
4. Add per-track temporal oscillators (sine, triangle, saw and square) with bounded frequency and amplitude.
5. Reject unsafe paths, malformed values, excessive track counts and excessive keyframe counts on import.

Acceptance: deterministic unit tests for interpolation, easing, discrete tracks, oscillator output, malformed imports and limits.

### Stage 2 — Timeline UI and persistence
1. Add a responsive timeline dock to Editor, Shape Lab and Script Slayer.
2. Add track picker, keyframe capture/removal, timeline scrubbing, playback/stop, duration, FPS, loop, easing, and oscillator controls.
3. Persist clips locally and include them in user backups and project JSON.
4. Preserve compatibility with projects that predate animation data.
5. Restore the user's non-animated settings after playback/export; never save transient playback values as workspace settings.

Acceptance: browser test that creates a two-keyframe track, scrubs it, reloads the app, and verifies clip persistence and settings restoration.

### Stage 3 — Temporal rendering and export
1. Add deterministic temporal phase/seed information to the render configuration.
2. Use that phase for moving scanlines and repeatable temporal grain; the Worker and main-thread renderer must agree on the same frame settings.
3. Export PNG frame sequences as ZIP with frame numbering, progress, cancellation and strict frame/archive limits.
4. Export animation video through MediaRecorder, preferring MP4 when the browser actually supports it and otherwise producing WebM with an explicit format message.
5. Restore source settings and release tracks/resources on completion, failure, cancellation or page shutdown.

Acceptance: tests for temporal phase routing, ZIP signatures/frame count, unsupported recording handling, cleanup and restoration. Do not claim MP4 support on browsers that do not expose an MP4 MediaRecorder codec.

### Stage 4 — Palette workflow parity
1. Add per-colour palette locks and shuffle only unlocked swatches.
2. Add a source-derived palette mode based on the currently loaded image, with the existing palette extraction algorithm and colour-count limits.
3. Keep locks, source palette state, and palette data consistent through project import, library changes and user-data backups.

Acceptance: browser tests for locking, shuffle invariants, extraction, persistence and reload.

### Stage 5 — SVG as an input format
1. Permit SVG as an image source in the main editor.
2. Parse SVG as XML, reject malformed documents, scripts, foreignObject, event-handler attributes and external references, then rasterize locally.
3. Reuse existing image-size limits and the existing Canvas/Worker pipeline.
4. Keep the existing Shape Lab SVG import path separate.

Acceptance: valid local SVG loads; malformed and active/external-content SVG files are rejected; normal raster imports remain unchanged.

### Stage 6 — Preview iteration modes and release
1. Add Live, Balanced and Still preview scheduling modes, while forcing immediate/high-priority renders for playback and export.
2. Update the service-worker asset list/cache version and user documentation.
3. Add unit and browser regression coverage for all new workflows.
4. Increment the app metadata to 1.4.0 only after the new tests and existing cross-browser suite pass.

Acceptance: complete CI pass; no live deployment claim unless GitHub Pages deployment succeeds.

## Design rules

- Animation clips describe settings, not copied renderer code.
- Evaluation is pure and deterministic for a given settings snapshot, clip and timestamp.
- Playback/export use a frozen base-settings snapshot and restore it afterwards.
- The UI is responsive and touch-operable; no timeline interaction requires drag-and-drop.
- ZIP and recording exports are bounded; the app must fail with an actionable message rather than exhaust memory.
- Main-thread fallback remains functional when Worker/OffscreenCanvas is unavailable.
