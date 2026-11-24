/**
 * Print the pronunciations (units) and LM scores the HMM network holds for
 * the given words, to tell a lexicon gap from an acoustic error.
 * node experiments/issue-75-lexicon-entry.mjs <lang> <word...>
 * Unlicense.
 */
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';

const [lang = 'en', ...words] = process.argv.slice(2);
const network = getNetwork(getHmmModel(), [lang]);
for (const [id, w] of network.words.entries()) {
  if (words.includes(w.word)) {
    const { units, ...rest } = w;
    const info = Object.entries(rest)
      .filter(([, v]) => typeof v !== 'object')
      .map(([k, v]) => `${k}=${typeof v === 'number' ? +v.toFixed(3) : v}`);
    console.log(id, units?.join(' '), info.join(' '));
  }
}
