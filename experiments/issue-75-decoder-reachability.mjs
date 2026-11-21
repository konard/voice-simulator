/** Find speech recordings whose decoder graph cannot reach the end. Unlicense. */
import { levelForTier, synthesize } from '../src/index.js';
import {
  analyzeForDecode,
  decoderSettings,
  prepareIpaDecode,
} from '../src/recognition/decode-pipeline.js';
import {
  decoderOptions,
  recognitionSettings,
} from '../src/recognition/recognizer.js';
import { sentences } from '../tests/helpers/roundtrip.js';

function lastReachableNode(spans) {
  const reachable = [true];
  for (const [from, outgoing] of spans.entries()) {
    if (!reachable[from]) {
      continue;
    }
    for (const { to } of outgoing) {
      reachable[to] = true;
    }
  }
  return reachable.length - 1;
}

const tier = 'telephone';
const level = levelForTier(tier);
const options = decoderOptions(recognitionSettings({ level }), level);
const seed = 1;
let recordings = 0;
let disconnected = 0;
for (const [lang, texts] of Object.entries(sentences)) {
  for (const [i, text] of texts.entries()) {
    for (const preset of ['male', 'female']) {
      const { samples, sampleRate } = synthesize(text, {
        lang,
        tier,
        head: 'random',
        preset,
        seed,
      });
      const settings = decoderSettings(sampleRate, options);
      const analysis = analyzeForDecode(samples, sampleRate, options, settings);
      const { prepared } = prepareIpaDecode(analysis, settings);
      const { times, spans } = prepared;
      const last = lastReachableNode(spans);
      recordings++;
      if (last !== times.length - 1) {
        disconnected++;
        console.log({
          lang,
          sentence: i + 1,
          preset,
          lastReachable: times[last],
          next: times[last + 1],
          end: times.at(-1),
        });
      }
    }
  }
}
console.log({ tier, recordings, disconnected });
