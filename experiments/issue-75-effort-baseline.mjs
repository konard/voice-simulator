/** Isolate the voice baseline and word timing in loudness recovery. Unlicense. */
import {
  levelForTier,
  recognize,
  recognizeModes,
  synthesize,
} from '../src/index.js';
import { modeLabels } from '../src/ipa/marks.js';
import { sentences } from '../tests/helpers/roundtrip.js';

function recoveredSpan(modes, reference) {
  return modes.some(
    ({ start, end, notation }) =>
      notation === 'f' &&
      Math.min(end, reference.end) - Math.max(start, reference.start) >=
        (reference.end - reference.start) / 2
  );
}

function recoverModes(spoken, words, lang, voice) {
  return recognizeModes(
    spoken.samples,
    spoken.sampleRate,
    { words, language: lang },
    voice ? { voice: { head: voice } } : {}
  ).modes;
}

for (const tier of ['telephone', 'wideband']) {
  for (const [lang, [text]] of Object.entries(sentences)) {
    const spoken = synthesize(
      `<speak><prosody volume="loud">${text}</prosody></speak>`,
      { lang, tier, head: 'random', preset: 'male', seed: 1, markup: true }
    );
    const heard = recognize(spoken.samples, spoken.sampleRate, {
      level: levelForTier(tier),
    });
    const referenceWords = spoken.timeline.words;
    const reference = spoken.plan.modes.find((mode) =>
      modeLabels(mode).includes('f')
    );
    if (!reference) {
      throw new Error(`No planned loud span for ${lang} at ${tier}`);
    }
    const measurements = {
      audioOnly: heard.modes,
      expectedWords: recoverModes(spoken, referenceWords, lang),
      expectedVoice: recoverModes(spoken, heard.words, lang, spoken.head),
      expectedWordsAndVoice: recoverModes(
        spoken,
        referenceWords,
        lang,
        spoken.head
      ),
    };
    console.log(
      JSON.stringify({
        tier,
        lang,
        ...Object.fromEntries(
          Object.entries(measurements).map(([key, modes]) => [
            key,
            recoveredSpan(modes, reference),
          ])
        ),
      })
    );
  }
}
