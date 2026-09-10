import { chromium } from "playwright";
const base = process.argv[2];
const b = await chromium.launch();
const ctx = await b.newContext();
await ctx.addInitScript(() => {
  localStorage.setItem("fomomarket.wallet.seen", "1");   // как у вернувшегося
  window.__eth = [];
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => { window.__eth.push(method); return method === "eth_accounts" ? [] : null; },
    on() {}, removeListener() {},
  };
});
for (const p of ["/", "/discover", "/portfolio"]) {
  const page = await ctx.newPage();
  await page.goto(base + p, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const c = await page.evaluate(() => window.__eth ?? []);
  console.log(`  ${p.padEnd(12)} ${c.length ? c.join(", ") : "ничего"}`);
  await page.close();
}
await b.close();
