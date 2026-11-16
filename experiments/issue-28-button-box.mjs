#!/usr/bin/env node
/**
 * Where the "Speak" button of the built app is in a 1280x720 viewport
 * (issue 28 acceptance clicks it with a plain mouse click).
 * Usage: node experiments/issue-28-button-box.mjs <playwright dir> <url>
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [playwrightDir, url] = process.argv.slice(2);
const { chromium } = await import(
  pathToFileURL(path.join(playwrightDir, 'index.mjs')).href
);
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
});
const page = await browser.newPage();
await page.goto(url);
const submit = page.locator('button[type="submit"].primary');
await submit.waitFor({ state: 'visible' });
console.log(page.viewportSize(), await submit.boundingBox());
await browser.close();
