#!/usr/bin/env node
/**
 * Does the idle app (no "Speak", after load) keep drawing (issue 28)?
 * Counts WebGL draw calls, animation-frame callbacks and long tasks per
 * second of the built app in Chromium (CPU throttled 4x), a few seconds
 * after load, and the busiest main-thread tasks.
 *
 * Usage:
 *   (cd examples/universal-app && npm run build)
 *   CHROMIUM=<chrome> node experiments/issue-28-idle-frames.mjs <playwright dir>
 */

/* global URL, window, WebGLRenderingContext, WebGL2RenderingContext, PerformanceObserver -- the page functions run in the browser */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [playwrightDir] = process.argv.slice(2);
if (!playwrightDir) {
  console.error('usage: issue-28-idle-frames.mjs <playwright dir>');
  process.exit(2);
}
const { chromium } = await import(
  pathToFileURL(path.join(playwrightDir, 'index.mjs')).href
);
const DIST = path.resolve('examples/universal-app/dist');
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
  const counts = { draws: 0, frames: 0, longTasks: 0, longMs: 0 };
  window.issue28Frames = counts;
  for (const Context of [WebGLRenderingContext, WebGL2RenderingContext]) {
    for (const name of ['drawArrays', 'drawElements']) {
      const original = Context.prototype[name];
      Context.prototype[name] = function (...args) {
        counts.draws++;
        return original.apply(this, args);
      };
    }
  }
  const raf = window.requestAnimationFrame;
  window.requestAnimationFrame = (callback) =>
    raf((time) => {
      counts.frames++;
      callback(time);
    });
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      counts.longTasks++;
      counts.longMs += entry.duration;
    }
  }).observe({ type: 'longtask' });
}

const url = `http://127.0.0.1:${server.address().port}/?debug&seed=preview`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
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
  for (let second = 0; second < 30; second += 3) {
    const before = await page.evaluate(() => ({ ...window.issue28Frames }));
    await page.waitForTimeout(3000);
    const after = await page.evaluate(() => ({ ...window.issue28Frames }));
    const rate = (key) => Math.round((after[key] - before[key]) / 3);
    console.log(
      JSON.stringify({
        at: second + 3,
        drawsPerSecond: rate('draws'),
        framesPerSecond: rate('frames'),
        longTasksPerSecond: (after.longTasks - before.longTasks) / 3,
        longMsPerSecond: rate('longMs'),
      })
    );
  }
} finally {
  await browser.close();
  server.close();
}
