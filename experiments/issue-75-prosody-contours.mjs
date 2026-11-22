/** Rank forward tune hypotheses with identified words and phone times. Unlicense. */
import { prepareUtterance, synthesize } from '../src/synthesize.js';
import { markProsody, measureProsody } from '../src/recognition/prosody.js';
import { render } from '../tests/helpers/prosody-material.js';
import { sentenceMark, sentences } from '../tests/helpers/roundtrip.js';

const marks = {
  en: { '.': '.', '?': '?', '!': '!' },
  ru: { '.': '.', '?': '?', '!': '!' },
  hi: { '.': '।', '?': '?', '!': '!' },
  zh: { '.': '。', '?': '？', '!': '！' },
};

const mean = (values) =>
  values.reduce((sum, value) => sum + value, 0) / values.length;
const frame = (time, { frameRate }) => Math.round(time * frameRate);

function comparePitch(recording, candidate, pitch, shift = 0) {
  const vowels = (plan) => plan.segments.filter(({ kind }) => kind === 'vowel');
  const measuredVowels = vowels(recording);
  const candidateVowels = vowels(candidate);
  if (measuredVowels.length !== candidateVowels.length) {
    return null;
  }
  const errors = [];
  for (const [index, vowel] of measuredVowels.entries()) {
    const other = candidateVowels[index];
    const from = Math.ceil((vowel.start - pitch.startTime - shift) / pitch.hop);
    for (let i = Math.max(0, from); i < pitch.count; i++) {
      const time = pitch.startTime + i * pitch.hop + shift;
      if (time >= vowel.end) {
        break;
      }
      if (pitch.semitones[i] === null) {
        continue;
      }
      const fraction = (time - vowel.start) / vowel.duration;
      const candidateTime = other.start + fraction * other.duration;
      const expected = candidate.channels.f0[frame(candidateTime, candidate)];
      errors.push(pitch.semitones[i] - 12 * Math.log2(expected));
    }
  }
  if (!errors.length) {
    return null;
  }
  // Fit a multiplicative pitch scale so knowing the source register is not required.
  const offset = mean(errors);
  return Math.sqrt(mean(errors.map((error) => (error - offset) ** 2)));
}

function identicalAlternatives(text, options, samples, scores) {
  const expected = sentenceMark(text);
  const expectedLoss = scores.find(({ mark }) => mark === expected)?.exact;
  return scores.some(({ mark, exact, hypothesis }) => {
    if (
      mark === expected ||
      !Number.isFinite(exact) ||
      !Number.isFinite(expectedLoss) ||
      Math.abs(exact - expectedLoss) > 1e-9
    ) {
      return false;
    }
    const alternative = synthesize(hypothesis, options).samples;
    return (
      samples.length === alternative.length &&
      samples.every((sample, i) => sample === alternative[i])
    );
  });
}

function summarize(cases, cost) {
  let right = 0;
  let tied = 0;
  for (const { expected, scores } of cases) {
    const ranked = scores.filter((score) => Number.isFinite(score[cost]));
    ranked.sort((a, b) => a[cost] - b[cost]);
    if (ranked.length < 2) {
      continue;
    }
    if (Math.abs(ranked[1][cost] - ranked[0][cost]) <= 1e-9) {
      tied++;
    } else if (ranked[0].mark === expected) {
      right++;
    }
  }
  return { right, tied };
}

for (const tier of ['telephone', 'wideband']) {
  for (const [lang, texts] of Object.entries(sentences)) {
    const pairs = [];
    for (const text of texts) {
      for (const preset of ['male', 'female']) {
        const options = {
          lang,
          tier,
          preset,
          head: 'random',
          engine: 'js',
          seed: 1,
        };
        const { audio, result, sounds } = render(text, lang, preset, options);
        const measured = measureProsody(
          audio.samples,
          audio.sampleRate,
          sounds,
          {
            language: lang,
          }
        );
        const baseline = sentenceMark(markProsody(result, measured).text);
        const scores = Object.entries(marks[lang]).map(([mark, written]) => {
          const hypothesis = text.replace(/[.?!।。？！]$/u, written);
          const { plan } = prepareUtterance(hypothesis, options);
          const otherVoice = prepareUtterance(hypothesis, {
            ...options,
            seed: 2,
          });
          return {
            mark,
            hypothesis,
            exact: comparePitch(audio.plan, plan, measured.pitch),
            shifted: comparePitch(audio.plan, plan, measured.pitch, 0.02),
            otherVoice: comparePitch(
              audio.plan,
              otherVoice.plan,
              measured.pitch
            ),
          };
        });
        pairs.push({
          expected: sentenceMark(text),
          baseline,
          scores,
          identical: identicalAlternatives(
            text,
            options,
            audio.samples,
            scores
          ),
        });
      }
    }
    for (const mark of ['all', ...Object.keys(marks[lang])]) {
      const cases = pairs.filter(
        ({ expected }) => mark === 'all' || mark === expected
      );
      console.log(
        JSON.stringify({
          tier,
          lang,
          mark,
          cases: cases.length,
          baseline: cases.filter(
            ({ expected, baseline }) => baseline === expected
          ).length,
          identical: cases.filter(({ identical }) => identical).length,
          exact: summarize(cases, 'exact'),
          shifted: summarize(cases, 'shifted'),
          otherVoice: summarize(cases, 'otherVoice'),
        })
      );
    }
  }
}
