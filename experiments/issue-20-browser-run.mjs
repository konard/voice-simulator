#!/usr/bin/env node

/* global Event */

/**
 * Issue 20: run the listening test end to end in real browsers.
 *
 * Opens examples/listening-test/index.html from file:// in Chromium and
 * Firefox (Playwright), answers the start screen and every trial, downloads
 * the result file and lists every request that is not a file:// or blob:
 * URL (there must be none). With --screenshots it saves the screens of
 * Chromium to docs/screenshots/listening-test/.
 *
 * Build the stimuli first:
 *   node scripts/listening-test.mjs build \
 *     --sentences examples/listening-test/sentences.example.json
 * Then:
 *   PLAYWRIGHT=$(npm root -g)/playwright/index.mjs \
 *     node experiments/issue-20-browser-run.mjs [--screenshots]
 * The results are written to experiments/out/issue-20/<browser>/.
 */

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const { chromium, firefox } = await import(
  process.env.PLAYWRIGHT ?? 'playwright'
);

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PAGE = pathToFileURL(
  path.join(ROOT, 'examples', 'listening-test', 'index.html')
).href;
const OUT = path.join(ROOT, 'experiments', 'out', 'issue-20');
const SHOTS = path.join(ROOT, 'docs', 'screenshots', 'listening-test');
const screenshots = process.argv.includes('--screenshots');

/** Keep the session that start() returns, so the run can answer sensibly. */
const KEEP_SESSION = `(() => {
  let kept;
  Object.defineProperty(globalThis, 'ListeningTest', {
    configurable: true,
    get: () => kept,
    set: (value) => {
      kept = { ...value, start: (o) => (globalThis.__session = value.start(o)) };
    },
  });
})();`;

/** Plausible ratings of a careful listener. */
const RATINGS = {
  reference: 100,
  medium: 72,
  low: 55,
  minimal: 41,
  anchor70: 38,
  anchor35: 15,
};

async function setSlider(page, label, value) {
  await page.getByLabel(`Rating of ${label}`).evaluate((input, v) => {
    input.value = String(v);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  }, value);
}

async function shoot(page, name, browserName) {
  if (screenshots && browserName === 'chromium') {
    await page.screenshot({
      path: path.join(SHOTS, `${name}.png`),
      fullPage: true,
    });
  }
}

async function mushra(page, trial, browserName) {
  for (const condition of trial.conditions) {
    await page.getByRole('button', { name: `Play ${condition.label}` }).click();
  }
  const next = page.getByRole('button', { name: 'Next' });
  const before = await next.isDisabled();
  for (const condition of trial.conditions) {
    await setSlider(page, condition.label, RATINGS[condition.name] ?? 50);
  }
  await page.getByRole('button', { name: 'Stop' }).click();
  await shoot(page, 'mushra', browserName);
  return { before, after: await next.isDisabled() };
}

async function abx(page, trial, browserName) {
  const next = page.getByRole('button', { name: 'Next' });
  for (const key of ['A', 'B', 'X']) {
    await page.getByRole('button', { name: `Play ${key}` }).click();
  }
  const before = await next.isDisabled();
  await page.getByLabel(`X is ${trial.x.toUpperCase()}`).check();
  await shoot(page, 'abx', browserName);
  return { before, after: await next.isDisabled() };
}

async function intelligibility(page, trial, browserName) {
  const next = page.getByRole('button', { name: 'Next' });
  const before = await next.isDisabled();
  await page.getByRole('button', { name: /^Play \(/ }).click();
  const used = await page
    .getByRole('button', { name: /^Play \(/ })
    .isDisabled();
  await page
    .getByLabel('The words you heard')
    .fill(trial.text.replace('young', 'yellow').replace(/[.?]$/u, ''));
  await shoot(page, 'intelligibility', browserName);
  return { before, after: await next.isDisabled(), playsUsedUp: used };
}

const SCREENS = { mushra, abx, intelligibility };

async function run(type, browserName) {
  const browser = await type.launch();
  const context = await browser.newContext({
    acceptDownloads: true,
    viewport: { width: 900, height: 900 },
  });
  await context.addInitScript(KEEP_SESSION);
  const page = await context.newPage();
  const requests = [];
  page.on('request', (request) => requests.push(request.url()));
  const problems = [];
  page.on('pageerror', (error) => problems.push(String(error)));
  page.on('console', (message) => {
    if (message.type() === 'error') {
      problems.push(message.text());
    }
  });

  await page.goto(PAGE);
  // The page's own Content-Security-Policy must refuse any connection.
  const csp = await page.evaluate(() =>
    fetch('https://example.invalid/').then(
      () => 'sent',
      (error) => `blocked (${error.name})`
    )
  );
  await shoot(page, 'start', browserName);
  await page.getByLabel('I am using headphones').check();
  await page.getByLabel(/Native language/).fill('EN');
  await page.getByRole('button', { name: 'Play volume check sound' }).click();
  await page.getByRole('button', { name: 'Start' }).click();

  const plan = await page.evaluate(() => globalThis.__session.plan);
  const steps = [];
  for (const trial of plan.trials) {
    const step = await SCREENS[trial.type](page, trial, browserName);
    const warnings = await page
      .locator('.warning:not([hidden])')
      .allTextContents();
    steps.push({ id: trial.id, type: trial.type, ...step, warnings });
    await page.getByRole('button', { name: 'Next' }).click();
  }
  await shoot(page, 'end', browserName);
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download results' }).click();
  const download = await downloading;
  const folder = path.join(OUT, browserName);
  mkdirSync(folder, { recursive: true });
  const file = path.join(folder, download.suggestedFilename());
  await download.saveAs(file);
  const warnings = await page
    .locator('.warning:not([hidden])')
    .allTextContents();
  await browser.close();

  const network = requests.filter(
    (url) =>
      !/^(file|blob|data):/u.test(url) && url !== 'https://example.invalid/'
  );
  const local = requests.filter((url) =>
    /^(file|blob|data):/u.test(url)
  ).length;
  return { browserName, csp, local, network, steps, file, problems, warnings };
}

if (screenshots) {
  mkdirSync(SHOTS, { recursive: true });
}
for (const [type, name] of [
  [chromium, 'chromium'],
  [firefox, 'firefox'],
]) {
  const report = await run(type, name);
  console.log(JSON.stringify(report, null, 2));
}
