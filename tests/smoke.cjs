const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/tgrmlither-qa/node_modules/playwright");

const baseURL = process.env.TGRM_BASE_URL || "http://127.0.0.1:4173/";

async function downloadFrom(page, selector) {
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 15000 }),
    page.locator(selector).click()
  ]);
  const path = await download.path();
  assert.ok(path, "download should have a temporary file");
  return { download, path, bytes: fs.readFileSync(path) };
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const errors = [];
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    page.on("pageerror", error => errors.push(error.stack || error.message));

    await page.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#output");
      return canvas && canvas.width > 0 && canvas.height > 0 &&
        document.querySelector("#statAlgorithm")?.textContent.trim();
    }, null, { timeout: 15000 });

    assert.match(await page.title(), /^TGRMLither/);
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor");
    assert.match(await page.locator("#homeLogo").innerText(), /TGRMLither/, "new product name must be visible in the app header");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), true, "regular effects should be visible in Editor");
    assert.equal(await page.locator("#asciiControl").isVisible(), false, "Script Slayer panel should be isolated from Editor");
    assert.equal(await page.locator("#shapeControl").isVisible(), false, "Shape Lab panel should be isolated from Editor");
    const theme = await page.evaluate(() => ({
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(document.querySelector("#pageTitle")).fontFamily,
      background: getComputedStyle(document.body).backgroundColor,
      fontStylesheet: document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis.com"]')?.href || ""
    }));
    assert.match(theme.bodyFont, /Onest/, "Cyrillic-friendly Onest should be used by the interface");
    assert.match(theme.headingFont, /Onest/, "headings should use readable Onest instead of a Latin-only pixel font");
    assert.ok(theme.fontStylesheet.includes("family=Onest"), "Onest web font must be included");
    assert.ok(theme.fontStylesheet.includes("IBM+Plex+Mono"), "IBM Plex Mono must be included for technical labels");
    const markupAudit = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(el => el.id);
      return { duplicates: ids.filter((id, i) => ids.indexOf(id) !== i), modeButtons: [...document.querySelectorAll(".topnav [data-mode]")].map(el => el.dataset.mode) };
    });
    assert.deepEqual(markupAudit.duplicates, [], "runtime-generated workspace panels must not create duplicate IDs");
    assert.deepEqual(markupAudit.modeButtons, ["presets", "shape", "script", "batch", "video"]);

    // Theme picker, local persistence and safe, shareable theme codes.
    await page.locator("#themeMenu > summary").click();
    await page.locator("#themePicker").selectOption("terminal");
    assert.equal(await page.locator("body").getAttribute("data-theme"), "terminal");
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-theme")).vars["--acid"] === "#72ffa0"),
      "theme choice should persist locally");
    await page.locator("#makeThemeCode").click();
    const themeCode = await page.locator("#themeCodeInput").inputValue();
    assert.ok(themeCode.startsWith("TGRMTHEME1:"), "theme sharing should generate a portable code");
    await page.locator("#themePicker").selectOption("paper");
    await page.locator("#themeCodeInput").fill(themeCode);
    await page.locator("#applyThemeCode").click();
    assert.equal(await page.locator("body").getAttribute("data-theme"), "terminal",
      "a shared theme code should restore the selected palette of UI colours");
    await page.locator("#themePicker").selectOption("custom");
    await page.locator("#themeColorAcid").evaluate(el => { el.value = "#12abef"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#applyCustomTheme").click();
    assert.equal(await page.locator("body").getAttribute("data-theme"), "custom", "custom theme colours should be applicable");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-theme")).vars["--acid"]), "#12abef",
      "custom UI colours should be stored safely as hex values");
    await page.locator("#makeThemeCode").click();
    const customThemeCode = await page.locator("#themeCodeInput").inputValue();
    await page.locator("#themePicker").selectOption("terminal");
    await page.locator("#themeCodeInput").fill(customThemeCode);
    await page.locator("#applyThemeCode").click();
    assert.equal(await page.locator("body").getAttribute("data-theme"), "custom", "sharing should preserve a custom theme identity");
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue("--acid").trim()), "#12abef");
    await page.locator("#themePicker").selectOption("night");
    assert.equal(await page.locator("body").getAttribute("data-theme"), "night");

    // Shuffle should randomize adjustments while preserving valid control ranges.
    await page.locator("#shuffle").click();
    const shuffled = await page.evaluate(() => ({
      scale: Number(document.querySelector("#scale").value),
      levels: Number(document.querySelector("#levels").value),
      threshold: Number(document.querySelector("#threshold").value),
      contrast: Number(document.querySelector("#contrast").value)
    }));
    assert.ok(shuffled.scale >= 2 && shuffled.scale <= 16, "Shuffle keeps scale in range");
    assert.ok(shuffled.levels >= 2 && shuffled.levels <= 16, "Shuffle supports the expanded 16-tone range");
    assert.ok(shuffled.threshold >= -80 && shuffled.threshold <= 80, "Shuffle keeps threshold in range");
    assert.ok(shuffled.contrast >= 50 && shuffled.contrast <= 180, "Shuffle keeps contrast in range");
    const initialSize = await page.locator("#output").evaluate(c => ({ width: c.width, height: c.height }));
    assert.ok(initialSize.width >= 1 && initialSize.height >= 1, "demo image should render");
    assert.equal(await page.locator("#algorithmStackControl").isVisible(), true, "algorithm stack is available in the image workspace");
    assert.ok(await page.locator('#layerAlgorithmSelect option[value="spiral"]').count() === 1, "Spiral Dither must be selectable as a stack layer");
    const beforeAlgorithmStack = await page.locator("#output").evaluate(c => c.toDataURL("image/png"));
    await page.locator("#layerAlgorithmSelect").selectOption("spiral");
    await page.locator("#addAlgorithmLayer").click();
    assert.equal(await page.locator("#algorithmLayerList .algorithm-layer").count(), 1, "adding a layer should add a configurable algorithm");
    assert.notEqual(await page.locator("#output").evaluate(c => c.toDataURL("image/png")), beforeAlgorithmStack, "an algorithm layer must composite into the preview");
    const persistedLayers = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")).editor.algorithmLayers);
    assert.equal(persistedLayers.length, 1, "algorithm layers should persist in workspace settings");
    assert.equal(persistedLayers[0].algorithm, "spiral");
    await page.locator('#algorithmLayerList [data-layer-action="remove"]').click();
    assert.equal(await page.locator("#algorithmLayerList .algorithm-layer").count(), 0, "algorithm layers can be removed");

    // Core image processing and input controls.
    await page.locator("#algorithm").selectOption("floyd");
    assert.equal(await page.locator("#algorithm").inputValue(), "floyd");
    assert.ok((await page.locator("#statAlgorithm").textContent()).trim().length > 0);
    await page.locator("#scale").evaluate(el => {
      el.value = "9";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal((await page.locator("#scaleV").textContent()).trim(), "9 px");
    const qualityOptions = await page.locator("#qualityMode option").evaluateAll(options => options.map(o => o.value));
    assert.deepEqual(qualityOptions, ["balanced", "detail", "max"], "still-image detail budget options should be available");
    await page.locator("#qualityMode").selectOption("detail");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")).editor.qualityMode), "detail",
      "the quality setting should persist with the current workspace");
    await page.locator("#qualityMode").selectOption("max");
    assert.equal(await page.locator("#qualityMode").inputValue(), "max");
    await page.locator("#qualityMode").selectOption("balanced");

    // Mode navigation, glyph controls, and preset application.
    await page.locator('.topnav [data-mode="shape"]').click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "shape");
    assert.equal(await page.locator("#algorithmPickerField").isVisible(), false, "Shape Lab uses its own workspace, not the standard algorithm picker");
    assert.equal(await page.locator("#shapeControl").isVisible(), true, "Shape Lab settings should only appear in Shape Lab");
    assert.equal(await page.locator("#shapeEffectsControl").isVisible(), true, "Shape Lab has an independent effect stack");
    assert.equal(await page.locator("#scriptEffectsControl").isVisible(), false, "Script Slayer effects must stay hidden in Shape Lab");
    assert.equal(await page.locator("#batchEffectsControl").isVisible(), false);
    assert.equal(await page.locator("#videoEffectsControl").isVisible(), false);
    assert.equal(await page.locator("#shape-effect-scanlines").getAttribute("aria-checked"), "false");
    const beforeShapeEffect = await page.locator("#output").evaluate(c => c.toDataURL("image/png"));
    await page.locator("#shape-effect-scanlines").click();
    assert.equal(await page.locator("#shape-effect-scanlines").getAttribute("aria-checked"), "true");
    assert.notEqual(await page.locator("#output").evaluate(c => c.toDataURL("image/png")), beforeShapeEffect,
      "Shape Lab effects must affect the rendered pixels");
    assert.equal(await page.locator("#randomize").isVisible(), false, "Editor randomizer should not leak into Shape Lab");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), false, "standard effect stack must not appear in Shape Lab");
    assert.equal(await page.locator("#asciiControl").isVisible(), false, "Script Slayer settings must not appear in Shape Lab");
    const svgShape = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M5 0 L10 10 L0 10 Z"/></svg>';
    await page.locator("#shapeSvgInput").setInputFiles({ name: "custom-triangle.svg", mimeType: "image/svg+xml", buffer: Buffer.from(svgShape) });
    assert.equal(await page.locator("#bandShape0").inputValue(), "custom", "imported SVG should become an available custom band shape");
    assert.match(await page.locator("#shapeSvgStatus").textContent(), /custom-triangle\.svg/);
    assert.equal(await page.locator("#shapePresetSelect option").count() >= 7, true, "Shape Lab should include built-in shape presets");
    assert.equal(await page.locator("#bandShape0 option[value=\"star\"]").count(), 1, "bands should expose the expanded shape library");
    await page.locator("#shapePresetSelect").selectOption("starfield");
    await page.locator("#applyShapePreset").click();
    const shapePresetDebug = await page.evaluate(() => {
      const state = JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}");
      return { selected: document.querySelector("#shapePresetSelect")?.value,
        visibleShape: document.querySelector("#bandShape0")?.value,
        storedShape: state.shape?.shapeBands?.[0]?.shape,
        storedThresholds: state.shape?.shapeThresholds,
        mode: document.body.dataset.mode,
        status: document.querySelector("#toast")?.textContent };
    });
    assert.equal(await page.locator("#bandShape0").inputValue(), "star",
      "Shape Shifter presets should update each band's assigned shape: " + JSON.stringify(shapePresetDebug));
    assert.equal(await page.locator("#shapeThreshold1").inputValue(), "48", "shape presets should configure luminance thresholds");
    const beforeShapeCode = await page.locator("#bandRotation0").inputValue();
    await page.locator("#makeShapeCode").click();
    const shapeCode = await page.locator("#shapeShareCode").inputValue();
    assert.ok(shapeCode.startsWith("TGRMSHAPE1:"), "Shape Shifter should generate a shareable settings code");
    await page.locator("#bandRotation0").evaluate(el => { el.value = "67"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(await page.locator("#bandRotation0").inputValue(), "67", "per-band rotation should respond to the slider");
    await page.locator("#applyShapeCode").click();
    assert.equal(await page.locator("#bandRotation0").inputValue(), beforeShapeCode, "share code should restore the prior band rotation");
    await page.locator("#shapePresetName").fill("QA Shape");
    await page.locator("#saveShapePreset").click();
    const shapeStorage = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-shape-presets")));
    assert.equal(shapeStorage.length, 1, "user Shape Shifter presets should persist locally");
    assert.equal(shapeStorage[0].name, "QA Shape");
    assert.ok(await page.locator("#shapePresetSelect option").evaluateAll(opts => opts.some(o => o.value.startsWith("user_"))), "saved Shape Shifter preset should appear in the preset selector");
    assert.equal(await page.locator("#deleteShapePreset").isEnabled(), true, "saving a custom preset should enable the delete button");
    await page.locator("#deleteShapePreset").click();
    assert.deepEqual(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-shape-presets"))), [],
      "user Shape Shifter presets should be removable");
    await page.locator('.topnav [data-mode="script"]').click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "script");
    assert.equal(await page.locator("#asciiControl").isVisible(), true, "Script Slayer controls should be visible in Script Slayer");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), false, "standard effect stack must not appear in Script Slayer");
    assert.equal(await page.locator("#scriptEffectsControl").isVisible(), true, "Script Slayer has its own effect stack");
    assert.equal(await page.locator("#shapeEffectsControl").isVisible(), false, "Shape Lab effects must stay hidden in Script Slayer");
    assert.equal(await page.locator("#batchEffectsControl").isVisible(), false);
    assert.equal(await page.locator("#videoEffectsControl").isVisible(), false);
    assert.equal(await page.locator("#algorithmPickerField").isVisible(), false, "Script Slayer must not duplicate the standard algorithm picker");
    assert.equal(await page.locator("#script-effect-scanlines").getAttribute("aria-checked"), "false",
      "Script Slayer should not inherit Shape Lab's active effect");
    await page.locator("#script-effect-scanlines").click();
    assert.equal(await page.locator("#script-effect-scanlines").getAttribute("aria-checked"), "true");
    assert.notEqual(await page.locator("#output").evaluate(c => c.toDataURL("image/png")), "",
      "Script Slayer should keep a rendered canvas after its own effect is enabled");
    await page.locator("#asciiSet").selectOption("binary");
    await page.locator("#asciiCustomChars").fill("01#X");
    assert.equal((await page.locator("#asciiCustomCount").textContent()).trim(), "4 / 10");
    await page.locator('.topnav [data-mode="presets"]').click();
    assert.ok(await page.locator("#presetGrid .preset").count() > 0, "built-in presets should render");
    await page.locator("#presetGrid .preset").first().click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor");
    assert.equal(await page.locator("#effect-scanlines").getAttribute("aria-checked"), "false",
      "Editor should start with its own effects, independent of the other workspaces");
    await page.locator("#homeLogo").click();
    assert.equal(await page.locator("#shape-effect-scanlines").getAttribute("aria-checked"), "true",
      "switching away and back must restore Shape Lab's own effect profile");
    await page.locator('.topnav [data-mode="script"]').click();
    assert.equal(await page.locator("#script-effect-scanlines").getAttribute("aria-checked"), "true",
      "switching away and back must restore Script Slayer's own effect profile");
    await page.locator("#homeLogo").click();

    // Independent scroll areas: settings must scroll without moving the page/canvas.
    const beforeScroll = await page.locator("#output").evaluate(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, pageY: window.scrollY };
    });
    await page.locator("#inspector").evaluate(el => { el.scrollTop = 260; });
    const afterScroll = await page.locator("#output").evaluate(el => {
      const r = el.getBoundingClientRect();
      return { x: r.x, y: r.y, pageY: window.scrollY, settingsScroll: document.querySelector("#inspector").scrollTop };
    });
    assert.ok(afterScroll.settingsScroll > 0, "settings panel must have an independent scroll area");
    assert.equal(afterScroll.pageY, 0, "document itself should not scroll");
    assert.equal(afterScroll.y, beforeScroll.y, "scrolling settings must not move the preview");

    // Switch between desktop, tablet, and mobile layout.
    await page.setViewportSize({ width: 820, height: 900 });
    const tablet = await page.evaluate(() => ({
      leftCount: document.querySelectorAll(".layout > .left").length,
      topNavCount: document.querySelectorAll(".topnav [data-mode]").length,
      inspectorWidth: document.querySelector("#inspector").getBoundingClientRect().width,
      canvasWidth: document.querySelector("#output").getBoundingClientRect().width
    }));
    assert.equal(tablet.leftCount, 0, "duplicate side workspace navigation must not exist");
    assert.equal(tablet.topNavCount, 5, "all alternate workspaces must be available in the top navigation");
    assert.ok(tablet.inspectorWidth > 200 && tablet.canvasWidth > 0, "tablet layout should show controls and preview");
    for (const viewport of [{ width: 390, height: 844 }, { width: 360, height: 740 }, { width: 320, height: 640 }, { width: 700, height: 390 }, { width: 844, height: 390 }]) {
      await page.setViewportSize(viewport);
      const mobile = await page.evaluate(() => {
        const rect = selector => document.querySelector(selector)?.getBoundingClientRect();
        const header = rect("header"), layout = rect(".layout"), canvas = rect("#output");
        const main = rect(".layout > main"), settings = rect("#inspector"), nav = rect(".topnav");
        return {
          width: innerWidth, height: innerHeight, pageX: scrollX, pageY: scrollY,
          documentWidth: document.documentElement.scrollWidth,
          header: header && { x: header.x, right: header.right, bottom: header.bottom, height: header.height },
          layout: layout && { x: layout.x, right: layout.right, top: layout.top, bottom: layout.bottom, height: layout.height },
          canvas: canvas && { x: canvas.x, right: canvas.right, width: canvas.width, height: canvas.height },
          main: main && { x: main.x, y: main.y, right: main.right, height: main.height, bottom: main.bottom },
          settings: settings && { x: settings.x, right: settings.right, height: settings.height, top: settings.top },
          nav: nav && { x: nav.x, right: nav.right, height: nav.height, scrollWidth: nav.scrollWidth, clientWidth: nav.clientWidth },
          leftDisplay: (() => { const left = document.querySelector(".layout > .left"); return left ? getComputedStyle(left).display : "none"; })(),
          horizontalPageOverflow: document.documentElement.scrollWidth > innerWidth + 1,
          workspaceNavCount: document.querySelectorAll(".topnav [data-mode]").length
        };
      });
      assert.equal(mobile.pageX, 0, "page must not scroll horizontally at " + viewport.width + "x" + viewport.height);
      assert.equal(mobile.pageY, 0, "page must not scroll vertically at " + viewport.width + "x" + viewport.height);
      assert.equal(mobile.horizontalPageOverflow, false, "mobile viewport must not have horizontal page overflow: " + JSON.stringify(mobile));
      assert.equal(mobile.leftDisplay, "none", "the duplicate sidebar workspace navigation must stay hidden");
      assert.equal(mobile.workspaceNavCount, 5, "all workspaces must remain reachable from the touch navigation");
      assert.ok(mobile.layout.height > 180, "work area must have usable height: " + JSON.stringify(mobile));
      assert.ok(mobile.canvas.width > 0 && mobile.canvas.height > 0, "preview should remain visible at " + viewport.width + "x" + viewport.height);
      assert.ok(mobile.main.height > 100 && mobile.settings.height > 100, "preview and settings panes should both be usable");
      if (viewport.width <= 740) {
        assert.ok(mobile.header.height < 130 && mobile.header.height > 60, "phone header should fit without consuming the screen: " + JSON.stringify(mobile));
        assert.ok(Math.abs(mobile.layout.top - mobile.header.bottom) < 2, "work area should start directly below the phone header");
        assert.ok(Math.abs(mobile.main.x - mobile.settings.x) < 2, "preview and settings should be stacked on narrow screens");
        assert.ok(Math.abs(mobile.main.right - mobile.settings.right) < 2, "both narrow-screen panes should use the full width");
        assert.ok(mobile.main.bottom <= mobile.settings.top + 3, "mobile panes should not overlap");
      } else {
        assert.ok(mobile.header.height >= 50 && mobile.header.height < 80, "tablet landscape should use a compact single-row header");
        assert.ok(Math.abs(mobile.main.y - mobile.settings.top) < 3, "tablet landscape should keep preview and settings side by side");
        assert.ok(mobile.main.right <= mobile.settings.x + 3, "tablet panes should not overlap");
      }
    }
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('.topnav [data-mode="script"]').click();
    assert.equal(await page.locator("#asciiControl").isVisible(), true, "Script Slayer must remain accessible from mobile navigation");
    await page.locator(".topnav").evaluate(el => { el.scrollLeft = el.scrollWidth; });
    assert.ok(await page.locator('.topnav [data-mode="video"]').isVisible(), "Video Lab navigation must stay reachable by horizontal nav scrolling");
    await page.locator(".topnav [data-mode=\"video\"]").click();
    assert.equal(await page.locator("#videoView").isVisible(), true, "Video Lab should open on mobile");
    await page.locator(".topnav [data-mode=\"presets\"]").click();
    assert.ok(await page.locator("#presetGrid .preset").first().isVisible(), "presets should render in the mobile layout");
    await page.locator("#homeLogo").click();
    assert.equal(await page.locator("#editorView").isVisible(), true, "brand should return to Editor on mobile");

    // Upload a deterministic fixture and check real download contents.
    await page.setViewportSize({ width: 1440, height: 900 });
    const dataURL = await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 48; c.height = 32;
      const ctx = c.getContext("2d");
      for (let y = 0; y < c.height; y++) {
        for (let x = 0; x < c.width; x++) {
          ctx.fillStyle = "rgb(" + Math.round(x / 47 * 255) + "," + Math.round(y / 31 * 255) + "," + ((x * 11 + y * 7) % 256) + ")";
          ctx.fillRect(x, y, 1, 1);
        }
      }
      return c.toDataURL("image/png");
    });
    const imageBuffer = Buffer.from(dataURL.split(",")[1], "base64");
    await page.locator("#imageInput").setInputFiles({
      name: "qa-fixture.png", mimeType: "image/png", buffer: imageBuffer
    });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));
    assert.deepEqual(await page.locator("#output").evaluate(c => [c.width, c.height]), [48, 32]);
    const pasteWasHandled = await page.evaluate(async dataURL => {
      const blob = await (await fetch(dataURL)).blob();
      const file = new File([blob], "clipboard-source.png", { type: "image/png" });
      const event = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(event, "clipboardData", { value: { items: [{ type: "image/png", getAsFile: () => file }] } });
      return !window.dispatchEvent(event);
    }, dataURL);
    assert.equal(pasteWasHandled, true, "pasting an image should be intercepted by the local editor");
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("clipboard-image.png"));
    assert.deepEqual(await page.locator("#output").evaluate(c => [c.width, c.height]), [48, 32], "pasted image should load into the editor");
    await page.locator("#imageInput").setInputFiles({ name: "qa-fixture.png", mimeType: "image/png", buffer: imageBuffer });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));

    // Exercise every algorithm option so a broken branch cannot hide behind a valid default.
    const algorithms = await page.locator("#algorithm option").evaluateAll(options => options.map(option => option.value));
    assert.ok(algorithms.length >= 64, "all advertised processing algorithms, including new ordered modes, should be present");
    assert.ok(algorithms.includes("bayer16") && algorithms.includes("blueNoise"), "Bayer 16×16 and Blue Noise must be registered as real algorithms");
    const diffusionAlgorithms = ["floyd", "atkinson", "jarvis", "stucki", "burkes", "sierra", "sierra2", "sierraLite", "fan", "shiau2", "shiau3", "stevenson", "falseFloyd", "twoRow", "simpleDiff"];
    for (const algorithm of algorithms.filter(value => !["shape", "ascii"].includes(value))) {
      await page.locator("#algorithm").selectOption(algorithm);
      const rendered = await page.locator("#output").evaluate(canvas => ({
        width: canvas.width,
        height: canvas.height,
        label: document.querySelector("#statAlgorithm")?.textContent.trim()
      }));
      assert.ok(rendered.width > 0 && rendered.height > 0, "algorithm failed to render: " + algorithm);
      assert.ok(rendered.label, "algorithm label missing for: " + algorithm);
      assert.equal(await page.locator("#glitchDepthControl").isVisible(), algorithm.startsWith("glitch_"),
        "Glitch-specific depth control should only appear for Glitch algorithms: " + algorithm);
      assert.equal(await page.locator("#serpentineControl").isVisible(), diffusionAlgorithms.includes(algorithm),
        "serpentine scan mode should appear only for error-diffusion kernels: " + algorithm);
    }
    await page.locator("#scale").evaluate(el => { el.value = "2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#levels").evaluate(el => { el.value = "2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#algorithm").selectOption("bayer16");
    const bayer16Output = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await page.locator("#algorithm").selectOption("blueNoise");
    const blueNoiseOutput = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.notEqual(blueNoiseOutput, bayer16Output, "Blue Noise must produce a distinct, real threshold pattern");
    await page.locator("#algorithm").selectOption("bayer16");
    assert.equal(await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png")), bayer16Output,
      "Bayer 16×16 output should be deterministic");
    const gameboyPalette = page.locator("#palettes .palette[data-palette=\"gameboy\"]");
    assert.equal(await gameboyPalette.count(), 1, "the Game Boy retro palette must be available");
    await gameboyPalette.click();
    assert.ok(await gameboyPalette.evaluate(el => el.classList.contains("active")), "built-in palette should become active on click");
    await page.locator("#palettes .palette[data-palette=\"moss\"]").click();
    const paletteBeforeWheel = await page.locator("#palettes .palette.active").getAttribute("data-palette");
    await page.locator("#palettes").hover();
    await page.mouse.wheel(0, 80);
    const wheelPreview = await page.locator("#palettes .palette.active").getAttribute("data-palette");
    assert.notEqual(wheelPreview, paletteBeforeWheel, "mouse wheel should temporarily preview the next palette");
    await page.locator("#paletteControl .controltitle").hover();
    assert.equal(await page.locator("#palettes .palette.active").getAttribute("data-palette"), paletteBeforeWheel,
      "leaving the palette grid should restore the previously committed selection");
    await page.locator("#palettes").hover();
    await page.mouse.wheel(0, 80);
    const paletteToCommit = await page.locator("#palettes .palette.active").getAttribute("data-palette");
    await page.locator(`#palettes .palette[data-palette="${paletteToCommit}"]`).click();
    await page.locator("#paletteControl .controltitle").hover();
    assert.equal(await page.locator("#palettes .palette.active").getAttribute("data-palette"), paletteToCommit,
      "clicking a wheel-previewed palette should commit it");
    await page.locator("#palettes .palette[data-palette=\"moss\"]").click();
    await page.locator("#algorithm").selectOption("floyd");
    assert.equal(await page.locator("#scale").getAttribute("min"), "1", "dither cell size should support full-resolution one-pixel detail");
    await page.locator("#scale").evaluate(el => { el.value = "1"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(await page.locator("#scale").inputValue(), "1", "the smallest detail size should be usable");
    await page.locator("#scale").evaluate(el => { el.value = "2"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#levels").evaluate(el => { el.value = "4"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#serpentine").uncheck();
    const standardScan = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await page.locator("#serpentineControl").click();
    assert.equal(await page.locator("#serpentine").isChecked(), true, "clicking the visible serpentine setting should enable it");
    const serpentineScan = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.notEqual(serpentineScan, standardScan, "serpentine scan should change error-diffusion pixels, not merely toggle UI state");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")).editor.serpentine), true,
      "serpentine scan preference should persist in the editor workspace");
    await page.locator("#serpentineControl").click();
    assert.equal(await page.locator("#serpentine").isChecked(), false, "clicking the visible serpentine setting should disable it");

    // Exercise each post-processing effect independently.
    for (const effect of await page.locator("#generalEffectsControl .effect-control .effect-toggle[role=checkbox][data-effect]").evaluateAll(els => els.map(el => el.dataset.effect))) {
      const toggle = page.locator('#effect-' + effect);
      assert.equal(await toggle.getAttribute("aria-checked"), "false", "effect should start unchecked: " + effect);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-checked"), "true", "checkbox-role control must respond to a real click: " + effect);
      assert.equal(await toggle.locator("xpath=..").evaluate(el => el.closest(".effect-control").classList.contains("is-active")), true,
        "active state should be reflected in the effect card: " + effect);
      assert.ok(await page.locator("#output").evaluate(c => c.width > 0 && c.height > 0), "effect failed to render: " + effect);
      await toggle.click();
      assert.equal(await toggle.getAttribute("aria-checked"), "false", "effect must turn off on a second click: " + effect);
    }

    const png = await downloadFrom(page, "#png");
    assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.match(png.download.suggestedFilename(), /TGRMLither.*\.png$/);

    const jpg = await downloadFrom(page, "#jpg");
    assert.equal(jpg.bytes[0], 0xff);
    assert.equal(jpg.bytes[1], 0xd8);

    const project = await downloadFrom(page, "#saveProject");
    const projectData = JSON.parse(project.bytes.toString("utf8"));
    assert.equal(projectData.format, "tgrmlither-project");
    assert.equal(projectData.workspace, "editor", "project files should remember their originating workspace");
    assert.ok(projectData.workspaces.shape.effects.includes("scanlines"), "projects should preserve Shape Lab settings");
    assert.ok(projectData.workspaces.script.effects.includes("scanlines"), "projects should preserve Script Slayer settings");
    assert.ok(projectData.source.startsWith("data:image/png;base64,"));
    await page.locator("#projectInput").setInputFiles({
      name: "roundtrip.tgrmlither.json",
      mimeType: "application/json",
      buffer: project.bytes
    });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor");

    // Legacy projects created before the rename must remain readable.
    const legacyProject = { ...projectData, format: "tgrmlithering-project", version: 1 };
    delete legacyProject.workspaces;
    await page.locator("#projectInput").setInputFiles({
      name: "legacy-project.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(legacyProject))
    });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor", "old project format should remain supported");

    // Project files must preserve and restore the exclusive Script Slayer workspace.
    await page.locator('.topnav [data-mode="script"]').click();
    const scriptProject = await downloadFrom(page, "#saveProject");
    const scriptProjectData = JSON.parse(scriptProject.bytes.toString("utf8"));
    assert.equal(scriptProjectData.workspace, "script");
    await page.locator("#projectInput").setInputFiles({
      name: "script-roundtrip.tgrmlither.json",
      mimeType: "application/json",
      buffer: scriptProject.bytes
    });
    await page.waitForFunction(() => document.body.dataset.mode === "script" && !document.querySelector("#asciiControl").classList.contains("hidden"));
    await page.locator("#homeLogo").click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor");

    const palette = await downloadFrom(page, "#exportPalette");
    const paletteData = JSON.parse(palette.bytes.toString("utf8"));
    assert.ok(Array.isArray(paletteData.colors) && paletteData.colors.length >= 2);
    await page.locator("#paletteInput").setInputFiles({
      name: "palette.json", mimeType: "application/json", buffer: palette.bytes
    });
    await page.locator("#paletteLibraryName").fill("QA palette");
    await page.locator("#savePaletteToLibrary").click();
    assert.equal(await page.locator("#paletteLibraryCount").textContent(), "1 / 100 сохранено");
    assert.equal(await page.locator("#paletteLibrarySelect").inputValue() && await page.locator("#paletteLibrarySelect option:checked").textContent(), "QA palette");
    const libraryState = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library")));
    assert.equal(libraryState.length, 1, "named palettes should persist locally");
    assert.equal(libraryState[0].name, "QA palette");
    await page.locator("#applyLibraryPalette").click();
    const libraryPack = await downloadFrom(page, "#exportPaletteLibrary");
    const libraryPackData = JSON.parse(libraryPack.bytes.toString("utf8"));
    assert.equal(libraryPackData.format, "tgrmlither-palette-library");
    assert.equal(libraryPackData.palettes.length, 1, "exported palette pack should contain the saved palette");
    await page.locator("#deleteLibraryPalette").click();
    assert.equal(await page.locator("#paletteLibraryCount").textContent(), "0 / 100 сохранено");
    await page.locator("#paletteLibraryInput").setInputFiles({name:"palette-library.json",mimeType:"application/json",buffer:libraryPack.bytes});
    await page.waitForFunction(() => document.querySelector("#paletteLibraryCount")?.textContent === "1 / 100 сохранено");
    assert.equal(await page.locator("#paletteLibrarySelect option:checked").textContent(), "QA palette", "palette pack import should restore named palettes");

    // Extract exactly the requested number of palette colours from the loaded image.
    await page.locator("#levels").evaluate(el => { el.value = "8"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#extractPalette").click();
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("ditherlab-colors")))).length, 8,
      "palette extraction should follow the selected colour depth");
    await page.locator("#levels").evaluate(el => { el.value = "4"; el.dispatchEvent(new Event("input", { bubbles: true })); });

    // Multi-colour palettes should remain intact beyond the original four-colour editor.
    const richPalette = { format: "tgrmlither-palette", version: 1, name: "Eight Tone QA",
      colors: ["#080a18", "#20284a", "#374c85", "#4b76b0", "#72a8c3", "#a4d0ce", "#d8e6c5", "#fff5dd"] };
    await page.locator("#paletteInput").setInputFiles({
      name: "eight-tone.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(richPalette))
    });
    await page.waitForFunction(() => {
      const data = JSON.parse(localStorage.getItem("tgrmlither-palette-library") || "[]");
      return data.some(p => p.name === "Eight Tone QA");
    });
    const richPaletteStored = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library")));
    const importedEightTone = richPaletteStored.find(p => p.name === "Eight Tone QA");
    assert.equal(importedEightTone.colors.length, 8, "importing a rich palette should preserve all eight colours");

    // Two- and three-colour files remain exactly as authored, not forced into four stops.
    const triplePalette = { format: "tgrmlither-palette", version: 1, name: "Three Tone QA",
      colors: ["#101020", "#6e5ca6", "#f6e8c3"] };
    await page.locator("#paletteInput").setInputFiles({
      name: "three-tone.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(triplePalette))
    });
    await page.waitForFunction(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library") || "[]")
      .some(p => p.name === "Three Tone QA"));
    const tripleSaved = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library"))
      .find(p => p.name === "Three Tone QA"));
    assert.deepEqual(tripleSaved.colors, triplePalette.colors, "three-colour palettes should keep every authored colour");
    assert.equal(await page.locator("#activePaletteEditor input[type=color]").count(), 3,
      "the editor should expose exactly three controls for a three-colour palette");
    assert.equal(await page.locator("#activePaletteEditor input[type=type]").count(), 0,
      "palette editor should not introduce arbitrary text inputs");
    const eightToneId = await page.locator("#paletteLibrarySelect option").evaluateAll(options => options.find(option => option.textContent.trim() === "Eight Tone QA")?.value);
    assert.ok(eightToneId, "the imported eight-colour palette should remain selectable after importing another palette");
    await page.locator("#paletteLibrarySelect").selectOption(eightToneId);
    await page.locator("#applyLibraryPalette").click();
    assert.equal(await page.locator("#activePaletteEditor input[type=color]").count(), 8,
      "the active palette editor should show one colour control per selected palette colour");
    await page.locator("#activePaletteEditor input[type=color]").nth(1).evaluate(el => {
      el.value = "#2a4566"; el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    let editedPalette = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library")));
    assert.equal(editedPalette.find(p => p.name === "Eight Tone QA").colors[1], "#2a4566",
      "editing an imported palette colour should persist the new value");
    await page.locator("#addPaletteColor").click();
    await page.waitForFunction(() => document.querySelector("#activePaletteMeta")?.textContent === "9 / 16 цветов");
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library")))).find(p => p.name === "Eight Tone QA").colors.length, 9, "adding a colour should persist a ninth palette stop");
    await page.locator("#activePaletteEditor button[aria-label^='Удалить цвет']").last().click();
    await page.waitForFunction(() => document.querySelector("#activePaletteMeta")?.textContent === "8 / 16 цветов");
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library")))).find(p => p.name === "Eight Tone QA").colors.length, 8, "deleting a colour should restore the original palette size");
    await page.locator("#levels").evaluate(el => { el.value = "16"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(await page.locator("#levels").inputValue(), "16", "the editor should expose up to 16 palette levels");
    await page.locator("#levels").evaluate(el => { el.value = "4"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.locator("#homeLogo").click();

    // Vector export supports print sizing and layered CMYK plates.
    await page.locator("#vectorDetail").selectOption("source");
    const blackSvg = await downloadFrom(page, "#svgBlack");
    const blackSvgText = blackSvg.bytes.toString("utf8");
    assert.match(blackSvgText, /viewBox="0 0 48 32"/, "source-detail black SVG should preserve the original coordinate grid");
    assert.match(blackSvgText, /width="4\.06mm"/, "SVG physical dimensions should follow source pixels and selected DPI");
    assert.match(blackSvgText, /data-dpi="300"/, "SVG export should record the selected print DPI");
    const cmykSvg = await downloadFrom(page, "#svgCmyk");
    const cmykSvgText = cmykSvg.bytes.toString("utf8");
    for (const plate of ["Cyan Plate", "Magenta Plate", "Yellow Plate", "Black Plate"]) assert.ok(cmykSvgText.includes(plate), "CMYK export should contain " + plate);
    assert.equal((cmykSvgText.match(/inkscape:groupmode="layer"/g) || []).length, 4, "CMYK export should create four named vector layers");

    const offline = await downloadFrom(page, "#offlineBtn");
    assert.match(offline.download.suggestedFilename(), /TGRMLither-offline\.html$/);
    assert.ok(offline.bytes.toString("utf8").includes("TGRMLither — Browser Image Studio"));
    assert.equal(await page.locator("#fullscreenBtn").count(), 1, "editor should provide an explicit full-screen control");
    assert.match(await page.locator("#fullscreenBtn").getAttribute("aria-label"), /весь экран/i);
    if (await page.evaluate(() => !!document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function")) {
      await page.locator("#fullscreenBtn").click();
      await page.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 3000 }).catch(() => {});
      const enteredFullscreen = await page.evaluate(() => !!document.fullscreenElement);
      if (enteredFullscreen) {
        await page.waitForFunction(() => /выйти/i.test(document.querySelector("#fullscreenBtn")?.getAttribute("aria-label") || ""), null, { timeout: 2000 });
        await page.locator("#fullscreenBtn").click();
        await page.waitForFunction(() => !document.fullscreenElement, null, { timeout: 3000 });
      }
    }

    // Video workspace should have a separate visible timeline and standard post-processing controls.
    await page.locator('.topnav [data-mode="video"]').click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "video");
    assert.equal(await page.locator("#videoView").isVisible(), true);
    assert.equal(await page.locator("#videoTimeline").isVisible(), true);
    assert.equal(await page.locator("#algorithmStackControl").isVisible(), false, "video controls remain outside the still-image algorithm stack");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), false, "Video Lab should not reuse Editor's effect stack");
    assert.equal(await page.locator("#videoEffectsControl").isVisible(), true, "Video Lab has an independent effect stack");
    assert.equal(await page.locator("#asciiControl").isVisible(), false);
    assert.equal(await page.locator("#shapeControl").isVisible(), false);
    assert.equal(await page.locator("#algorithm").isVisible(), true, "video workspace should retain algorithm selection");

    // Generate a tiny, valid WebM in-browser and test video input, scrubbing and rendered-video export.
    const videoDataURL = await page.evaluate(async () => {
      const canvas = document.createElement("canvas");
      canvas.width = 48; canvas.height = 32;
      const ctx = canvas.getContext("2d");
      const mime = ["video/webm;codecs=vp8", "video/webm"].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime || !canvas.captureStream) throw new Error("WebM recording is unsupported in test browser");
      const stream = canvas.captureStream(12);
      const recorder = new MediaRecorder(stream, { mimeType: mime });
      const chunks = [];
      let resolveBlob;
      const stopped = new Promise(resolve => { resolveBlob = resolve; });
      recorder.ondataavailable = event => { if (event.data && event.data.size) chunks.push(event.data); };
      recorder.onstop = async () => {
        const blob = new Blob(chunks, { type: mime });
        const reader = new FileReader();
        reader.onload = () => resolveBlob(reader.result);
        reader.readAsDataURL(blob);
      };
      recorder.start();
      for (let i = 0; i < 16; i++) {
        ctx.fillStyle = "#172b46";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "rgb(" + (i * 13 % 255) + ",120,210)";
        ctx.fillRect(i * 2, 8, 12, 12);
        await new Promise(resolve => setTimeout(resolve, 80));
      }
      recorder.stop();
      stream.getTracks().forEach(track => track.stop());
      return await stopped;
    });
    const videoBuffer = Buffer.from(videoDataURL.split(",")[1], "base64");
    assert.ok(videoBuffer.length > 500, "test video should contain encoded frames");
    await page.locator("#videoInput").setInputFiles({ name: "qa-video.webm", mimeType: "video/webm", buffer: videoBuffer });
    await page.waitForFunction(() => {
      const video = document.querySelector("#videoSource");
      return video && Number.isFinite(video.duration) && video.duration > 0;
    }, null, { timeout: 20000 });
    assert.match(await page.locator("#videoFilename").textContent(), /qa-video\.webm/);
    assert.ok(Number(await page.locator("#videoTimeline").getAttribute("max")) > 0, "video timeline should have a duration");
    await page.locator("#videoTimeline").evaluate(el => {
      el.value = String(Math.min(0.3, Number(el.max)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.ok(await page.locator("#videoOutput").evaluate(canvas => canvas.width > 0 && canvas.height > 0),
      "video frame should be processed onto the output canvas");
    const [videoDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 20000 }),
      page.locator("#videoExport").click()
    ]);
    assert.match(videoDownload.suggestedFilename(), /TGRMLither\.webm$/);
    assert.ok(fs.statSync(await videoDownload.path()).size > 500, "exported video should contain data");

    // Batch processing should accept and produce a real PNG.
    await page.locator('.topnav [data-mode="batch"]').click();
    await page.locator("#batchInput").setInputFiles({
      name: "batch-fixture.png", mimeType: "image/png", buffer: imageBuffer
    });
    assert.equal(await page.locator("#batchList .fileitem").count(), 1);
    await page.locator("#runBatch").click();
    await page.waitForFunction(() => document.querySelectorAll("#batchResults a[download]").length === 1, null, { timeout: 15000 });
    assert.match(await page.locator("#batchResults a[download]").getAttribute("download"), /TGRMLither\.png$/);

    await page.locator("#batch-effect-scanlines").click();
    assert.equal(await page.locator("#batch-effect-scanlines").getAttribute("aria-checked"), "true");
    const batchProfileAfterClick = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "null")?.batch?.effects || []; }
      catch { return ["<invalid-json>"]; }
    });
    assert.ok(batchProfileAfterClick.includes("scanlines"), "effect click should persist to the batch profile: " + JSON.stringify(batchProfileAfterClick));
    await page.locator("#homeLogo").click();
    assert.equal(await page.locator("#effect-scanlines").getAttribute("aria-checked"), "false", "batch effects must not leak into Editor");
    const batchProfileAfterSwitch = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "null")?.batch?.effects || []; }
      catch { return ["<invalid-json>"]; }
    });
    assert.ok(batchProfileAfterSwitch.includes("scanlines"), "leaving Batch should not overwrite its profile: " + JSON.stringify(batchProfileAfterSwitch));
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#output")?.width > 0);
    const batchProfileAfterReload = await page.evaluate(() => {
      try { return JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "null")?.batch?.effects || []; }
      catch { return ["<invalid-json>"]; }
    });
    assert.ok(batchProfileAfterReload.includes("scanlines"), "browser storage should retain Batch after reload: " + JSON.stringify(batchProfileAfterReload));
    await page.locator('.topnav [data-mode="batch"]').click();
    const restoredBatch = await page.evaluate(() => ({
      mode: document.body.dataset.mode,
      checked: document.querySelector("#batch-effect-scanlines")?.getAttribute("aria-checked"),
      stored: (() => { try { return JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "null")?.batch?.effects || []; } catch { return ["<invalid-json>"]; } })()
    }));
    assert.equal(restoredBatch.checked, "true", "workspace settings should persist after reload: " + JSON.stringify(restoredBatch));
    await page.locator('.topnav [data-mode="shape"]').click();
    assert.equal(await page.locator("#shape-effect-scanlines").getAttribute("aria-checked"), "true", "Shape Lab effects should persist independently");
    await page.locator("#shape-effect-scanlines").evaluate(el => el.setAttribute("aria-checked", "false"));
    await page.locator("#homeLogo").click();
    await page.locator('.topnav [data-mode="shape"]').click();
    assert.equal(await page.locator("#shape-effect-scanlines").getAttribute("aria-checked"), "true", "workspace activation should resync stale hidden controls from saved state");
    await page.locator("#homeLogo").click();
    await page.locator('.topnav [data-mode="script"]').click();
    assert.equal(await page.locator("#script-effect-scanlines").getAttribute("aria-checked"), "true", "Script Slayer effects should survive reload");

    assert.deepEqual(errors, [], "the app should not throw uncaught browser runtime errors");
    console.log("TGRMLither smoke tests passed: workspace isolation, click-tested effects, responsive layout, every algorithm, project/palette/image exports, video timeline/WebM export, and batch processing.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
