/**
 * Renders the brand marks and the link-preview card from the same markup the
 * site uses, so a change to the wordmark never leaves a stale bitmap behind.
 */
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
// the real mark, already cut off its plate by scripts/cut-logo.py
const mark = readFileSync("public/brand/mark.png").toString("base64");
const MARK = `<img src="data:image/png;base64,${mark}" style="width:__W__px;height:auto;display:block">`;

const page = (body, w, h) => `<!doctype html><meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  *{margin:0;box-sizing:border-box}
  body{width:${w}px;height:${h}px;background:#08090d;color:#f2f4f8;
       font-family:"Space Grotesk",system-ui,sans-serif;display:flex;overflow:hidden}
  .mono{font-family:"IBM Plex Mono",monospace}
</style>${body}`;

const b = await chromium.launch();

// square marks
for (const size of [512, 192, 96]) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(page(
    `<div style="flex:1;display:grid;place-items:center">${MARK.replace(/__W__/g, Math.round(size * 0.58))}</div>`,
    size, size,
  ));
  await p.waitForTimeout(200);
  await p.screenshot({ path: size === 512 ? "app/icon.png" : `public/brand/mark-${size}.png` });
  await p.close();
}
const p512 = await b.newPage({ viewport: { width: 512, height: 512 } });
await p512.setContent(page(`<div style="flex:1;display:grid;place-items:center">${MARK.replace(/__W__/g, 300)}</div>`, 512, 512));
await p512.waitForTimeout(200);
await p512.screenshot({ path: "public/brand/mark-512.png" });
await p512.close();

// link preview
const og = await b.newPage({ viewport: { width: 1200, height: 400 } });
await og.setContent(page(`
  <div style="flex:1;position:relative;padding:56px 64px;display:flex;flex-direction:column;justify-content:space-between;
              background:radial-gradient(90% 120% at 12% 0%, rgba(91,108,255,.30) 0%, rgba(8,9,13,0) 62%)">
    <div style="display:flex;align-items:center;gap:14px">
      ${MARK.replace(/__W__/g, 40)}
      <span style="font-size:40px;font-weight:500;letter-spacing:-.05em">fomo market</span>
      <span class="mono" style="font-size:13px;letter-spacing:.18em;text-transform:uppercase;color:#8d94a6;
                   border:1px solid rgba(255,255,255,.1);padding:6px 10px;border-radius:4px">Robinhood Chain</span>
    </div>
    <div>
      <div style="font-size:60px;font-weight:500;letter-spacing:-.04em;line-height:1.04">The traders are<br>the instrument.</div>
      <div class="mono" style="margin-top:20px;font-size:18px;color:#949bad;letter-spacing:-.01em">
        Up or down on a fomo account&rsquo;s PnL &middot; settled in USDG
      </div>
    </div>
  </div>`, 1200, 400));
await og.waitForTimeout(250);
await og.screenshot({ path: "public/brand/og.jpg", type: "jpeg", quality: 92 });
await og.close();

await b.close();
console.log("brand assets written");
