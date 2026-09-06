import { chromium } from "playwright";
const [,, path, out, full] = process.argv;
const b = await chromium.launch();
const p = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await p.goto("http://localhost:3082" + path, { waitUntil: "load", timeout: 120000 });
await p.evaluate(async () => {
  for (let y = 0; y < document.body.scrollHeight; y += 400) { window.scrollTo(0, y); await new Promise(r => setTimeout(r, 40)); }
  window.scrollTo(0, 0);
});
await p.waitForTimeout(1200);
await p.screenshot({ path: out, fullPage: full === "full" });
await b.close();
