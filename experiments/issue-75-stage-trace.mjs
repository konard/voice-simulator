/** Measure the acoustic and text stages separately on the telephone smoke cases. */
import { performance } from 'node:perf_hooks';
import { errorRate, levelForTier, synthesize } from '../src/index.js';
import {
  decodeRecognitionAudio,
  recognitionSettings,
  recognizeDecoded,
} from '../src/recognition/recognizer.js';
import { sentences } from '../tests/helpers/roundtrip.js';

const tier = 'telephone';
const level = levelForTier(tier);
const head = process.argv.includes('--seeded-preset') ? 'random' : undefined;
const cpuSeconds = ({ user, system }) => (user + system) / 1e6;
for (const [lang, index] of [
  ['en', 17],
  ['ru', 1],
  ['zh', 1],
]) {
  const requested = process.argv.find((flag) => flag.startsWith('--lang='));
  if (requested && requested !== `--lang=${lang}`) {
    continue;
  }
  const text = sentences[lang][index];
  const spoken = synthesize(text, {
    lang,
    tier,
    preset: 'male',
    seed: 1,
    head,
  });
  const settings = recognitionSettings({
    level,
    ...(process.argv.includes('--no-whisper') && { whisper: false }),
    ...(process.argv.includes('--known-head') && { voice: spoken.head }),
    ...(process.argv.includes('--known-language') && { languages: [lang] }),
  });
  const start = performance.now();
  const cpuStart = process.cpuUsage();
  const { decoded, input, rate } = decodeRecognitionAudio(
    spoken.samples,
    spoken.sampleRate,
    settings,
    level
  );
  const afterAudio = performance.now();
  const audioCpuSeconds = cpuSeconds(process.cpuUsage(cpuStart));
  const cpuAfterAudio = process.cpuUsage();
  const heard = recognizeDecoded(
    decoded,
    input,
    rate,
    settings,
    level,
    'batch'
  );
  console.log(
    JSON.stringify({
      lang,
      text,
      ipa: spoken.ipa,
      decoded: decoded.ipa,
      heard: heard.ipa,
      acousticPer: errorRate(spoken.ipa, decoded.ipa, 'phone').rate,
      finalPer: errorRate(spoken.ipa, heard.ipa, 'phone').rate,
      whisper: decoded.whisperSpans,
      audioCpuSeconds,
      textCpuSeconds: cpuSeconds(process.cpuUsage(cpuAfterAudio)),
      audioSeconds: (afterAudio - start) / 1000,
      textSeconds: (performance.now() - afterAudio) / 1000,
    })
  );
}
