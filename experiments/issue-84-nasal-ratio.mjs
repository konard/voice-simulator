// Issue 84: level of the nasal murmur against the vowel next to it. Prints
// the RMS (30 ms in the middle of each segment) of the [m] of ˈama divided
// by that of the first [a], per tier, for the head overrides given as JSON
// on the command line.
// Run: node experiments/issue-84-nasal-ratio.mjs '{"nasalLoss":3}' medium high
import { synthesize } from '../src/index.js';

export function nasalRatio(tier, head = {}) {
  const { samples, sampleRate, plan } = synthesize('ˈama', {
    ipa: true,
    tier,
    seed: 1,
    head,
  });
  const level = (kind) => {
    const segment = plan.segments.find((item) => item.kind === kind);
    const centre = ((segment.start + segment.end) / 2) * sampleRate;
    const half = Math.round(0.015 * sampleRate);
    let sum = 0;
    for (let index = centre - half; index < centre + half; index++) {
      sum += samples[Math.floor(index)] ** 2;
    }
    return Math.sqrt(sum / (2 * half));
  };
  return level('consonant') / level('vowel');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const head = JSON.parse(process.argv[2] ?? '{}');
  for (const tier of process.argv.slice(3)) {
    console.log(
      `${tier} ${JSON.stringify(head)}: ratio ${nasalRatio(tier, head).toFixed(3)}`
    );
  }
}
