/**
 * Issue 168: why the calibrated lane (a whole loud sentence heard with its
 * voice) misses `f` on some tiers. Prints the pooled word cues against the
 * voice baseline and each condition of the coherent constant-effort check
 * in src/recognition/modes.js.
 * node experiments/issue-168-calibrated-3d.mjs [tiers] [langs]
 * Unlicense.
 */
import { levelForTier, recognize, synthesize } from '../src/index.js';
import { quantile, summarize } from '../src/recognition/mode-features.js';
import { semitones } from '../src/recognition/mode-rules.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [tiers = 'low,high', langs = 'en'] = process.argv.slice(2);
const r = (v) => (Number.isFinite(v) ? v.toFixed(2) : String(v));
for (const tier of tiers.split(',')) {
  for (const lang of langs.split(',')) {
    const spoken = synthesize(
      `<speak><prosody volume="loud">${sentences[lang][0]}</prosody></speak>`,
      { lang, tier, head: 'random', preset: 'male', seed: 1, markup: true }
    );
    let words;
    const heard = recognize(spoken.samples, spoken.sampleRate, {
      level: levelForTier(tier),
      voice: spoken.head,
      trace: (e) => {
        if (e.stage === 'words') {
          words = e;
        }
      },
    });
    const { baseline: base, features } = words;
    const vowels = features.filter((w) => w.vowels);
    const pooled = summarize(vowels);
    const pitches = vowels.map((w) => w.pitch);
    const band = pooled.pitch * 0.12;
    const checks = {
      displacement: semitones(pooled.pitch, base.pitch),
      steady:
        quantile(pitches, 0.9) - quantile(pitches, 0.1) < band ||
        pitches.filter((p) => Math.abs(p - pooled.pitch) < band / 2).length >=
          0.75 * pitches.length,
      jitter: pooled.jitter,
      voiced: pooled.voiced,
      cpp: pooled.cpp - base.cpp,
      hnr: pooled.hnr - base.hnr,
    };
    console.log(
      tier,
      lang,
      `rate ${spoken.sampleRate}`,
      Object.entries(checks)
        .map(([k, v]) => `${k} ${typeof v === 'boolean' ? v : r(v)}`)
        .join(', '),
      '(need |displacement| ≥ 3, steady, jitter < 2, voiced > 0.8, cpp > -1.5, hnr > -4)'
    );
    console.log(
      '  modes',
      JSON.stringify(
        heard.modes.map((m) => [m.notation, r(m.start), r(m.end)])
      ),
      heard.text
    );
  }
}
