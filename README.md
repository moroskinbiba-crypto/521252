# DitherLab

DitherLab — локальная браузерная мастерская для дизеринга, ретро-растра, глитча, полутонов и символьной графики. Изображения обрабатываются в браузере и не загружаются на сервер.

**[Открыть редактор](https://moroskinbiba-crypto.github.io/521252/)** · [Исходный код](https://github.com/moroskinbiba-crypto/521252)

## Движок

- 15 матриц распространения ошибки: Floyd–Steinberg, Atkinson, Jarvis–Judice–Ninke, Stucki, Burkes, Sierra и варианты, Fan, Shiau, Stevenson–Arce и другие.
- Ordered dithering: Bayer и Clustered Dot.
- 8 паттернов: halftone, Shape Shifter, crosshatch, diagonal hatch, waves, concentric rings, modulation bars и lines.
- 17 творческих glitch-режимов и 16 специальных визуальных режимов, включая threshold/posterize/edges/thermal/X-Ray/woodcut и RGB/data-mosh стили.
- Контраст, яркость, midtones/highlights, размер ячейки, порог, число тонов, blur и инверсия.
- Встроенные палитры, собственные цвета, извлечение четырёх цветов из фото и JSON import/export палитр.
- Shape Shifter с четырьмя диапазонами яркости: форма, размер и цвет для каждого диапазона, распределение и поворот.
- Эффекты с индивидуальной интенсивностью и изменяемым порядком: Glow, Epsilon Glow, Chromatic Shift, Scanlines, Vignette, Film Grain, JPEG Glitch, Lick, Stress Relief и Modulation Lines.
- Script Slayer: дополнительные наборы символов, глубина, размер ячейки, offset, custom glyphs, палитра/цвет источника/монохром, прозрачный фон, TXT и WebM.
- Пресеты, проект JSON, пакетная обработка, PNG/JPEG, автономный HTML-экспорт и PWA/offline cache.

## Запуск

Откройте `index.html` или запустите `python -m http.server 8080`, затем откройте `http://localhost:8080`. Кнопка **↓ HTML** создаёт автономную HTML-версию.

## Совместимость и ограничения

Это независимая реализация, ориентированная на публично описанные возможности Dither Boy, а не пиксель-в-пиксель копия его закрытого исходного кода. Некоторые glitch/special режимы — собственные реализации похожих визуальных приёмов и могут отличаться от оригинала. Полная видеомонтажная шкала с ключевыми кадрами и точная трассировка произвольных SVG-контуров остаются будущими этапами.

## Лицензия

MIT.
