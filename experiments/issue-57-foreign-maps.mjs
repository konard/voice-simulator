// Prints the unit map of every foreign accent (issue 57), to audit the
// nearest-unit choices: node experiments/issue-57-foreign-maps.mjs
import { foreignAccent, PROFILES } from '../src/accent/foreign.js';

const languages = Object.keys(PROFILES);
for (const target of languages) {
  for (const first of languages) {
    if (target === first) {
      continue;
    }
    const definition = foreignAccent(target, first);
    const map = definition.rules[0].map;
    console.log(`${definition.code} (base ${definition.base}):`);
    console.log(
      `  ${Object.entries(map)
        .map(([from, to]) => `${from}→${to}`)
        .join(' ')}`
    );
  }
}
