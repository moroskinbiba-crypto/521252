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
    await page.locator('.topnav [data-mode="script"]').click();
    assert.equal(await page.locator("body").getAttribute("data-mode"), "script");
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
      leftDisplay: getComputedStyle(document.querySelector(".layout > .left")).display,
      inspectorWidth: document.querySelector("#inspector").getBoundingClientRect().width,
      canvasWidth: document.querySelector("#output").getBoundingClientRect().width
    }));
    assert.equal(tablet.leftDisplay, "none");
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
    for (const effect of await page.locator("[data-effect]").evaluateAll(els => els.map(el => el.dataset.effect))) {
      const input = page.locator('[data-effect="' + effect + '"]');
      await input.evaluate(el => {
        el.checked = true;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
      assert.ok(await page.locator("#output").evaluate(c => c.width > 0 && c.height > 0), "effect failed to render: " + effect);
      await input.evaluate(el => {
        el.checked = false;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      });
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

    // Batch processing should accept and produce a real PNG.
    await page.locator('.left [data-mode="batch"]').click();
    await page.locator("#batchInput").setInputFiles({
      name: "batch-fixture.png", mimeType: "image/png", buffer: imageBuffer
    });
    assert.equal(await page.locator("#batchList .fileitem").count(), 1);
    await page.locator("#runBatch").click();
    await page.waitForFunction(() => document.querySelectorAll("#batchResults a[download]").length === 1, null, { timeout: 15000 });
    assert.match(await page.locator("#batchResults a[download]").getAttribute("download"), /TGRMLithering\.png$/);

    assert.deepEqual(errors, [], "the app should not throw uncaught browser runtime errors");
    console.log("TGRMLithering smoke tests passed: startup, controls, modes, responsive layout, settings scroll, image import, PNG/JPEG/project/palette/standalone export, and batch processing.");
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
