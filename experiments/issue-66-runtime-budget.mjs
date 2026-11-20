/** Time first use and a warmed run for a supplied or estimated head. Unlicense. */
import { audioToIpa } from '../src/index.js';
import {
  DECODE_SENTENCES,
  DECODER_VOICES,
  renderDecoderText,
} from '../tests/helpers/decoder-material.js';

const rate = Number(process.argv[2] ?? 16000);
const condition = process.argv[3] ?? 'known';
const language = 'en';
const voice = DECODER_VOICES.male;
const { samples } = renderDecoderText(
  DECODE_SENTENCES.en[0],
  voice,
  rate,
  language
);
for (let attempt = 0; attempt < 2; attempt++) {
  const start = globalThis.performance.now();
  const result = audioToIpa(samples, rate, {
    voice: condition === 'known' ? voice : undefined,
    language,
  });
  console.log(
    condition,
    rate,
    attempt === 0 ? 'cold' : 'warm',
    'audioToIpa rtf',
    ((globalThis.performance.now() - start) * rate) / (1000 * samples.length),
    result.ipa
  );
}
