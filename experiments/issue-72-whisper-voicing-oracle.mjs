/** Measure whispered voicing with phoneme times supplied by the synthesizer. Unlicense. */
import { analyzeFrames, presetHeadConfig, synthesize } from '../src/index.js';
import { whisperVoicing } from '../src/recognition/whisper-result.js';
import { WHISPER_CUES } from '../src/recognition/data/whisper-cues.js';
import { plannedPhones } from '../tests/helpers/decoder-material.js';

let correct = 0;
for (const pair of WHISPER_CUES) {
  for (const [expected, [ipa]] of pair.entries()) {
    const { plan, samples, sampleRate } = synthesize(`{W a${ipa}a W}`, {
      ipa: true,
      head: presetHeadConfig('female'),
      tier: 'minimal',
      engine: 'js',
      seed: 1,
    });
    const frames = analyzeFrames(samples, sampleRate);
    const sounds = plannedPhones(plan).map((sound, i) => ({
      ...sound,
      kind: i === 1 ? 'consonant' : 'vowel',
    }));
    const [, { voicing }] = whisperVoicing(sounds, frames, [
      {
        start: 0,
        end: samples.length / sampleRate,
      },
    ]);
    correct += Number(voicing !== 0.5 && Number(voicing > 0.5) === expected);
    console.log(ipa, voicing);
  }
}
console.log(`${correct}/${WHISPER_CUES.length * 2}`);
