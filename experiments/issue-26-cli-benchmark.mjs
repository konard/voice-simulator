// Issue 26: how often `node bin/voice-simulator.js benchmark` lists each
// narrow-band tier with a load below that of `minimal`, and the load of
// each tier measured alone in its own process (no other tier compiled).
//
//   node experiments/issue-26-cli-benchmark.mjs [runs]
import { execFileSync } from 'node:child_process';
import { loadavg } from 'node:os';
import { URL, fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const NARROW = ['telephone', 'narrowband', 'wideband'];
const runs = Number(process.argv[2] ?? 20);

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1];
};

console.log(
  `load average ${loadavg()
    .map((v) => v.toFixed(2))
    .join(' ')}`
);

// 1. The command line benchmark, `runs` times.
const below = Object.fromEntries(NARROW.map((name) => [name, 0]));
const ratios = Object.fromEntries(NARROW.map((name) => [name, []]));
for (let run = 0; run < runs; run++) {
  const { loads } = JSON.parse(
    execFileSync('node', ['bin/voice-simulator.js', 'benchmark', '--json'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
  );
  NARROW.forEach((name, index) => {
    below[name] += loads[index] < loads[3] ? 1 : 0;
    ratios[name].push(loads[index] / loads[3]);
  });
}
for (const name of NARROW) {
  console.log(
    `cli ${name}: below minimal in ${below[name]}/${runs} runs, median load / minimal ${median(ratios[name]).toFixed(2)}`
  );
}

// 2. Each tier alone: 25 measurements of 0.3 s, median of the last 15.
const SOLO = `
import { AUDIO_TIERS, measureAudioTier } from './src/index.js';
const tier = AUDIO_TIERS.find((entry) => entry.name === process.argv[1]);
const loads = [];
for (let i = 0; i < 25; i++) loads.push(measureAudioTier(tier, { seconds: 0.3 }));
const tail = loads.slice(10).sort((a, b) => a - b);
console.log(tail[7]);
`;
const solo = Object.fromEntries(
  [...NARROW, 'minimal'].map((name) => [name, []])
);
for (let round = 0; round < 5; round++) {
  for (const name of Object.keys(solo)) {
    solo[name].push(
      Number(
        execFileSync('node', ['--input-type=module', '-e', SOLO, name], {
          cwd: ROOT,
          encoding: 'utf8',
        })
      )
    );
  }
}
const minimal = median(solo.minimal);
for (const [name, loads] of Object.entries(solo)) {
  console.log(
    `alone ${name}: median load ${median(loads).toFixed(4)} (${(median(loads) / minimal).toFixed(2)} of minimal)`
  );
}
