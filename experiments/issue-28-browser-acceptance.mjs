#!/usr/bin/env node
/**
 * Browser acceptance of issue 28 on the built app (examples/universal-app/dist):
 * Chromium with the CPU throttled 4x, address with `?debug`.
 *
 * 1. Empty storage: "Speak" pressed as soon as the page shows it; the time
 *    from the click to the first audio handed to the player, the number of
 *    `benchmark` messages to the worker, the long tasks of the HUD and
 *    whether a HUD note appeared.
 * 2. Reload (valid cache): the same, which should send no `benchmark`.
 * 3. `localStorage.clear()` and reload: one `benchmark` again.
 *
 * Usage:
 *   (cd examples/universal-app && npm ci --ignore-scripts && npm run build)
 *   node experiments/issue-28-browser-acceptance.mjs <path to playwright> [runs]
 * The playwright package is not a dependency of this repository; pass the
 * directory of an installed one (e.g. from `npx playwright`).
 */

/* global URL, PerformanceObserver, window, Worker, performance, MessagePort, AudioBufferSourceNode, MutationObserver, document, localStorage -- the page functions run in the browser */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [playwrightDir, runsArg] = process.argv.slice(2);
if (!playwrightDir) {
  console.error(
    'usage: issue-28-browser-acceptance.mjs <playwright dir> [runs]'
  );
  process.exit(2);
}
const { chromium } = await import(
  pathToFileURL(path.join(playwrightDir, 'index.mjs')).href
);
const RUNS = Number(runsArg ?? 3);
// QUIET=1: no "Speak", to see the long tasks of the benchmark alone.
const SPEAK = process.env.QUIET !== '1';
const DIST = path.resolve('examples/universal-app/dist');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

function serve() {
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
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve(server))
  );
}

/** Runs in the page before the app: records what the acceptance needs. */
function instrument() {
  const probe = {
    benchmarks: [],
    answers: 0,
    click: null,
    sound: null,
    notes: [],
    answerAt: null,
    tasks: [],
  };
  new PerformanceObserver((list) => {
    for (const entry of list.getEntries()) {
      probe.tasks.push([
        Math.round(entry.startTime),
        Math.round(entry.duration),
      ]);
    }
  }).observe({ type: 'longtask', buffered: true });
  window.issue28 = probe;
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.type === 'benchmark') {
      probe.benchmarks.push(performance.now());
    }
    return post.call(this, message, ...rest);
  };
  const addEventListener = Worker.prototype.addEventListener;
  Worker.prototype.addEventListener = function (type, listener, ...rest) {
    if (type === 'message') {
      addEventListener.call(this, 'message', (event) => {
        if (event.data?.type === 'benchmark' && !event.data.gpuPending) {
          probe.answers++;
          probe.answerAt = performance.now();
        }
      });
    }
    return addEventListener.call(this, type, listener, ...rest);
  };
  const sound = () => {
    if (probe.click !== null && probe.sound === null) {
      probe.sound = performance.now();
    }
  };
  const portPost = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...rest) {
    if (message?.type === 'chunk' || message?.type === 'ring') {
      sound();
    }
    return portPost.call(this, message, ...rest);
  };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    sound();
    return start.apply(this, args);
  };
  // Texts of HUD notes (render-ahead waits are expected, a benchmark note
  // is not).
  new MutationObserver(() => {
    const text = document.querySelector('.hud .hud-note')?.textContent;
    if (text && !probe.notes.includes(text)) {
      probe.notes.push(text);
    }
  }).observe(document, { childList: true, subtree: true });
}

async function visit(page, url, speak = true) {
  await page.goto(url);
  const submit = page.locator('button[type="submit"].primary');
  await submit.waitFor({ state: 'visible' });
  await page.waitForFunction(
    () => !document.querySelector('button[type="submit"].primary')?.disabled
  );
  if (speak) {
    await page.evaluate(() => {
      window.issue28.click = performance.now();
    });
    await submit.click();
    await page.waitForFunction(() => window.issue28.sound !== null, null, {
      timeout: 60000,
    });
  }
  // Let the idle-time benchmark run and answer.
  await page.waitForTimeout(6000);
  return page.evaluate(() => {
    const probe = window.issue28;
    const hud = document.querySelector('.hud')?.textContent ?? '';
    const longTasks = /(?:long tasks|долгие задачи) (\d+)/.exec(hud)?.[1];
    return {
      loadToClick: Math.round(probe.click),
      soundAfterClick: Math.round(probe.sound - probe.click),
      benchmarks: probe.benchmarks.length,
      benchmarkAt: probe.benchmarks.map(Math.round),
      answers: probe.answers,
      answerAt: probe.answerAt === null ? null : Math.round(probe.answerAt),
      tasks: probe.tasks,
      longTasks: longTasks === undefined ? null : Number(longTasks),
      notes: probe.notes,
      measured: document.querySelector('.measured-note small')?.textContent,
    };
  });
}

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/?debug&seed=preview`;
// CHROMIUM=<executable> uses another browser than the one of the package.
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  // CHROME_ARGS="--disable-3d-apis": no WebGL, so the frames of the 3D head
  // (software-rendered and long on a machine without a GPU) do not hide the
  // long tasks of the benchmark.
  args: [
    '--autoplay-policy=no-user-gesture-required',
    ...(process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
  ],
});
const results = [];
try {
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const empty = await visit(page, url, SPEAK);
    const cached = await visit(page, url, SPEAK);
    await page.evaluate(() => localStorage.clear());
    const cleared = await visit(page, url, SPEAK);
    results.push({ run, empty, cached, cleared });
    console.log(JSON.stringify({ run, empty, cached, cleared }));
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
const median = (values) => values.sort((a, b) => a - b)[values.length >> 1];
if (!SPEAK) {
  console.log(
    JSON.stringify({
      longTasks: results.map((entry) => entry.empty.longTasks),
      benchmarks: results.map((entry) => [
        entry.empty.benchmarks,
        entry.cached.benchmarks,
        entry.cleared.benchmarks,
      ]),
    })
  );
  process.exit(0);
}
const empty = results.map((entry) => entry.empty.soundAfterClick);
const cached = results.map((entry) => entry.cached.soundAfterClick);
console.log(
  JSON.stringify({
    soundAfterClickEmpty: empty,
    soundAfterClickCached: cached,
    medianDifference: median([...empty]) - median([...cached]),
    longTasks: results.map((entry) => entry.empty.longTasks),
    notes: [
      ...new Set(
        results.flatMap((entry) => [
          ...entry.empty.notes,
          ...entry.cached.notes,
          ...entry.cleared.notes,
        ])
      ),
    ],
    benchmarks: results.map((entry) => [
      entry.empty.benchmarks,
      entry.cached.benchmarks,
      entry.cleared.benchmarks,
    ]),
  })
);
