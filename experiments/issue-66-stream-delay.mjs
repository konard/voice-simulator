/** Reproduce late streaming commitments with their preceding beam snapshots. Unlicense. */
import { createIpaDecoder } from '../src/index.js';
import {
  DECODE_SENTENCES,
  DECODER_VOICES,
  renderDecoderText,
} from '../tests/helpers/decoder-material.js';

const sampleRate = 16000;
for (const [language, sentences] of Object.entries(DECODE_SENTENCES)) {
  if (process.argv[2] && process.argv[2] !== language) {
    continue;
  }
  for (const [index, text] of sentences.entries()) {
    for (const [name, voice] of Object.entries(DECODER_VOICES)) {
      const { samples } = renderDecoderText(text, voice, sampleRate, language);
      const stream = createIpaDecoder(sampleRate, { voice, language });
      const fixed = [];
      const history = [];
      function inspect(segments, now, final) {
        for (const segment of segments) {
          if (segment.kind !== 'pause' && now - segment.end > 0.55) {
            console.log(
              JSON.stringify({
                language,
                index,
                name,
                now,
                final,
                segment,
                previous: fixed.at(-1),
                history,
              })
            );
          }
          fixed.push(segment);
        }
      }
      for (let from = 0; from < samples.length; from += 320) {
        const end = Math.min(from + 320, samples.length);
        const now = end / sampleRate;
        inspect(stream.push(samples.subarray(from, end)).segments, now, false);
        const result = stream.result();
        history.push({
          time: now,
          boundary: result.lattice.times.at(-1),
          next: result.segments
            .slice(fixed.length, fixed.length + 3)
            .map(({ ipa, start, end }) => [ipa, start, end]),
        });
        if (history.length > 12) {
          history.shift();
        }
      }
      inspect(stream.flush().segments, samples.length / sampleRate, true);
    }
  }
}
