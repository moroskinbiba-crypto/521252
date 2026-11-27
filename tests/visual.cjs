"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "/tmp/tgrmlither-qa/node_modules/playwright");

const baseURL = process.env.TGRM_BASE_URL || "http://127.0.0.1:4173/";
const outputDir = path.join(process.cwd(), "artifacts", "ui-audit");
const viewports = [
  { width: 320, height: 780 },
  { width: 360, height: 800 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 768 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 }
];
const captureWidths = new Set([320, 390, 768, 1280]);
const modes = ["editor", "presets", "shape", "script", "batch", "video"];

function safeName(value) {
  return String(value).replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

async function switchMode(page, mode) {
  await page.evaluate(nextMode => {
    const button = document.querySelector('.topnav [data-mode="' + nextMode + '"]');
    if (!button) throw new Error("Missing workspace navigation button: " + nextMode);
    button.click();
  }, mode);
  await page.waitForFunction(expected => document.body.dataset.mode === expected, mode, { timeout: 10000 });
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

(async () => {
  fs.rmSync(outputDir, { recursive: true, force: true });
  fs.mkdirSync(outputDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  const errors = [];
  let captures = 0;
  try {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 1,
      acceptDownloads: true
    });
    page.on("pageerror", error => errors.push(error.stack || error.message));

    await page.goto(baseURL, { waitUntil: "load", timeout: 30000 });
    await page.waitForFunction(() => {
      const canvas = document.querySelector("#output");
      return canvas && canvas.width > 0 && canvas.height > 0;
    }, null, { timeout: 15000 });

    for (const mode of modes) {
      await switchMode(page, mode);

      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));

        const layout = await page.evaluate(() => {
          const box = selector => {
            const element = document.querySelector(selector);
            if (!element) return null;
            const r = element.getBoundingClientRect();
            return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom };
          };
          const visible = element => !!element && !!(element.getClientRects().length) &&
            getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden";
          const headerGroups = ["#homeLogo", "#openImage", ".topnav", ".topright"]
            .map(selector => ({ selector, element: document.querySelector(selector) }))
            .filter(item => visible(item.element))
            .map(item => ({ selector: item.selector, ...box(item.selector) }));
          const overlaps = [];
          for (let i = 0; i < headerGroups.length; i++) {
            for (let j = i + 1; j < headerGroups.length; j++) {
              const a = headerGroups[i], b = headerGroups[j];
              const intersects = a.x < b.right - 1 && a.right > b.x + 1 &&
                a.y < b.bottom - 1 && a.bottom > b.y + 1;
              if (intersects) overlaps.push([a.selector, b.selector]);
            }
          }
          const inspector = document.querySelector("#inspector");
          const quickNav = document.querySelector("#inspectorJumpNav");
          return {
            width: innerWidth,
            documentWidth: document.documentElement.scrollWidth,
            uploadText: document.querySelector("#openImage")?.innerText || "",
            upload: box("#openImage"),
            inspector: box("#inspector"),
            inspectorVisible: visible(inspector),
            quickNavVisible: visible(quickNav),
            quickNavButtons: quickNav ? [...quickNav.querySelectorAll("button:not([hidden])")].length : 0,
            resetText: document.querySelector("#reset")?.innerText || "",
            headerOverlaps: overlaps,
            mode: document.body.dataset.mode
          };
        });

        assert.equal(layout.mode, mode, mode + "/" + viewport.width + ": workspace should be active");
        assert.ok(layout.documentWidth <= viewport.width + 1,
          mode + "/" + viewport.width + ": horizontal page overflow (" + layout.documentWidth + "px > " + viewport.width + "px)");
        assert.ok(layout.upload && layout.upload.width >= 80,
          mode + "/" + viewport.width + ": primary upload action should remain full-size");
        assert.match(layout.uploadText, /Загрузить/,
          mode + "/" + viewport.width + ": upload action must keep its visible label");
        assert.ok(layout.upload.x >= -1 && layout.upload.right <= viewport.width + 1,
          mode + "/" + viewport.width + ": upload action should stay inside the viewport");
        assert.deepEqual(layout.headerOverlaps, [],
          mode + "/" + viewport.width + ": header controls must not overlap");

        if (mode === "presets") {
          assert.equal(layout.inspectorVisible, false, "Presets should not show the editing inspector");
        } else {
          assert.equal(layout.inspectorVisible, true, mode + ": contextual inspector should be visible");
          assert.ok(layout.inspector.width > 0 && layout.inspector.width <= viewport.width + 1,
            mode + "/" + viewport.width + ": inspector should fit the viewport");
          assert.equal(layout.quickNavVisible, true, mode + ": quick navigation should be available");
          assert.ok(layout.quickNavButtons > 0, mode + ": quick navigation should expose relevant sections");
          assert.match(layout.resetText, /Сбросить пространство/,
            "Reset action should describe the scope it actually resets");
        }

        if (captureWidths.has(viewport.width)) {
          await page.evaluate(() => window.scrollTo(0, 0));
          await page.screenshot({
            path: path.join(outputDir, safeName(mode) + "-" + viewport.width + "-workspace.png"),
            animations: "disabled"
          });
          captures++;

          if (mode !== "presets") {
            await page.locator("#inspector").screenshot({
              path: path.join(outputDir, safeName(mode) + "-" + viewport.width + "-inspector.png"),
              animations: "disabled"
            });
            captures++;
          }
        }
      }

      if (mode !== "presets") {
        const firstJump = page.locator("#inspectorJumpNav button:not([hidden])").first();
        await firstJump.click();
        assert.equal(await firstJump.getAttribute("aria-current"), "location",
          mode + ": inspector jump button should expose its current destination");
      }
    }

    // Dialogs must name themselves, take focus, trap keyboard navigation and return focus.
    await page.setViewportSize({ width: 390, height: 844 });
    await switchMode(page, "presets");
    await page.locator("#savePresetLibrary").click();
    const presetDialog = page.locator("#modal");
    assert.equal(await presetDialog.getAttribute("role"), "dialog");
    assert.equal(await presetDialog.getAttribute("aria-modal"), "true");
    assert.equal(await presetDialog.getAttribute("aria-hidden"), "false");
    assert.equal(await page.locator('label[for="presetName"]').count(), 1);
    await page.waitForFunction(() => document.activeElement?.id === "presetName");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "modalSave",
      "Shift+Tab from the first preset field should wrap to the last dialog action");
    await page.keyboard.press("Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "presetName",
      "Tab from the last preset action should wrap to the first field");
    await page.keyboard.press("Escape");
    assert.equal(await presetDialog.getAttribute("aria-hidden"), "true");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "savePresetLibrary",
      "closing the preset dialog should restore focus to its opener");

    await switchMode(page, "editor");
    const fixture = await page.evaluate(() => {
      const canvas = document.createElement("canvas");
      canvas.width = 96;
      canvas.height = 64;
      const ctx = canvas.getContext("2d");
      const gradient = ctx.createLinearGradient(0, 0, 96, 64);
      gradient.addColorStop(0, "#102030");
      gradient.addColorStop(1, "#d0b080");
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/png");
    });
    await page.locator("#imageInput").setInputFiles({
      name: "ui-audit-fixture.png",
      mimeType: "image/png",
      buffer: Buffer.from(fixture.split(",")[1], "base64")
    });
    await page.waitForFunction(() =>
      document.querySelector("#filename")?.textContent.includes("ui-audit-fixture.png")
    );
    await page.locator("#topExport").click();
    const exportDialog = page.locator("#exportModal");
    assert.equal(await exportDialog.getAttribute("role"), "dialog");
    assert.equal(await exportDialog.getAttribute("aria-hidden"), "false");
    await page.waitForFunction(() => document.activeElement?.id === "exportFormat");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "exportConfirm",
      "export dialog should trap reverse tab navigation");
    await page.keyboard.press("Escape");
    assert.equal(await exportDialog.getAttribute("aria-hidden"), "true");
    assert.equal(await page.evaluate(() => document.activeElement?.id), "topExport",
      "closing the export dialog should restore focus to its opener");

    assert.deepEqual(errors, [], "responsive UI audit should not produce uncaught browser exceptions");
    console.log("Responsive UI audit passed: " + viewports.length + " viewports × " + modes.length +
      " workspaces; " + captures + " screenshots captured; modal focus tests passed.");
    await page.close();
  } finally {
    await browser.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
