/** Reproduce late streaming commitments with their preceding beam snapshots. Unlicense. */
import { createIpaDecoder } from '../src/index.js';
import {
  DECODE_SENTENCES,
  DECODER_VOICES,
  renderDecoderText,
} from '../tests/helpers/decoder-material.js';

const sampleRate = 16000;
for (const [language, [text]] of Object.entries(DECODE_SENTENCES)) {
  for (const [name, voice] of Object.entries(DECODER_VOICES)) {
    const { samples } = renderDecoderText(text, voice, sampleRate, language);
    const stream = createIpaDecoder(sampleRate, { voice, language });
    const fixed = [];
    const history = [];
    for (let from = 0; from < samples.length; from += 320) {
      const end = Math.min(from + 320, samples.length);
      const now = end / sampleRate;
      const { segments } = stream.push(samples.subarray(from, end));
      for (const segment of segments) {
        if (segment.kind !== 'pause' && now - segment.end > 0.55) {
          console.log(
            JSON.stringify({
              language,
              name,
              now,
              segment,
              previous: fixed.at(-1),
              history,
            })
          );
        }
        fixed.push(segment);
      }
      const result = stream.result();
      history.push({
        time: now,
        boundary: result.lattice.times.at(-1),
        next: result.segments
          .slice(fixed.length, fixed.length + 3)
          .map(({ ipa, start, end }) => [ipa, start, end]),
      });
      if (history.length > 7) {
        history.shift();
      }
    }
    stream.flush();
  }
}
