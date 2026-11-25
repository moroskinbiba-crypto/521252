# TGRMLither

**Portable browser-based graphics studio for dithering, pixel art, halftone, glitch and ASCII art.** Works locally in your browser; images are processed on your device and are not uploaded to a server.

**[Open the editor](https://moroskinbiba-crypto.github.io/521252/)** · **[Download portable release](https://github.com/moroskinbiba-crypto/521252/releases/latest)** · [Source code](https://github.com/moroskinbiba-crypto/521252)

## Download and run

Download the latest `TGRMLither-Portable` ZIP from [Releases](https://github.com/moroskinbiba-crypto/521252/releases/latest) and extract it to any folder. On Windows, run `Launch-TGRMLither.bat`; on macOS/Linux, run `./Launch-TGRMLither.sh`. The launcher starts a local web server and opens the editor in your default browser. Python 3 is required for the launcher; if it is unavailable, open `index.html` directly (some browser storage/offline features can vary with file URLs).

No installer, account, or backend is required. Image processing takes place in the browser. Web fonts are fetched from Google Fonts when online; offline use falls back to fonts installed on your system.

## Engine

- 15 error-diffusion kernels, including Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra variants, Fan and Stevenson–Arce; optional serpentine row scanning reduces the left-to-right directional bias.
- 8 ordered-dither modes: Bayer 2×2, 4×4, 8×8 and 16×16, Blue Noise rank dithering, clustered-dot 4×4/8×8, and a Beehive hexagonal hybrid; plus 8 pattern dither modes.
- 17 glitch styles and 16 special modes, including threshold, posterize, CMYK halftone, edge/contour, thermal map, X-Ray, woodcut, pixel sort, tearing, VHS and bitcrush.
- Contrast, brightness, midtones/highlights, levels, threshold, blur, 1–24 px dither cells, separate pattern-mark scale, post-processing smoothing, original/result blending and inversion. Choose a processing budget of 480k, 1.2M, 2.4M, or UHD 8.3M internal cells to balance live-preview speed against fine detail on large images. Adaptive sampling uses fractional downscaling to avoid unnecessarily discarding detail.
- 25 built-in retro/print palettes plus a user palette and saved library, including Game Boy, PICO-8, DawnBringer 16, Commodore 64, CGA, Risograph and screenprint sets; mouse-wheel preview before confirming a palette, custom colours, image palette extraction, 2–16-colour palette editing, and JSON palette/library import/export.
- Shape Lab with four luminance bands, per-band geometry, size and colour, placement distribution and rotation.
- Independent, adjustable and reorderable effect stacks for Editor, Shape Lab, Script Slayer, Batch and Video Lab.
- Script Slayer with 48 character families, live glyph preview, editable glyphs, depth/cell sizing, offset, palette/source/mono colour, transparent backgrounds, TXT export and animation.
- User presets, project JSON, batch processing with individual PNGs or a one-click ZIP bundle, PNG/JPEG, SVG pixel-grid export, WebM motion export, standalone HTML and PWA/offline cache.


## Mobile and tablet support

The web editor adapts to phones and tablets. On narrow screens, the workspace switcher becomes a horizontally scrollable touch bar; the preview and contextual controls use separate vertical scroll panes. The desktop layout keeps the preview and settings side by side. Use the latest version of a mobile browser for the best Canvas and WebM support.

## Workstation interface

The editor opens in a clean studio layout with the preview as the main focus and contextual controls in the inspector. Use **Дополнительно** to reveal technical parameters, search algorithms by name, or keep frequently used algorithms in favourites. **До / после** overlays the original image with an adjustable comparison divider. Undo and redo are available through the toolbar and Ctrl/Cmd+Z or Ctrl/Cmd+Shift+Z. The export dialog brings PNG, JPEG, SVG, CMYK plates, project JSON and copy-to-clipboard actions together. The editor now opens in a full Windows XP Luna-inspired shell by default: vivid blue title bars, silver-gray window chrome, classic beveled controls, square pixel-crisp borders, and the green primary image-loading button. The modern studio remains available in the appearance menu. The preset catalogue includes search across built-in and saved presets.

## Run from source

Open `index.html`, or run `python -m http.server 8080` in the repository folder and open `http://localhost:8080`.

## Compatibility note

TGRMLither is an independent implementation inspired by the publicly described feature set of Dither Boy, not a pixel-identical copy of its proprietary implementation. Some creative modes are approximations and may produce different results. SVG export traces the rendered pixel grid rather than reconstructing arbitrary smooth contours; Video Lab provides frame processing and WebM export rather than a full keyframe timeline.

## License

MIT. See [LICENSE](LICENSE).


## Advanced still-image workflow

- Algorithm coverage: 65 still-image choices, including 15 error-diffusion kernels, 8 ordered modes, 8 pattern modes, 17 glitch modes, 16 special modes, Pixel Poster and the Beehive hexagonal hybrid; plus extended Bayer 16×16 and a deterministic blue-noise-style ranked threshold matrix. These are independent implementations, not bit-identical recreations of Dither Boy internals.
- Algorithm compositing: up to four added algorithm layers, per-layer opacity, blend modes, reordering and removal. Layers are saved with workspace settings and project files.
- Independent dot/mark scale for pattern modes, adjustable blend between the original image and the processed result, and a separate post-processing smoothing control.
- Print output: choose SVG detail (compact, 1024 px, 2048 px or source resolution), black-vector threshold and DPI. CMYK export creates four labelled vector plates.
- Pattern dithering: eight pattern modes including Spiral Dither, adjustable screen angle and halftone mark shape.
- Palette library: save and name up to 100 four-colour palettes, apply or delete them, and import/export a collection as one JSON file.
- Workflow helpers: paste images directly from the clipboard and toggle the editor into browser full-screen mode.


## Performance and format limits

- Source images are limited to 24 megapixels and a maximum edge of 32,767 px. Larger images are proportionally reduced before canvas allocation and the UI shows a warning; the same safeguard applies to images embedded in imported projects.
- Video Lab processes up to 2.4 megapixels per frame to keep preview and WebM recording responsive. Full HD frames are processed at their original size; larger frames are scaled down.
- The built-in batch ZIP writer uses the classic ZIP format and limits each archive to 64 MB and 65,535 files. Split larger batches into smaller exports.
- The browser-based editor keeps image processing local. Imported project files must contain a self-contained PNG, JPEG, or WebP data URL; remote image URLs are not loaded from project files.
- The offline service worker only clears old caches whose names use the `tgrmlither-` prefix. It does not remove caches belonging to other apps on the same origin.


## Additional hardening in v1.3.2

- PWA launch/background colours follow the default dark theme; browser chrome colour updates with the selected theme.
- Project import refuses files above 160 MB before reading them and handles FileReader failures; project export avoids an unnecessary full-resolution canvas copy and reports failures.
- Motion WebM recording validates browser support before changing the UI and cleans up recorder streams if setup fails.
- CI validates the Portable shell launcher's syntax and checks that its executable permission survives packaging.

- Portable launchers verify that the local server responds before opening the browser and report if port 8765 is already in use.


## UX and performance improvements in v1.3.3

- Continuous slider and colour adjustments are coalesced into one preview render per animation frame, reducing redundant processing during fast adjustments.
- Video Lab reuses its off-screen frame canvas and caps live frame processing at 24 fps to reduce allocation churn and CPU spikes.
- Batch processing now reports accessible progress, can be stopped after the current file, and preserves completed partial results for individual download or ZIP export.


## Image loading UX in v1.3.4

- Opening an image from the file picker, clipboard or preview drop zone now shows a visible, accessible loading state while the browser decodes it locally.
- A failed or cancelled decode leaves the last valid preview intact; starting a newer load cancels the previous decode request.
- Dropping files over nested preview elements no longer causes the drag highlight to flicker. Unsupported dropped files receive a clear message.
- Image files larger than 128 MB are rejected before decoding to avoid unnecessarily large memory allocations. The existing 24 MP canvas limit still applies after decoding.


## Export and mobile refinements in v1.3.5

- Vector and CMYK exports now report success only after a file has actually been generated. A size/detail limit or an export error no longer changes the source status to “exported”.
- Mobile navigation, primary actions, selects, effect toggles and range controls have larger touch targets while preserving the existing compact layout.


## Effect stack ordering in v1.3.6

- Moving an effect up or down now also moves its visible control row, so the inspector matches the order used by the image-processing pipeline.
- The first effect disables its “move up” action and the last effect disables “move down”.
- Order remains independent for Editor, Shape Lab, Script Slayer, Batch and Video Lab and is persisted in each workspace profile.


## Rendering performance in v1.3.7

- Preview and Video Lab canvases now keep their existing backing stores when frame dimensions are unchanged, avoiding repeated GPU/bitmap reallocation on every slider update or video frame.
- Empty effect stacks (including effects set to zero strength) skip the bounded post-processing pass. This removes an unnecessary full-image downscale/upscale and preserves detail when no effects are active.
- Browser regression tests verify unchanged-size canvas reuse and pixel-identical output when the effect stack is inactive.

## Background processing in v1.3.8

- Large image previews (786,432 source pixels and above) run in a dedicated Web Worker using OffscreenCanvas when the browser supports it. The source ImageBitmap is transferred once and reused across adjustments; the worker returns transferable ImageBitmaps instead of copying full pixel buffers back to the main thread.
- Large batch items use the same worker pipeline after the existing safe image-size normalization. Large Video Lab frames are processed off the UI thread; frame requests are coalesced so slow frames do not build an unbounded queue.
- Smaller images and browsers without Worker, OffscreenCanvas, or createImageBitmap keep using the established main-thread renderer. Worker errors automatically fall back to that path.
- The portable/PWA service-worker cache includes the processing worker for offline use. Browser regression coverage checks the real worker path on a large image, plus the main-thread fallback.

### Script Slayer · Neo Glow
Neo Glow includes an adjustable scan-band position, width, brightness, off-band visibility and colour. The band is centered by default, its settings follow the saved Script Slayer profile, and the Animation button moves the band across the symbol canvas.



## Stability hardening in v1.3.9

- Worker requests now have a 120-second watchdog. A request timeout, worker runtime error, or message-decoding failure terminates the worker, rejects pending operations, clears their timers and returns the current preview to the main-thread renderer.
- ImageBitmap creation for preview, batch and video processing is also time-bounded. A bitmap that resolves after its caller timed out is immediately closed instead of being retained.
- Batch processing caps accumulated output blobs at 128 MiB. Completed files remain available for individual download or ZIP export; the app asks the user to split larger batches rather than accumulating unbounded results.
- Browser smoke tests simulate a worker that accepts its source image but never returns a rendered frame, then verify watchdog activation and a usable main-thread fallback.
- The offline cache version is advanced so installed PWA copies fetch the updated editor and worker assets.
