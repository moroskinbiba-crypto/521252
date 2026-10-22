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

    // Exercise every algorithm option so a broken branch cannot hide behind a valid default.
    const algorithms = await page.locator("#algorithm option").evaluateAll(options => options.map(option => option.value));
    assert.ok(algorithms.length >= 60, "all advertised processing algorithms should be present");
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
    }
    await page.locator("#algorithm").selectOption("floyd");

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
