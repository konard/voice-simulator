// Which 8 kHz "Hello world." variants are recognised (issue 81). Unlicense.
import { synthesize, recognize } from '../src/index.js';
const variants = [
  [{}, {}],
  [{ lang: 'en' }, {}],
  [{ lang: 'en', seed: 1 }, {}],
  [{}, { languages: ['en'] }],
  [{ lang: 'en', seed: 1 }, { languages: ['en'] }],
];
for (const [s, r] of variants) {
  const out = synthesize('Hello world.', { tier: 'telephone', ...s });
  const heard = recognize(out.samples, out.sampleRate, { level: 'low', ...r });
  console.log(
    JSON.stringify(s),
    JSON.stringify(r),
    JSON.stringify(heard.text),
    heard.ipa
  );
}
