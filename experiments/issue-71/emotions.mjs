/** Bounded twelve-emotion probe, four languages, no downloads. Unlicense. */
import { synthesize, EMOTION_PRESETS } from '../../src/index.js';
import {
  LANGUAGES,
  HEAD,
  recognize,
} from '../../tests/helpers/recognition-modes.js';
import { BASELINE_TEXT } from '../../src/recognition/mode-baseline.js';
for (const lang of LANGUAGES) {
  for (const name of Object.keys(EMOTION_PRESETS)) {
    const audio = synthesize(`[${name}]${BASELINE_TEXT[lang]}[/${name}]`, {
      lang,
      head: HEAD,
      tier: 'minimal',
      seed: 1,
      engine: 'js',
      markup: true,
    });
    const events = [];
    const result = recognize(audio, lang, {
      trace: (event) => {
        if (event.stage === 'phrase') {
          events.push(event);
        }
      },
    });
    console.log(JSON.stringify({ lang, name, modes: result.modes, events }));
  }
}
