#!/usr/bin/env node

/* global document */

/**
 * Issue 20: why does an <audio> element of the listening test report an
 * error in Firefox opened from file://? Loads one stimulus in the page and
 * prints the MediaError code and message, the ready state and the duration.
 *
 *   PLAYWRIGHT=$(npm root -g)/playwright/index.mjs \
 *     node experiments/issue-20-firefox-audio.mjs [browser] [file]
 */

import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const playwright = await import(process.env.PLAYWRIGHT ?? 'playwright');
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const browserName = process.argv[2] ?? 'firefox';
const file = process.argv[3] ?? 'stimuli/volume.wav';
const browser = await playwright[browserName].launch();
const page = await browser.newPage();
page.on('console', (message) => console.log('console:', message.text()));
await page.goto(
  pathToFileURL(path.join(ROOT, 'examples', 'listening-test', 'index.html'))
    .href
);
const state = await page.evaluate(
  (src) =>
    new Promise((resolve) => {
      const audio = document.createElement('audio');
      audio.preload = 'auto';
      const done = (event) =>
        resolve({
          event,
          code: audio.error?.code ?? null,
          message: audio.error?.message ?? null,
          readyState: audio.readyState,
          duration: audio.duration,
          canPlayWav: audio.canPlayType('audio/wav'),
        });
      audio.addEventListener('error', () => done('error'));
      audio.addEventListener('canplaythrough', () => done('canplaythrough'));
      audio.src = src;
      setTimeout(() => done('timeout'), 5000);
    }),
  file
);
console.log(browserName, file, JSON.stringify(state));
await browser.close();
