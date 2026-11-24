/** Issue 71: physics-generated audio; labels never enter recognition input. */
import { pulseF0, jitterPercent, cpp } from '../src/analysis/mode-features.js';
import { describe, expect, it } from 'test-anywhere';
import {
  recognizeModes,
  toPlanModes,
  synthesize,
  planUtterance,
  resample,
  EMOTION_PRESETS,
} from '../src/index.js';
import {
  classifyEmotion,
  classifyWord,
  estimateEffort,
  distance,
} from '../src/recognition/mode-rules.js';
import { neutralIpa } from '../src/recognition/modes.js';
import {
  voiceBaseline,
  emotionReferences,
  BASELINE_TEXT,
} from '../src/recognition/mode-baseline.js';
import {
  LANGUAGES,
  LABELS,
  HEAD,
  VOICE,
  render,
  recognize,
  dominant,
} from './helpers/recognition-modes.js';

const other = {
  en: 'Please call Stella.',
  ru: 'Это мой новый дом.',
  hi: 'आज मौसम अच्छा है।',
  zh: '今天是星期三。',
};
const effort = ['pp', 'p', null, 'f', 'ff'];
const counts = {
  exact: 0,
  near: 0,
  effort: 0,
  whisper: 0,
  other: 0,
  otherTotal: 0,
};
const telephone = { whisper: 0, correct: 0, total: 0 };
const emotions = { correct: 0, total: 0, sign: 0, signs: 0 };
// Replay starts from the same deterministic observations measured above.
// Retain only results, not audio; isolated replay runs still render afresh.
const recognizedLabels = new Map();

function emotionClasses(refs) {
  // Connected components of references <1 apart count as one class.
  const classes = new Map(refs.map((r) => [r.name, r.name]));
  for (const a of refs) {
    for (const b of refs) {
      if (distance(a.vector, b.vector) < 1) {
        const old = classes.get(b.name);
        const group = classes.get(a.name);
        for (const [name, value] of classes) {
          if (value === old) {
            classes.set(name, group);
          }
        }
      }
    }
  }
  return classes;
}

// The language/label table keeps the full acceptance matrix visible together.
// eslint-disable-next-line max-lines-per-function
describe('mode recognition', () => {
  it('measures pulses with an odd 10 ms sample hop (22050 Hz)', () => {
    const audio = render('en');
    expect(pulseF0(audio.samples, audio.sampleRate)).toBeGreaterThan(80);
    expect(jitterPercent(audio.samples, audio.sampleRate)).toBeGreaterThan(0);
    expect(cpp(audio.samples, audio.sampleRate)).toBeGreaterThan(0);
  });
  it('inverts the effort correlates, missing F1 and emotion margins', () => {
    const baseline = {
      alpha: -20,
      pitch: 120,
      rate: 4,
      pitchSpan: 3,
      h1h2: 4,
      hnr: 20,
    };
    expect(
      estimateEffort({ alpha: -18, pitch: 170, f1: 35 }, baseline)
    ).toEqual({ E: 10, effort: 0.75, confidence: 1 });
    expect(
      estimateEffort({ alpha: -18, pitch: 170, f1: null }, baseline).E
    ).toBe(10);
    expect(
      classifyWord(
        { ...baseline, alpha: -18, f1: 0, jitter: 0 },
        baseline,
        true
      ).quality
    ).toBe(null);
    expect(classifyEmotion([0, 0, 0, 0, 0, 0], [])).toBe(null);
    const found = classifyEmotion(
      [2, 2, 2, 2, 0, 0],
      [
        { name: 'happy', vector: [2, 2, 2, 2, 0, 0] },
        { name: 'sad', vector: [-1, -1, -1, -1, 0, 0] },
      ]
    );
    expect(found.emotion.name).toBe('happy');
    expect(found.emotion.arousal).toBe(1);
  });
  for (const lang of LANGUAGES) {
    for (const text of [BASELINE_TEXT[lang], other[lang]]) {
      it(`finds no mode in plain speech: ${lang} ${text}`, () => {
        const audio = render(lang, null, text);
        expect(recognize(audio, lang).modes).toEqual([]);
      });
    }
    for (const label of LABELS) {
      it(`hears ${label}: ${lang}`, () => {
        const audio = render(lang, label);
        const result = recognize(audio, lang);
        recognizedLabels.set(`${lang}:${label}`, result);
        const actual = dominant(
          result.modes,
          ['allegro', 'lento'].includes(label) ? 'tempo' : 'quality'
        );
        console.log(JSON.stringify({ lang, expected: label, actual }));
        if (effort.includes(label)) {
          counts.effort++;
          counts.exact += actual === label;
          counts.near +=
            actual !== null &&
            Math.abs(effort.indexOf(actual) - effort.indexOf(label)) <= 1;
        } else if (label === 'W') {
          counts.whisper += actual === 'W';
        } else {
          counts.otherTotal++;
          counts.other += actual?.replace(/^[123]/u, '') === label;
        }
        const low = resample(audio.samples, audio.sampleRate, 8000);
        const lowResult = recognize({ ...audio, ...low }, lang);
        const lowActual = dominant(
          lowResult.modes,
          ['allegro', 'lento'].includes(label) ? 'tempo' : 'quality'
        );
        console.log(
          JSON.stringify({
            lang,
            rate: 8000,
            expected: label,
            actual: lowActual,
          })
        );
        if (label === 'W') {
          telephone.whisper += lowActual === label;
        } else {
          telephone.total++;
          telephone.correct += lowActual?.replace(/^[123]/u, '') === label;
        }
      });
    }
    it(`does not guess constant effort without a baseline: ${lang}`, () => {
      expect(
        recognize(render(lang, 'f'), lang, { voice: undefined }).modes.some(
          (s) => s.effort !== undefined
        )
      ).toBe(false);
      for (const label of ['W', 'C', 'F']) {
        expect(
          dominant(
            recognize(render(lang, label), lang, { voice: undefined }).modes
          )
        ).toBe(label);
      }
    });
    const refs = emotionReferences(voiceBaseline(VOICE, 22050, lang));
    const classes = emotionClasses(refs);
    console.log(
      JSON.stringify({
        language: lang,
        emotionClasses: Object.fromEntries(classes),
      })
    );
    for (const name of Object.keys(EMOTION_PRESETS)) {
      it(`names the emotion: ${lang} ${name}`, () => {
        const audio = synthesize(`[${name}]${BASELINE_TEXT[lang]}[/${name}]`, {
          lang,
          head: HEAD,
          tier: 'minimal',
          seed: 1,
          engine: 'js',
          markup: true,
        });
        const result = recognize(audio, lang);
        const found = result.modes.find((s) => s.emotion)?.emotion;
        const actual = found?.name ?? 'neutral';
        emotions.total++;
        emotions.correct += classes.get(name) === classes.get(actual);
        const sign = {
          angry: 1,
          happy: 1,
          afraid: 1,
          surprised: 1,
          sad: -1,
          bored: -1,
          tender: -1,
        }[name];
        if (sign) {
          emotions.signs++;
          emotions.sign += (found?.arousal ?? 0) * sign > 0;
        }
        console.log(
          JSON.stringify({
            lang,
            expectedEmotion: name,
            actual,
            arousal: found?.arousal,
          })
        );
      });
    }
  }
  it('finds where loud speech starts', () => {
    const audio = render(
      'en',
      null,
      'one two three [loud] four five six [/loud]'
    );
    const spans = recognize(audio, 'en').modes.filter(
      (s) => s.effort !== undefined
    );
    expect(spans.some((s) => Math.abs(s.from - 3) <= 1)).toBe(true);
  });
  it('hears a crescendo', () => {
    const audio = render(
      'en',
      null,
      '[crescendo] one two three four five six [/crescendo]'
    );
    expect(
      recognize(audio, 'en').modes.some((s) => s.notation === 'crescendo')
    ).toBe(true);
  });
  for (const lang of LANGUAGES) {
    for (const label of LABELS) {
      it(`speaks ${label} ${lang} again on the same words`, () => {
        const first =
          recognizedLabels.get(`${lang}:${label}`) ??
          recognize(render(lang, label), lang);
        const modes = toPlanModes(first.modes);
        const plan = planUtterance(first.ipa, { head: HEAD, lang, modes });
        expect(
          plan.modes.some(
            (s) => s.emotion.arousal === (modes[0].mode.emotion?.arousal ?? 0)
          )
        ).toBe(true);
        const replay = synthesize(first.ipa, {
          ipa: true,
          lang,
          head: HEAD,
          tier: 'minimal',
          seed: 1,
          engine: 'js',
          modes,
        });
        const second = recognize(replay, lang);
        const selected = (r) =>
          r.modes
            .filter((s) => s.notation && !s.sound)
            .map(({ from, to, notation }) => ({ from, to, notation }));
        expect(selected(second)).toEqual(selected(first));
      });
    }
  }
  it('writes the neutral context with the heard marks, one word per word', () => {
    const tunes = [
      { from: 0, to: 1, notation: ',', tune: 'continuation' },
      { from: 1, to: 2, notation: '↘ ?', tune: 'wh' },
      { from: 0, to: 2, notation: 'f', effort: 0.75 },
    ];
    expect(
      neutralIpa({
        words: [{ ipa: 'ni˧˥ xɑʊ˨˩˦' }, { ipa: 'ni˨˩' }],
        modes: tunes,
      })
    ).toBe('ni˧˥xɑʊ˨˩˦ , ni˨˩ ↘ ?');
    expect(neutralIpa({ words: [{ ipa: 'ˈjɛs' }] })).toBe('ˈjɛs .');
  });
  it('hears a loud question against a neutral question (issue 75)', () => {
    const audio = render('hi', 'f', 'नमस्ते, आप कैसे हैं?');
    const words = audio.timeline.words;
    const at = (from, to) => ({
      from,
      to,
      start: words[from].start,
      end: words[to - 1].end,
    });
    // The tunes the prosody stage of recognize() hears in this question.
    const modes = [
      { ...at(0, 1), notation: ',', tune: 'continuation' },
      { ...at(1, 4), notation: '↘ ?', tune: 'wh' },
    ];
    const heard = recognizeModes(
      audio.samples,
      audio.sampleRate,
      { ipa: audio.ipa, lang: 'hi', words, modes },
      { voice: VOICE }
    );
    expect(
      heard.modes.some((s) => s.notation === 'f' && s.from === 0 && s.to === 4)
    ).toBe(true);
  });
  it('retains fields, copies results, abstains on short phrases and honors modes:false', () => {
    const audio = render('en', 'f', 'Yes.');
    const input = {
      words: audio.timeline.words,
      ipa: audio.ipa,
      text: 'Yes.',
      extra: 42,
    };
    const frozen = JSON.stringify(input);
    const result = recognizeModes(audio.samples, audio.sampleRate, input, {
      voice: VOICE,
    });
    expect(result.extra).toBe(42);
    expect(
      result.modes.some(
        (s) => s.effort !== undefined || s.phonation || s.emotion?.name
      )
    ).toBe(false);
    expect(JSON.stringify(input)).toBe(frozen);
    expect(
      recognizeModes(audio.samples, audio.sampleRate, input, { modes: false })
        .ipa
    ).toBe(input.ipa);
    expect(
      toPlanModes([
        {
          from: 0,
          to: 2,
          start: 0,
          end: 1,
          notation: null,
          confidence: 0.7,
          emotion: { arousal: 0.4 },
        },
      ])
    ).toEqual([{ from: 0, to: 2, mode: { emotion: { arousal: 0.4 } } }]);
  });
  it('meets the issue 71 acceptance gates', () => {
    console.log(JSON.stringify({ counts, telephone, emotions }));
    expect(counts.whisper).toBe(4);
    expect(counts.exact / counts.effort >= 0.8).toBe(true);
    expect(counts.near / counts.effort >= 0.95).toBe(true);
    expect(counts.other / counts.otherTotal >= 0.85).toBe(true);
    expect(telephone.whisper).toBe(4);
    expect(telephone.correct / telephone.total >= 0.7).toBe(true);
    expect(emotions.correct / emotions.total >= 0.75).toBe(true);
    expect(emotions.sign / emotions.signs >= 0.95).toBe(true);
  });
});
