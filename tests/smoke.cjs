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
    const setRange = async (selector, value) => {
      await page.locator(selector).evaluate((el, next) => {
        el.value = String(next);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }, value);
      // Continuous preview updates are intentionally coalesced into the next animation frame.
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    };
    page.on("pageerror", error => errors.push(error.stack || error.message));
    await page.addInitScript(async () => {
      if ("caches" in window && /^https?:/.test(location.protocol)) {
        const cache = await caches.open("unrelated-test-cache");
        await cache.put(new URL("./unrelated-test-entry", location.href).href, new Response("keep"));
      }
    });

    await page.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#output");
      return canvas && canvas.width > 0 && canvas.height > 0 &&
        document.querySelector("#statAlgorithm")?.textContent.trim();
    }, null, { timeout: 15000 });

    // Exercise the real OffscreenCanvas worker with an image above its activation threshold.
    const largeWorkerFixture = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1024; canvas.height = 900;
      const ctx = canvas.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 1024, 900);
      gradient.addColorStop(0, "#102030");
      gradient.addColorStop(.5, "#b07038");
      gradient.addColorStop(1, "#e0f0d0");
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, canvas.width, canvas.height);
      for (let y = 0; y < canvas.height; y += 17) {
        ctx.fillStyle = "rgba(20, 80, 120, .35)";
        ctx.fillRect((y * 19) % canvas.width, y, 180, 8);
      }
      return canvas.toDataURL("image/png");
    });
    const largeWorkerBuffer = Buffer.from(largeWorkerFixture.split(",")[1], "base64");
    await page.locator("#imageInput").setInputFiles({
      name: "worker-large-fixture.png", mimeType: "image/png",
      buffer: largeWorkerBuffer
    });
    await page.waitForFunction(() =>
      document.querySelector("#filename")?.textContent.includes("worker-large-fixture.png")
    );
    await page.waitForFunction(() =>
      document.body.dataset.processingEngine === "worker" &&
      document.body.dataset.processingPending === "false",
      null, { timeout: 30000 }
    );
    const workerPreview = await page.evaluate(() => ({
      available: document.body.dataset.processingWorker === "available",
      engine: document.body.dataset.processingEngine,
      pending: document.body.dataset.processingPending,
      width: document.querySelector("#output").width,
      height: document.querySelector("#output").height
    }));
    assert.equal(workerPreview.available, true, "large previews should initialize the OffscreenCanvas worker");
    assert.equal(workerPreview.engine, "worker", "large image processing should run in the worker");
    assert.ok(workerPreview.width > 0 && workerPreview.height > 0, "the worker should return a drawable preview bitmap");
    await page.evaluate(() => window.__tgrmlitherWaitForPreview());
    const workerResources = await page.evaluate(() => window.__tgrmlitherResourceStatus?.());
    assert.ok(workerResources, "localhost QA should expose resource counters");
    assert.equal(workerResources.scratchCanvasOutstanding, 0, "main-thread scratch canvases should be released after rendering");
    assert.ok(workerResources.workerResources?.scratchCanvasesCreated > 0, "the Worker should report tracked scratch canvas allocations");
    assert.equal(workerResources.workerResources.scratchCanvasesCreated, workerResources.workerResources.scratchCanvasesReleased,
      "all worker scratch canvases, including the output surface, should be released after transferring the frame");
    assert.equal(workerResources.workerResources.sourceCount, 1, "the Worker should retain only the current source bitmap");
    assert.equal(workerResources.workerResources.sourcePixels, 1024 * 900, "worker source retention should match the bounded input image");
    const unrelatedCachePreserved = await page.evaluate(async () => {
      if (!("serviceWorker" in navigator) || !("caches" in window)) return true;
      await navigator.serviceWorker.ready;
      return (await caches.keys()).includes("unrelated-test-cache");
    });
    assert.equal(unrelatedCachePreserved, true, "the app must not delete caches owned by other apps on the same origin");

    assert.match(await page.title(), /^TGRMLither/);
    const manifestResponse = await page.request.get(new URL("./manifest.webmanifest", baseURL).href);
    assert.equal(manifestResponse.status(), 200, "PWA manifest should be reachable");
    const manifest = await manifestResponse.json();
    assert.equal(manifest.theme_color, "#11130f", "installed PWA theme should match the default app theme");
    assert.equal(manifest.background_color, "#11130f", "installed PWA background should match the default app theme");
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#11130f");
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor");
    assert.match(await page.locator("#homeLogo").innerText(), /TGRMLither/, "new product name must be visible in the app header");
    await page.locator("#projectInput").setInputFiles({ name: "invalid-project.json", mimeType: "application/json", buffer: Buffer.from("{ invalid") });
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent === "Неверный файл проекта");
    assert.equal(await page.locator("#projectInput").inputValue(), "", "project input should remain reusable after a bad file");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), true, "regular effects should be visible in Editor");
    assert.equal(await page.locator("#asciiControl").isVisible(), false, "Script Slayer panel should be isolated from Editor");
    assert.equal(await page.locator("#shapeControl").isVisible(), false, "Shape Lab panel should be isolated from Editor");

    // Effect stack arrows must reorder the visible list, not only its saved processing order.
    const initialEffectOrder = await page.locator("#generalEffectsControl .effects .effect-control").evaluateAll(rows =>
      rows.map(row => row.querySelector("[data-effect]")?.dataset.effect));
    assert.equal(initialEffectOrder[0], "scanlines");
    const glowEffectRow = page.locator("#generalEffectsControl .effect-control:has(#effect-glow)");
    await glowEffectRow.locator(".effect-order-actions button").first().click();
    const movedEffectOrder = await page.locator("#generalEffectsControl .effects .effect-control").evaluateAll(rows =>
      rows.map(row => row.querySelector("[data-effect]")?.dataset.effect));
    assert.equal(movedEffectOrder[0], "glow", "moving Soft Glow up should move its visible control to the top");
    assert.equal(movedEffectOrder[1], "scanlines");
    assert.equal(await glowEffectRow.locator(".effect-order-actions button").first().isDisabled(), true,
      "the top effect should disable its move-up action");
    const storedEffectOrder = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")).editor.effectOrder);
    assert.deepEqual(storedEffectOrder.slice(0, 2), ["glow", "scanlines"],
      "visual effect order should persist to the active workspace");
    await glowEffectRow.locator(".effect-order-actions button").nth(1).click();
    assert.deepEqual(
      await page.locator("#generalEffectsControl .effects .effect-control").evaluateAll(rows =>
        rows.map(row => row.querySelector("[data-effect]")?.dataset.effect)),
      initialEffectOrder,
      "moving the effect back down should restore the original visible order"
    );
    const theme = await page.evaluate(() => ({
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(document.querySelector("#pageTitle")).fontFamily,
      background: getComputedStyle(document.body).backgroundColor,
      fontStylesheet: document.querySelector('link[rel="stylesheet"][href*="fonts.googleapis.com"]')?.href || ""
    }));
    assert.match(theme.bodyFont, /Tahoma/, "Windows XP Luna should use the native-style Tahoma interface font");
    assert.match(theme.headingFont, /Tahoma/, "XP headings should use the same native-style font family");
    assert.ok(theme.fontStylesheet.includes("family=Onest"), "Onest web font must be included");
    assert.ok(theme.fontStylesheet.includes("IBM+Plex+Mono"), "IBM Plex Mono must be included for technical labels");
    const markupAudit = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map(el => el.id);
      return { duplicates: ids.filter((id, i) => ids.indexOf(id) !== i), modeButtons: [...document.querySelectorAll(".topnav [data-mode]")].map(el => el.dataset.mode) };
    });
    assert.deepEqual(markupAudit.duplicates, [], "runtime-generated workspace panels must not create duplicate IDs");
    assert.deepEqual(markupAudit.modeButtons, ["editor", "presets", "shape", "script", "batch", "video"]);
    assert.equal(await page.locator("body").getAttribute("data-shell"), "xp", "Windows XP Luna is the default shell");
    assert.equal(await page.locator("#xpShellStyles").getAttribute("media"), "all", "XP shell styles should be active on startup");
    const xpVisual = await page.evaluate(() => ({
      panel: getComputedStyle(document.body).getPropertyValue("--panel").trim(),
      titleBlue: getComputedStyle(document.body).getPropertyValue("--xp-title").trim(),
      buttonRadius: getComputedStyle(document.querySelector(".btn")).borderRadius,
      inputBackground: getComputedStyle(document.querySelector("#algorithm")).backgroundColor,
      titlebar: getComputedStyle(document.querySelector("header")).backgroundImage
    }));
    assert.equal(xpVisual.panel, "#ece9d8", "XP shell should use the classic light-gray window chrome");
    assert.equal(xpVisual.titleBlue, "#0054e3", "XP shell should use the saturated Luna blue title-bar palette");
    assert.equal(xpVisual.buttonRadius, "0px", "XP controls should use crisp square geometry");
    assert.equal(xpVisual.inputBackground, "rgb(255, 255, 255)", "XP inputs should use classic white inset controls");
    assert.match(xpVisual.titlebar, /linear-gradient/, "XP header should use a full Luna blue title-bar gradient");
    assert.equal(await page.locator("#smoothingControl").isVisible(), false, "advanced processing controls should be tucked away in basic mode");
    await page.locator("#advancedToggle").click();
    assert.equal(await page.locator("#smoothingControl").isVisible(), true, "advanced controls should expand from the inspector");
    await page.locator("#advancedToggle").click();
    assert.equal(await page.locator("#smoothingControl").isVisible(), false, "advanced controls should collapse again");
    await page.locator("#algorithmSearch").fill("Floyd");
    assert.equal(await page.locator('#algorithm option[value="floyd"]').count(), 1, "algorithm search should leave matching choices selectable");
    await page.locator("#algorithmSearch").fill("");
    await page.locator("#favoriteAlgorithm").click();
    assert.equal(await page.locator("#favoriteAlgorithm").getAttribute("aria-pressed"), "true");
    await page.locator("#algorithmFavoritesOnly").click();
    assert.deepEqual(await page.locator("#algorithm option").evaluateAll(options => options.filter(o => !o.disabled).map(o => o.value)), ["bayer4"],
      "favourites-only mode should filter to pinned algorithms");
    await page.locator("#algorithmFavoritesOnly").click();
    await page.locator("#favoriteAlgorithm").click();
    assert.equal(await page.locator("#favoriteAlgorithm").getAttribute("aria-pressed"), "false",
      "algorithm favourite should be removable");

    // Theme picker, local persistence and safe, shareable theme codes.
    await page.locator("#themeMenu > summary").click();
    await page.locator("#shellPicker").selectOption("xp");
    assert.equal(await page.locator("body").getAttribute("data-shell"), "xp", "XP shell should be independently selectable");
    assert.equal(await page.locator("#xpShellStyles").getAttribute("media"), "all");
    await page.locator("#shellPicker").selectOption("studio");
    assert.equal(await page.locator("body").getAttribute("data-shell"), "studio");
    assert.equal(await page.locator("#xpShellStyles").getAttribute("media"), "not all");
    await page.locator("#themePicker").selectOption("terminal");
    assert.equal(await page.locator("body").getAttribute("data-theme"), "terminal");
    assert.equal(await page.locator('meta[name="theme-color"]').getAttribute("content"), "#07140c", "browser chrome color should follow the selected theme");
    assert.ok(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-theme")).vars["--acid"] === "#72ffa0"),
      "theme choice should persist locally");
    await page.locator("#makeThemeCode").click();
    const themeCode = await page.locator("#themeCodeInput").inputValue();
    assert.ok(themeCode.startsWith("TGRMTHEME1:"), "theme sharing should generate a portable code");
    await page.locator("#themePicker").selectOption("paper");
    assert.equal(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme), "light", "Paper theme should switch native controls to a light color scheme");
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
    const inheritedThemeCode = "TGRMTHEME1:" + Buffer.from(JSON.stringify({
      format: "tgrmlither-theme", version: 1, id: "constructor",
      vars: { "--bg": "#11130f", "--panel": "#191c17", "--panel2": "#20241e", "--line": "#30372c",
        "--text": "#eff3e9", "--muted": "#9aa393", "--acid": "#cafa6a", "--purple": "#b5a3ff" }
    })).toString("base64url");
    await page.locator("#themeCodeInput").fill(inheritedThemeCode);
    await page.locator("#applyThemeCode").click();
    assert.equal(await page.locator("body").getAttribute("data-theme"), "custom",
      "inherited object properties must not be treated as built-in themes");
    await page.locator("#themePicker").selectOption("night");

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
    // Clear effects randomized by the earlier Shuffle test without triggering several costly renders.
    await page.evaluate(() => {
      const key = "tgrmlithering-workspaces";
      const profiles = JSON.parse(localStorage.getItem(key) || "{}");
      profiles.editor = profiles.editor || {};
      profiles.editor.effects = [];
      profiles.editor.effectStrength = { ...(profiles.editor.effectStrength || {}), scanlines: 0 };
      localStorage.setItem(key, JSON.stringify(profiles));
    });
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#output")?.width > 0);
    // Use a deterministic algorithm so repeated preview renders can be compared byte-for-byte.
    await page.locator("#algorithm").selectOption("bayer4");
    // An enabled effect at zero intensity must not trigger a redundant post-processing resize.
    const beforeNoOpEffect = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await setRange('#generalEffectsControl [data-effect-strength="scanlines"]', 0);
    await page.locator("#effect-scanlines").click();
    const afterNoOpEffect = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.equal(afterNoOpEffect, beforeNoOpEffect,
      "an enabled effect at zero strength must leave the rendered pixels unchanged");
    await page.locator("#effect-scanlines").click();
    await setRange('#generalEffectsControl [data-effect-strength="scanlines"]', 50);

    // Rendering at an unchanged size should reuse the existing canvas backing store.
    const expectedOutputContext = await page.locator("#output").evaluate(canvas => {
      const context = canvas.getContext("2d");
      context.fillStyle = "#123456";
      context.globalAlpha = 0.37;
      return { fillStyle: context.fillStyle, globalAlpha: context.globalAlpha };
    });
    await page.locator("#algorithm").selectOption("floyd");
    const reusedOutputContext = await page.locator("#output").evaluate(canvas => {
      const context = canvas.getContext("2d");
      return { fillStyle: context.fillStyle, globalAlpha: context.globalAlpha };
    });
    assert.deepEqual(reusedOutputContext, expectedOutputContext,
      "same-size preview renders should not reset the output canvas backing store");

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
      el.value = "7";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(300);
    await page.locator("#scale").evaluate(el => {
      el.value = "9";
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.equal((await page.locator("#scaleV").textContent()).trim(), "9 px");
    await page.waitForTimeout(300);
    await page.locator("#undo").click();
    await page.waitForFunction(() => document.querySelector("#scale")?.value === "7");
    await page.locator("#redo").click();
    await page.waitForFunction(() => document.querySelector("#scale")?.value === "9");
    assert.equal((await page.locator("#scaleV").textContent()).trim(), "9 px", "redo should restore the edited scale");
    const qualityOptions = await page.locator("#qualityMode option").evaluateAll(options => options.map(o => o.value));
    assert.deepEqual(qualityOptions, ["balanced", "detail", "max", "ultra"], "still-image detail budget options should include UHD processing");
    await page.locator("#qualityMode").selectOption("ultra");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")).editor.qualityMode), "ultra",
      "UHD processing mode should persist with the workspace");
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
    await page.waitForFunction(() => {
      const shape = JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").shape;
      return shape?.shapeBands?.[0]?.shape === "custom" &&
        shape.shapeBands[0].customPath === "M5 0 L10 10 L0 10 Z";
    }, null, { timeout: 5000 });
    await page.reload({ waitUntil: "load" });
    await page.locator('.topnav [data-mode="shape"]').click();
    await page.waitForFunction(() => document.querySelector("#bandShape0")?.value === "custom",
      null, { timeout: 5000 });
    assert.equal(await page.locator("#bandShape0").inputValue(), "custom",
      "custom SVG shape assignment should survive a reload");
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
    await setRange("#bandRotation0", "67");
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
    assert.equal(await page.locator("#neoGlowPhase").inputValue(), "50", "Neo Glow should start centered on the preview");
    assert.equal(await page.locator("#neoGlowEnabled").getAttribute("aria-checked"), "false", "Neo Glow should initially be off unless the saved user profile enables it");
    await page.locator("#asciiColorMode").selectOption("mono");
    await setRange("#asciiTextColor", "#222222");
    await setRange("#neoGlowColor", "#ff00ff");
    
    await setRange("#neoGlowLength", 30);
    await setRange("#neoGlowBrightness", 100);
    await setRange("#neoGlowVisibility", 0);
    await setRange("#neoGlowPhase", 50);
    await page.locator("#neoGlowEnabled").click();
    assert.equal(await page.locator("#neoGlowEnabled").getAttribute("aria-checked"), "true", "Neo Glow toggle must stay on after clicking");
    const centeredGlow = await page.locator("#output").evaluate(canvas => {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let center = 0, edges = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i] > 170 && pixels[i + 1] < 100 && pixels[i + 2] > 170 && pixels[i + 3] > 80) {
          if (x >= canvas.width * .35 && x <= canvas.width * .65) center++;
          if (x <= canvas.width * .12 || x >= canvas.width * .88) edges++;
        }
      }
      return { center, edges };
    });
    assert.ok(centeredGlow.center > 10, "enabled Neo Glow should render a visible neon band around the center of the ASCII output");
    await setRange("#neoGlowPhase", 0);
    const edgePositionGlow = await page.locator("#output").evaluate(canvas => {
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let center = 0, edges = 0;
      for (let y = 0; y < canvas.height; y++) for (let x = 0; x < canvas.width; x++) {
        const i = (y * canvas.width + x) * 4;
        if (pixels[i] > 170 && pixels[i + 1] < 100 && pixels[i + 2] > 170 && pixels[i + 3] > 80) {
          if (x >= canvas.width * .35 && x <= canvas.width * .65) center++;
          if (x <= canvas.width * .12 || x >= canvas.width * .88) edges++;
        }
      }
      return { center, edges };
    });
    assert.ok(edgePositionGlow.edges > centeredGlow.edges, "moving the Neo Glow position to the edge should move the neon band, not leave it pinned in place");
    await page.locator("#neoGlowEnabled").click();
    assert.equal(await page.locator("#neoGlowEnabled").getAttribute("aria-checked"), "false", "Neo Glow toggle must turn off after a second click");
    assert.equal(await page.locator("#neoGlowPhaseV").textContent(), "0%");
    await setRange("#neoGlowPhase", 50);
    await page.locator("#neoGlowEnabled").click();
    assert.equal(await page.locator("#neoGlowEnabled").getAttribute("aria-checked"), "true", "Neo Glow toggle must stay on after clicking");
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
    assert.equal(tablet.topNavCount, 6, "Editor and every workspace must be available in the top navigation");
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
      assert.equal(mobile.workspaceNavCount, 6, "Editor and every workspace must remain reachable from the touch navigation");
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
    const mobileTouchTargets = await page.evaluate(() => {
      const selectors = ["#topExport", '.topnav [data-mode="editor"]', "#algorithm", "#scale", "#effect-scanlines"];
      return selectors.map(selector => {
        const el = document.querySelector(selector), rect = el?.getBoundingClientRect();
        return { selector, height: rect?.height || 0, visible: !!el && getComputedStyle(el).display !== "none" && rect.width > 0 };
      });
    });
    for (const target of mobileTouchTargets) {
      assert.equal(target.visible, true, "mobile control should remain visible: " + target.selector);
      assert.ok(target.height >= 30, "mobile control should have a comfortable touch target: " + JSON.stringify(target));
    }
    await page.locator('.topnav [data-mode="script"]').click();
    assert.equal(await page.locator("#asciiControl").isVisible(), true, "Script Slayer must remain accessible from mobile navigation");
    await page.locator(".topnav").evaluate(el => { el.scrollLeft = el.scrollWidth; });
    assert.ok(await page.locator('.topnav [data-mode="video"]').isVisible(), "Video Lab navigation must stay reachable by horizontal nav scrolling");
    await page.locator(".topnav [data-mode=\"video\"]").click();
    assert.equal(await page.locator("#videoView").isVisible(), true, "Video Lab should open on mobile");
    await page.locator(".topnav [data-mode=\"presets\"]").click();
    assert.ok(await page.locator("#presetGrid .preset").first().isVisible(), "presets should render in the mobile layout");
    await page.locator("#presetSearch").fill("tgrm-no-match-qa");
    assert.equal(await page.locator("#presetGrid .preset").count(), 0, "preset search should filter unmatched built-in presets");
    await page.locator("#presetSearch").fill("");
    assert.ok(await page.locator("#presetGrid .preset").count() > 0, "clearing preset search should restore the catalogue");
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
    // The image loading overlay must appear before decoding and disappear after success.
    await page.evaluate(() => {
      const NativeImage = window.Image;
      const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
      function DelayedImage() {
        const image = new NativeImage();
        Object.defineProperty(image, "src", {
          configurable: true,
          get: () => src.get.call(image),
          set: value => setTimeout(() => src.set.call(image, value), 300)
        });
        return image;
      }
      window.__tgrmNativeImage = NativeImage;
      window.Image = DelayedImage;
    });
    await page.locator("#imageInput").setInputFiles({
      name: "qa-fixture.png", mimeType: "image/png", buffer: imageBuffer
    });
    await page.waitForFunction(() => {
      const overlay = document.querySelector("#imageLoading");
      return overlay && !overlay.classList.contains("hidden");
    }, null, { timeout: 5000 });
    assert.equal(await page.locator("#stage").getAttribute("aria-busy"), "true",
      "image decoding should mark the preview stage as busy");
    assert.match(await page.locator("#imageLoadingDetail").textContent(), /КБ|МБ|Б/,
      "loading overlay should show the file size");
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));
    await page.waitForFunction(() => document.querySelector("#stage")?.getAttribute("aria-busy") === "false");
    assert.equal(await page.locator("#imageLoading").isVisible(), false,
      "image loading overlay should disappear after successful decoding");
    await page.evaluate(() => { window.Image = window.__tgrmNativeImage; delete window.__tgrmNativeImage; });

    // A corrupt image must not replace the last valid image or leave the stage busy.
    await page.locator("#imageInput").setInputFiles({
      name: "broken-image.png", mimeType: "image/png", buffer: Buffer.from("not a PNG")
    });
    await page.waitForFunction(() => /Не удалось открыть файл изображения/.test(document.querySelector("#toast")?.textContent || ""));
    assert.ok((await page.locator("#filename").textContent()).includes("qa-fixture.png"),
      "a failed image load should leave the previous preview intact");
    assert.equal(await page.locator("#stage").getAttribute("aria-busy"), "false");
    assert.equal(await page.locator("#imageInput").inputValue(), "",
      "image input should remain reusable after a failed file");

    const dragHighlight = await page.evaluate(() => {
      const stage = document.querySelector("#stage"), inner = document.querySelector("#canvaswrap");
      const transfer = new DataTransfer();
      transfer.items.add(new File(["x"], "drag.png", { type: "image/png" }));
      stage.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer }));
      const entered = stage.classList.contains("drag");
      inner.dispatchEvent(new DragEvent("dragenter", { bubbles: true, dataTransfer: transfer, relatedTarget: stage }));
      inner.dispatchEvent(new DragEvent("dragleave", { bubbles: true, dataTransfer: transfer, relatedTarget: stage }));
      const stayedWhileInside = stage.classList.contains("drag");
      stage.dispatchEvent(new DragEvent("dragleave", { bubbles: true, dataTransfer: transfer, relatedTarget: document.body }));
      return { entered, stayedWhileInside, cleared: !stage.classList.contains("drag") };
    });
    assert.deepEqual(dragHighlight, { entered: true, stayedWhileInside: true, cleared: true },
      "drag highlight should remain stable over nested preview elements and clear on exit");

    await page.locator("#imageInput").setInputFiles({
      name: "qa-fixture.png", mimeType: "image/png", buffer: imageBuffer
    });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));
    assert.deepEqual(await page.locator("#output").evaluate(c => [c.width, c.height]), [48, 32]);
    const oversizedSvg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="40000" height="1" viewBox="0 0 40000 1"><rect width="40000" height="1" fill="#246"/></svg>`);
    await page.locator("#imageInput").setInputFiles({ name: "oversized-source.svg", mimeType: "image/svg+xml", buffer: oversizedSvg });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("oversized-source.svg"));
    const safeSourceSize = await page.locator("#output").evaluate(c => [c.width, c.height]);
    assert.ok(safeSourceSize[0] <= 32767 && safeSourceSize[1] <= 32767, "source canvas dimensions must remain below the browser-safe edge limit");
    assert.match(await page.locator("#toast").textContent(), /уменьшено для стабильной обработки/, "oversized images should get a clear downscale warning");
    await page.locator("#imageInput").setInputFiles({ name: "qa-fixture.png", mimeType: "image/png", buffer: imageBuffer });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));
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
    await page.locator("#advancedToggle").click();
    assert.equal(await page.locator("#advancedToggle").getAttribute("aria-pressed"), "true", "advanced options should be available for the full algorithm QA sweep");

    // Exercise every algorithm option so a broken branch cannot hide behind a valid default.
    const algorithms = await page.locator("#algorithm option").evaluateAll(options => options.map(option => option.value));
    const coreAlgorithms = algorithms.filter(value => !["shape", "ascii"].includes(value));
    assert.equal(coreAlgorithms.length, 65, "expected 65 still-image algorithm choices including the Beehive hexagonal mode");
    assert.ok(algorithms.includes("bayer16") && algorithms.includes("blueNoise") && algorithms.includes("beehive"), "Bayer 16×16, Blue Noise and Beehive must be registered as real algorithms");
    const diffusionAlgorithms = ["floyd", "atkinson", "jarvis", "stucki", "burkes", "sierra", "sierra2", "sierraLite", "fan", "shiau2", "shiau3", "stevenson", "falseFloyd", "twoRow", "simpleDiff"];
    const orderedAlgorithms = ["bayer2", "bayer4", "bayer8", "bayer16", "blueNoise", "clustered4", "clustered8", "beehive"];
    const patternDithers = ["halftone", "crosshatch", "diagonal", "waves", "concentric", "lines", "modulation", "spiral"];
    assert.ok(diffusionAlgorithms.every(algorithm => coreAlgorithms.includes(algorithm)), "all 15 error-diffusion kernels must be selectable");
    assert.ok(orderedAlgorithms.every(algorithm => coreAlgorithms.includes(algorithm)), "all ordered dithering matrices must be selectable");
    assert.ok(patternDithers.every(algorithm => coreAlgorithms.includes(algorithm)), "all eight pattern modes must be selectable");
    assert.equal(coreAlgorithms.filter(algorithm => algorithm.startsWith("glitch_")).length, 17, "the Glitch family should contain 17 choices");
    assert.equal(coreAlgorithms.filter(algorithm => algorithm.startsWith("special_")).length, 16, "the Special family should contain 16 choices");
    assert.ok(coreAlgorithms.includes("pixel"), "Pixel Poster must be present as a basic mode");
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
    await setRange("#scale", "2");
    await setRange("#levels", "2");
    await page.locator("#algorithm").selectOption("halftone");
    await page.locator("#patternShape").selectOption("circle");
    await setRange("#patternAngle", "0");
    const halftoneAngle0 = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await setRange("#patternAngle", "45");
    const halftoneAngle45 = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.notEqual(halftoneAngle0, halftoneAngle45, "Halftone screen angle should rotate the dot grid even when dots are circular");
    await page.locator("#algorithm").selectOption("bayer16");
    const bayer16Output = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await page.locator("#algorithm").selectOption("blueNoise");
    const blueNoiseOutput = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.notEqual(blueNoiseOutput, bayer16Output, "Blue Noise must produce a distinct, real threshold pattern");
    await page.locator("#algorithm").selectOption("bayer16");
    assert.equal(await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png")), bayer16Output,
      "Bayer 16×16 output should be deterministic");
    await page.locator("#algorithm").selectOption("beehive");
    assert.equal(await page.locator("#markScaleControl").isVisible(), true, "pattern mark scale should appear for Beehive");
    await setRange("#markScale", 40);
    const beehiveSmall = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await setRange("#markScale", 165);
    const beehiveLarge = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.notEqual(beehiveSmall, beehiveLarge, "mark scale should resize hexagonal marks independently of cell size");
    await setRange("#markScale", 100);
    await page.locator("#algorithm").selectOption("floyd");
    const fullStrengthOutput = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await setRange("#blend", 0);
    const originalBlendOutput = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.notEqual(fullStrengthOutput, originalBlendOutput, "zero blend should return the original image, not the processed pixels");
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")).editor.blend), 0, "blend amount should persist in workspace settings");
    await setRange("#blend", 100);
    const crispOutput = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await setRange("#smoothing", "100");
    const softenedOutput = await page.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.notEqual(crispOutput, softenedOutput, "smoothing should visibly blend a blurred pass into the processed image");
    await setRange("#smoothing", "0");
    const gameboyPalette = page.locator("#palettes .palette[data-palette=\"gameboy\"]");
    assert.equal(await gameboyPalette.count(), 1, "the Game Boy retro palette must be available");
    await gameboyPalette.click();
    assert.ok(await gameboyPalette.evaluate(el => el.classList.contains("active")), "built-in palette should become active on click");
    const pico8Palette = page.locator("#palettes .palette[data-palette=\"pico8\"]");
    const db16Palette = page.locator("#palettes .palette[data-palette=\"db16\"]");
    assert.equal(await pico8Palette.locator(".swatches i").count(), 16, "PICO-8 should expose its full 16-colour palette");
    assert.equal(await db16Palette.locator(".swatches i").count(), 16, "DawnBringer 16 should expose all 16 colours");
    await pico8Palette.click();
    assert.ok(await pico8Palette.evaluate(el => el.classList.contains("active")), "PICO-8 palette should be selectable");
    await db16Palette.click();
    assert.ok(await db16Palette.evaluate(el => el.classList.contains("active")), "DawnBringer palette should be selectable");
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
    await setRange("#scale", "1");
    assert.equal(await page.locator("#scale").inputValue(), "1", "the smallest detail size should be usable");
    await setRange("#scale", "2");
    await setRange("#levels", "4");
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

    await page.locator("#compareToggle").click();
    assert.equal(await page.locator("#beforeOutput").isVisible(), true, "before/after comparison should overlay the original");
    assert.equal(await page.locator("#compareDivider").isVisible(), true, "comparison should show a draggable divider");
    await page.locator("#compareRange").evaluate(el => { el.value = "73"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    assert.equal(await page.locator("#compareValue").textContent(), "73%");
    await page.locator("#compareToggle").click();
    assert.equal(await page.locator("#beforeOutput").isVisible(), false, "comparison overlay should close cleanly");

    await page.locator("#topExport").click();
    assert.equal(await page.locator("#exportModal").isVisible(), true, "top-level export should open the unified export dialog");
    await page.locator("#exportFormat").selectOption("jpeg");
    await page.locator("#exportJpegQuality").evaluate(el => { el.value = "83"; el.dispatchEvent(new Event("input", { bubbles: true })); });
    const [unifiedJpeg] = await Promise.all([
      page.waitForEvent("download", { timeout: 15000 }),
      page.locator("#exportConfirm").click()
    ]);
    assert.match(unifiedJpeg.suggestedFilename(), /TGRMLither.*\.jpg$/);
    assert.equal(await page.locator("#jpegQuality").inputValue(), "83", "export dialog quality should feed the JPEG encoder");
    await page.locator("#jpegQuality").evaluate(el => { el.value = "94"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });

    const png = await downloadFrom(page, "#png");
    assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.match(png.download.suggestedFilename(), /TGRMLither.*\.png$/);

    const jpg = await downloadFrom(page, "#jpg");
    assert.equal(jpg.bytes[0], 0xff);
    assert.equal(jpg.bytes[1], 0xd8);
    assert.equal(await page.locator("#jpegQuality").inputValue(), "94", "JPEG export quality should default to a high-quality setting");
    await page.locator("#jpegQuality").evaluate(el => { el.value = "70"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")).editor.jpegQuality), 70,
      "selected JPEG quality should persist with the workspace");
    const lowQualityJpg = await downloadFrom(page, "#jpg");
    await page.locator("#jpegQuality").evaluate(el => { el.value = "100"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
    const maxQualityJpg = await downloadFrom(page, "#jpg");
    assert.ok(lowQualityJpg.bytes.length < maxQualityJpg.bytes.length, "JPEG compression quality should affect the encoded export");
    await page.locator("#jpegQuality").evaluate(el => { el.value = "94"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });

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

    // Imported projects are data, not trusted code: unknown settings, bad ranges,
    // malformed colours and invalid viewBoxes must be normalized before rendering.
    const unsafeProject = JSON.parse(JSON.stringify(projectData));
    unsafeProject.settings = {
      ...unsafeProject.settings,
      algorithm: "not-an-algorithm",
      scale: 999999,
      levels: "not-a-number",
      patternShape: "not-a-shape",
      effectStrength: { scanlines: 9999, glow: "broken" },
      customColors: ["javascript:alert(1)", "#112233", "#334455"],
      customShapePath: "M 0 0 ".repeat(5000),
      customShapeViewBox: [0, 0, 0, 1],
      shapeBands: [{ shape: "invalid", size: 999999, color: "not-a-colour", customViewBox: [0, 0, 0, 1] }],
      unknownInjectedProperty: "ignored"
    };
    unsafeProject.workspaces.editor = {
      ...unsafeProject.workspaces.editor,
      scale: 999999,
      asciiWidth: -100
    };
    unsafeProject.workspaces.batch = {
      ...unsafeProject.workspaces.batch,
      scale: 999999,
      asciiWidth: -100
    };
    await page.locator("#projectInput").setInputFiles({
      name: "unsafe-settings.tgrmlither.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(unsafeProject))
    });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));
    const safeSettings = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces")));
    assert.equal(safeSettings.editor.algorithm, "bayer4", "invalid algorithms should fall back to a supported algorithm");
    assert.equal(safeSettings.editor.scale, 24, "numeric settings should be clamped to supported limits");
    assert.equal(safeSettings.batch.scale, 24, "every workspace profile should be normalized during project import");
    assert.equal(safeSettings.editor.levels, 4, "invalid numeric values should use defaults");
    assert.equal(safeSettings.editor.effectStrength.scanlines, 100, "effect strength should be clamped");
    assert.equal(safeSettings.editor.effectStrength.glow, 50, "invalid effect strength should use the default");
    assert.equal(safeSettings.editor.customColors.length, 2, "invalid custom colours should be dropped");
    assert.equal(safeSettings.editor.shapeBands[0].shape, "circle", "invalid shape values should use the default");
    assert.equal(safeSettings.editor.shapeBands[0].size, 180, "shape sizes should be bounded");
    assert.equal(safeSettings.editor.shapeBands[0].color, "#334b2b", "invalid shape colours should use a safe default");
    assert.equal(safeSettings.editor.customShapePath.length, 20000, "global custom paths should be capped before rendering");
    assert.deepEqual(safeSettings.editor.customShapeViewBox, [0, 0, 100, 100], "invalid global viewBoxes should be replaced");
    assert.deepEqual(safeSettings.editor.shapeBands[0].customViewBox, [0, 0, 100, 100], "invalid viewBoxes should be replaced");
    assert.equal("unknownInjectedProperty" in safeSettings.editor, false, "unknown project settings should not persist");

    // Shape preset import has a separate validation path; validate the global viewBox there too.
    const unsafeShapeProfile = {
      shape: "custom", jitter: 20, shapeDistribution: "uniform", shapeRotation: 0,
      shapeThresholds: [25, 50, 75],
      shapeBands: Array.from({ length: 4 }, () => ({ shape: "circle", size: 70, color: "#334b2b", rotation: 0 })),
      customShapePath: "M 0 0 L 1 1",
      customShapeViewBox: [0, 0, 0, 1]
    };
    await page.locator("#shapePresetInput").setInputFiles({
      name: "unsafe-shape.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ name: "Unsafe QA Shape", profile: unsafeShapeProfile }))
    });
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Пресет Shape Shifter импортирован"));
    const cleanedShapeProfile = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "null")?.shape);
    assert.deepEqual(cleanedShapeProfile.customShapeViewBox, [0, 0, 100, 100],
      "global custom shape viewBox should be validated in the direct shape-preset import path");

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
    await setRange("#levels", "8");
    await page.locator("#extractPalette").click();
    assert.equal((await page.evaluate(() => JSON.parse(localStorage.getItem("ditherlab-colors")))).length, 8,
      "palette extraction should follow the selected colour depth");
    await setRange("#levels", "4");

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
    await setRange("#levels", "16");
    assert.equal(await page.locator("#levels").inputValue(), "16", "the editor should expose up to 16 palette levels");
    await setRange("#levels", "4");
    await page.locator("#homeLogo").click();

    // Vector export supports print sizing and layered CMYK plates.
    await page.locator("#vectorDetail").selectOption("source");
    const blackSvg = await downloadFrom(page, "#svgBlack");
    const blackSvgText = blackSvg.bytes.toString("utf8");
    assert.match(blackSvgText, /viewBox="0 0 48 32"/, "source-detail black SVG should preserve the original coordinate grid");
    assert.match(blackSvgText, /width="4\.06mm"/, "SVG physical dimensions should follow source pixels and selected DPI");
    assert.match(blackSvgText, /data-dpi="300"/, "SVG export should record the selected print DPI");
    assert.equal(await page.locator("#fileStatus").getAttribute("data-state"), "exported",
      "successful direct SVG export should mark the current result as exported");
    const cmykSvg = await downloadFrom(page, "#svgCmyk");
    const cmykSvgText = cmykSvg.bytes.toString("utf8");
    for (const plate of ["Cyan Plate", "Magenta Plate", "Yellow Plate", "Black Plate"]) assert.ok(cmykSvgText.includes(plate), "CMYK export should contain " + plate);
    assert.equal((cmykSvgText.match(/inkscape:groupmode="layer"/g) || []).length, 4, "CMYK export should create four named vector layers");
    assert.equal(await page.locator("#fileStatus").getAttribute("data-state"), "exported",
      "successful direct CMYK export should keep the exported result state");

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

    // Start Video Lab from a clean default profile. Earlier smoke scenarios intentionally
    // mutate editor settings; those are unrelated to Worker/fallback rendering parity.
    await page.evaluate(() => localStorage.clear());
    await page.reload({ waitUntil: "load" });
    await page.waitForFunction(() => document.querySelector("#output")?.width > 0);

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
      canvas.width = 1024; canvas.height = 900;
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
        // Keep every encoded frame visually identical so Worker/fallback parity
        // compares renderers rather than two different moments in an animated clip.
        ctx.fillStyle = "#172b46";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.fillStyle = "#c080d0";
        ctx.fillRect(240, 80, 120, 120);
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
    await page.waitForFunction(() => document.body.dataset.videoProcessingEngine === "worker", null, { timeout: 30000 });
    assert.equal(await page.locator("#videoOutput").evaluate(canvas => canvas.width >= 1024 && canvas.height >= 890), true,
      "Video Lab should render high-resolution frames through OffscreenCanvas worker");
    assert.ok(Number(await page.locator("#videoTimeline").getAttribute("max")) > 0, "video timeline should have a duration");
    await page.locator("#videoTimeline").evaluate(el => {
      el.value = String(Math.min(0.3, Number(el.max)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    assert.ok(await page.locator("#videoOutput").evaluate(canvas => canvas.width > 0 && canvas.height > 0),
      "video frame should be processed onto the output canvas");
    const expectedVideoContext = await page.locator("#videoOutput").evaluate(canvas => {
      const context = canvas.getContext("2d");
      context.fillStyle = "#123456";
      context.globalAlpha = 0.37;
      return { fillStyle: context.fillStyle, globalAlpha: context.globalAlpha };
    });
    await page.locator("#videoTimeline").evaluate(el => {
      el.value = String(Math.min(0.3, Number(el.max)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const reusedVideoContext = await page.locator("#videoOutput").evaluate(canvas => {
      const context = canvas.getContext("2d");
      return { fillStyle: context.fillStyle, globalAlpha: context.globalAlpha };
    });
    assert.deepEqual(reusedVideoContext, expectedVideoContext,
      "same-size video frames should reuse the output canvas backing store");

    // Worker and main-thread Video Lab paths must produce the same result with the same effect profile.
    await setRange("#scale", 16);
    const videoScanlines = page.locator("#video-effect-scanlines");
    if (await videoScanlines.getAttribute("aria-checked") !== "true") await videoScanlines.click();
    await setRange('#videoEffectsControl [data-effect-strength="scanlines"]', 100);
    await page.locator("#videoTimeline").evaluate(el => {
      el.value = String(Math.min(0.3, Number(el.max)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.waitForTimeout(500);
    const workerVideoFingerprint = await page.locator("#videoOutput").evaluate(canvas => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let i = 0; i < data.length; i += 68) { hash ^= data[i]; hash = Math.imul(hash, 16777619); }
      return { width: canvas.width, height: canvas.height, hash: hash >>> 0 };
    });
    const mainThreadVideoPage = await browser.newPage({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
    const mainThreadVideoErrors = [];
    mainThreadVideoPage.on("pageerror", error => mainThreadVideoErrors.push(error.stack || error.message));
    await mainThreadVideoPage.addInitScript(() => { Object.defineProperty(window, "Worker", { value: undefined, configurable: true }); });
    await mainThreadVideoPage.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await mainThreadVideoPage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    await mainThreadVideoPage.locator('.topnav [data-mode="video"]').click();
    await mainThreadVideoPage.locator("#scale").evaluate(el => {
      el.value = "16"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const fallbackScanlines = mainThreadVideoPage.locator("#video-effect-scanlines");
    if (await fallbackScanlines.getAttribute("aria-checked") !== "true") await fallbackScanlines.click();
    await mainThreadVideoPage.locator('#videoEffectsControl [data-effect-strength="scanlines"]').evaluate(el => {
      el.value = "100"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await mainThreadVideoPage.locator("#videoInput").setInputFiles({ name: "qa-video-fallback.webm", mimeType: "video/webm", buffer: videoBuffer });
    await mainThreadVideoPage.waitForFunction(() => {
      const video = document.querySelector("#videoSource");
      return video && Number.isFinite(video.duration) && video.duration > 0 &&
        document.body.dataset.videoProcessingEngine === "main";
    }, null, { timeout: 20000 });
    await mainThreadVideoPage.locator("#videoTimeline").evaluate(el => {
      el.value = String(Math.min(0.3, Number(el.max)));
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await mainThreadVideoPage.waitForTimeout(500);
    const mainThreadVideoFingerprint = await mainThreadVideoPage.locator("#videoOutput").evaluate(canvas => {
      const data = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let i = 0; i < data.length; i += 68) { hash ^= data[i]; hash = Math.imul(hash, 16777619); }
      return { width: canvas.width, height: canvas.height, hash: hash >>> 0 };
    });
    assert.deepEqual(workerVideoFingerprint, mainThreadVideoFingerprint,
      "Video Lab Worker and main-thread fallback must apply the same complete raster/effect pipeline");
    assert.deepEqual(mainThreadVideoErrors, [], "Video Lab main-thread fallback should not create runtime errors");
    await mainThreadVideoPage.close();

    const videoDownloadPromise = page.waitForEvent("download", { timeout: 20000 });
    await page.locator("#videoExport").click();
    assert.equal(await page.locator("#videoTimeline").isDisabled(), true, "video timeline must be locked during export");
    const videoDownload = await videoDownloadPromise;
    assert.match(videoDownload.suggestedFilename(), /TGRMLither\.webm$/);
    assert.ok(fs.statSync(await videoDownload.path()).size > 500, "exported video should contain data");
    assert.equal(await page.locator("#videoExport").isEnabled(), true, "video export control must be re-enabled after recording finishes");
    assert.equal(await page.locator("#videoTimeline").isDisabled(), false, "video timeline must unlock after recording finishes");

    // Batch processing should use a stable settings snapshot even if controls change while files are being encoded.
    await page.locator('.topnav [data-mode="batch"]').click();
    const releasedVideoBuffers = await page.evaluate(() => window.__tgrmlitherResourceStatus?.());
    assert.equal(releasedVideoBuffers.videoFramePixels, 1, "leaving Video Lab should release its reusable frame buffer");
    await page.locator("#batchInput").setInputFiles([
      { name: "batch-fixture.png", mimeType: "image/png", buffer: imageBuffer },
      { name: "batch-fixture.png", mimeType: "image/png", buffer: imageBuffer },
      { name: "broken-image.png", mimeType: "image/png", buffer: Buffer.from("not a valid PNG") }
    ]);
    assert.equal(await page.locator("#batchList .fileitem").count(), 3);
    await page.locator("#algorithm").selectOption("bayer4");
    const batchScanlines = page.locator("#batch-effect-scanlines");
    if (await batchScanlines.getAttribute("aria-checked") !== "true") await batchScanlines.click();
    const batchScanlinesStrength = page.locator('#batchEffectsControl [data-effect-strength="scanlines"]');
    await batchScanlinesStrength.evaluate(el => { el.value = "10"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.evaluate(() => {
      window.__tgrmOriginalToBlob = HTMLCanvasElement.prototype.toBlob;
      window.__tgrmToBlobCalls = 0;
      HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        const canvas = this;
        window.__tgrmToBlobCalls++;
        setTimeout(() => window.__tgrmOriginalToBlob.call(canvas, callback, type, quality), 250);
      };
    });
    await page.locator("#runBatch").click();
    assert.equal(await page.locator("#clearBatch").isDisabled(), true, "batch items must not be removed while processing is running");
    assert.equal(await page.locator("#batchInput").isDisabled(), true, "new files must not be added while processing is running");
    await page.waitForFunction(() => window.__tgrmToBlobCalls >= 1, null, { timeout: 10000 });
    await batchScanlinesStrength.evaluate(el => { el.value = "100"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.waitForFunction(() => document.querySelectorAll("#batchResults a[download]").length === 2, null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelectorAll("#batchResults .fileitem").length === 3 && !document.querySelector("#clearBatch")?.disabled, null, { timeout: 15000 });
    assert.match(await page.locator("#batchResults").innerText(), /broken-image\.png[\s\S]*Ошибка:/, "failed batch files should remain visible with an error reason");
    assert.match(await page.locator("#toast").textContent(), /2 успешно, 1 с ошибкой/, "batch summary should distinguish successes from failures");
    const outputHashes = await page.locator("#batchResults a[download]").evaluateAll(async links => Promise.all(links.map(async link => {
      const bytes = await (await fetch(link.href)).arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
    })));
    assert.equal(outputHashes[0], outputHashes[1], "all batch outputs should use the starting settings snapshot even if a control changes mid-run");
    await batchScanlinesStrength.evaluate(el => { el.value = "50"; el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); });
    await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = window.__tgrmOriginalToBlob; delete window.__tgrmOriginalToBlob; delete window.__tgrmToBlobCalls; });
    const batchNames = await page.locator("#batchResults a[download]").evaluateAll(links => links.map(link => link.download));
    assert.equal(new Set(batchNames).size, 2, "duplicate source filenames must not overwrite each other in the batch ZIP");
    assert.match(batchNames[0], /TGRMLither\.png$/);
    assert.match(batchNames[1], /TGRMLither-2\.png$/);
    assert.equal(await page.locator("#downloadBatchZip").isEnabled(), true, "ZIP download should enable after batch processing");
    const batchResourceState = await page.evaluate(() => window.__tgrmlitherResourceStatus?.());
    assert.equal(batchResourceState.scratchCanvasOutstanding, 0, "batch processing should release all temporary raster canvases between files");
    assert.equal(batchResourceState.batchResultCount, 2, "only completed batch blobs should be retained");
    assert.equal(batchResourceState.batchResultUrls, 2, "each retained PNG should have one live download URL");
    assert.ok(batchResourceState.batchResultBytes > 0, "the retained batch byte budget should account for output blobs");
    const [batchZipDownload] = await Promise.all([
      page.waitForEvent("download", { timeout: 10000 }),
      page.locator("#downloadBatchZip").click()
    ]);
    assert.equal(batchZipDownload.suggestedFilename(), "TGRMLither-batch.zip");
    const batchZipBytes = fs.readFileSync(await batchZipDownload.path());
    assert.deepEqual([...batchZipBytes.subarray(0, 4)], [0x50, 0x4b, 0x03, 0x04], "batch archive should have a valid ZIP local-file signature");
    assert.ok(batchZipBytes.includes(Buffer.from("batch-fixture-TGRMLither.png")), "batch ZIP should contain the first processed PNG filename");
    assert.ok(batchZipBytes.includes(Buffer.from("batch-fixture-TGRMLither-2.png")), "batch ZIP should contain a collision-free second PNG filename");

    // Large batch files should use the same background worker pipeline.
    await page.locator("#clearBatch").click();
    const clearedBatchResources = await page.evaluate(() => window.__tgrmlitherResourceStatus?.());
    assert.equal(clearedBatchResources.batchResultCount, 0, "clearing a batch should release references to retained blobs");
    assert.equal(clearedBatchResources.batchResultBytes, 0, "clearing a batch should reset retained output bytes");
    assert.equal(clearedBatchResources.batchResultUrls, 0, "clearing a batch should revoke all batch object URLs");
    await page.locator("#batchInput").setInputFiles({
      name: "worker-batch-fixture.png", mimeType: "image/png", buffer: largeWorkerBuffer
    });
    await page.locator("#runBatch").click();
    await page.waitForFunction(() => document.body.dataset.batchProcessingEngine === "worker", null, { timeout: 15000 });
    await page.waitForFunction(() =>
      document.querySelectorAll("#batchResults a[download]").length === 1 &&
      !document.querySelector("#clearBatch")?.disabled,
      null, { timeout: 30000 }
    );
    assert.match(await page.locator("#batchResults").innerText(), /worker-batch-fixture\.png[\s\S]*Готово/,
      "large batch output should be returned from worker processing");

    // Restore the three small fixtures so the cancellation test targets the main-thread fallback.
    await page.locator("#clearBatch").click();
    await page.locator("#batchInput").setInputFiles([
      { name: "batch-fixture.png", mimeType: "image/png", buffer: imageBuffer },
      { name: "batch-fixture.png", mimeType: "image/png", buffer: imageBuffer },
      { name: "broken-image.png", mimeType: "image/png", buffer: Buffer.from("not a valid PNG") }
    ]);
    assert.equal(await page.locator("#batchList .fileitem").count(), 3);

    // Batch cancellation stops after the in-flight file and keeps partial results downloadable.
    assert.equal(await page.locator("#cancelBatch").isVisible(), false, "batch cancellation should be hidden while idle");
    await page.evaluate(() => {
      window.__tgrmOriginalToBlob = HTMLCanvasElement.prototype.toBlob;
      window.__tgrmToBlobCalls = 0;
      HTMLCanvasElement.prototype.toBlob = function(callback, type, quality) {
        const canvas = this;
        window.__tgrmToBlobCalls++;
        setTimeout(() => window.__tgrmOriginalToBlob.call(canvas, callback, type, quality), 300);
      };
    });
    await page.locator("#runBatch").click();
    await page.waitForFunction(() => window.__tgrmToBlobCalls >= 1, null, { timeout: 10000 });
    assert.equal(await page.locator("#cancelBatch").isVisible(), true, "cancel action should appear while processing");
    await page.locator("#cancelBatch").click();
    await page.waitForFunction(() => document.querySelector("#cancelBatch")?.hidden === true, null, { timeout: 15000 });
    assert.equal(await page.locator("#batchResults .fileitem").count(), 1, "cancellation should finish the current file but skip the remaining files");
    assert.equal(await page.locator("#batchProgressCount").textContent(), "1 / 3", "partial progress should report completed files");
    assert.match(await page.locator("#batchProgressLabel").textContent(), /остановлена/i, "the progress status should identify a cancelled batch");
    assert.equal(await page.locator("#downloadBatchZip").isEnabled(), true, "partial batch results should remain available as a ZIP");
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toBlob = window.__tgrmOriginalToBlob;
      delete window.__tgrmOriginalToBlob;
      delete window.__tgrmToBlobCalls;
    });


    if (await page.locator("#batch-effect-scanlines").getAttribute("aria-checked") !== "true") await page.locator("#batch-effect-scanlines").click();
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

    // Extremely tall sources must not produce a multi-billion-pixel ASCII output canvas.
    await page.locator('.topnav [data-mode="script"]').click();

    // A malformed palette item should be skipped without corrupting the library.
    const previousPaletteCount = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library") || "[]").length);
    await page.locator("#paletteLibraryInput").setInputFiles({
      name: "mixed-palettes.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify({ palettes: [
        { name: "Valid QA palette", colors: ["#112233", "#445566"] },
        { name: "Invalid QA palette", colors: "not-an-array" }
      ] }))
    });
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Импортировано палитр: 1"));
    const importedPaletteState = await page.evaluate(() => JSON.parse(localStorage.getItem("tgrmlither-palette-library") || "[]"));
    assert.equal(importedPaletteState.length, previousPaletteCount + 1, "only valid palette records should be saved");
    assert.ok(importedPaletteState.some(palette => palette.name === "Valid QA palette"));
    // Oversized JSON imports must be rejected before their contents are read.
    const oversizedJson = Buffer.alloc(5 * 1024 * 1024 + 1, 0x20);
    await page.locator("#presetInput").setInputFiles({
      name: "oversized-presets.json",
      mimeType: "application/json",
      buffer: oversizedJson
    });
    await page.waitForFunction(() => document.querySelector("#toast")?.textContent.includes("Файл пресетов слишком большой"));
    oversizedJson.fill(0);

    // ASCII animation export should either create a real WebM or leave controls usable when unsupported.
    const asciiRecordingSupported = await page.evaluate(() => !!document.querySelector("#output")?.captureStream && typeof MediaRecorder !== "undefined");
    if (asciiRecordingSupported) {
      const asciiDownloadPromise = page.waitForEvent("download", { timeout: 20000 });
      await page.locator("#asciiExportWebm").click();
      assert.equal(await page.locator("#asciiPlay").isDisabled(), true, "ASCII playback control should lock during recording");
      assert.equal(await page.locator("#asciiExportWebm").isDisabled(), true, "ASCII export button should lock during recording");
      const asciiDownload = await asciiDownloadPromise;
      assert.match(asciiDownload.suggestedFilename(), /script-slayer\.webm$/);
      assert.ok(fs.statSync(await asciiDownload.path()).size > 300, "ASCII WebM export should contain encoded frames");
      await page.waitForFunction(() => !document.querySelector("#asciiPlay")?.disabled && document.querySelector("#asciiStop")?.disabled);
      assert.equal(await page.locator("#asciiExportWebm").isEnabled(), true, "ASCII export button should unlock after recording");
    } else {
      await page.locator("#asciiExportWebm").click();
      assert.equal(await page.locator("#asciiPlay").isEnabled(), true, "unsupported ASCII recording should leave the controls usable");
    }

    const tallImageDataUrl = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 1;
      canvas.height = 32767;
      const ctx = canvas.getContext("2d");
      ctx.fillStyle = "#234567";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    });
    await page.locator("#imageInput").setInputFiles({
      name: "extreme-tall.png",
      mimeType: "image/png",
      buffer: Buffer.from(tallImageDataUrl.split(",")[1], "base64")
    });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("extreme-tall.png"));
    await page.waitForFunction(() => !document.querySelector("#asciiLimitWarning")?.classList.contains("hidden"));
    const asciiOutputSize = await page.locator("#output").evaluate(canvas => ({ width: canvas.width, height: canvas.height }));
    assert.ok(asciiOutputSize.width * asciiOutputSize.height <= 4000000,
      "extreme-ratio ASCII output must stay below the configured pixel budget");
    assert.equal(await page.locator("#asciiLimitWarning").isVisible(), true,
      "the UI should tell the user when the ASCII grid was limited");

    // Failed processing must not replace the last successfully rendered preview.
    const recoveryPage = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const recoveryErrors = [];
    recoveryPage.on("pageerror", error => recoveryErrors.push(error.stack || error.message));
    await recoveryPage.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await recoveryPage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    const previewBeforeFailure = await recoveryPage.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    await recoveryPage.evaluate(() => {
      window.__nativeGetImageData = CanvasRenderingContext2D.prototype.getImageData;
      CanvasRenderingContext2D.prototype.getImageData = function () {
        throw new Error("Simulated canvas readback failure");
      };
    });
    await recoveryPage.locator("#algorithm").selectOption("floyd");
    await recoveryPage.waitForFunction(() => document.body.dataset.processingError === "true");
    const previewAfterFailure = await recoveryPage.locator("#output").evaluate(canvas => canvas.toDataURL("image/png"));
    assert.equal(previewAfterFailure, previewBeforeFailure,
      "a failed render must preserve the previous successful preview");
    assert.match(await recoveryPage.locator("#toast").textContent(), /Предыдущий результат сохранён/);
    await recoveryPage.evaluate(() => {
      CanvasRenderingContext2D.prototype.getImageData = window.__nativeGetImageData;
      delete window.__nativeGetImageData;
    });

    // A decoder that never emits load/error must time out and release the loading state.
    const decodeTimeoutConfigured = await recoveryPage.evaluate(() =>
      window.__tgrmlitherSetImageDecodeTimeoutForTests?.(700) === true
    );
    assert.equal(decodeTimeoutConfigured, true, "local smoke tests should be able to shorten the image decode watchdog");
    const previousImageName = await recoveryPage.locator("#filename").textContent();
    await recoveryPage.evaluate(() => {
      const NativeImage = window.Image;
      const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, "src");
      window.__nativeImageConstructor = NativeImage;
      window.Image = function () {
        const image = new NativeImage();
        Object.defineProperty(image, "src", {
          configurable: true,
          get: () => src.get.call(image),
          set: value => { if (value === "") src.set.call(image, value); }
        });
        return image;
      };
    });
    await recoveryPage.locator("#imageInput").setInputFiles({
      name: "decoder-timeout.png", mimeType: "image/png", buffer: imageBuffer
    });
    await recoveryPage.waitForFunction(() =>
      /Декодирование изображения превысило лимит времени/.test(document.querySelector("#toast")?.textContent || ""),
      null, { timeout: 10000 }
    );
    assert.equal(await recoveryPage.locator("#stage").getAttribute("aria-busy"), "false",
      "a decoder timeout must clear the loading state");
    assert.equal(await recoveryPage.locator("#filename").textContent(), previousImageName,
      "a decoder timeout must leave the previous source image in place");
    assert.equal(
      await recoveryPage.locator("#output").evaluate(canvas => canvas.toDataURL("image/png")),
      previewBeforeFailure,
      "a decoder timeout must preserve the previous rendered image"
    );
    await recoveryPage.evaluate(() => { window.Image = window.__nativeImageConstructor; });
    assert.deepEqual(recoveryErrors, [], "render and image-decode recovery must not create uncaught page errors");
    await recoveryPage.close();

    // A worker that stops answering must time out, be terminated, and fall back to the main thread.
    const fallbackPage = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    const fallbackErrors = [];
    fallbackPage.on("pageerror", error => fallbackErrors.push(error.stack || error.message));
    await fallbackPage.addInitScript(() => {
      const NativeWorker = window.Worker;
      window.Worker = function (...args) {
        const worker = new NativeWorker(...args);
        const postMessage = worker.postMessage.bind(worker);
        worker.postMessage = (message, transfer) => {
          if (message?.type === "render") return; // Simulate a worker that has stopped responding.
          return postMessage(message, transfer);
        };
        return worker;
      };
      window.Worker.prototype = NativeWorker.prototype;
    });
    await fallbackPage.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await fallbackPage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    const watchdogConfigured = await fallbackPage.evaluate(() =>
      window.__tgrmlitherSetWorkerTimeoutForTests?.(700) === true
    );
    assert.equal(watchdogConfigured, true, "local smoke tests should be able to shorten the worker watchdog");
    await fallbackPage.locator("#imageInput").setInputFiles({
      name: "worker-timeout-fixture.png", mimeType: "image/png", buffer: largeWorkerBuffer
    });
    await fallbackPage.waitForFunction(() =>
      document.body.dataset.processingWorker === "failed" &&
      document.body.dataset.processingEngine === "main" &&
      document.body.dataset.processingPending === "false" &&
      document.querySelector("#output")?.width > 0,
      null, { timeout: 15000 }
    );
    const fallbackState = await fallbackPage.evaluate(() => ({
      failed: document.body.dataset.processingWorker,
      engine: document.body.dataset.processingEngine,
      pending: document.body.dataset.processingPending,
      width: document.querySelector("#output")?.width
    }));
    assert.deepEqual(fallbackState, {
      failed: "failed", engine: "main", pending: "false", width: 1024
    }, "a timed-out worker must leave the preview usable on the main thread");
    assert.deepEqual(fallbackErrors, [], "worker timeout recovery must not create uncaught page errors");
    await fallbackPage.close();

    // Storage snapshots must recover a corrupted primary record from the last known-good value.
    const storagePage = await browser.newPage({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
    const storageErrors = [];
    storagePage.on("pageerror", error => storageErrors.push(error.stack || error.message));
    await storagePage.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await storagePage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    const setStorageScale = async value => storagePage.locator("#scale").evaluate((el, next) => {
      el.value = String(next);
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }, value);
    await setStorageScale(8);
    await storagePage.waitForFunction(() => {
      try { return JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "null")?.editor?.scale === 8; }
      catch { return false; }
    });
    await setStorageScale(9);
    await storagePage.waitForFunction(() => {
      try {
        const backup = JSON.parse(localStorage.getItem("tgrmlither-backup-v1:tgrmlithering-workspaces") || "null");
        return backup?.format === "tgrmlither-storage-backup" &&
          JSON.parse(backup.raw)?.editor?.scale === 8;
      } catch { return false; }
    });
    await storagePage.evaluate(() => localStorage.setItem("tgrmlithering-workspaces", "{ broken json"));
    await storagePage.reload({ waitUntil: "load" });
    await storagePage.waitForFunction(() => document.querySelector("#scale")?.value === "8");
    const recoveredStorage = await storagePage.evaluate(() => ({
      scale: Number(document.querySelector("#scale").value),
      raw: localStorage.getItem("tgrmlithering-workspaces"),
      notice: document.querySelector("#toast")?.textContent || ""
    }));
    assert.equal(recoveredStorage.scale, 8, "corrupted workspace settings should recover the previous saved state");
    assert.doesNotThrow(() => JSON.parse(recoveredStorage.raw), "recovery should rewrite a valid primary storage record");
    await storagePage.waitForFunction(() => /восстановлены из резервной копии/i.test(document.querySelector("#toast")?.textContent || ""));

    // The full user-data backup must round-trip through export and validated transactional restore.
    await storagePage.locator("#themeMenu > summary").click();
    await storagePage.locator("#themePicker").selectOption("terminal");
    const [userBackupDownload] = await Promise.all([
      storagePage.waitForEvent("download", { timeout: 15000 }),
      storagePage.locator("#exportUserBackup").click()
    ]);
    const userBackupBuffer = fs.readFileSync(await userBackupDownload.path());
    const userBackupDoc = JSON.parse(userBackupBuffer.toString("utf8"));
    assert.equal(userBackupDoc.format, "tgrmlither-user-backup");
    assert.equal(userBackupDoc.version, 1);
    assert.ok(userBackupDoc.data["tgrmlithering-workspaces"], "backup should include workspace profiles");
    assert.ok(userBackupDoc.data["tgrmlither-theme"], "backup should include the current interface theme");
    await storagePage.locator("#shellPicker").selectOption("studio");
    await storagePage.waitForFunction(() => JSON.parse(localStorage.getItem("tgrmlither-shell") || "null") === "studio");
    storagePage.on("dialog", dialog => dialog.accept());
    await storagePage.locator("#userBackupInput").setInputFiles({
      name: "TGRMLither-backup.json",
      mimeType: "application/json",
      buffer: userBackupBuffer
    });
    await storagePage.waitForFunction(() =>
      document.body.dataset.shell === "xp" &&
      document.body.dataset.theme === "terminal" &&
      JSON.parse(localStorage.getItem("tgrmlither-shell") || "null") === "xp" &&
      document.querySelector("#scale")?.value === "8",
      null, { timeout: 15000 }
    );
    // Recover the primary preview after a restored or permanently lost Canvas 2D context.
    await storagePage.evaluate(() => {
      window.__firstCanvasBeforeLoss = document.querySelector("#output");
      window.__firstCanvasBeforeLoss.dispatchEvent(new Event("contextlost", { cancelable: true }));
    });
    await storagePage.waitForFunction(() => document.body.dataset.canvasRecovery === "recovering");
    assert.equal(await storagePage.evaluate(() => window.__firstCanvasBeforeLoss.isConnected), true,
      "the original canvas remains mounted while the browser attempts context restoration");
    await storagePage.evaluate(() => window.__firstCanvasBeforeLoss.dispatchEvent(new Event("contextrestored")));
    await storagePage.waitForFunction(() =>
      document.body.dataset.canvasRecovery === "idle" &&
      document.body.dataset.canvasRecoveryResult === "restored"
    );
    await storagePage.evaluate(() => window.__tgrmlitherWaitForPreview());
    assert.equal(await storagePage.locator("#output").evaluate(canvas => canvas.width > 0 && canvas.height > 0), true,
      "the preview should be rendered again after context restoration");

    const canvasWatchdogConfigured = await storagePage.evaluate(() =>
      window.__tgrmlitherSetCanvasRecoveryTimeoutForTests?.(450) === true
    );
    assert.equal(canvasWatchdogConfigured, true, "local smoke tests should be able to shorten the canvas recovery watchdog");
    await storagePage.evaluate(() => {
      window.__lostCanvasForReplacement = document.querySelector("#output");
      window.__lostCanvasForReplacement.dispatchEvent(new Event("contextlost", { cancelable: true }));
    });
    await storagePage.waitForFunction(() =>
      document.body.dataset.canvasRecovery === "idle" &&
      document.body.dataset.canvasRecoveryResult === "recreated" &&
      document.querySelector("#output") !== window.__lostCanvasForReplacement,
      null, { timeout: 5000 }
    );
    await storagePage.evaluate(() => window.__tgrmlitherWaitForPreview());
    assert.equal(await storagePage.locator("#output").evaluate(canvas => canvas.width > 0 && canvas.height > 0), true,
      "a context that never restores should be replaced with a fresh canvas and re-rendered");

    assert.deepEqual(storageErrors, [], "storage and canvas recovery must not create uncaught page errors");

    // A failed storage write during project import must not replace the currently open image.
    const projectAtomicPage = await browser.newPage({ viewport: { width: 1100, height: 800 } });
    await projectAtomicPage.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await projectAtomicPage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    const previousProjectSource = await projectAtomicPage.locator("#filename").textContent();
    const validProject = {
      format: "tgrmlither-project", version: 2, workspace: "editor",
      sourceName: "must-not-open.png", source: dataURL,
      settings: { algorithm: "floyd", scale: 11 }
    };
    await projectAtomicPage.evaluate(() => {
      const nativeSetItem = Storage.prototype.setItem;
      window.__nativeStorageSetItem = nativeSetItem;
      Storage.prototype.setItem = function (key, value) {
        if (key === "tgrmlithering-workspaces") throw new DOMException("Quota exceeded", "QuotaExceededError");
        return nativeSetItem.call(this, key, value);
      };
    });
    await projectAtomicPage.locator("#projectInput").setInputFiles({
      name: "valid-but-unwritable.tgrmlither.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(validProject))
    });
    await projectAtomicPage.waitForFunction(() =>
      /Проект не открыт/.test(document.querySelector("#toast")?.textContent || ""),
      null, { timeout: 10000 }
    );
    assert.equal(await projectAtomicPage.locator("#filename").textContent(), previousProjectSource,
      "a project import must leave the active image intact when persistence fails");
    assert.equal(await projectAtomicPage.locator("body").getAttribute("data-mode"), "editor",
      "a failed project import must return to the original workspace");
    await projectAtomicPage.evaluate(() => { Storage.prototype.setItem = window.__nativeStorageSetItem; });
    await projectAtomicPage.close();
    await storagePage.close();

    // Long-session resource stress: replace a large Worker source repeatedly and
    // verify that only the current source bitmap and one output surface remain live.
    const resourceStressPage = await browser.newPage({ viewport: { width: 1100, height: 800 }, acceptDownloads: true });
    const resourceStressErrors = [];
    resourceStressPage.on("pageerror", error => resourceStressErrors.push(error.stack || error.message));
    await resourceStressPage.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await resourceStressPage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    const sourceCycles = 10;
    for (let cycle = 0; cycle < sourceCycles; cycle++) {
      const algorithm = ["bayer4", "floyd", "atkinson", "pixel"][cycle % 4];
      await resourceStressPage.locator("#algorithm").selectOption(algorithm);
      await resourceStressPage.locator("#imageInput").setInputFiles({
        name: "resource-cycle-" + cycle + ".png",
        mimeType: "image/png",
        buffer: largeWorkerBuffer
      });
      await resourceStressPage.waitForFunction(expected =>
        document.querySelector("#filename")?.textContent.includes(expected) &&
        document.body.dataset.processingEngine === "worker" &&
        document.body.dataset.processingPending === "false",
        "resource-cycle-" + cycle + ".png",
        { timeout: 30000 }
      );
      await resourceStressPage.evaluate(() => window.__tgrmlitherWaitForPreview());
      const snapshot = await resourceStressPage.evaluate(() => window.__tgrmlitherResourceStatus?.());
      assert.equal(snapshot.workerResources?.sourceCount, 1, "a long editing session should keep exactly one live Worker source");
      assert.equal(snapshot.workerResources?.sourcePixels, 1024 * 900, "replacing a source should not accumulate prior ImageBitmap pixels");
      assert.equal(snapshot.scratchCanvasOutstanding, 0, "each preview must release its temporary Canvas allocations");
      assert.equal(snapshot.workerResources?.scratchCanvasesCreated, snapshot.workerResources?.scratchCanvasesReleased,
        "Worker scratch canvases should be fully released after every preview");
    }
    const stressSnapshot = await resourceStressPage.evaluate(() => window.__tgrmlitherResourceStatus?.());
    assert.ok(stressSnapshot.workerResources.sourceBitmapsClosed >= sourceCycles - 1,
      "replacing the source should close every superseded Worker ImageBitmap");
    assert.ok(stressSnapshot.sourceCanvasesReleased >= sourceCycles - 1,
      "replacing the source should release every superseded HTML source canvas");

    const [stressExport] = await Promise.all([
      resourceStressPage.waitForEvent("download", { timeout: 15000 }),
      resourceStressPage.locator("#png").click()
    ]);
    assert.match(stressExport.suggestedFilename(), /TGRMLither\.png$/);
    const beforePageHide = await resourceStressPage.evaluate(() => window.__tgrmlitherResourceStatus?.());
    assert.equal(beforePageHide.transientDownloadUrls, 1, "an export URL should remain available for the browser download handoff");
    await resourceStressPage.evaluate(() => window.dispatchEvent(new PageTransitionEvent("pagehide", { persisted: false })));
    const afterPageHide = await resourceStressPage.evaluate(() => window.__tgrmlitherResourceStatus?.());
    assert.equal(afterPageHide.transientDownloadUrls, 0, "page shutdown should revoke transient download URLs");
    assert.equal(afterPageHide.batchResultUrls, 0, "page shutdown should revoke batch result URLs");
    assert.equal(afterPageHide.sourcePixels, 0, "page shutdown should release the current source canvas");
    assert.equal(afterPageHide.workerSourceCount, 0, "page shutdown should clear Worker source retention");
    assert.deepEqual(resourceStressErrors, [], "long-session resource cleanup should not create uncaught browser errors");
    await resourceStressPage.close();

    // Palette save/import must persist the active workspace selection, including across reloads.
    const palettePersistencePage = await browser.newPage({ viewport: { width: 1280, height: 800 }, acceptDownloads: true });
    const palettePersistenceErrors = [];
    palettePersistencePage.on("pageerror", error => palettePersistenceErrors.push(error.stack || error.message));
    await palettePersistencePage.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await palettePersistencePage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    await palettePersistencePage.locator("#paletteLibraryName").fill("Persisted QA Palette");
    await palettePersistencePage.locator("#savePaletteToLibrary").click();
    const savedPaletteId = await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    );
    assert.match(savedPaletteId || "", /^lib_/, "saving a palette should persist its selection in the active workspace");
    await palettePersistencePage.reload({ waitUntil: "load" });
    await palettePersistencePage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    assert.equal(await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    ), savedPaletteId, "saved palette selection should survive an immediate reload");

    const libraryImport = Buffer.from(JSON.stringify({
      format: "tgrmlither-palette-library", version: 1,
      palettes: [{ name: "Imported QA Palette", colors: ["#102030", "#406080", "#a0c0e0"] }]
    }));
    await palettePersistencePage.locator("#paletteLibraryInput").setInputFiles({
      name: "qa-palette-library.json", mimeType: "application/json", buffer: libraryImport
    });
    await palettePersistencePage.waitForFunction(() => {
      const current = JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette;
      return typeof current === "string" && current !== "moss" &&
        JSON.parse(localStorage.getItem("tgrmlither-palette-library") || "[]").some(item => item.id === current);
    });
    const importedLibraryPaletteId = await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    );
    await palettePersistencePage.reload({ waitUntil: "load" });
    await palettePersistencePage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    assert.equal(await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    ), importedLibraryPaletteId, "importing a palette library should persist the newly selected palette");

    await palettePersistencePage.locator("#paletteLibrarySelect").selectOption(savedPaletteId);
    await palettePersistencePage.locator("#applyLibraryPalette").click();
    assert.equal(await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    ), savedPaletteId, "applying a library palette should persist the new selection");
    await palettePersistencePage.reload({ waitUntil: "load" });
    await palettePersistencePage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    assert.equal(await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    ), savedPaletteId, "applied library palette should remain active after reload");

    const singlePalette = Buffer.from(JSON.stringify({
      name: "Single Import QA", colors: ["#182838", "#587898", "#a8c8e8"]
    }));
    await palettePersistencePage.locator("#paletteInput").setInputFiles({
      name: "single-palette.json", mimeType: "application/json", buffer: singlePalette
    });
    await palettePersistencePage.waitForFunction(() => {
      const current = JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette;
      return typeof current === "string" && current.startsWith("lib_") &&
        JSON.parse(localStorage.getItem("tgrmlither-palette-library") || "[]").some(item => item.id === current);
    });
    const singleImportedPaletteId = await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    );
    await palettePersistencePage.reload({ waitUntil: "load" });
    await palettePersistencePage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    assert.equal(await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    ), singleImportedPaletteId, "importing a single palette should persist its active workspace selection");
    await palettePersistencePage.locator("#useCustomPalette").click();
    assert.equal(await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    ), "custom", "activating the custom palette should persist its workspace selection");
    await palettePersistencePage.reload({ waitUntil: "load" });
    await palettePersistencePage.waitForFunction(() => document.querySelector("#output")?.width > 0);
    assert.equal(await palettePersistencePage.evaluate(() =>
      JSON.parse(localStorage.getItem("tgrmlithering-workspaces") || "{}").editor?.palette
    ), "custom", "active custom palette should remain selected after reload");
    assert.deepEqual(palettePersistenceErrors, [], "palette persistence workflows should not create runtime errors");
    await palettePersistencePage.close();

    assert.deepEqual(errors, [], "the app should not throw uncaught browser runtime errors");
    console.log("TGRMLither smoke tests passed: workspace isolation, click-tested effects, responsive layout, every algorithm, project/palette/image exports, video timeline/WebM export, and batch processing.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
