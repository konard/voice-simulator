// Issue 32: matchVoice on MATCH_TEXT rendered with the default head at a
// given breathiness (waveguide, 16 kHz, seed 1), printed step by step: the
// breathiness, H1-H2 and HNR of every render and the head that is returned.
// Usage: node experiments/issue-32-recover-breathiness.mjs [breathiness...]
//   [--iterations n] [--transcript]
// --transcript passes MATCH_TEXT as the transcript, so that the speech rate
// is matched by the speaking time.
import { synthesize } from '../src/synthesize.js';
import { MATCH_TEXT, matchVoiceSteps } from '../src/analysis/voice-match.js';
import { analyzeVoice } from '../src/analysis/voice-features.js';

const args = process.argv.slice(2);
const at = args.indexOf('--iterations');
const iterations = at >= 0 ? Number(args[at + 1]) : undefined;
const transcript = args.includes('--transcript') ? MATCH_TEXT : undefined;
const values = args
  .filter((arg, index) => !arg.startsWith('--') && (at < 0 || index !== at + 1))
  .map(Number);

for (const breathiness of values.length ? values : [0.1, 0.8]) {
  const { samples, sampleRate } = synthesize(MATCH_TEXT, {
    head: { breathiness },
    sampleRate: 16000,
    solver: 'waveguide',
    seed: 1,
  });
  const target = analyzeVoice(samples, sampleRate);
  console.log(
    `target breathiness ${breathiness}: hnr ${target.hnr.toFixed(2)}`,
    `h1h2 ${target.h1h2.toFixed(2)} f0Range ${target.f0Range.toFixed(2)}`
  );
  const steps = matchVoiceSteps(samples, sampleRate, {
    iterations,
    transcript,
  });
  let result = steps.next();
  while (!result.done) {
    const { step, head, distance } = result.value;
    const render = synthesize(MATCH_TEXT, {
      head,
      sampleRate: 16000,
      solver: 'waveguide',
      seed: 1,
    });
    const got = analyzeVoice(render.samples, render.sampleRate);
    console.log(
      `  step ${step}: breathiness ${head.breathiness}`,
      `tenseness ${head.tenseness} speechRate ${head.speechRate}`,
      `-> hnr ${got.hnr.toFixed(2)} h1h2 ${got.h1h2.toFixed(2)}`,
      `distance ${distance.toFixed(3)}`
    );
    result = steps.next();
  }
  const { head, rendered, preset } = result.value;
  console.log(
    `  result ${preset}: breathiness ${head.breathiness}`,
    `tenseness ${head.tenseness} hnr ${rendered.hnr.toFixed(2)}`,
    `h1h2 ${rendered.h1h2.toFixed(2)}`
  );
}
