// Load every built-in accent through loadAccent and apply it to sample words.
import { ACCENTS } from '../src/g2p/accents.js';
import {
  getAccent,
  loadAccent,
  applyAccent,
  explainAccent,
} from '../src/accent/index.js';

for (const [language, list] of Object.entries(ACCENTS)) {
  for (const { code } of list) {
    try {
      const definition = loadAccent(getAccent(code));
      console.log(language, code, definition.rules.length, 'rules');
    } catch (error) {
      console.log(language, code, 'ERROR', error.message);
    }
  }
}
console.log(
  applyAccent('ˈθɪŋ', 'en-x-ru'),
  applyAccent('ˈθɪŋ', 'en-x-ru', 0.5)
);
console.log(
  applyAccent('ˈskul', 'en-x-hi'),
  applyAccent('ˈstɹit', 'en-x-zh'),
  applyAccent('ˈbɛd', 'en-x-zh')
);
console.log(explainAccent('ˈɡorət', 'ˈɣorət', 'ru'));
