// Issue 51: tune spans in inline markup, SSML and IPA brace marks.
import { textToIpa } from '../src/g2p/index.js';
import { parseIpa } from '../src/ipa/parse.js';
for (const [text, opts] of [
  ['[tune IK4]А ты?[/tune]', { lang: 'ru', markup: true }],
  ['<speak><vs:tune name="call">John!</vs:tune></speak>', { lang: 'en' }],
  ['<speak><vs:tune name="nope">John!</vs:tune></speak>', { lang: 'en' }],
]) {
  const r = textToIpa(text, opts);
  console.log(text, '→', r.ipa, JSON.stringify(r.modes.map((m) => [m.from, m.to, m.mode.tune])), r.warnings.map((w) => w.message));
}
console.log(JSON.stringify(parseIpa('{IK4 a ˈtɨ ? IK4}').modes));
