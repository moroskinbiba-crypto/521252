const assert = require("node:assert/strict");
const fs = require("node:fs");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/tgrmlithering-qa/node_modules/playwright");

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

    assert.match(await page.title(), /^TGRMLithering/);
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), true, "regular effects should be visible in Editor");
    assert.equal(await page.locator("#asciiControl").isVisible(), false, "Script Slayer panel should be isolated from Editor");
    assert.equal(await page.locator("#shapeControl").isVisible(), false, "Shape Lab panel should be isolated from Editor");
    const theme = await page.evaluate(() => ({
      bodyFont: getComputedStyle(document.body).fontFamily,
      headingFont: getComputedStyle(document.querySelector("#pageTitle")).fontFamily,
      background: getComputedStyle(document.body).backgroundColor
    }));
    assert.match(theme.bodyFont, /VT323/, "pixel body font stack should be applied");
    assert.match(theme.headingFont, /Press Start 2P/, "pixel heading font stack should be applied");
    const initialSize = await page.locator("#output").evaluate(c => ({ width: c.width, height: c.height }));
    assert.ok(initialSize.width >= 1 && initialSize.height >= 1, "demo image should render");

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
    assert.equal(await page.locator("#algorithm").inputValue(), "shape");
    assert.equal(await page.locator("#shapeControl").isVisible(), true, "Shape Lab settings should only appear in Shape Lab");
    assert.equal(await page.locator("#randomize").isVisible(), false, "Editor randomizer should not leak into Shape Lab");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), false, "standard effect stack must not appear in Shape Lab");
    assert.equal(await page.locator("#asciiControl").isVisible(), false, "Script Slayer settings must not appear in Shape Lab");
    await page.locator('.topnav [data-mode="script"]').click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "script");
    assert.equal(await page.locator("#asciiControl").isVisible(), true, "Script Slayer controls should be visible in Script Slayer");
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), false, "standard effect stack must not appear in Script Slayer");
    assert.equal(await page.locator("#shapeControl").isVisible(), false, "Shape Lab settings must not appear in Script Slayer");
    await page.locator("#asciiSet").selectOption("binary");
    await page.locator("#asciiCustomChars").fill("01#X");
    assert.equal((await page.locator("#asciiCustomCount").textContent()).trim(), "4 / 10");
    await page.locator('.topnav [data-mode="presets"]').click();
    assert.ok(await page.locator("#presetGrid .preset").count() > 0, "built-in presets should render");
    await page.locator("#presetGrid .preset").first().click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "editor");

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
    await page.setViewportSize({ width: 390, height: 844 });
    const mobile = await page.evaluate(() => ({
      pageY: window.scrollY,
      canvas: document.querySelector("#output").getBoundingClientRect().toJSON(),
      mainHeight: document.querySelector(".layout > main").getBoundingClientRect().height,
      settingsHeight: document.querySelector("#inspector").getBoundingClientRect().height
    }));
    assert.equal(mobile.pageY, 0);
    assert.ok(mobile.canvas.width > 0 && mobile.canvas.height > 0, "mobile preview should remain visible");
    assert.ok(mobile.mainHeight > 100 && mobile.settingsHeight > 100, "mobile split panes should both be usable");

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
    for (const algorithm of algorithms) {
      await page.locator("#algorithm").selectOption(algorithm);
      const rendered = await page.locator("#output").evaluate(canvas => ({
        width: canvas.width,
        height: canvas.height,
        label: document.querySelector("#statAlgorithm")?.textContent.trim()
      }));
      assert.ok(rendered.width > 0 && rendered.height > 0, "algorithm failed to render: " + algorithm);
      assert.ok(rendered.label, "algorithm label missing for: " + algorithm);
    }
    await page.locator("#algorithm").selectOption("floyd");

    // Exercise each post-processing effect independently.
    for (const effect of await page.locator(".effect-control input[type=checkbox][data-effect]").evaluateAll(els => els.map(el => el.dataset.effect))) {
      const input = page.locator('#effect-' + effect);
      assert.equal(await input.isChecked(), false, "effect should start unchecked: " + effect);
      // Use real pointer clicks rather than assigning .checked / dispatching a synthetic event.
      await input.click();
      assert.equal(await input.isChecked(), true, "checkbox must respond to a real click: " + effect);
      assert.equal(await input.locator("xpath=..").evaluate(el => el.closest(".effect-control").classList.contains("is-active")), true,
        "active state should be reflected in the effect card: " + effect);
      assert.ok(await page.locator("#output").evaluate(c => c.width > 0 && c.height > 0), "effect failed to render: " + effect);
      await input.click();
      assert.equal(await input.isChecked(), false, "checkbox must turn off on a second click: " + effect);
    }

    const png = await downloadFrom(page, "#png");
    assert.deepEqual([...png.bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
    assert.match(png.download.suggestedFilename(), /TGRMLithering.*\.png$/);

    const jpg = await downloadFrom(page, "#jpg");
    assert.equal(jpg.bytes[0], 0xff);
    assert.equal(jpg.bytes[1], 0xd8);

    const project = await downloadFrom(page, "#saveProject");
    const projectData = JSON.parse(project.bytes.toString("utf8"));
    assert.equal(projectData.format, "tgrmlithering-project");
    assert.equal(projectData.workspace, "editor", "project files should remember their originating workspace");
    assert.ok(projectData.source.startsWith("data:image/png;base64,"));
    await page.locator("#projectInput").setInputFiles({
      name: "roundtrip.tgrmlithering.json",
      mimeType: "application/json",
      buffer: project.bytes
    });
    await page.waitForFunction(() => document.querySelector("#filename")?.textContent.includes("qa-fixture.png"));

    const palette = await downloadFrom(page, "#exportPalette");
    const paletteData = JSON.parse(palette.bytes.toString("utf8"));
    assert.ok(Array.isArray(paletteData.colors) && paletteData.colors.length >= 2);
    await page.locator("#paletteInput").setInputFiles({
      name: "palette.json", mimeType: "application/json", buffer: palette.bytes
    });

    const offline = await downloadFrom(page, "#offlineBtn");
    assert.match(offline.download.suggestedFilename(), /TGRMLithering-offline\.html$/);
    assert.ok(offline.bytes.toString("utf8").includes("TGRMLithering — Browser Image Studio"));

    // Video workspace should have a separate visible timeline and standard post-processing controls.
    await page.locator('.topnav [data-mode="video"]').click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "video");
    assert.equal(await page.locator("#videoView").isVisible(), true);
    assert.equal(await page.locator("#videoTimeline").isVisible(), true);
    assert.equal(await page.locator("#generalEffectsControl").isVisible(), true);
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
    assert.match(videoDownload.suggestedFilename(), /TGRMLithering\.webm$/);
    assert.ok(fs.statSync(await videoDownload.path()).size > 500, "exported video should contain data");

    // Batch processing should accept and produce a real PNG.
    await page.locator('.topnav [data-mode="batch"]').click();
    await page.locator("#batchInput").setInputFiles({
      name: "batch-fixture.png", mimeType: "image/png", buffer: imageBuffer
    });
    assert.equal(await page.locator("#batchList .fileitem").count(), 1);
    await page.locator("#runBatch").click();
    await page.waitForFunction(() => document.querySelectorAll("#batchResults a[download]").length === 1, null, { timeout: 15000 });
    assert.match(await page.locator("#batchResults a[download]").getAttribute("download"), /TGRMLithering\.png$/);

    assert.deepEqual(errors, [], "the app should not throw uncaught browser runtime errors");
    console.log("TGRMLithering smoke tests passed: workspace isolation, click-tested effects, responsive layout, every algorithm, project/palette/image exports, video timeline/WebM export, and batch processing.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
