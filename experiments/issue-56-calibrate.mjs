// Issue 56: measure the sounds (levels, peaks, f0, voicing) at tier medium.
// node experiments/issue-56-calibrate.mjs [text ...]
import { levelDb, pitchTrack, synthesize, voicedShare } from '../src/index.js';

const BASE = { tier: 'medium', seed: 1, markup: true };
const texts = process.argv.slice(2);

function levelCurve(samples, rate, from, to, hop = 0.01) {
  const out = [];
  const step = Math.round(hop * rate);
  for (let i = from; i + step <= to; i += step) {
    out.push(levelDb(samples, i, i + step));
  }
  return out;
}

for (const text of texts.length ? texts : ['Yes [laugh]', '[inhale] Yes']) {
  const t0 = Date.now();
  const result = synthesize(text, BASE);
  const { samples, sampleRate, plan } = result;
  const at = (t) => Math.round(t * sampleRate);
  console.log(
    JSON.stringify(text),
    result.ipa,
    `${Date.now() - t0} ms`,
    JSON.stringify(plan.sounds)
  );
  const vowel = plan.segments.find((s) => s.kind === 'vowel' && !s.soundOf);
  if (vowel) {
    console.log(
      '  speech vowel level',
      levelDb(samples, at(vowel.start), at(vowel.end)).toFixed(1)
    );
  }
  for (const sound of plan.sounds) {
    const from = at(sound.start);
    const to = at(sound.end);
    const part = samples.subarray(from, to);
    console.log(
      '  sound',
      sound.name,
      (sound.end - sound.start).toFixed(3),
      'level',
      levelDb(samples, from, to).toFixed(1),
      'voiced',
      voicedShare(part, sampleRate).toFixed(2)
    );
    console.log(
      '  curve',
      levelCurve(samples, sampleRate, from, to)
        .map((v) => v.toFixed(0))
        .join(' ')
    );
    const f0 = pitchTrack(part, sampleRate, { hop: 0.01 });
    console.log('  f0   ', Array.from(f0, (v) => v.toFixed(0)).join(' '));
    const pf = plan.channels.f0;
    const fr = plan.frameRate;
    console.log(
      '  planf0',
      Array.from(
        pf.subarray(Math.round(sound.start * fr), Math.round(sound.end * fr))
      )
        .filter((_, i) => i % 2 === 0)
        .map((v) => v.toFixed(0))
        .join(' ')
    );
  }
}
