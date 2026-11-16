#!/usr/bin/env node
/**
 * What the main thread does in the long tasks (over 50 ms) of the built app
 * while the load-time benchmark runs (issue 28): Chromium with the CPU
 * throttled 4x, empty storage, no "Speak". Records a Chrome trace and
 * prints, for each long task, the events inside it with the most time
 * (function calls with their script and function, GC, layout, ...).
 *
 * Usage:
 *   (cd examples/universal-app && npm run build)
 *   CHROMIUM=<chrome> CHROME_ARGS="--disable-3d-apis" \
 *     node experiments/issue-28-trace-long-tasks.mjs <playwright dir> [runs]
 */

/* global URL, window, Worker, performance, document -- the page functions run in the browser */
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [playwrightDir, runsArg] = process.argv.slice(2);
if (!playwrightDir) {
  console.error('usage: issue-28-trace-long-tasks.mjs <playwright dir> [runs]');
  process.exit(2);
}
const { chromium } = await import(
  pathToFileURL(path.join(playwrightDir, 'index.mjs')).href
);
const RUNS = Number(runsArg ?? 3);
const DIST = path.resolve('examples/universal-app/dist');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.json': 'application/json',
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

function instrument() {
  window.issue28 = { benchmarkAt: null, answerAt: null, messages: [] };
  const post = Worker.prototype.postMessage;
  Worker.prototype.postMessage = function (message, ...rest) {
    if (message?.type === 'benchmark') {
      window.issue28.benchmarkAt = performance.now();
    }
    return post.call(this, message, ...rest);
  };
  const add = Worker.prototype.addEventListener;
  Worker.prototype.addEventListener = function (type, listener, ...rest) {
    if (type === 'message') {
      add.call(this, 'message', (event) => {
        window.issue28.messages.push([
          Math.round(performance.now()),
          event.data?.type,
        ]);
        if (event.data?.type === 'benchmark' && !event.data.gpuPending) {
          window.issue28.answerAt = performance.now();
        }
      });
    }
    return add.call(this, type, listener, ...rest);
  };
}

/** A short label of a trace event. */
function label(event) {
  const data = event.args?.data ?? event.args?.beginData ?? {};
  if (event.name === 'FunctionCall' || event.name === 'EvaluateScript') {
    const file = (data.url ?? '').split('/').pop();
    return `${event.name} ${data.functionName || '?'} ${file}:${data.lineNumber ?? ''}`;
  }
  if (event.name === 'TimerFire' || event.name === 'FireAnimationFrame') {
    return event.name;
  }
  if (event.name === 'EventDispatch') {
    return `EventDispatch ${data.type}`;
  }
  return event.name;
}

function summarize(trace, start, end) {
  const events = trace.traceEvents;
  const main = events.find(
    (event) =>
      event.name === 'thread_name' && event.args?.name === 'CrRendererMain'
  );
  const onMain = events.filter(
    (event) =>
      event.pid === main.pid && event.tid === main.tid && event.ph === 'X'
  );
  // Navigation start in trace time (µs): performance.now() 0.
  const navigation = events.find(
    (event) => event.name === 'navigationStart' && event.pid === main.pid
  );
  const origin = navigation?.ts ?? 0;
  const tasks = onMain.filter(
    (event) =>
      event.name === 'RunTask' &&
      event.dur > 50000 &&
      (event.ts + event.dur - origin) / 1000 >= start &&
      (event.ts - origin) / 1000 <= end
  );
  return tasks.map((task) => {
    const inside = onMain.filter(
      (event) =>
        event !== task &&
        event.ts >= task.ts &&
        event.ts + (event.dur ?? 0) <= task.ts + task.dur
    );
    const top = inside
      .filter((event) => event.dur > 5000)
      .sort((a, b) => b.dur - a.dur)
      .slice(0, 6)
      .map((event) => `${label(event)} ${Math.round(event.dur / 1000)} ms`);
    return {
      at: Math.round((task.ts - origin) / 1000),
      ms: Math.round(task.dur / 1000),
      top,
    };
  });
}

const server = await serve();
const url = `http://127.0.0.1:${server.address().port}/?debug&seed=preview`;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM || undefined,
  args: (process.env.CHROME_ARGS ?? '').split(' ').filter(Boolean),
});
try {
  for (let run = 0; run < RUNS; run++) {
    const context = await browser.newContext({ locale: 'en-US' });
    await context.addInitScript(instrument);
    const page = await context.newPage();
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    const file = path.resolve(`ci-logs/issue-28-trace-${run}.json`);
    await browser.startTracing(page, {
      path: file,
      categories: [
        'devtools.timeline',
        'disabled-by-default-devtools.timeline',
        'blink.user_timing',
        'v8',
        'loading',
      ],
    });
    await page.goto(url);
    await page.waitForFunction(() => window.issue28.answerAt !== null, null, {
      timeout: 30000,
    });
    await page.waitForTimeout(500);
    const times = await page.evaluate(() => window.issue28);
    const hud = await page.evaluate(
      () => document.querySelector('.hud')?.textContent ?? ''
    );
    await browser.stopTracing();
    const trace = JSON.parse(await readFile(file, 'utf8'));
    console.log(
      JSON.stringify(
        {
          run,
          benchmarkAt: Math.round(times.benchmarkAt),
          answerAt: Math.round(times.answerAt),
          hud: /long tasks \d+/.exec(hud)?.[0],
          messages: times.messages,
          tasks: summarize(trace, times.benchmarkAt, times.answerAt),
        },
        null,
        1
      )
    );
    await context.close();
  }
} finally {
  await browser.close();
  server.close();
}
