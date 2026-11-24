/**
 * Why a whole loud sentence is or is not heard as `f` with the known
 * voice: the pooled cues of corroborateLabels() (src/recognition/modes.js)
 * against the voice baseline, each condition of `coherent` printed.
 * node experiments/issue-75-effort-trace.mjs [tier] [langs] [preset] [volume]
 * Unlicense.
 */
import { levelForTier, recognize, synthesize } from '../src/index.js';
import { quantile, summarize } from '../src/recognition/mode-features.js';
import { semitones } from '../src/recognition/mode-rules.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [
  tier = 'telephone',
  langs = 'en,ru,hi,zh',
  preset = 'male',
  volume = 'loud',
] = process.argv.slice(2);
for (const lang of langs.split(',')) {
  const text = sentences[lang][0];
  const spoken = synthesize(
    `<speak><prosody volume="${volume}">${text}</prosody></speak>`,
    { lang, tier, head: 'random', preset, seed: 1, markup: true }
  );
  let last;
  const result = recognize(spoken.samples, spoken.sampleRate, {
    level: levelForTier(tier),
    voice: spoken.head,
    trace: (e) => {
      if (e.stage === 'words') {
        last = e;
      }
      if (e.stage === 'context') {
        console.log('  context', e.found, e.ipa);
      }
    },
  });
  const heard = result;
  const { baseline: base, features } = last;
  const vowels = features.filter((w) => w.vowels);
  const pooled = summarize(vowels);
  const pitches = vowels.map((w) => w.pitch);
  const spread = quantile(pitches, 0.9) - quantile(pitches, 0.1);
  const steady =
    pitches.filter((p) => Math.abs(p - pooled.pitch) < pooled.pitch * 0.06)
      .length / pitches.length;
  const r = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
  console.log(
    lang,
    heard.text,
    JSON.stringify(result.modes.map((m) => [m.notation, r(m.start), r(m.end)]))
  );
  console.log(
    `  displacement ${r(semitones(pooled.pitch, base.pitch))} st (≥3)` +
      ` pitch ${r(pooled.pitch)}/${r(base.pitch)}` +
      ` spread ${r(spread)} (was < ${r(pooled.pitch * 0.12)})` +
      ` steady ${r(steady)} (≥0.75)` +
      ` jitter ${r(pooled.jitter)} (<2) voiced ${r(pooled.voiced)} (>0.8)` +
      ` cpp ${r(pooled.cpp - base.cpp)} (>-1.5) hnr ${r(pooled.hnr - base.hnr)} (>-4)`
  );
  console.log(
    '  words',
    features.map((w) => `${w.text ?? ''}:${r(w.pitch)}/${w.vowels}`).join(' ')
  );
}
