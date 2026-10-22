# TGRMLithering

TGRMLithering — локальная браузерная мастерская для дизеринга, ретро-растра, глитча, полутонов и символьной графики. Изображения обрабатываются в браузере и не загружаются на сервер.

**[Открыть редактор](https://moroskinbiba-crypto.github.io/521252/)** · [Исходный код](https://github.com/moroskinbiba-crypto/521252)

## Engine

- 15 diffusion kernels: Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra variants, Fan, Shiau variants, Stevenson–Arce and more.
- Bayer and clustered-dot ordered dithering; 8 pattern dither modes.
- 17 glitch styles and 16 special modes, including threshold, posterize, CMYK halftone, edge/contour, thermal map, X-Ray, woodcut, pixel sort, tearing, VHS and bitcrush.
- Contrast, brightness, midtones/highlights, levels, threshold, blur, scale and inversion.
- Built-in palettes, custom colours, image palette extraction and JSON palette import/export.
- Shape Shifter with four luminance bands, per-band geometry, size and colour, placement distribution and rotation.
- Individually adjustable reorderable effects: Glow, Epsilon Glow, Chromatic Shift, Scanlines, Vignette, Film Grain, JPEG Glitch, Lick, Stress Relief and Modulation Lines.
- Script Slayer with 48 character families, live glyph preview, editable glyphs, depth/cell sizing, offset, palette/source/mono colour, transparent backgrounds, TXT export and animation.
- Preset JSON import/export, project JSON, batch processing, PNG/JPEG, vector-like SVG pixel-run export, and WebM motion export.
- Standalone HTML and PWA/offline cache.

## Run locally

Open `index.html` or run `python -m http.server 8080`, then open `http://localhost:8080`. **↓ HTML** exports a standalone version.

## Compatibility note

TGRMLithering is an independent implementation inspired by the public feature set of Dither Boy, not a pixel-identical copy of its proprietary implementation. Some creative modes are approximations and can produce different results. SVG export traces the rendered pixel grid rather than reconstructing arbitrary smooth contours. The editor still lacks a full video timeline and keyframe graph.

## License

MIT.
