// A whisper span in each language (issue 53): the voiced share of
// `[whisper]…[/whisper]` against the plain text, at tier medium. Usage:
//   node experiments/issue-53-languages.mjs
import { synthesize, voicedShare } from '../src/index.js';

const TEXTS = {
  en: 'Please call Stella.',
  ru: 'Привет, мир.',
  hi: 'नमस्ते दुनिया।',
  zh: '你好，世界。',
};
for (const [lang, text] of Object.entries(TEXTS)) {
  const share = (input) => {
    const result = synthesize(input, {
      lang,
      tier: 'medium',
      seed: 1,
      markup: true,
      headroom: 20,
    });
    return voicedShare(result.samples, result.sampleRate);
  };
  console.log(
    lang,
    'plain',
    share(text).toFixed(3),
    'whisper',
    share(`[whisper]${text}[/whisper]`).toFixed(3)
  );
}
