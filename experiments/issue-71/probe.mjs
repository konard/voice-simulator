/** Bounded acoustic confusion probe: node experiments/issue-71/probe.mjs. */
import { synthesize } from '../../src/synthesize.js';
import { recognizeModes } from '../../src/recognition/modes.js';
import { presetHeadConfig } from '../../src/head-config.js';
import { BASELINE_TEXT } from '../../src/recognition/mode-baseline.js';
const head = presetHeadConfig('male');
const names = process.argv.slice(2);
for (const lang of ['en', 'ru', 'hi', 'zh']) {
  for (const label of names.length
    ? names
    : [
        'plain',
        'pp',
        'p',
        'f',
        'ff',
        'W',
        'V̤',
        'V̰',
        'C',
        'V͈',
        'V͉',
        'F',
        'V!',
        'Ṿ',
        'allegro',
        'lento',
      ]) {
    const text = BASELINE_TEXT[lang];
    const options = {
      lang,
      head,
      seed: 1,
      tier: 'minimal',
      markup: true,
      engine: 'js',
    };
    const plain = synthesize(text, options);
    const audio =
      label === 'plain'
        ? plain
        : synthesize(`{${label} ${plain.ipa} ${label}}`, {
            ...options,
            ipa: true,
          });
    let feature;
    const recognized = recognizeModes(
      audio.samples,
      audio.sampleRate,
      { lang, words: audio.timeline.words },
      {
        voice: { head },
        trace: (e) => {
          if (e.stage === 'words') {
            feature = e;
          }
        },
      }
    );
    console.log(
      JSON.stringify({ lang, label, modes: recognized.modes, feature })
    );
  }
}
