/**
 * Issue 57: list the IPA units of each language, to write the literal
 * `inventory` of the foreign-accent profiles in src/accent/profiles/.
 * en: every unit of the dictionary (General American); ru, hi, zh: the
 * units that the pronouncers produce for the letters of their tables.
 *
 *   node experiments/issue-57-inventories.mjs
 */
import { ENGLISH_DICTIONARY } from '../src/g2p/english-dict.js';
import { ipaUnits } from '../src/g2p/spelling.js';
import { FINALS, ERHUA_FINALS } from '../src/g2p/pinyin.js';

const STRESS = /^[ˈˌ]$/u;
const TONES = /[˥˦˧˨˩]/gu;

function collect(strings) {
  const counts = new Map();
  for (const text of strings) {
    for (const part of text.split(' ')) {
      for (const unit of ipaUnits(part)) {
        const clean = unit.replace(TONES, '');
        if (clean && !STRESS.test(clean)) {
          counts.set(clean, (counts.get(clean) ?? 0) + 1);
        }
      }
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

const english = String(ENGLISH_DICTIONARY)
  .split(' ')
  .map((entry) => entry.slice(entry.indexOf('=') + 1));
console.log('en', collect(english).map(([unit, n]) => `${unit}:${n}`).join(' '));
console.log(
  'zh finals',
  collect([...Object.values(FINALS), ...Object.values(ERHUA_FINALS)])
    .map(([unit]) => unit)
    .join(' ')
);
