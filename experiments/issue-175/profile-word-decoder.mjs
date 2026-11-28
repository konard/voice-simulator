// Time the 8 kHz word search at different beam widths on synthesized speech.
// Run pinned: UV_THREADPOOL_SIZE=1 taskset -c 0 node --max-old-space-size=192
// experiments/issue-175/profile-word-decoder.mjs
import { synthesize } from '../../src/index.js';
import { hmmAudioToIpa } from '../../src/recognition/hmm-stage.js';
import {
  recognizeDecoded,
  recognitionSettings,
} from '../../src/recognition/recognizer.js';
import { sentences } from '../../tests/helpers/roundtrip.js';

const { samples, sampleRate } = synthesize(sentences.en[0], {
  tier: 'telephone',
  head: 'random',
  preset: 'male',
  lang: 'en',
  seed: 1,
  engine: 'js',
});
const languages = ['en'];
const settings = recognitionSettings({ engine: 'js', languages, level: 'low' });
hmmAudioToIpa(samples.subarray(0, sampleRate / 2), sampleRate, { languages });

function timed(run) {
  const start = process.cpuUsage();
  const result = run();
  const { user, system } = process.cpuUsage(start);
  return [result, ((user + system) / 1e6).toFixed(3)];
}

for (const beam of [120, 80, 55, 40, 30, 20]) {
  const [decoded, hmmSeconds] = timed(() =>
    hmmAudioToIpa(samples, sampleRate, { languages, search: { beam } })
  );
  const [result, resultSeconds] = timed(() =>
    recognizeDecoded(decoded, samples, sampleRate, settings, 'low', 'batch')
  );
  console.log({
    beam,
    audioSeconds: samples.length / sampleRate,
    hmmSeconds,
    resultSeconds,
    text: result.text,
  });
}
