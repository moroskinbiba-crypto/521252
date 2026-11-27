"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const sw = fs.readFileSync(path.join(root, "sw.js"), "utf8");
const links = [...html.matchAll(/<link[^>]*data-standalone-inline[^>]*>/g)].map(match => match[0]);

assert.equal(links.length, 5, "the app should load its five ordered local stylesheet layers");

const hrefs = links.map((tag, index) => {
  const href = tag.match(/href="([^"]+)"/)?.[1];
  assert.ok(href, "stylesheet link " + index + " must have an href");
  assert.ok(href.startsWith("./styles/"), "local standalone stylesheet should live under styles/");
  const diskPath = path.resolve(root, href.replace("./", ""));
  assert.ok(diskPath.startsWith(path.join(root, "styles") + path.sep), "stylesheet path must stay inside styles/");
  assert.ok(fs.existsSync(diskPath), "stylesheet file should exist: " + href);
  assert.ok(fs.statSync(diskPath).size > 0, "stylesheet should not be empty: " + href);
  return href;
});

assert.deepEqual(hrefs, [
  "./styles/base.css",
  "./styles/xp-shell.css",
  "./styles/action-priority.css",
  "./styles/animation-studio.css",
  "./styles/ui-foundation.css"
], "stylesheet order is part of the cascade contract");
assert.match(links[1], /id="xpShellStyles"/, "XP theme element id is a runtime contract");
assert.match(links[1], /media="not all"/, "XP theme should begin disabled until selected");

const prefix = "const ASSETS = ";
const assetStart = sw.indexOf(prefix);
const assetEnd = sw.indexOf(";", assetStart);
assert.ok(assetStart >= 0 && assetEnd > assetStart, "service worker should expose its explicit precache list");
const cachedAssets = JSON.parse(sw.slice(assetStart + prefix.length, assetEnd));
for (const href of hrefs) {
  assert.ok(cachedAssets.includes(href), "service worker must precache " + href);
}

const saveStart = html.indexOf("async function saveStandalone()");
const saveEnd = html.indexOf("function openImage()", saveStart);
assert.ok(saveStart >= 0 && saveEnd > saveStart, "standalone builder should remain discoverable");
const saveSource = html.slice(saveStart, saveEnd);
assert.ok(saveSource.includes("link[data-standalone-inline]"), "standalone builder should detect local CSS assets");
assert.ok(saveSource.includes("link.replaceWith(style)"), "standalone builder should replace each CSS link with an inline style");
assert.ok(saveSource.includes("animation-engine.js"), "standalone builder must continue embedding the animation engine");

console.log("CSS asset checks passed: five ordered files, PWA precache and standalone inlining contract.");
