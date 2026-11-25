const assert = require("node:assert/strict");
const { chromium, firefox, webkit } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/tgrmlither-qa/node_modules/playwright");

const baseURL = process.env.TGRM_BASE_URL || "http://127.0.0.1:4173/";
const engines = [
  ["Chromium", chromium],
  ["Firefox", firefox],
  ["WebKit", webkit]
];

(async () => {
  for (const [name, engine] of engines) {
    const browser = await engine.launch({ headless: true });
    const errors = [];
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 800 } });
      page.on("pageerror", error => errors.push(error.stack || error.message));
      await page.goto(baseURL, { waitUntil: "load", timeout: 30000 });
      await page.waitForFunction(() => {
        const canvas = document.querySelector("#output");
        return canvas?.width > 0 && canvas?.height > 0 &&
          !!document.querySelector("#statAlgorithm")?.textContent.trim();
      }, null, { timeout: 20000 });

      const fixture = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = 96;
        canvas.height = 64;
        const context = canvas.getContext("2d");
        const gradient = context.createLinearGradient(0, 0, 96, 64);
        gradient.addColorStop(0, "#112233");
        gradient.addColorStop(1, "#e6bd74");
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
        for (let y = 0; y < canvas.height; y += 8) {
          context.fillStyle = "rgba(20, 120, 90, .5)";
          context.fillRect(0, y, canvas.width, 3);
        }
        return canvas.toDataURL("image/png");
      });
      const fixtureBuffer = Buffer.from(fixture.split(",")[1], "base64");
      await page.locator("#imageInput").setInputFiles({
        name: "cross-browser-fixture.png",
        mimeType: "image/png",
        buffer: fixtureBuffer
      });
      await page.waitForFunction(() =>
        document.querySelector("#filename")?.textContent.includes("cross-browser-fixture.png")
      );
      await page.evaluate(() => window.__tgrmlitherWaitForPreview?.());
      const initial = await page.locator("#output").evaluate(canvas => ({
        width: canvas.width, height: canvas.height,
        hasContext: !!canvas.getContext("2d")
      }));
      assert.ok(initial.width > 0 && initial.height > 0, name + ": image should render");
      assert.equal(initial.hasContext, true, name + ": a 2D context should be available");

      const restoredCanvas = await page.evaluate(() => {
        const canvas = document.querySelector("#output");
        const event = new Event("contextlost", { cancelable: true });
        canvas.dispatchEvent(event);
        const prevented = event.defaultPrevented;
        canvas.dispatchEvent(new Event("contextrestored"));
        return prevented;
      });
      assert.equal(restoredCanvas, true, name + ": the app should opt into context restoration");
      await page.waitForFunction(() =>
        document.body.dataset.canvasRecovery === "idle" &&
        document.body.dataset.canvasRecoveryResult === "restored"
      );
      await page.evaluate(() => window.__tgrmlitherWaitForPreview?.());

      const configured = await page.evaluate(() =>
        window.__tgrmlitherSetCanvasRecoveryTimeoutForTests?.(350) === true
      );
      assert.equal(configured, true, name + ": local Canvas watchdog test hook should be available");
      await page.evaluate(() => {
        window.__canvasBeforeTimeout = document.querySelector("#output");
        window.__canvasBeforeTimeout.dispatchEvent(new Event("contextlost", { cancelable: true }));
      });
      await page.waitForFunction(() =>
        document.body.dataset.canvasRecovery === "idle" &&
        document.body.dataset.canvasRecoveryResult === "recreated" &&
        document.querySelector("#output") !== window.__canvasBeforeTimeout,
        null, { timeout: 10000 }
      );
      await page.evaluate(() => window.__tgrmlitherWaitForPreview?.());

      // Repeated edits exercise scheduling, canvas resizing and image cleanup without
      // relying on browser-specific video codecs or non-standard memory counters.
      const algorithms = await page.locator("#algorithm option").evaluateAll(options =>
        options.map(option => option.value).filter(value =>
          ["floyd", "atkinson", "bayer4", "bayer8", "pixel"].includes(value)
        )
      );
      assert.ok(algorithms.length >= 3, name + ": expected common raster algorithms should exist");
      for (let i = 0; i < 24; i++) {
        await page.locator("#algorithm").selectOption(algorithms[i % algorithms.length]);
        await page.locator("#scale").evaluate((element, value) => {
          element.value = String(value);
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
        }, 2 + (i % 10));
        await page.evaluate(() => window.__tgrmlitherWaitForPreview?.());
      }

      const finalState = await page.evaluate(() => ({
        width: document.querySelector("#output")?.width || 0,
        height: document.querySelector("#output")?.height || 0,
        canvasCount: document.querySelectorAll("#canvaswrap canvas").length,
        recovery: document.body.dataset.canvasRecovery,
        pending: document.body.dataset.processingPending
      }));
      assert.ok(finalState.width > 0 && finalState.height > 0, name + ": canvas should remain renderable after repeated edits");
      assert.equal(finalState.canvasCount, 2, name + ": canvas replacement should not leak DOM canvas nodes");
      assert.equal(finalState.recovery, "idle", name + ": recovery state should settle");
      assert.equal(finalState.pending, "false", name + ": no preview request should remain stuck");
      const resourceState = await page.evaluate(() => window.__tgrmlitherResourceStatus?.());
      assert.ok(resourceState, name + ": resource telemetry should be available in local test runs");
      assert.equal(resourceState.scratchCanvasOutstanding, 0, name + ": every tracked temporary Canvas should be released after rendering");
      assert.deepEqual(errors, [], name + ": browser compatibility run should not create uncaught exceptions");

      console.log(name + " compatibility checks passed (startup, image render, Canvas recovery, 24 repeated edits).");
      await page.close();
    } finally {
      await browser.close();
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
