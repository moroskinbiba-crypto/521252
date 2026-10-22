# TGRMLither

**Portable browser-based graphics studio for dithering, pixel art, halftone, glitch and ASCII art.** Works locally in your browser; images are processed on your device and are not uploaded to a server.

**[Open the editor](https://moroskinbiba-crypto.github.io/521252/)** · **[Download portable release](https://github.com/moroskinbiba-crypto/521252/releases/latest)** · [Source code](https://github.com/moroskinbiba-crypto/521252)

## Download and run

Download `TGRMLither-Portable-v1.2.0.zip` from **Releases** and extract it to any folder. On Windows, run `Launch-TGRMLither.bat`; on macOS/Linux, run `./Launch-TGRMLither.sh`. The launcher starts a local web server and opens the editor in your default browser. Python 3 is required for the launcher; if it is unavailable, open `index.html` directly (some browser storage/offline features can vary with file URLs).

No installer, account, or backend is required. Image processing takes place in the browser. Web fonts are fetched from Google Fonts when online; offline use falls back to fonts installed on your system.

## Engine

- 15 error-diffusion kernels, including Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra variants, Fan and Stevenson–Arce.
- Bayer and clustered-dot ordered dithering; 8 pattern dither modes.
- 17 glitch styles and 16 special modes, including threshold, posterize, CMYK halftone, edge/contour, thermal map, X-Ray, woodcut, pixel sort, tearing, VHS and bitcrush.
- Contrast, brightness, midtones/highlights, levels, threshold, blur, scale and inversion.
- Built-in palettes, custom colours, image palette extraction and JSON palette import/export.
- Shape Lab with four luminance bands, per-band geometry, size and colour, placement distribution and rotation.
- Independent, adjustable and reorderable effect stacks for Editor, Shape Lab, Script Slayer, Batch and Video Lab.
- Script Slayer with 48 character families, live glyph preview, editable glyphs, depth/cell sizing, offset, palette/source/mono colour, transparent backgrounds, TXT export and animation.
- User presets, project JSON, batch processing, PNG/JPEG, SVG pixel-grid export, WebM motion export, standalone HTML and PWA/offline cache.

## Run from source

Open `index.html`, or run `python -m http.server 8080` in the repository folder and open `http://localhost:8080`.

## Compatibility note

TGRMLither is an independent implementation inspired by the publicly described feature set of Dither Boy, not a pixel-identical copy of its proprietary implementation. Some creative modes are approximations and may produce different results. SVG export traces the rendered pixel grid rather than reconstructing arbitrary smooth contours; Video Lab provides frame processing and WebM export rather than a full keyframe timeline.

## License

MIT. See [LICENSE](LICENSE).
