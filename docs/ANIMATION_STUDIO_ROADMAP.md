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


## Implementation status — 2026-11-26

All six implementation stages above were delivered from `feat/animation-studio-1.4.0` and merged into `main` on 2026-11-27 through PR #23 (merge commit `eb08d9ffaa86d4d3cac7a05649b757014e13156f`). PR #24 subsequently restored the mobile upload label and visible effect-lock controls. The current mainline baseline is `0e55d2be78c98d04bf6cb5cd120c5f6125ce439d`.

- Stage 0: existing app guardrails retained; the new engine is isolated and no server/runtime dependency was added.
- Stage 1: keyframe engine supports numeric, toggle and enumerated parameters, easing, bounded track/keyframe counts, safe paths and per-track oscillators.
- Stage 2: responsive timeline added to Editor, Shape Lab and Script Slayer. Clips survive reloads, project import/export and user-data backup/restore. Legacy projects without an animation field remain valid.
- Stage 3: deterministic temporal phase is passed through both Worker and main renderer for scanline motion and grain. PNG Sequence ZIP and browser-supported MP4/WebM video exports have cancellation, progress and memory/frame limits.
- Stage 4: palette swatch locks persist; shuffle permutes unlocked colours only; Source mode extracts a palette from the open image.
- Stage 5: SVG can be opened as an editor source after local sanitization and rasterization. Shape Lab's custom SVG geometry import remains separate.
- Stage 6: Live/Balanced/Still preview scheduling, PWA cache v19, standalone HTML engine bundling, package metadata 1.4.0, README and CI tests are updated.

### Validated in CI

Workflow run [#295](https://github.com/moroskinbiba-crypto/521252/actions/runs/45869374371) completed successfully on 2026-11-26.

- Inline app JavaScript, the Worker, portable launchers, smoke-test scripts and animation engine tests passed.
- Animation engine unit tests passed for interpolation, easing, discrete tracks, nested paths, oscillators, limits and unsafe path rejection.
- Full browser smoke tests passed, including animation clip interpolation and reload, project round-trip, PNG ZIP export, palette locking/shuffle and SVG sanitization.
- Chromium, Firefox and WebKit compatibility checks passed, including startup, image rendering, Canvas recovery and 60 repeated edits.

### Deliberate scope limits

- MP4 is emitted only where the active browser advertises an MP4 MediaRecorder codec; otherwise the export is WebM.
- The current Animation Studio animates image/workspace parameters in Editor, Shape Lab and Script Slayer. Video Lab remains its separate source-video processing workspace.
- The first temporal renderer exposes animated scanline offset and deterministic grain; other visual effects can be animated through keyframes/oscillators, while additional procedural temporal patterns remain future work.
- PNG Sequence export is bounded to 600 frames and 48 MiB of PNG data; video recording is bounded to 128 MiB.
- The SVG importer rasterizes imported SVG as an image source. It does not preserve the source SVG as editable vector layers.

## Post-implementation audit — 2026-11-27

A second pass against the actual renderer, persistence paths, and import boundaries found two issues that were not covered by the first implementation review.

### Corrective work

- Animation track paths now reject array length mutation, prototype-related names, non-canonical array indexes, and traversal into nested arrays such as a custom Shape Lab viewBox. Only indexed algorithmLayers and shapeBands properties are traversable.
- Imported clips are normalized into a prototype-free track map. Unsupported or hostile track paths are discarded before they can be evaluated.
- Switching workspaces stops active playback before the outgoing workspace is saved.
- Timeline scrubbing is treated as a preview, not as a permanent workspace edit. A deliberate inspector edit while scrubbing establishes a new base; leaving a workspace, changing the source image, exporting a project, or creating a user backup preserves the base rather than the transient frame.
- Project files now store the animation clip together with its non-animated workspace base.
- Workspace/source changes are guarded during animation exports so an export cannot silently switch its source midway through a frame sequence or recording.

### Added regression coverage

- Reject writes to effects.length, shapeBands.length, and algorithmLayers.length.
- Reject nested-array traversal and prototype-related paths.
- Verify malformed imported tracks do not expand application arrays or pollute object prototypes.
- Verify a project saved while the timeline is scrubbed contains the base settings and the clip.
- Verify scrubbed frames are not persisted when leaving a workspace.
- Verify playback is stopped and the base restored during workspace navigation.

### Current scope boundary

The timeline currently targets the Editor, Shape Lab, and Script Slayer workspaces. Video Lab remains its separate source-video processing/recording workspace; it does not yet have a per-video keyframe timeline. Procedural temporal motion is currently implemented for scanline phase and deterministic grain, while other existing settings can be animated through keyframes and oscillators. This is intentionally documented as follow-up work rather than claiming full feature parity with Dither Boy's timeline/video animation workflow.

## Random-style effect locks — 2026-11-27

- Every effect row now has a lock button beside its enable checkbox in Editor, Shape Lab, Script Slayer, Batch and Video workspaces.
- Locking preserves the effect's current enabled/disabled state when the random-style action generates a new effect selection. Locked-on effects stay on; locked-off effects stay off.
- The checkbox remains manually editable while locked; the latest manual selection is the state that subsequent random styles preserve.
- Lock preferences are scoped per workspace, saved locally, and included in user backup/restore.
- Both the main Random Style action and the Shuffle fallback that generates an effect selection respect the same lock map.
- Browser smoke coverage checks locked-on and locked-off effects across repeated randomizations, reload and backup export.


## Animation Studio v2 follow-up — 2026-11-27

### Delivered in this branch

- Keyframes can be selected directly on a lane and edited with exact time (milliseconds represented as seconds), typed value, and outgoing easing. Retiming onto an occupied key position is rejected instead of silently replacing another key.
- Playback starts from the current playhead. Stop restores the non-animated workspace settings but leaves the playhead where playback stopped, so the next run can continue from that position.
- Playback modes are explicit: one pass, loop, and ping-pong. Old projects and backups that only contain the boolean `loop` field are migrated to the equivalent new mode.
- Oscillator phase is editable in the UI and remains bounded by the engine's existing phase limits.
- Playback and each export now compile a validated clip/base-settings snapshot once. Per-frame evaluation reuses that plan instead of normalising, sorting and validating the entire track map for every frame. Each frame still receives an isolated settings clone, so no frame can mutate the saved base or the compiled clip.
- Sequence/video exports use a frozen clip snapshot and restore the user's original playhead after completion or cancellation. The current frame-count, byte-size and cancellation limits remain in place.

### Stability and compatibility

- The engine format is version 2, but the normalizer continues to accept version-1 clips and the old `loop` boolean.
- Track and keyframe limits remain enforced. The edit operation rejects key collisions and invalid value types.
- No new runtime dependency, network request, rendering pipeline, Worker protocol, or project file format is introduced.
- The active clip is still shared by Editor, Shape Lab and Script Slayer. Per-workspace clip isolation remains a separate migration because it must preserve existing global clips, user backups, and legacy project JSON without losing animation data.

### Validation added

- Unit coverage for exact keyframe edits, collision rejection, loop migration, loop/ping-pong time mapping and compiled-evaluator snapshot isolation.
- Browser smoke coverage for selecting/editing a keyframe and persisting ping-pong mode.
