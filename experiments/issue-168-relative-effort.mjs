/**
 * Issue 168: what the audio-only recognizer hears when one voice speaks a
 * neutral span followed by a louder span, compared with a whole loud
 * utterance heard blind (the negative control) and with its voice.
 * node experiments/issue-168-relative-effort.mjs [tiers] [langs] [shapes]
 * shapes: relative (sentence 1 neutral, then loud), plain (sentence 1 twice
 * neutral, the control), relative2 and plain2 (sentences 1 and 2), whole,
 * voice. Prints the activation contrast: the
 * duration-weighted heard arousal of the second sentence minus the first.
 * Unlicense.
 */
import { performance } from 'node:perf_hooks';
import { levelForTier, recognize, synthesize } from '../src/index.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const [
  tiers = 'telephone,wideband',
  langs = 'en,ru,hi,zh',
  shapes = 'relative,whole,voice',
] = process.argv.slice(2);
const loud = (text) => `<prosody volume="loud">${text}</prosody>`;
for (const tier of tiers.split(',')) {
  for (const lang of langs.split(',')) {
    for (const shape of shapes.split(',')) {
      const [first, other] = sentences[lang];
      const second = shape.endsWith('2') ? other : first;
      const input = shape.startsWith('relative')
        ? `<speak>${first} ${loud(second)}</speak>`
        : shape.startsWith('plain')
          ? `<speak>${first} ${second}</speak>`
          : `<speak>${loud(first)}</speak>`;
      const spoken = synthesize(input, {
        lang,
        tier,
        head: 'random',
        preset: 'male',
        seed: 1,
        markup: true,
      });
      const start = performance.now();
      const heard = recognize(spoken.samples, spoken.sampleRate, {
        level: levelForTier(tier),
        ...(shape === 'voice' && { voice: spoken.head }),
      });
      // The second sentence starts after the words of the first.
      const firstWords = synthesize(first, { lang, tier: 'minimal' }).timeline
        .words.length;
      const split =
        shape.startsWith('relative') || shape.startsWith('plain')
          ? spoken.timeline.words[firstWords].start
          : undefined;
      const arousal = (start, end) => {
        let total = 0;
        for (const m of heard.modes) {
          const overlap = Math.min(end, m.end) - Math.max(start, m.start);
          if (m.emotion?.arousal !== undefined && overlap > 0) {
            total += m.emotion.arousal * overlap;
          }
        }
        return total / (end - start);
      };
      const contrast =
        split === undefined
          ? null
          : arousal(split, spoken.duration) - arousal(0, split);
      const planned = spoken.plan.modes
        .filter((m) => m.end > m.start && m.effort > 0.5)
        .map((m) => [m.effort, m.start.toFixed(2), m.end.toFixed(2)]);
      console.log(
        tier,
        lang,
        shape,
        `${((performance.now() - start) / 1000).toFixed(1)} s`,
        'contrast',
        contrast?.toFixed(2),
        'planned',
        JSON.stringify(planned),
        'heard',
        JSON.stringify(
          heard.modes.map((m) => [
            m.notation ?? JSON.stringify(m.emotion ?? m.sound ?? null),
            m.start.toFixed(2),
            m.end.toFixed(2),
          ])
        ),
        heard.text
      );
    }
  }
}
