/** Compare the telephone decoder's beam budgets and voice-fit observations. Unlicense. */
import { fitVoice, presetHeadConfig, synthesize } from '../src/index.js';
import { hmmAudioToIpa } from '../src/recognition/hmm-stage.js';

const text =
  'A little bird sings in the morning. We heard it again across the green field. The road climbed slowly through the forest toward a house beside the river. She turned around and saw the lights come on in every room. They brought some tea and set the table before walking home together. The wind blew through the trees while we looked for a place to rest.';
function measure(label, fn) {
  const start = process.cpuUsage();
  const result = fn();
  const { user, system } = process.cpuUsage(start);
  console.log(label, (user + system) / 1e6, result);
}
for (const head of ['male', 'female', 'child']) {
  const truth = presetHeadConfig(head);
  const { samples, sampleRate } = synthesize(text, {
    tier: 'telephone',
    head: truth,
    seed: 1,
  });
  console.log(head, truth.vocalTractLength, truth.pitch);
  if (process.argv.includes('--decoder') && head === 'male') {
    for (const [beam, maxActive] of [
      [48, 280],
      [58, 640],
      [120, 6000],
    ]) {
      measure(`hmm ${beam} ${maxActive}`, () =>
        hmmAudioToIpa(samples.subarray(0, 8000 * 3), sampleRate, {
          languages: ['en'],
          maxWords: 6000,
          search: { beam, maxActive },
        })
          .words.map(({ text }) => text)
          .join(' ')
      );
    }
  }
  for (const seconds of [3, 4, 6, 9, 12]) {
    measure(`fit ${seconds}s`, () => {
      const { head } = fitVoice(
        samples.subarray(0, sampleRate * seconds),
        sampleRate,
        { refine: false, sourceDiagnostics: false }
      );
      return [
        head.vocalTractLength,
        head.pitch,
        head.pitchRange,
        head.breathiness,
        head.tenseness,
        head.speechRate,
      ];
    });
  }
}
