/**
 * The tiers set of the heavy round trip (sentences 2 and 20, male, random
 * head seed 1) for every language: renders once into a cache directory,
 * then recognises each render at levelForTier(tier) and prints its PER, top
 * language and text, and a line with the mean PER and language hits.
 * Usage: node experiments/issue-75-tiers-sweep.mjs [cacheDir] [regex]
 * To compare search settings, edit HMM_DECODE_DEFAULTS in
 * src/recognition/hmm-decode.js between runs (the cache is reused).
 * Unlicense.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { performance } from 'node:perf_hooks';
import { join } from 'node:path';
import {
  errorRate,
  levelForTier,
  recognize,
  synthesize,
} from '../src/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const dir = process.argv[2] ?? join(tmpdir(), 'issue-75-tiers-cache');
const filter = new RegExp(process.argv[3] ?? '.');
const tiers = ['telephone', 'low', 'medium', 'high', 'ultra', 'studio'];
mkdirSync(dir, { recursive: true });

function render(lang, tier, index) {
  const file = join(dir, `${lang}-${tier}-${index + 1}.json`);
  if (!existsSync(file)) {
    const text = sentences[lang][index];
    const s = synthesize(text, {
      lang,
      tier,
      head: 'random',
      preset: 'male',
      seed: 1,
    });
    const bytes = Buffer.from(Float32Array.from(s.samples).buffer);
    writeFileSync(
      file,
      JSON.stringify({
        text,
        sampleRate: s.sampleRate,
        ipa: s.ipa,
        samples: bytes.toString('base64'),
      })
    );
  }
  const { text, sampleRate, ipa, samples } = JSON.parse(
    readFileSync(file, 'utf8')
  );
  // A short base64 string decodes into Node's shared pool: copy its bytes.
  const b = Buffer.from(samples, 'base64');
  const x = new Float32Array(
    b.buffer.slice(b.byteOffset, b.byteOffset + b.length)
  );
  return { text, sampleRate, ipa, samples: x };
}

let n = 0;
let perSum = 0;
let right = 0;
let ms = 0;
for (const lang of Object.keys(sentences)) {
  for (const tier of tiers) {
    for (const index of [1, 19]) {
      const name = `${lang}-${tier}-${index + 1}`;
      if (!filter.test(name)) {
        continue;
      }
      const { sampleRate, ipa, samples } = render(lang, tier, index);
      const t0 = performance.now();
      const heard = recognize(samples, sampleRate, {
        level: levelForTier(tier),
      });
      ms += performance.now() - t0;
      const per = errorRate(ipa, heard.ipa, 'phone').rate;
      const top = [...heard.languages].sort((a, b) => b.share - a.share)[0]
        ?.language;
      n++;
      perSum += per;
      right += top === lang;
      console.log(name, per.toFixed(2), top, JSON.stringify(heard.text));
    }
  }
}
console.log(
  `ALL PER ${(perSum / n).toFixed(3)} lang ${right}/${n} ${(ms / n).toFixed(0)} ms/utt`
);
