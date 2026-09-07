/**
 * Does the site touch a wallet before it is asked to?
 *
 * Installs a spy `window.ethereum` before any page script runs and reports
 * every request the page makes to it. Arriving to read the board should
 * produce none at all.
 */
import { chromium } from "playwright";

const base = process.argv[2] ?? "http://localhost:3081";
const browser = await chromium.launch();
const ctx = await browser.newContext();
await ctx.addInitScript(() => {
  window.__ethCalls = [];
  window.ethereum = {
    isMetaMask: true,
    request: async ({ method }) => {
      window.__ethCalls.push(method);
      if (method === "eth_accounts") return [];
      if (method === "eth_chainId") return "0x1237";
      throw new Error("spy wallet: nothing is authorised");
    },
    on() {}, removeListener() {},
  };
});

for (const path of ["/", "/discover", "/leaderboard", "/portfolio", "/docs"]) {
  const page = await ctx.newPage();
  await page.goto(base + path, { waitUntil: "networkidle", timeout: 120000 }).catch(() => {});
  await page.waitForTimeout(2500);
  const calls = await page.evaluate(() => window.__ethCalls ?? []);
  console.log(`${path.padEnd(13)} wallet calls: ${calls.length ? calls.join(", ") : "none"}`);
  await page.close();
}
await browser.close();
