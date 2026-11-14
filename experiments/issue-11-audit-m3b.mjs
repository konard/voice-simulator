// Audit of the current behaviour for the "modes of speech" issues of
// issue 11 (markup, intonation, effort, whisper, phonation, emotion,
// paralinguistic sounds, accents).
// Run: node experiments/issue-11-audit-m3b.mjs > experiments/issue-11-audit-m3b.txt
import {
  textToIpa,
  parseIpa,
  planUtterance,
  prepareUtterance,
  synthesize,
  analyzeVoice,
} from '../src/index.js';
import { ACCENTS } from '../src/g2p/accents.js';

const show = (label, value) =>
  console.log(`${label}: ${JSON.stringify(value)}`);
const round = (value, digits = 2) => Number(value.toFixed(digits));

// 1. What happens to markup in plain text today?
for (const text of [
  '<speak>Hello <emphasis>world</emphasis>.</speak>',
  '[whisper]Hello[/whisper] world.',
  'This is *really* good.',
]) {
  show(`markup ${text}`, textToIpa(text, { lang: 'en' }).ipa);
}

// 2. Which mode symbols does the IPA parser know?
for (const ipa of [
  'a̤',
  'a̰',
  'ạ',
  '{W ma W}',
  '{𝆑 ma 𝆑}',
  '⸨cough⸩ ma',
  'ˈˈma',
  'ma (.) ma',
]) {
  const { tokens, unknown } = parseIpa(ipa);
  show(`ipa ${ipa}`, {
    segments: tokens.filter((token) => token.kind !== 'pause').length,
    unknown,
  });
}

// 3. Sentence types: pitch (Hz) in the first vowel and at the end of the
// last vowel, mean pitch of all vowels, peak loudness.
for (const [lang, text] of [
  ['en', "You are coming, aren't you?"],
  ['en', 'Apples, pears and plums.'],
  ['en', 'Come here!'],
  ['en', 'Come here.'],
  ['ru', 'Ты придёшь.'],
  ['ru', 'Ты придёшь?'],
  ['ru', 'Кто пришёл?'],
  ['hi', 'तुम आओगे।'],
  ['hi', 'तुम आओगे?'],
  ['hi', 'क्या तुम आओगे?'],
  ['zh', '你来。'],
  ['zh', '你来？'],
  ['zh', '你来吗？'],
]) {
  const { plan, ipa } = prepareUtterance(text, { lang, tier: 'minimal' });
  const vowels = plan.segments.filter((segment) => segment.kind === 'vowel');
  const frame = (time) => Math.round(time * plan.frameRate);
  const at = (time) => Math.round(plan.channels.f0[frame(time)]);
  let sum = 0;
  let count = 0;
  for (const vowel of vowels) {
    for (let index = frame(vowel.start); index < frame(vowel.end); index++) {
      sum += plan.channels.f0[index];
      count++;
    }
  }
  show(`${lang} ${text}`, {
    ipa,
    first: at(vowels[0].start + 0.02),
    last: at(vowels.at(-1).end - 0.02),
    mean: Math.round(sum / count),
    peakLoudness: round(Math.max(...plan.channels.loudness)),
  });
}

// 4. Hindi breathy-voiced stops: is `bʱ` different from `b`?
for (const ipa of ['baː', 'bʱaː', 'pʰaː', 'paː']) {
  const plan = planUtterance(ipa, { language: 'hi' });
  show(`hi ${ipa}`, {
    segments: plan.segments
      .filter((segment) => segment.kind !== 'pause')
      .map(
        (segment) => `${segment.kind}:${Math.round(segment.duration * 1000)}ms`
      ),
    peakAspiration: round(Math.max(...plan.channels.aspiration)),
  });
}

// 5. Voice source knobs against what the analysis measures.
const sentence = 'Please call Stella and ask her to bring these things.';
const level = (samples) => {
  let sum = 0;
  for (const sample of samples) {
    sum += sample * sample;
  }
  return 10 * Math.log10(sum / samples.length + 1e-12);
};
const measure = (label, head) => {
  const out = synthesize(sentence, { tier: 'medium', seed: 1, head });
  const features = analyzeVoice(out.samples, out.sampleRate);
  show(label, {
    levelDb: round(level(out.samples), 1),
    f0: Math.round(features.f0),
    f1: Math.round(features.formants[0]),
    h1h2: round(features.h1h2),
    hnr: round(features.hnr),
    voicedShare: round(features.voicedDuration / features.activeDuration),
  });
};
for (const tenseness of [0, 0.3, 0.6, 0.9, 1]) {
  measure(`tenseness ${tenseness}`, { tenseness });
}
for (const outputGain of [0.5, 1, 2]) {
  measure(`outputGain ${outputGain}`, { outputGain });
}
for (const jitter of [0.4, 3]) {
  measure(`jitter ${jitter}`, { jitter });
}
measure('pitch 60', { pitch: 60 });
measure('breathiness 1 aspirationLevel 3 chink 10', {
  breathiness: 1,
  aspirationLevel: 3,
  glottalChink: 10,
  tenseness: 0,
});

// 6. Fillers and laughter written as words.
for (const [lang, text] of [
  ['en', 'um'],
  ['en', 'uh'],
  ['en', 'haha'],
  ['en', 'hmm'],
  ['ru', 'э-э'],
  ['ru', 'ха-ха'],
  ['zh', '嗯'],
  ['zh', '呃'],
  ['hi', 'अं'],
]) {
  show(`filler ${lang} ${text}`, textToIpa(text, { lang }).ipa);
}

// 7. Accents.
show('accent languages', Object.keys(ACCENTS));
for (const [lang, accent, text] of [
  ['en', 'en-GB', 'water'],
  ['en', 'en-IN', 'think of the water'],
  ['ru', 'ru-south', 'город молоко'],
  ['zh', 'zh-TW', '是不是'],
  ['hi', 'hi-east', 'ज़रा फिर'],
  ['en', 'ru', 'think of the water'],
]) {
  const out = textToIpa(text, { lang, accent });
  show(`accent ${lang} ${accent} ${text}`, {
    ipa: out.ipa,
    accent: out.accent ?? null,
  });
}

// 8. Where does the pitch move? Start and end pitch (Hz) of every vowel.
for (const [lang, text] of [
  ['ru', 'Это мама.'],
  ['ru', 'Это мама?'],
  ['en', 'Tea or coffee?'],
  ['en', 'I said Anna, not Maria.'],
]) {
  const { plan, ipa } = prepareUtterance(text, { lang, tier: 'minimal' });
  const frame = (time) => Math.round(time * plan.frameRate);
  show(`vowels ${lang} ${text}`, {
    ipa,
    f0: plan.segments
      .filter((segment) => segment.kind === 'vowel')
      .map((segment) => [
        Math.round(plan.channels.f0[frame(segment.start + 0.01)]),
        Math.round(plan.channels.f0[frame(segment.end - 0.01)]),
      ]),
  });
}

// 9. A voiceless vowel is the closest thing to a whisper today.
for (const ipa of ['ˈama', 'ˈḁm̥ḁ', 'ˈhḁ']) {
  const out = synthesize(ipa, { ipa: true, tier: 'medium', seed: 1 });
  show(`voiceless ${ipa}`, { levelDb: round(level(out.samples), 1) });
}
