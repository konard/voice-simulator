#!/usr/bin/env node
/**
 * Issue 41: drive the head editor of the example app in Chromium.
 *
 * Serves examples/universal-app/dist, opens the app with ?seed=preview and
 * checks the editor: six <details> groups in the order of HEAD_GROUPS, the
 * "Show all parameters" switch (from the basic sliders to all 137), "Export
 * voice" (downloads voice.json that loadVoice reads back to the same head),
 * "Import voice" with a good file (the sliders move) and with a broken one
 * (the error text appears). Prints one line per check and saves
 * docs/screenshots/issue-41/editor-{en,ru}.png.
 *
 * Build the app first:
 *   (cd examples/universal-app && npm ci --ignore-scripts && npx vite build)
 * Then:
 *   PLAYWRIGHT=$(npm root -g)/playwright/index.mjs \
 *     node experiments/issue-41-editor.mjs
 */

/* global URL, document */

import { createServer } from 'node:http';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HEAD_GROUPS,
  HEAD_PARAMETERS,
  VOICE_FORMAT,
  VOICE_VERSION,
  loadVoice,
} from '../src/index.js';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'examples', 'universal-app', 'dist');
const SHOTS = path.join(ROOT, 'docs', 'screenshots', 'issue-41');
const TYPES = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.wasm': 'application/wasm',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const file = path.join(
    DIST,
    url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)
  );
  try {
    const body = await readFile(file);
    response.writeHead(200, {
      'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream',
    });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const advanced = HEAD_PARAMETERS.filter((parameter) => parameter.advanced);
const basic = HEAD_PARAMETERS.length - advanced.length;
let failures = 0;
function check(name, ok, detail = '') {
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? `: ${detail}` : ''}`);
  if (!ok) {
    failures++;
  }
}

const temp = path.join(os.tmpdir(), 'issue-41-editor');
mkdirSync(temp, { recursive: true });
mkdirSync(SHOTS, { recursive: true });
const browser = await chromium.launch();

async function run(locale) {
  const context = await browser.newContext({
    locale: locale === 'ru' ? 'ru-RU' : 'en-US',
    viewport: { width: 1280, height: 900 },
    colorScheme: 'light',
    acceptDownloads: true,
  });
  const page = await context.newPage();
  await page.goto(`${base}?seed=preview`);
  const editor = page.locator('section[aria-labelledby=editor-title]');
  await editor.waitFor();
  const groups = await page
    .locator('details.editor-group')
    .evaluateAll((nodes) => nodes.map((node) => node.dataset.group));
  check(`${locale}: six groups in order`, groups.join() === HEAD_GROUPS.join());
  const sliders = () => page.locator('.head-editor input[type=range]').count();
  check(`${locale}: basic sliders`, (await sliders()) === basic, basic);
  await page.locator('#head-show-all').check();
  const all = await sliders();
  check(`${locale}: all sliders`, all === HEAD_PARAMETERS.length, all);
  await page.locator('#head-show-all').uncheck();

  const buttons = page.locator('.voice-file button');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    buttons.nth(1).click(),
  ]);
  const exported = path.join(temp, `${locale}-voice.json`);
  await download.saveAs(exported);
  const voice = loadVoice(readFileSync(exported, 'utf8'));
  check(
    `${locale}: export voice`,
    download.suggestedFilename() === 'voice.json' &&
      voice.warnings.length === 0,
    `${download.suggestedFilename()}, preset ${voice.preset}`
  );

  const good = path.join(temp, 'good.json');
  writeFileSync(
    good,
    JSON.stringify({
      format: VOICE_FORMAT,
      version: VOICE_VERSION,
      folds: { pitch: 205 },
    })
  );
  await page.locator('.voice-file input[type=file]').setInputFiles(good);
  await page.waitForFunction(
    () => document.querySelector('#head-pitch')?.value === '205'
  );
  check(`${locale}: import voice`, true, 'pitch slider at 205');

  const broken = path.join(temp, 'broken.json');
  writeFileSync(
    broken,
    JSON.stringify({
      format: VOICE_FORMAT,
      version: VOICE_VERSION,
      folds: { pitch: 900 },
    })
  );
  await page.locator('.voice-file input[type=file]').setInputFiles(broken);
  const alert = page.locator('.voice-file-error');
  await alert.waitFor();
  const text = await alert.innerText();
  check(
    `${locale}: import error`,
    text.includes('broken.json') && text.includes('folds.pitch = 900'),
    JSON.stringify(text)
  );
  await page.locator('.voice-file input[type=file]').setInputFiles(good);
  await alert.waitFor({ state: 'detached' });
  await editor.screenshot({ path: path.join(SHOTS, `editor-${locale}.png`) });
  await context.close();
}

try {
  await run('en');
  await run('ru');
} finally {
  await browser.close();
  server.close();
}
console.log(failures ? `${failures} failed` : 'all checks passed');
process.exitCode = failures ? 1 : 0;
