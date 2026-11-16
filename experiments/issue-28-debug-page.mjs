// Prints the console of the built app (helper of issue-28-browser-acceptance.mjs).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const { chromium } = await import(
  pathToFileURL(path.join(process.argv[2], 'index.mjs')).href
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
});
const page = await browser.newPage();
page.on('console', (m) => console.log('console', m.type(), m.text()));
page.on('pageerror', (e) => console.log('pageerror', e.message));
page.on('requestfailed', (r) => console.log('failed', r.url()));
await page.goto(process.argv[3]);
await page.waitForTimeout(5000);
console.log((await page.content()).slice(0, 1500));
await page.screenshot({ path: 'ci-logs/debug-page.png' });
await browser.close();
