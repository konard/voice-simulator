#!/usr/bin/env node
/**
 * The example app at the lowest settings (issue 81): Chromium with the CPU
 * throttled 6 times and the audio tier fixed to telephone (8 kHz) speaks a
 * text of about 10 s, then recognises the downloaded audio file in the
 * recognition panel. Unlicense.
 *
 *   node scripts/check-app-lowest.mjs [--skip-build] [--out reports/heavy]
 *   Add --core <id> for a publishable measurement when pinned to that core.
 *
 * - workerRtf: render time / audio time of the synthesis worker, from the
 *   `load` it sends with every chunk.
 * - firstSound: seconds from pressing Speak to the chunk that lets playback
 *   start (readyToPlay of render-ahead.js, as the app decides it).
 * - textBack: share of the words recognised back from the file, in order
 *   (1 - word error rate, at least 0).
 */
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cpus } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';
import { strings } from '../examples/universal-app/src/i18n.js';
import { readyToPlay } from '../examples/universal-app/src/engine/render-ahead.js';
import { TIER_KEY } from '../examples/universal-app/src/engine/benchmark-cache.js';
import { errorRate } from '../src/index.js';
import { playwrightChromium } from './check-app-copy.mjs';
import { createStaticServer } from './example-app-static.mjs';
import { passes } from './lowest-report.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const THROTTLING = Number(process.env.LOWEST_THROTTLING) || 6;
export const TIER = 'telephone';
/** About 10 s of speech at the default rate. */
export const TEXT =
  'The quick brown fox jumps over the lazy dog. She sells sea shells by ' +
  'the sea shore. We measure the treasure every morning before the sun ' +
  'comes up over the quiet hills.';
/** Spoken first: the first utterance also loads lexicon and worklet. */
export const WARM_UP = 'Hello.';
const t = strings('en');

function build() {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(npm, ['run', 'example:web:build'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.error) {
    throw result.error;
  }
  assert.equal(result.status, 0, 'Example app build failed');
}

/**
 * Init script: fix the tier and record the messages of every worker and
 * the moment the speak form is submitted.
 */
function observe({ key, tier }) {
  globalThis.localStorage.setItem(key, tier);
  const log = [];
  globalThis.lowestLog = log;
  const Original = globalThis.Worker;
  globalThis.Worker = class extends Original {
    constructor(url, options) {
      super(url, options);
      const name = String(url);
      this.lowestName = name;
      this.addEventListener('message', ({ data }) => {
        if (!data || typeof data.type !== 'string') {
          return;
        }
        log.push({
          worker: name,
          type: data.type,
          at: globalThis.performance.now(),
          sampleRate: data.sampleRate,
          totalSamples: data.totalSamples,
          start: data.start,
          length: data.samples?.length,
          load: data.load,
          level: data.level,
        });
      });
    }
  };
  const post = Original.prototype.postMessage;
  Original.prototype.postMessage = function (message, ...rest) {
    if (message && typeof message.type === 'string') {
      log.push({
        worker: `to ${this.lowestName ?? ''}`,
        type: message.type,
        at: globalThis.performance.now(),
      });
    }
    return post.call(this, message, ...rest);
  };
  globalThis.addEventListener(
    'submit',
    () => log.push({ type: 'submit', at: globalThis.performance.now() }),
    true
  );
}

/** Worker RTF and first sound from the logged messages of one utterance. */
export function speechTimes(log) {
  const submit = log.find((entry) => entry.type === 'submit');
  const start = log.find(
    (entry) =>
      /synth-worker/u.test(entry.worker ?? '') &&
      entry.type === 'start' &&
      entry.at >= (submit?.at ?? 0)
  );
  if (!submit || !start) {
    return null;
  }
  const chunks = log.filter(
    (entry) =>
      entry.worker === start.worker &&
      entry.type === 'chunk' &&
      entry.at >= start.at
  );
  const { sampleRate, totalSamples: total } = start;
  let rendered = 0;
  let busy = 0;
  let firstSound = null;
  for (const chunk of chunks) {
    rendered = Math.max(rendered, chunk.start + chunk.length);
    busy += (chunk.load * chunk.length) / sampleRate;
    if (
      firstSound === null &&
      readyToPlay({ rendered, total, busy, sampleRate })
    ) {
      firstSound = (chunk.at - submit.at) / 1000;
    }
  }
  const firstChunk = chunks[0];
  return {
    startDelay: (start.at - submit.at) / 1000,
    firstChunk: firstChunk ? (firstChunk.at - submit.at) / 1000 : null,
    timeline: log
      .filter((entry) => entry.at >= submit.at && entry.type !== 'chunk')
      .map(({ worker, type, at }) => ({
        worker: worker?.replace(/^.*\//u, ''),
        type,
        at: Number(((at - submit.at) / 1000).toFixed(3)),
      })),
    sampleRate,
    audioSeconds: total / sampleRate,
    workerRtf: rendered ? busy / (rendered / sampleRate) : null,
    firstSound,
    chunks: chunks.length,
  };
}

/** 1 - word error rate of `heard` against `text`, at least 0. */
export function textBack(text, heard) {
  return Math.max(0, 1 - errorRate(text, heard).rate);
}

/**
 * Emulation.setCPUThrottlingRate on a page leaves its dedicated workers at
 * full speed, so throttle every worker target too: attached through the
 * page session (not flattened, so the messages go through
 * Target.sendMessageToTarget). Returns a function that gives the URLs of
 * the workers that accepted the rate.
 */
async function throttleWorkers(cdp, rate) {
  const throttled = [];
  const pending = new Map();
  let id = 0;
  cdp.on('Target.receivedMessageFromTarget', ({ message }) => {
    const reply = JSON.parse(message);
    const url = pending.get(reply.id);
    if (url !== undefined) {
      pending.delete(reply.id);
      if (reply.error) {
        console.error(`Worker ${url}: ${reply.error.message}`);
      } else {
        throttled.push(url);
      }
    }
  });
  cdp.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (!/worker/u.test(targetInfo.type)) {
      return;
    }
    id++;
    pending.set(id, targetInfo.url);
    cdp
      .send('Target.sendMessageToTarget', {
        sessionId,
        message: JSON.stringify({
          id,
          method: 'Emulation.setCPUThrottlingRate',
          params: { rate },
        }),
      })
      .catch((error) => console.error(`Worker ${targetInfo.url}: ${error}`));
  });
  await cdp.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
  return () => [...throttled];
}

/** Speak `text` and wait for the end; the times of this utterance. */
async function speakOnce(page, form, text) {
  await page.evaluate(() => {
    globalThis.lowestLog.length = 0;
  });
  await page.locator('#speech-text').fill(text);
  await form.getByRole('button', { name: t.speak, exact: true }).click();
  // Short utterances can finish before Playwright sees the Stop button.
  await page.waitForFunction(
    () =>
      globalThis.lowestLog.some(
        ({ worker, type }) =>
          /synth-worker/u.test(worker ?? '') && type === 'end'
      ),
    undefined,
    { timeout: 600_000 }
  );
  await form
    .getByRole('button', { name: t.speak, exact: true })
    .waitFor({ state: 'visible', timeout: 600_000 });
  const times = speechTimes(await page.evaluate(() => globalThis.lowestLog));
  assert.ok(times, `The synthesis worker sent no utterance for "${text}"`);
  return times;
}

async function speakAndRecognise(browser, url) {
  const context = await browser.newContext({
    locale: 'en-US',
    colorScheme: 'light',
    viewport: { width: 1080, height: 980 },
    acceptDownloads: true,
  });
  try {
    await context.addInitScript(observe, { key: TIER_KEY, tier: TIER });
    const page = await context.newPage();
    page.on('pageerror', (error) =>
      console.error(`Chromium: ${error.message}`)
    );
    await page.goto(`${url}?seed=lowest-settings`, {
      waitUntil: 'networkidle',
    });
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: THROTTLING });
    const throttledWorkers = await throttleWorkers(cdp, THROTTLING);

    // The app measures the device at its first idle moment (issue 28),
    // also with a fixed tier; a Speak pressed meanwhile waits for it.
    const benchmarkFrom = Date.now();
    await page
      .locator('.measured-note small')
      .filter({
        hasText: new RegExp(`^${t.measuredAgo.replace('{n}', '\\d+')}`, 'u'),
      })
      .first()
      .waitFor({ state: 'attached', timeout: 300_000 });
    const benchmarkWait = (Date.now() - benchmarkFrom) / 1000;

    const form = page.locator('form.speak-panel');
    // The first utterance also loads the lexicon and the audio worklet:
    // reported as coldFirstSound, without a limit.
    const cold = await speakOnce(page, form, WARM_UP);
    const times = await speakOnce(page, form, TEXT);

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      form.getByRole('button', { name: t.download, exact: true }).click(),
    ]);
    const file = await download.path();
    const panel = page.locator('section[aria-labelledby="recognition-title"]');
    await panel.locator('#recognition-file').setInputFiles(file);
    const status = panel.getByRole('status');
    await panel
      .getByText(t.recognitionStates.done, { exact: false })
      .or(panel.getByText(t.recognitionStates.error, { exact: false }))
      .first()
      .waitFor({ state: 'visible', timeout: 600_000 });
    const heard = (
      (await panel.locator('.spoken-text').first().textContent()) ?? ''
    ).trim();
    return {
      ...times,
      heard,
      textBack: textBack(TEXT, heard),
      status: await status.textContent(),
      throttledWorkers: throttledWorkers(),
      benchmarkWait,
      coldFirstSound: cold.firstSound,
    };
  } finally {
    await context.close();
  }
}

/**
 * Run the check. Returns the result of the app row of the lowest-settings
 * report: { row: 'app', engine: 'js', metrics, ... }.
 */
export async function checkAppLowest({ skipBuild = false } = {}) {
  const available = await playwrightChromium();
  assert.ok(
    available,
    'Install Playwright and Chromium as described in the example app README.'
  );
  if (!skipBuild) {
    build();
  }
  const server = await createStaticServer(
    join(ROOT, 'examples/universal-app/dist')
  );
  let browser;
  try {
    browser = await available.chromium.launch({
      executablePath: available.path,
    });
    const measured = await speakAndRecognise(browser, server.url);
    return {
      row: 'app',
      engine: 'js',
      metrics: {
        textBack: Number(measured.textBack.toFixed(4)),
        // Workers cannot be throttled (see throttleWorkers): their RTF is
        // judged scaled by the throttling rate, as on a CPU this slow.
        workerRtf: Number(
          (
            measured.workerRtf *
            (measured.throttledWorkers.some((url) => /synth-worker/u.test(url))
              ? 1
              : THROTTLING)
          ).toFixed(4)
        ),
        workerRtfMeasured: Number(measured.workerRtf?.toFixed(4)),
        firstSound: Number(measured.firstSound?.toFixed(3)),
        firstChunk: Number(measured.firstChunk?.toFixed(3)),
        coldFirstSound: Number(measured.coldFirstSound?.toFixed(3)),
        startDelay: Number(measured.startDelay?.toFixed(3)),
        sampleRate: measured.sampleRate,
        chunks: measured.chunks,
        heard: measured.heard,
      },
      audioSeconds: Number(measured.audioSeconds.toFixed(3)),
      throttling: THROTTLING,
      tier: TIER,
      text: TEXT,
      status: measured.status,
      throttledWorkers: measured.throttledWorkers,
      timeline: measured.timeline,
      benchmarkWait: measured.benchmarkWait,
    };
  } finally {
    await browser?.close();
    await server.close();
  }
}

/** The failures of a result against the issue 81 limits. */
export function appFailures({ metrics, audioSeconds }) {
  const failures = [];
  if (!passes('workerRtf', metrics.workerRtf, 1)) {
    failures.push(`synthesis worker RTF ${metrics.workerRtf} (limit: < 1)`);
  }
  if (!(metrics.firstSound <= 1)) {
    failures.push(`first sound after ${metrics.firstSound} s (limit: 1 s)`);
  }
  if (metrics.textBack < 1) {
    failures.push(
      `recognised "${metrics.heard}", ${metrics.textBack} of the words back`
    );
  }
  if (metrics.sampleRate !== 8000) {
    failures.push(`spoken at ${metrics.sampleRate} Hz, not 8000 Hz`);
  }
  if (!(audioSeconds >= 8)) {
    failures.push(`spoke ${audioSeconds} s, expected about 10 s`);
  }
  return failures;
}

function rowMetadata(core) {
  assert.match(core, /^\d+$/u, 'Expected a single CPU core');
  const { groups } = /^Cpus_allowed_list:\s*(?<core>.+)$/mu.exec(
    readFileSync('/proc/self/status', 'utf8')
  );
  assert.equal(groups.core, core, 'Process must be pinned to the reported CPU');
  assert.equal(process.env.UV_THREADPOOL_SIZE, '1');
  assert.ok(process.execArgv.includes('--max-old-space-size=192'));
  assert.equal(THROTTLING, 6);
  const { app } = JSON.parse(
    readFileSync(
      new URL('../tests/heavy/lowest-thresholds.json', import.meta.url),
      'utf8'
    )
  );
  return {
    row: 'app',
    limit: null,
    pinned: true,
    core: Number(core),
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: ROOT,
      encoding: 'utf8',
    }).trim(),
    command: `UV_THREADPOOL_SIZE=1 taskset -c ${core} node ${process.execArgv.join(' ')} ${relative(ROOT, process.argv[1])} ${process.argv.slice(2).join(' ')}`,
    cpu: cpus()[Number(core)]?.model ?? cpus()[0]?.model ?? 'unknown',
    node: process.version,
    limits: { app },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({
    options: {
      'skip-build': { type: 'boolean' },
      out: { type: 'string' },
      core: { type: 'string' },
    },
  });
  if (values.core) {
    assert.ok(values.out, '--core requires --out');
  }
  const metadata = values.core ? rowMetadata(values.core) : null;
  const result = await checkAppLowest({ skipBuild: values['skip-build'] });
  console.log(JSON.stringify(result, null, 2));
  if (values.out) {
    mkdirSync(values.out, { recursive: true });
    writeFileSync(
      join(values.out, 'lowest-app.json'),
      `${JSON.stringify({ result }, null, 2)}\n`
    );
    if (metadata) {
      const report = {
        ...metadata,
        measured: new Date().toISOString(),
        runs: { app: { js: { ...result, capped: {} } } },
      };
      writeFileSync(
        join(values.out, 'lowest-settings.json'),
        `${JSON.stringify(report, null, 2)}\n`
      );
    }
  }
  const failures = appFailures(result);
  for (const failure of failures) {
    console.error(failure);
  }
  process.exitCode = failures.length ? 1 : 0;
}
