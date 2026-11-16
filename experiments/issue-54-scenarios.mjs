// Measures of the remaining phonation scenarios of issue 54 (the cases of
// tests/phonation.test.js beyond the six types on "Please call Stella.").
// node experiments/issue-54-scenarios.mjs > experiments/issue-54-scenarios.txt
import { synthesize, analyzeVoice } from '../src/index.js';
import {
  jitterPercent,
  pulseF0,
  pulseH1H2,
} from '../src/analysis/mode-features.js';
import { voicedShare } from '../tests/helpers/accent-measures.js';

const BASE = { tier: 'medium', seed: 1 };
const f = (x) => x.toFixed(2);
const slice = (r, s) =>
  r.samples.subarray(
    Math.round(s.start * r.sampleRate),
    Math.round(s.end * r.sampleRate)
  );
const vowels = (r) => r.plan.segments.filter((s) => s.kind === 'vowel');

// Degree ordering.
for (const degree of [0.33, 0.67, 1]) {
  const r = synthesize(
    `<speak><vs:phonation name="breathy" degree="${degree}">Please call Stella.</vs:phonation></speak>`,
    { ...BASE, markup: true }
  );
  console.log(
    `breathy degree ${degree}: h1h2 ${f(analyzeVoice(r.samples, r.sampleRate).h1h2)}`
  );
}

// Creak on {C ˈa C}.
{
  const r = synthesize('{C ˈa C}', { ...BASE, ipa: true });
  console.log(
    `{C ˈa C}: duration ${f(r.duration)} s, pulseF0 ${f(pulseF0(r.samples, r.sampleRate))} Hz, segments ${r.plan.segments.map((s) => `${s.kind}:${((s.end - s.start) * 1000).toFixed(0)}`).join(' ')}`
  );
}

// One vowel.
for (const ipa of ['ˈma̤ma', 'ˈmama', 'ˈma̰ma']) {
  const r = synthesize(ipa, { ...BASE, ipa: true });
  const [a, b] = vowels(r);
  const fa = slice(r, a);
  const fb = slice(r, b);
  console.log(
    `${ipa}: v1 pulseH1H2 ${f(pulseH1H2(fa, r.sampleRate))} pulseF0 ${f(pulseF0(fa, r.sampleRate))}; v2 pulseH1H2 ${f(pulseH1H2(fb, r.sampleRate))} pulseF0 ${f(pulseF0(fb, r.sampleRate))}; analyze v1 h1h2 ${f(analyzeVoice(fa, r.sampleRate).h1h2)} f0 ${f(analyzeVoice(fa, r.sampleRate).f0)} v2 h1h2 ${f(analyzeVoice(fb, r.sampleRate).h1h2)} f0 ${f(analyzeVoice(fb, r.sampleRate).f0)}`
  );
}

// Hindi stops.
const hindi = {};
for (const ipa of ['paː', 'pʰaː', 'baː', 'bʱaː']) {
  const r = synthesize(ipa, { ...BASE, ipa: true, lang: 'hi' });
  hindi[ipa] = r;
  const segs = r.plan.segments
    .map((s) => `${s.kind}:${((s.end - s.start) * 1000).toFixed(1)}`)
    .join(' ');
  const release = r.plan.segments.find((s) => s.kind === 'release');
  let extra = '';
  if (release) {
    const share = voicedShare(r, release);
    const h = pulseH1H2(slice(r, release), r.sampleRate);
    const a = analyzeVoice(slice(r, release), r.sampleRate);
    extra = ` release voicedShare ${f(share)} pulseH1H2 ${f(h)} analyze h1h2 ${f(a.h1h2)}`;
  }
  const vowel = vowels(r)[0];
  const first = { start: vowel.start, end: vowel.start + 0.08 };
  const fv = slice(r, first);
  console.log(
    `hi ${ipa}: ${segs}${extra}; vowel first 80 ms pulseH1H2 ${f(pulseH1H2(fv, r.sampleRate))} analyze h1h2 ${f(analyzeVoice(fv, r.sampleRate).h1h2)}`
  );
}

// Final creak.
for (const head of [{ finalCreak: 1 }, {}]) {
  const r = synthesize('You are coming.', { ...BASE, head });
  const v = vowels(r);
  console.log(
    `finalCreak ${head.finalCreak ?? 0}: first vowel jitter ${f(jitterPercent(r.samples, r.sampleRate, v[0]))} %, last vowel jitter ${f(jitterPercent(r.samples, r.sampleRate, v.at(-1)))} %, last vowel pulseF0 ${f(pulseF0(r.samples, r.sampleRate, v.at(-1)))} Hz, creak max ${f(Math.max(...r.plan.channels.creak))}`
  );
}

// Text and IPA: the markup of the text against the same markup in IPA, both
// the IPA the text gives and `{V̰ ma V̰}`.
{
  const a = synthesize('[creaky]ma[/creaky]', { ...BASE, markup: true });
  for (const ipa of [a.ipa, '{V̰ ma V̰}']) {
    const b = synthesize(ipa, { ...BASE, ipa: true });
    const ca = a.plan.channels.creak;
    const cb = b.plan.channels.creak;
    console.log(
      `text ${a.ipa} vs IPA ${b.ipa}: lengths ${ca.length} ${cb.length}, equal ${ca.length === cb.length && ca.every((x, i) => x === cb[i])}, max ${f(Math.max(...ca))} ${f(Math.max(...cb))}`
    );
  }
}
