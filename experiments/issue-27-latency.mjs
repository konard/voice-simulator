#!/usr/bin/env node

/* global document, window, performance, AudioNode, AudioDestinationNode, AudioBufferSourceNode, MessagePort, Blob, URL */

/**
 * Issue 27: measures the streaming player of the example app in a real
 * browser. Serves the built app (examples/universal-app/dist) with
 * `vite preview`, types a text, picks a tier, presses "Speak" and reports:
 *
 * - the player mode shown in the status line and the underrun count;
 * - `baseLatency` and `outputLatency` of the AudioContext;
 * - speakToChunk, speakToPush: Speak -> first chunk of the synthesis worker
 *   and -> first samples handed to the player (page clock);
 * - playerDelay: those samples reach the audio thread -> their first sample
 *   is rendered (audio clock), the latency the player adds;
 * - speakToFirstSample = speakToPush + playerDelay, and speakToOutput, the
 *   same plus `baseLatency` and `outputLatency`.
 *
 * The output of the player is tapped by a recording AudioWorklet and saved
 * as a 16-bit WAV with --record; the gaps (underruns) are listed with the
 * sample values next to them, a step there is a click.
 *
 *   npm run example:web:build
 *   PLAYWRIGHT=$(npm root -g)/playwright/index.mjs \
 *     node experiments/issue-27-latency.mjs [--browser chromium|firefox]
 *       [--isolated] [--buffer] [--tier 0] [--text "..."] [--runs 3]
 *       [--warmup 1] [--speech-mode both|sound] [--throttle 6]
 *       [--record out.wav] [--screenshot out.png] [--headed]
 *
 * --isolated serves the app with VITE_CROSS_ORIGIN_ISOLATION=1 (COOP/COEP);
 * --buffer blocks the processor module so the player falls back to buffer
 * sources; the --warmup runs are left out of the medians (the first run
 * also loads the synthesis worker); --throttle slows the CPU of the page
 * (Chrome only, CDP).
 *
 * Firefox needs an audio device or sound server to run its AudioContext;
 * without one the context stays 'suspended' (on a headless machine start
 * a PulseAudio server and set PULSE_SERVER).
 */

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const playwright = await import(process.env.PLAYWRIGHT ?? 'playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(ROOT, 'examples', 'universal-app');
const VITE = [APP, ROOT]
  .map((dir) => path.join(dir, 'node_modules', 'vite', 'bin', 'vite.js'))
  .find((file) => fs.existsSync(file));

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) {
    return fallback;
  }
  const value = process.argv[index + 1];
  return value === undefined || value.startsWith('--') ? true : value;
}

const browserName = option('browser', 'chromium');
const isolated = Boolean(option('isolated', false));
const buffer = Boolean(option('buffer', false));
const tier = String(option('tier', '0'));
const runs = Number(option('runs', 3));
const warmup = Number(option('warmup', runs > 1 ? 1 : 0));
const speechMode = option('speech-mode', 'both');
const throttle = Number(option('throttle', 0));
const record = option('record', null);
const screenshot = option('screenshot', null);
const headed = Boolean(option('headed', false));
const text = option('text', 'Hello, this is a short test of the player.');
const port = 4300 + Math.floor(Math.random() * 500);

/** Start `vite preview` and resolve when it answers. */
async function serve() {
  const server = spawn(
    process.execPath,
    [
      VITE,
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--strictPort',
    ],
    {
      cwd: APP,
      env: {
        ...process.env,
        VITE_CROSS_ORIGIN_ISOLATION: isolated ? '1' : '',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`);
      if (response.ok) {
        return server;
      }
    } catch {
      // Not up yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  server.kill();
  throw new Error('vite preview did not start');
}

/**
 * Runs in the page before the app: taps the output of the player with a
 * recording AudioWorklet and records the first chunk of the synthesis
 * worker and the first samples handed to the player (a buffer source, a
 * port chunk or a ring write). At that push a mark is posted to the tap,
 * which notes `currentTime` when it gets it: the delay of the player is
 * measured on the audio clock in every browser.
 */
function instrument({ buffer }) {
  const probe = {
    clicks: [],
    firstChunk: null,
    firstPush: null,
    mark: null,
    ring: null,
    tap: null,
    tapError: null,
    recorded: [],
    recordRate: 0,
  };
  window.__i27 = probe;
  const pushed = () => {
    if (probe.firstPush === null) {
      probe.firstPush = performance.now();
      probe.tap?.port.postMessage('mark');
    }
  };

  const TAP = `
    registerProcessor('i27-tap', class extends AudioWorkletProcessor {
      constructor() {
        super();
        this.parts = [];
        this.time = 0;
        this.port.onmessage = () => this.port.postMessage({ mark: currentTime });
      }
      process(inputs) {
        const input = inputs[0] && inputs[0][0];
        const block = new Float32Array(128);
        if (input) block.set(input);
        if (this.parts.length === 0) this.time = currentTime;
        this.parts.push(block);
        if (this.parts.length === 16) {
          const out = new Float32Array(16 * 128);
          this.parts.forEach((part, i) => out.set(part, i * 128));
          this.port.postMessage({ time: this.time, samples: out }, [out.buffer]);
          this.parts = [];
        }
        return true;
      }
    });`;
  const tapUrl = URL.createObjectURL(
    new Blob([TAP], { type: 'text/javascript' })
  );
  const nativeConnect = AudioNode.prototype.connect;
  if (buffer) {
    // Fail the processor module: the player falls back to buffer sources.
    const addModule = window.AudioWorklet.prototype.addModule;
    window.AudioWorklet.prototype.addModule = function (url, ...rest) {
      return String(url).includes('worklet-processor')
        ? Promise.reject(new Error('blocked by issue-27-latency'))
        : addModule.call(this, url, ...rest);
    };
  }
  const Native = window.AudioContext;
  window.AudioContext = class extends Native {
    constructor(...args) {
      super(...args);
      this.__tapReady = this.audioWorklet
        .addModule(tapUrl)
        .then(() => {
          const tap = new window.AudioWorkletNode(this, 'i27-tap', {
            outputChannelCount: [1],
            channelCount: 1,
            channelCountMode: 'explicit',
          });
          const silent = this.createGain();
          silent.gain.value = 0;
          // The native connect: the hook below would feed the gain back
          // into the tap, a cycle that Firefox mutes.
          nativeConnect.call(tap, silent);
          nativeConnect.call(silent, this.destination);
          probe.tap = tap;
          probe.recordRate = this.sampleRate;
          tap.port.onmessage = ({ data }) => {
            if (probe.tap !== tap) {
              return;
            }
            if ('mark' in data) {
              probe.mark ??= data.mark;
            } else {
              probe.recorded.push(data);
            }
          };
          return tap;
        })
        .catch((error) => {
          probe.tapError = String(error);
          return null;
        });
    }
  };

  // Everything connected to the destination is connected to the tap too.
  AudioNode.prototype.connect = function (target, ...rest) {
    const result = nativeConnect.call(this, target, ...rest);
    if (target instanceof AudioDestinationNode && this.context.__tapReady) {
      this.context.__tapReady.then(
        (tap) => tap && nativeConnect.call(this, tap)
      );
    }
    return result;
  };

  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) {
    pushed();
    return start.apply(this, args);
  };

  const post = MessagePort.prototype.postMessage;
  MessagePort.prototype.postMessage = function (message, ...rest) {
    if (message?.type === 'chunk') {
      pushed();
    } else if (message?.type === 'ring') {
      probe.ring = message.buffer;
    }
    return post.call(this, message, ...rest);
  };

  // Index 0 of the ring header is WRITE (src/playback/ring-buffer.js).
  const store = Atomics.store;
  Atomics.store = function (array, index, value) {
    if (array.buffer === probe.ring && index === 0 && value !== 0) {
      pushed();
    }
    return store.call(Atomics, array, index, value);
  };

  const NativeWorker = window.Worker;
  window.Worker = class extends NativeWorker {
    constructor(...args) {
      super(...args);
      this.addEventListener('message', (event) => {
        if (event.data?.type === 'chunk' && probe.firstChunk === null) {
          probe.firstChunk = performance.now();
        }
      });
    }
  };

  document.addEventListener(
    'click',
    (event) => {
      if (event.target?.closest?.('button[type="submit"]')) {
        probe.clicks.push(performance.now());
      }
    },
    true
  );
}

/** Timings of the last utterance, from the probe of the page. */
function measure() {
  const probe = window.__i27;
  const rate = probe.recordRate;
  let first = null;
  for (const part of probe.recorded) {
    const index = part.samples.findIndex((value) => value !== 0);
    if (index >= 0) {
      first = part.time + index / rate;
      break;
    }
  }
  const context = probe.tap?.context;
  const round = (value) =>
    Number.isFinite(value) ? Math.round(value * 10) / 10 : null;
  const speak = probe.clicks.at(-1);
  const baseLatency = (context?.baseLatency ?? 0) * 1000;
  const outputLatency = (context?.outputLatency ?? 0) * 1000;
  const speakToPush = probe.firstPush - speak;
  const playerDelay =
    first === null || probe.mark === null ? NaN : (first - probe.mark) * 1000;
  return {
    sampleRate: rate,
    baseLatency: round(baseLatency),
    outputLatency: round(outputLatency),
    speakToChunk: round(probe.firstChunk - speak),
    speakToPush: round(speakToPush),
    playerDelay: round(playerDelay),
    speakToFirstSample: round(speakToPush + playerDelay),
    speakToOutput: round(
      speakToPush + playerDelay + baseLatency + outputLatency
    ),
    crossOriginIsolated: window.crossOriginIsolated,
    tapError: probe.tapError,
  };
}

function wav(samples, rate) {
  const data = Buffer.alloc(44 + samples.length * 2);
  data.write('RIFF', 0);
  data.writeUInt32LE(36 + samples.length * 2, 4);
  data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20);
  data.writeUInt16LE(1, 22);
  data.writeUInt32LE(rate, 24);
  data.writeUInt32LE(rate * 2, 28);
  data.writeUInt16LE(2, 32);
  data.writeUInt16LE(16, 34);
  data.write('data', 36);
  data.writeUInt32LE(samples.length * 2, 40);
  samples.forEach((value, index) => {
    const clamped = Math.max(-1, Math.min(1, value));
    data.writeInt16LE(Math.round(clamped * 32767), 44 + index * 2);
  });
  return data;
}

/**
 * Gaps of at least 64 zero samples inside the recording, with the largest
 * step between neighbouring samples around each edge and in the whole
 * signal outside the edges.
 */
function analyse(samples, rate) {
  const first = samples.findIndex((value) => value !== 0);
  let last = samples.length - 1;
  while (last > 0 && samples[last] === 0) {
    last--;
  }
  if (first < 0) {
    return { gaps: [], seconds: 0 };
  }
  const gaps = [];
  let run = 0;
  for (let index = first; index <= last; index++) {
    if (samples[index] === 0) {
      run++;
    } else {
      if (run >= 64) {
        gaps.push({ start: index - run, end: index });
      }
      run = 0;
    }
  }
  const step = (from, to) => {
    let max = 0;
    const end = Math.min(samples.length, to);
    for (let index = Math.max(1, from); index < end; index++) {
      max = Math.max(max, Math.abs(samples[index] - samples[index - 1]));
    }
    return max;
  };
  const peak = (from, to) => {
    let max = 0;
    const end = Math.min(samples.length, to);
    for (let index = Math.max(0, from); index < end; index++) {
      max = Math.max(max, Math.abs(samples[index]));
    }
    return max;
  };
  const round = (value) => Math.round(value * 10000) / 10000;
  return {
    seconds: round((last - first + 1) / rate),
    signalMaxStep: round(step(first, last + 1)),
    signalPeak: round(peak(first, last + 1)),
    gaps: gaps.map(({ start, end }) => ({
      at: round(start / rate),
      ms: round(((end - start) / rate) * 1000),
      edgeBefore: round(Math.abs(samples[start - 1])),
      edgeAfter: round(Math.abs(samples[end])),
      stepIn: round(step(start - 4, start + 1)),
      stepOut: round(step(end, end + 4)),
      levelBefore: round(peak(start - 640, start - 128)),
    })),
  };
}

/**
 * Slow the CPU of the page and of its workers by `rate`, as the CPU
 * throttling of the Chrome developer tools does: the page session sets the
 * rate and auto-attaches to the workers, which get the same rate.
 */
async function throttleCpu(page, rate) {
  const session = await page.context().newCDPSession(page);
  const command = { id: 1, method: 'Emulation.setCPUThrottlingRate' };
  session.on('Target.attachedToTarget', ({ sessionId, targetInfo }) => {
    if (targetInfo.type === 'worker') {
      const message = JSON.stringify({ ...command, params: { rate } });
      session
        .send('Target.sendMessageToTarget', { sessionId, message })
        .then(() => console.error('throttled worker', targetInfo.url))
        .catch((error) => console.error('worker throttle', error.message));
    }
  });
  await session.send('Target.setAutoAttach', {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: false,
  });
  await session.send('Emulation.setCPUThrottlingRate', { rate });
}

const server = await serve();
let browser;
try {
  const launchOptions = {
    headless: !headed,
    args:
      browserName === 'chromium'
        ? ['--autoplay-policy=no-user-gesture-required']
        : [],
    firefoxUserPrefs: { 'media.autoplay.default': 0 },
  };
  if (browserName !== 'firefox') {
    delete launchOptions.firefoxUserPrefs;
  }
  browser = await playwright[browserName].launch(launchOptions);
  const page = await browser.newPage({
    viewport: { width: 1280, height: 900 },
  });
  page.on('pageerror', (error) => console.error('pageerror:', error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      console.error(`console.${message.type()}:`, message.text());
    }
  });
  await page.addInitScript(instrument, { buffer });
  await page.goto(`http://127.0.0.1:${port}/`);
  await page.waitForSelector('#speech-text');
  await page.fill('#speech-text', text);
  await page.selectOption('#speech-tier', tier);
  await page.selectOption('#speech-mode', speechMode);
  if (throttle > 1) {
    await throttleCpu(page, throttle);
  }
  const results = [];
  for (let run = 0; run < runs; run++) {
    await page.evaluate(() => {
      const probe = window.__i27;
      Object.assign(probe, {
        firstChunk: null,
        firstPush: null,
        mark: null,
        recorded: [],
      });
    });
    await page.click('button[type="submit"]');
    await page.waitForFunction(
      () => !document.querySelector('button[type="submit"]'),
      null,
      { timeout: 60000 }
    );
    await page.waitForSelector('button[type="submit"]', { timeout: 300000 });
    await page.waitForTimeout(400);
    const hud = await page.textContent('.hud');
    const result = await page.evaluate(measure);
    results.push({ run, ...result, hud: hud.replace(/\s+/g, ' ').trim() });
    console.log(JSON.stringify(results.at(-1)));
    if (run === runs - 1 && record) {
      const recorded = await page.evaluate(() => {
        const probe = window.__i27;
        const length = probe.recorded.reduce(
          (sum, part) => sum + part.samples.length,
          0
        );
        const all = new Float32Array(length);
        let offset = 0;
        for (const part of probe.recorded) {
          all.set(part.samples, offset);
          offset += part.samples.length;
        }
        return { rate: probe.recordRate, samples: Array.from(all) };
      });
      fs.writeFileSync(record, wav(recorded.samples, recorded.rate));
      console.log(
        'recording',
        record,
        JSON.stringify(analyse(recorded.samples, recorded.rate))
      );
    }
    if (run === runs - 1 && screenshot) {
      await page.locator('.hud').scrollIntoViewIfNeeded();
      await page.screenshot({ path: screenshot });
    }
  }
  const median = (key) => {
    const values = results
      .slice(warmup)
      .map((item) => item[key])
      .filter((value) => typeof value === 'number')
      .sort((a, b) => a - b);
    return values.length ? values[Math.floor(values.length / 2)] : null;
  };
  console.log(
    'median',
    JSON.stringify({
      browser: browserName,
      isolated,
      buffer,
      tier,
      throttle,
      mode: results[0]?.hud.match(/(worklet-\w+|buffer)/)?.[1] ?? null,
      baseLatency: median('baseLatency'),
      outputLatency: median('outputLatency'),
      speakToChunk: median('speakToChunk'),
      speakToPush: median('speakToPush'),
      playerDelay: median('playerDelay'),
      speakToFirstSample: median('speakToFirstSample'),
      speakToOutput: median('speakToOutput'),
      underruns: results.map((item) =>
        Number(item.hud.match(/underruns (\d+)/)?.[1] ?? NaN)
      ),
    })
  );
} finally {
  await browser?.close();
  server.kill();
}
