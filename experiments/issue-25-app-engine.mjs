/* global window, document */

/**
 * Open the built app (vite preview) in a browser, press Speak
 * and read the engine status: first with the .wasm served, then with every .wasm
 * request blocked.
 *
 * Usage: node experiments/issue-25-app-engine.mjs [chromium|firefox|webkit] [url] [screenshot-prefix]
 * Needs the playwright package (PLAYWRIGHT=<path to playwright/index.js>,
 * default: the global npm install) and `npx vite preview` of
 * examples/universal-app on the url (default http://localhost:4173/).
 */

import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';

const [browserName = 'firefox', url = 'http://localhost:4173/', prefix] =
  process.argv.slice(2);
const require = createRequire(import.meta.url);
const playwright = require(
  process.env.PLAYWRIGHT ??
    `${execSync('npm root -g').toString().trim()}/playwright`
);

const recordWorker = () => {
  window.__engineLog = [];
  const Original = window.Worker;
  window.Worker = class extends Original {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        const m = event.data;
        if (m && ['engine', 'start', 'end', 'error'].includes(m.type)) {
          window.__engineLog.push(
            m.type === 'start'
              ? {
                  type: m.type,
                  engine: m.engine,
                  fallbackReason: m.fallbackReason,
                }
              : m.type === 'engine'
                ? { type: m.type, name: m.name, reason: m.reason }
                : { type: m.type, message: m.message }
          );
        }
      });
    }
  };
};

async function run(page, blockWasm) {
  if (blockWasm) {
    await page.route('**/*.wasm', (route) => route.abort());
  }
  await page.goto(url);
  await page.waitForSelector('.engine-status');
  await page.getByRole('button', { name: /speak/i }).first().click();
  const started = Date.now();
  while (Date.now() - started < 120000) {
    const done = await page.evaluate(() =>
      window.__engineLog.some((m) => m.type === 'end' || m.type === 'error')
    );
    if (done) {
      break;
    }
    await page.waitForTimeout(250);
  }
  await page.evaluate(() =>
    document.querySelector('.engine-status').scrollIntoView({ block: 'center' })
  );
  await page.waitForTimeout(300);
  if (prefix) {
    await page.screenshot({
      path: `${prefix}-${blockWasm ? 'js' : 'rust'}.png`,
    });
  }
  return page.evaluate(() => ({
    status: document.querySelector('.engine-status').textContent,
    log: window.__engineLog,
  }));
}

const browser = await playwright[browserName].launch();
try {
  for (const blockWasm of [false, true]) {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 800 },
    });
    await context.addInitScript(recordWorker);
    const page = await context.newPage();
    const result = await run(page, blockWasm);
    console.log(
      JSON.stringify({
        browser: `${browserName} ${browser.version()}`,
        wasm: blockWasm ? 'blocked' : 'served',
        ...result,
      })
    );
    await context.close();
  }
} finally {
  await browser.close();
}
