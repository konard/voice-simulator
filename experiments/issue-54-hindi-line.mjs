// The four Hindi stops of issue 54 in one utterance: segments, release
// voicing and H1-H2 against the first 80 ms of the baː vowel.
// node experiments/issue-54-hindi-line.mjs
import { synthesize, analyzeVoice } from '../src/index.js';
import { voicedShare } from '../tests/helpers/accent-measures.js';
const r = synthesize('paː pʰaː baː bʱaː', {
  tier: 'medium',
  seed: 1,
  ipa: true,
  lang: 'hi',
});
const slice = (s) =>
  r.samples.subarray(
    Math.round(s.start * r.sampleRate),
    Math.round(s.end * r.sampleRate)
  );
for (const s of r.plan.segments) {
  const share =
    s.kind === 'release'
      ? ` voicedShare ${voicedShare(r, s).toFixed(2)} h1h2 ${analyzeVoice(slice(s), r.sampleRate).h1h2.toFixed(2)}`
      : '';
  console.log(
    s.kind,
    s.symbol ?? s.token?.phoneme?.symbol ?? '',
    ((s.end - s.start) * 1000).toFixed(1),
    share
  );
}
console.log(Object.keys(r.plan.segments[1]));
