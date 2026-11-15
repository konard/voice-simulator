/**
 * Issue 39: the ratio of the last vowel of `ˈmɑmɑ.` to the same vowel at
 * the end of the first word of `ˈmɑmɑ ˈmɑmɑ.` for several values of the
 * `nonPhraseFinal` and `clauseFinal` rules (en table).
 * Run: node experiments/issue-39-phrase-final.mjs
 */
import { DURATION_TABLES } from '../src/articulation/durations.js';
import { planUtterance } from '../src/articulation/plan.js';
import { normalizeHeadConfig } from '../src/head-config.js';

const head = normalizeHeadConfig({});
function vowel(ipa, table, count) {
  const plan = planUtterance(ipa, {
    language: 'en',
    head,
    durationTable: table,
  });
  const tokens = plan.tokens.filter((token) => token.base === 'ɑ');
  const token = tokens[count];
  return plan.segments
    .filter((segment) => segment.token === token)
    .reduce((sum, segment) => sum + segment.duration, 0);
}
const base = DURATION_TABLES.en;
for (const clauseFinal of [1.2, 1.4]) {
  for (const nonPhraseFinal of [0.6, 0.7, 0.8, 0.85, 0.9, 1]) {
    const table = {
      ...base,
      rules: { ...base.rules, clauseFinal, nonPhraseFinal },
    };
    const ratio = vowel('ˈmɑmɑ.', table, 1) / vowel('ˈmɑmɑ ˈmɑmɑ.', table, 1);
    console.log(
      `clauseFinal ${clauseFinal} nonPhraseFinal ${nonPhraseFinal}: ratio ${ratio.toFixed(2)}`
    );
  }
}
