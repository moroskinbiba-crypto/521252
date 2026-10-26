# TGRMLither

**Portable browser-based graphics studio for dithering, pixel art, halftone, glitch and ASCII art.** Works locally in your browser; images are processed on your device and are not uploaded to a server.

**[Open the editor](https://moroskinbiba-crypto.github.io/521252/)** · **[Download portable release](https://github.com/moroskinbiba-crypto/521252/releases/latest)** · [Source code](https://github.com/moroskinbiba-crypto/521252)

## Download and run

Download `TGRMLither-Portable-v1.2.0.zip` from **Releases** and extract it to any folder. On Windows, run `Launch-TGRMLither.bat`; on macOS/Linux, run `./Launch-TGRMLither.sh`. The launcher starts a local web server and opens the editor in your default browser. Python 3 is required for the launcher; if it is unavailable, open `index.html` directly (some browser storage/offline features can vary with file URLs).

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
- User presets, project JSON, batch processing, PNG/JPEG, SVG pixel-grid export, WebM motion export, standalone HTML and PWA/offline cache.


## Mobile and tablet support

The web editor adapts to phones and tablets. On narrow screens, the workspace switcher becomes a horizontally scrollable touch bar; the preview and contextual controls use separate vertical scroll panes. The desktop layout keeps the preview and settings side by side. Use the latest version of a mobile browser for the best Canvas and WebM support.

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
