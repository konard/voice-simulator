// Phonotactic repairs of src/accent/apply.js on a few words (issue 57).
import { applyOwnRules } from '../src/accent/apply.js';

const zh = {
  phonotactics: { codas: ['n', 'ŋ'], maxOnset: 1, epenthesis: 'ə' },
};
const hi = {
  phonotactics: { codas: 'any', maxOnset: 2, epenthesis: 'ə', prothesis: 'ɪ' },
};
for (const word of [
  'ˈstɹit',
  'ˈbɛd',
  'ˈskul',
  'ˈspɹɪŋ',
  'ˈkjut',
  'əˈbaʊt',
  'ˈstɹɛŋkθs',
]) {
  console.log(
    word.padEnd(10),
    applyOwnRules(word, zh).padEnd(18),
    applyOwnRules(word, hi)
  );
}
