#!/usr/bin/env node
/**
 * Screenshots of issue 28 in the built app (Chromium, CPU throttled 4x,
 * empty storage, `?debug`): the page right after the silent benchmark
 * answered, the "Measured 0 days ago · rust" note with "Measure again" and
 * the HUD with the benchmark's long tasks. Writes docs/screenshots/issue-28.
 *
 * Usage:
 *   (cd examples/universal-app && npm run build)
 *   CHROMIUM=<chrome> node experiments/issue-28-screenshots.mjs <playwright dir>
 */

/* global URL, window, Worker, document -- the page functions run in the browser */
import { createServer } from 'node:http';
import { mkdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [playwrightDir] = process.argv.slice(2);
if (!playwrightDir) {
  console.error('usage: issue-28-screenshots.mjs <playwright dir>');
  process.exit(2);
}
const { chromium } = await import(
  pathToFileURL(path.join(playwrightDir, 'index.mjs')).href
);
const DIST = path.resolve('examples/universal-app/dist');
const OUT = path.resolve('docs/screenshots/issue-28');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const name = url.pathname === '/' ? '/index.html' : url.pathname;
  try {
    const body = await readFile(path.join(DIST, decodeURIComponent(name)));
    response.writeHead(200, {
      'content-type': TYPES[path.extname(name)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

function instrument() {
  window.issue28Answered = false;
  const add = Worker.prototype.addEventListener;
  Worker.prototype.addEventListener = function (type, listener, ...rest) {
    if (type === 'message') {
      add.call(this, 'message', (event) => {
        if (event.data?.type === 'benchmark' && !event.data.gpuPending) {
          window.issue28Answered = true;
        }
      });
    }
    return add.call(this, type, listener, ...rest);
  };
}

await mkdir(OUT, { recursive: true });
const url = `http://127.0.0.1:${server.address().port}/?debug&seed=preview`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
});
try {
  const context = await browser.newContext({
    locale: 'en-US',
    viewport: { width: 1280, height: 1000 },
  });
  await context.addInitScript(instrument);
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(url);
  await page.waitForFunction(() => window.issue28Answered, null, {
    timeout: 120000,
  });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(OUT, 'page-after-benchmark.png') });
  await page
    .locator('.speak-panel')
    .screenshot({ path: path.join(OUT, 'measured-note.png') });
  await page
    .locator('.hud')
    .first()
    .screenshot({ path: path.join(OUT, 'debug-hud.png') });
  console.log(
    JSON.stringify({
      note: await page.locator('.measured-note').textContent(),
      hud: await page.evaluate(
        () => document.querySelector('.hud')?.textContent ?? ''
      ),
      storage: await page.evaluate(() => Object.keys(window.localStorage)),
    })
  );
} finally {
  await browser.close();
  server.close();
}
