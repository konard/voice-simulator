// YIN frames and plan channels inside the breathy-voiced release of hi bʱaː (issue 54).
// node experiments/issue-54-release-debug.mjs [ipa]
import { synthesize } from '../src/index.js';
import { decimate, rms } from '../src/acoustics/analysis.js';
import { yinPitch } from '../src/analysis/voice-features.js';
const r = synthesize(process.argv[2] ?? 'bʱaː', {
  tier: 'medium',
  seed: 1,
  ipa: true,
  lang: 'hi',
});
const { samples, sampleRate } = decimate(r.samples, r.sampleRate, 11025);
const db = (x) => 20 * Math.log10(Math.max(x, 1e-12));
const vowel = r.plan.segments.find((s) => s.kind === 'vowel');
const loud = db(
  rms(
    samples,
    Math.round(vowel.start * sampleRate),
    Math.round(vowel.end * sampleRate)
  )
);
const fr = r.plan.frameRate;
const ch = r.plan.channels;
const start = r.plan.segments.find((s) => s.kind === 'consonant').start;
for (let t = start; t < vowel.start + 0.03; t += 0.01) {
  const len = Math.round(0.03 * sampleRate);
  const from = Math.round((t + 0.005) * sampleRate) - Math.round(len / 2);
  const y = yinPitch(samples, from, len, sampleRate);
  const lvl = db(
    rms(
      samples,
      Math.round(t * sampleRate),
      Math.round((t + 0.01) * sampleRate)
    )
  );
  const k = Math.round((t + 0.005) * fr);
  const seg = r.plan.segments.find(
    (s) => s.start <= t + 0.005 && s.end > t + 0.005
  )?.kind;
  console.log(
    `${(t * 1000).toFixed(0)} ms ${seg} aper ${y?.aperiodicity?.toFixed(2)} f0 ${y?.f0?.toFixed(1)} level ${(lvl - loud).toFixed(1)} dB | voicing ${ch.voicing[k].toFixed(2)} asp ${ch.aspiration[k].toFixed(2)} breath ${ch.breath[k].toFixed(2)} tension ${ch.tension[k].toFixed(2)} lipArea ${ch.lipArea?.[k]?.toFixed(2)} f0 ${ch.f0[k].toFixed(1)}`
  );
}
