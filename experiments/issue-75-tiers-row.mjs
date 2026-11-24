/**
 * One row of the heavy round-trip tiers set (male, seed 1): the audio is
 * checked for non-finite samples, then the round-trip metrics are printed.
 * Usage: node experiments/issue-75-tiers-row.mjs <lang> <tier> [sentence…]
 * Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { roundTrip, sentences } from '../tests/helpers/roundtrip.js';

const [lang = 'en', tier = 'high', ...picked] = process.argv.slice(2);
const indexes = picked.length ? picked.map((s) => Number(s) - 1) : [1, 19];
for (const index of indexes) {
  const text = sentences[lang][index];
  const started = performance.now();
  const { spoken, heard, per, soundWer, languageRight } = roundTrip(text, {
    lang,
    tier,
    preset: 'male',
    seed: 1,
    referenceText: text,
  });
  const finite = spoken.samples ? spoken.samples.every(Number.isFinite) : '?';
  console.log(
    lang,
    tier,
    index + 1,
    `finite ${finite}`,
    `per ${per?.rate?.toFixed(2)}`,
    `swer ${soundWer?.rate?.toFixed(2)}`,
    `lang ${languageRight}`,
    `${((performance.now() - started) / 1000).toFixed(1)} s`,
    JSON.stringify(text),
    '→',
    JSON.stringify(heard.text)
  );
}
