#!/usr/bin/env node
// Issue 7: check that the preview script's benchmark stub reaches the app.
// Serves examples/universal-app/dist and prints the HUD and page errors.
/* global document, window, URL, Worker, MessageEvent */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { chromium } from 'playwright';

const dist = path.resolve('examples/universal-app/dist');
const server = createServer(async (request, response) => {
  const pathname = new URL(request.url, 'http://x').pathname;
  try {
    const file = path.join(dist, pathname === '/' ? 'index.html' : pathname);
    const type = file.endsWith('.js')
      ? 'text/javascript'
      : file.endsWith('.html')
        ? 'text/html'
        : 'application/octet-stream';
    response.writeHead(200, { 'content-type': type });
    response.end(await readFile(file));
  } catch {
    response.writeHead(404);
    response.end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({
  executablePath: process.env.PREVIEW_CHROMIUM || undefined,
});
const context = await browser.newContext();
await context.addInitScript(() => {
  const postMessage = Worker.prototype.postMessage;
  window.__posted = [];
  Worker.prototype.postMessage = function (message, ...rest) {
    window.__posted.push(message?.type);
    if (message?.type !== 'benchmark') {
      return postMessage.call(this, message, ...rest);
    }
    setTimeout(() => {
      this.dispatchEvent(
        new MessageEvent('message', {
          data: { type: 'benchmark', level: 2, loads: [0.1, 0.2, 0.35, 0.9] },
        })
      );
    });
    return undefined;
  };
});
const page = await context.newPage();
page.on('pageerror', (error) => console.log('pageerror', error.message));
page.on('console', (message) =>
  console.log('console', message.type(), message.text())
);
await page.goto(`http://127.0.0.1:${server.address().port}/?seed=preview`);
await page.waitForTimeout(3000);
console.log(
  await page.evaluate(() => ({
    posted: window.__posted,
    hud: document.querySelector('.hud')?.textContent,
    patched: String(Worker.prototype.postMessage).slice(0, 60),
  }))
);
await browser.close();
server.close();
