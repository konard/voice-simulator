/**
 * Duration of the audit sentence at default settings (issue 39 acceptance:
 * it changes by less than 15 %). Usage:
 *   node experiments/issue-39-audit-duration.mjs [srcRoot]
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(process.argv[2] ?? path.join(here, '../src'));
const load = (file) => import(pathToFileURL(path.join(root, file)).href);
const { textToIpa } = await load('g2p/index.js');
const { planUtterance } = await load('articulation/plan.js');
const { normalizeHeadConfig } = await load('head-config.js');

const sentence = 'The quick brown fox jumps over the lazy dog.';
const { ipa } = textToIpa(sentence);
for (const speechRate of [1, 1.5]) {
  const plan = planUtterance(ipa, {
    language: 'en',
    head: normalizeHeadConfig({ speechRate }),
  });
  console.log(
    `speechRate ${speechRate}: ${plan.duration.toFixed(3)} s (${ipa})`
  );
}
