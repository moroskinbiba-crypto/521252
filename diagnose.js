import { chromium } from "playwright";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

function isAllowedHost(hostname) {
  const h = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return h === "localhost"
    || h.endsWith(".localhost")
    || h.endsWith(".test")
    || h === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(h);
}

function safeText(value) {
  return String(value ?? "")
    .replace(/https?:\/\/[^\s"'<>]+/gi, (raw) => {
      try {
        const u = new URL(raw);
        return `${u.origin}${u.pathname}?[query redacted]`;
      } catch {
        return "[URL redacted]";
      }
    })
    .replace(/\b(token|authorization|cookie|secret|password|session)[=: ]+[^\s&;,]+/gi, "$1=[REDACTED]")
    .slice(0, 240);
}

const rawUrl = process.env.TEST_URL;
if (!rawUrl) {
  console.error("Set TEST_URL to a local/test URL, e.g. http://localhost:3000");
  process.exit(2);
}

let base;
try {
  base = new URL(rawUrl);
} catch {
  console.error("TEST_URL is not a valid URL.");
  process.exit(2);
}

if (!["http:", "https:"].includes(base.protocol) || !isAllowedHost(base.hostname)) {
  console.error("Safety stop: only localhost, 127.0.0.1, ::1, *.localhost, or *.test are allowed.");
  console.error("This diagnostic tool intentionally refuses public contest websites.");
  process.exit(2);
}

const seen = new Set();
const browser = await chromium.launch({ headless: false });
const context = await browser.newContext();
const page = await context.newPage();

page.on("request", (request) => {
  try {
    const u = new URL(request.url());
    if (u.origin !== base.origin) return;
    const key = `REQ ${request.method()} ${u.pathname}`;
    if (!seen.has(key)) {
      seen.add(key);
      console.log(key);
    }
  } catch {}
});

page.on("response", (response) => {
  try {
    const u = new URL(response.url());
    if (u.origin !== base.origin) return;
    console.log(`RES ${response.status()} ${response.request().method()} ${u.pathname}`);
  } catch {}
});

page.on("requestfailed", (request) => {
  try {
    const u = new URL(request.url());
    if (u.origin !== base.origin) return;
    console.log(`FAILED ${request.method()} ${u.pathname}: ${safeText(request.failure()?.errorText)}`);
  } catch {}
});

page.on("console", (message) => {
  if (message.type() === "error") {
    console.log(`CONSOLE ERROR: ${safeText(message.text())}`);
  }
});

page.on("pageerror", (error) => {
  console.log(`PAGE ERROR: ${safeText(error.message)}`);
});

page.on("framenavigated", (frame) => {
  if (frame !== page.mainFrame()) return;
  try {
    const u = new URL(frame.url());
    if (u.origin !== base.origin && u.protocol !== "about:") {
      console.log("NOTICE: main frame navigated away from the configured test origin.");
    }
  } catch {}
});

try {
  console.log(`Opening test environment: ${base.origin}${base.pathname}`);
  await page.goto(base.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
  console.log("\nBrowser is open. On the test site, manually click the test vote button once.");
  console.log("Do not use this tool against a live public contest; it will not send or replay votes.");
  const rl = readline.createInterface({ input, output });
  await rl.question("After the single test click and any UI response, press Enter here to finish. ");
  rl.close();
} catch (error) {
  console.error(`Navigation/test error: ${safeText(error.message)}`);
} finally {
  await context.close();
  await browser.close();
  console.log("\nDone. Correlate this report with test-server logs/database to confirm whether the write committed.");
}
