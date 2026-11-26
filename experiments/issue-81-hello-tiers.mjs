// Issue 81: "Hello world." recognised back per tier and level. Unlicense.
import { synthesize, recognize } from '../src/index.js';
for (const tier of ['telephone', 'wideband', undefined]) {
  const out = synthesize('Hello world.', { tier, lang: 'en' });
  for (const level of ['low', 'medium']) {
    const heard = recognize(out.samples, out.sampleRate, {
      level,
      languages: ['en'],
    });
    console.log(
      tier ?? 'default',
      out.sampleRate,
      level,
      JSON.stringify(heard.text)
    );
  }
}
