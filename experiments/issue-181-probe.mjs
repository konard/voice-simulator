// Issue 181: what the synthesiser says and the HMM word decoder hears for "Hello world.". Unlicense.
import { synthesize, recognize } from '../src/index.js';
import { getLexicon } from '../src/recognition/lexicon.js';
const lex = getLexicon('en');
for (const w of [
  'hello',
  'hollow',
  'her',
  'no',
  'to',
  'know',
  'world',
  'hallo',
  'hullo',
]) {
  console.log(
    w,
    JSON.stringify(
      lex.pronunciations
        ? [...lex.pronunciations(20000)]
            .filter((e) => e.word === w)
            .map((e) => [
              e.count,
              e.tokens
                .map((t) => t.symbol + (t.stress ? `ˈ${t.stress}` : ''))
                .join(' '),
            ])
        : null
    )
  );
}
for (const tier of process.argv[2]
  ? process.argv[2].split(',')
  : ['telephone']) {
  const out = synthesize('Hello world.', {
    tier: tier === 'default' ? undefined : tier,
    lang: 'en',
  });
  console.log('synth ipa', out.ipa ?? Object.keys(out));
  const heard = recognize(out.samples, out.sampleRate, {
    level: 'low',
    languages: ['en'],
    segments: true,
  });
  console.log(tier, heard.text, heard.ipa);
  console.log(
    heard.segments
      .map((s) => `${s.ipa}@${s.start.toFixed(2)}-${s.end.toFixed(2)}`)
      .join(' ')
  );
}
