/** Compile-only public API regression. Unlicense. */
import {
  recognizeModes,
  toPlanModes,
  planUtterance,
  synthesize,
} from '../../src/index.js';

const heard = recognizeModes(new Float32Array(8000), 8000, {
  words: [{ start: 0, end: 1, ipa: 'a' }],
  text: 'a',
});
const text: string = heard.text;
const modes = toPlanModes(heard.modes);
planUtterance(heard.ipa, { modes });
synthesize(heard.ipa, { ipa: true, modes });
void text;
