#!/usr/bin/env node
/** Exercise the built app with synthetic microphone input on Chromium. Unlicense. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, URL } from 'node:url';
import { encodeWav } from '../src/audio/wav.js';
import { strings } from '../examples/universal-app/src/i18n.js';
import { copyFixture } from '../tests/helpers/copy-app-fixture.js';
import { createStaticServer } from './example-app-static.mjs';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const RATE = 48000; // Chromium reads fake capture as 48 kHz mono WAV.
const SECONDS = 20;
const RECORDING_MS = SECONDS * 1000;
const t = strings('en');

export async function playwrightChromium() {
  try {
    const { chromium } = await import('playwright');
    const path = process.env.COPY_CHROMIUM ?? chromium.executablePath();
    return existsSync(path) ? { chromium, path } : null;
  } catch (error) {
    if (error.code !== 'ERR_MODULE_NOT_FOUND') {
      throw error;
    }
    return null;
  }
}

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

function observeTasks(diagnostics) {
  const spans = [];
  const observer = new globalThis.PerformanceObserver((list) => {
    for (const { startTime, duration } of list.getEntries()) {
      spans.push({ startTime, duration });
    }
  });
  observer.observe({ type: 'longtask' });
  const frames = [];
  if (
    diagnostics &&
    globalThis.PerformanceObserver.supportedEntryTypes.includes(
      'long-animation-frame'
    )
  ) {
    const animation = new globalThis.PerformanceObserver((list) => {
      for (const frame of list.getEntries()) {
        if (frame.duration > 100) {
          frames.push(frame.toJSON());
        }
      }
    });
    animation.observe({ type: 'long-animation-frame' });
  }
  globalThis.copyTaskWindow = {
    start: () => globalThis.performance.now(),
    frames: (from) => frames.filter(({ startTime }) => startTime >= from),
    longest(from, to) {
      return Math.max(
        0,
        ...[...spans, ...observer.takeRecords()]
          .filter(({ startTime }) => startTime >= from && startTime <= to)
          .map(({ duration }) => duration)
      );
    },
  };
}

async function checkRate(browser, url, rate, screenshot) {
  const context = await browser.newContext({
    locale: 'en-US',
    colorScheme: 'light',
    viewport: { width: 1080, height: 980 },
  });
  try {
    const diagnostics = process.env.COPY_DIAGNOSTICS === '1';
    await context.addInitScript(observeTasks, diagnostics);
    const page = await context.newPage();
    page.on('pageerror', (error) =>
      console.error(`Chromium: ${error.message}`)
    );
    await page.goto(`${url}?seed=copy-preview`, { waitUntil: 'networkidle' });
    const panel = page.locator('section[aria-labelledby="copy-title"]');
    const start = panel.getByRole('button', { name: t.copyStart });
    const live = panel.getByRole('status');
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    await start.scrollIntoViewIfNeeded();

    const requests = [];
    context.on('request', (request) => {
      const url = request.url();
      if (/^https?:/.test(url)) {
        requests.push(url);
      }
    });

    const from = await page.evaluate(() => globalThis.copyTaskWindow.start());
    await start.click();
    const remaining = await page.evaluate(
      ({ from, limit }) =>
        Math.max(1, limit - (globalThis.copyTaskWindow.start() - from)),
      { from, limit: RECORDING_MS }
    );
    const stable = await panel
      .getByText(t.copyStates.stable, { exact: false })
      .waitFor({ state: 'visible', timeout: remaining })
      .then(
        () => true,
        (error) => {
          if (error.name !== 'TimeoutError') {
            throw error;
          }
          return false;
        }
      );
    const { elapsed, longest } = await page.evaluate((from) => {
      const to = globalThis.performance.now();
      return {
        elapsed: to - from,
        longest: globalThis.copyTaskWindow.longest(from, to),
      };
    }, from);
    const status = await live.textContent();
    const result = { rate, stable, elapsed, longest, requests, status };
    console.log(
      `CPU ×${rate}: ${status} ${(elapsed / 1000).toFixed(2)} s, longest main-thread task ${longest} ms, ${requests.length} network requests.`
    );
    for (const request of requests) {
      console.log(`  ${request}`);
    }
    if (diagnostics) {
      console.log(
        await page.evaluate(
          (from) => ({
            frames: globalThis.copyTaskWindow.frames(from),
            progress: globalThis.document
              .querySelector('#copy-progress')
              .getAttribute('value'),
          }),
          from
        )
      );
    }
    if (screenshot && rate === 1) {
      await mkdir(dirname(screenshot), { recursive: true });
      await panel.screenshot({ path: screenshot, timeout: 15000 });
    }
    return result;
  } finally {
    await context.close();
  }
}

export async function checkAppCopy({
  skipBuild = false,
  screenshot = join(ROOT, 'docs/screenshots/copy-voice.png'),
} = {}) {
  const available = await playwrightChromium();
  assert.ok(
    available,
    'Install Playwright and Chromium as described in the example app README.'
  );
  if (!skipBuild) {
    build();
  }
  const temporary = await mkdtemp(join(tmpdir(), 'voice-copy-'));
  const server = await createStaticServer(
    join(ROOT, 'examples/universal-app/dist')
  );
  const wav = join(temporary, 'female.wav');
  let browser;
  try {
    await writeFile(wav, encodeWav(copyFixture(SECONDS, RATE), RATE));
    browser = await available.chromium.launch({
      executablePath: available.path,
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        `--use-file-for-fake-audio-capture=${wav}%noloop`,
      ],
    });
    const results = [];
    for (const rate of [1, 6]) {
      results.push(await checkRate(browser, server.url, rate, screenshot));
    }
    return results;
  } finally {
    await browser?.close();
    await server.close();
    await rm(temporary, { recursive: true, force: true });
  }
}

export function assertCopyResults(results) {
  const failures = [];
  for (const { rate, stable, elapsed, longest, requests, status } of results) {
    if (!stable || elapsed > RECORDING_MS) {
      failures.push(
        `CPU ×${rate} did not reach stable within ${SECONDS} s. Last status: ${status}`
      );
    }
    if (longest > 100) {
      failures.push(
        `CPU ×${rate} main-thread task took ${longest} ms (limit: 100 ms)`
      );
    }
    if (requests.length) {
      failures.push(`CPU ×${rate} made ${requests.length} network request(s)`);
    }
  }
  assert.deepEqual(failures, []);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertCopyResults(
    await checkAppCopy({ skipBuild: process.argv.includes('--skip-build') })
  );
}
