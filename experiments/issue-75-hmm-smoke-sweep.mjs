/**
 * Decode the smoke sentences (or any sentence list) with several search
 * settings, blind (all languages) and with the known language.
 * node experiments/issue-75-hmm-smoke-sweep.mjs [tier] [preset] [cases]
 * cases: "en:17,ru:1,zh:1" (0-based). Environment: LMW, WIP, BEAM, SIL,
 * WORDS as comma lists to sweep. Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { synthesize } from '../src/index.js';
import { hmmFeatures } from '../src/recognition/hmm-features.js';
import { getHmmModel } from '../src/recognition/hmm-model.js';
import { getNetwork } from '../src/recognition/hmm-network.js';
import { decodeWords } from '../src/recognition/hmm-decode.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tier = 'telephone', preset = 'male', casesArg = 'en:17,ru:1,zh:1'] =
  process.argv.slice(2);
const list = (name, fallback) =>
  (process.env[name] ?? fallback).split(',').map(Number);
const searches = list('LMW', '8').flatMap((lmw) =>
  list('WIP', '-4').flatMap((wip) =>
    list('BEAM', '120').flatMap((beam) =>
      list('SIL', '-2').map((silencePenalty) => ({
        lmw,
        wip,
        beam,
        silencePenalty,
      }))
    )
  )
);
const model = getHmmModel();
const cases = casesArg.split(',').map((c) => c.split(':'));
for (const [lang, index] of cases) {
  const text = sentences[lang][Number(index)];
  const spoken = synthesize(text, {
    lang,
    tier,
    head: 'random',
    preset,
    seed: 1,
  });
  const { feats, frames } = hmmFeatures(
    spoken.samples,
    spoken.sampleRate,
    model.lda
  );
  console.log(`${lang} ${index}: ${text}`);
  for (const maxWords of list('WORDS', '8000')) {
    for (const languages of [['en', 'ru', 'hi', 'zh'], [lang]]) {
      const t0 = performance.now();
      const network = getNetwork(model, languages, { maxWords });
      const built = performance.now() - t0;
      for (const search of searches) {
        const t1 = performance.now();
        const d = decodeWords(network, feats, frames, search);
        console.log(
          `  ${languages.length > 1 ? 'blind' : 'known'} words=${maxWords}`,
          JSON.stringify(search),
          `build ${built.toFixed(0)} ms decode ${(performance.now() - t1).toFixed(0)} ms`,
          d.lang,
          JSON.stringify(d.words.map((w) => w.word).join(' ')),
          d.score?.toFixed?.(1) ?? ''
        );
      }
    }
  }
}
