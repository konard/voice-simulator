// Prints parseMarkup() for one SSML case per row of the table in step 2 of
// issue 50, to check the expectations in tests/markup.test.js.
// Run: node experiments/issue-50-probe-ssml.mjs
import { parseMarkup } from '../src/markup/index.js';

const cases = [
  '<speak xml:lang="ru-RU">привет</speak>',
  '<speak><p>a b</p><p>c.</p><s>d</s></speak>',
  '<speak>a<break time="300ms"/>b<break time="1.5s"/>c<break strength="x-strong"/>d<break/>e</speak>',
  '<speak><prosody rate="fast" pitch="+2st">a b</prosody> c</speak>',
  '<speak><prosody rate="80%" pitch="x-low" range="high" volume="loud">a</prosody></speak>',
  '<speak><prosody pitch="+50%">a</prosody><prosody pitch="200Hz">b</prosody><prosody range="-50%">c</prosody></speak>',
  '<speak><prosody volume="-6dB">a</prosody><prosody volume="silent">b</prosody><prosody vs:gain="-6dB">c</prosody></speak>',
  '<speak><emphasis>a</emphasis> <emphasis level="reduced">b</emphasis></speak>',
  '<speak><say-as interpret-as="characters">abc</say-as> <say-as interpret-as="ordinal">3</say-as> <say-as interpret-as="date">x</say-as></speak>',
  '<speak><phoneme alphabet="ipa" ph="ˈtəmeɪtoʊ">tomato</phoneme></speak>',
  '<speak><lang xml:lang="ru">да</lang> yes</speak>',
  '<speak><sub alias="World Wide Web">WWW</sub></speak>',
  '<speak><vs:effort level="whisper">a</vs:effort><vs:effort value="0.75" to="1">b</vs:effort></speak>',
  '<speak><vs:phonation name="breathy">a</vs:phonation><vs:phonation name="pressed" degree="1">b</vs:phonation></speak>',
  '<speak><vs:emotion name="angry" intensity="0.8">a</vs:emotion><vs:emotion arousal="0.5" valence="-0.5">b</vs:emotion></speak>',
  '<speak xmlns:vs="urn:voice-simulator:markup:1">a <vs:sound name="laugh"/><vs:sound name="cough" duration="0.5s"/> b</speak>',
  '<speak><foo>kept</foo> &lt;&amp;&#65;&#x42;<!-- c --></speak>',
];
const brief = (mode) => {
  const out = {};
  for (const [k, v] of Object.entries(mode)) {
    if (typeof v === 'object' && v) {
      const inner = Object.entries(v).filter(
        ([, x]) => x !== 0 && x !== 'neutral'
      );
      if (inner.length) {
        out[k] = Object.fromEntries(inner);
      }
    } else if (
      !(k === 'effort' && v === 0.5) &&
      !(k === 'effortEnd' && v === 0.5) &&
      !(k === 'rate' && v === 1) &&
      !(k === 'range' && v === 1) &&
      v !== 0 &&
      v !== null
    ) {
      out[k] = v;
    }
  }
  return out;
};
for (const input of cases) {
  const r = parseMarkup(input);
  console.log(input);
  console.log(
    '  ',
    JSON.stringify({
      text: r.text,
      lang: r.lang,
      spans: r.spans.map((s) => [s.start, s.end, brief(s.mode)]),
      breaks: r.breaks,
      sounds: r.sounds,
      overrides: r.overrides,
      sources: r.sources,
      warnings: r.warnings,
    })
  );
}
