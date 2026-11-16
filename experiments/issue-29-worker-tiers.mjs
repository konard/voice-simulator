// The tier messages of the worker in automatic mode with a simulated
// device speed (option `busy`): node experiments/issue-29-worker-tiers.mjs
// [factor below medium] [factor at medium and above] [tier] [seconds of text]
import { createWorkerHandler } from '../src/engine/worker-protocol.js';
import { DEFAULT_HEAD } from '../src/index.js';
import { AUDIO_TIERS, audioTierIndex } from '../src/perf/lod.js';

const [low = '0.05', high = '0.05', tier = 'minimal', repeats = '12'] =
  process.argv.slice(2);
const medium = audioTierIndex('medium');
const messages = [];
const handle = createWorkerHandler((message) => messages.push(message), {
  requestGpuDevice: () => null,
  busy: (level, audio) => audio * Number(level >= medium ? high : low),
});
const began = globalThis.performance.now();
await handle({
  type: 'speak',
  id: 1,
  ipa: 'həˈloʊ wɝld '.repeat(Number(repeats)).trim(),
  lang: 'en',
  head: DEFAULT_HEAD,
  seed: 1,
  tier: audioTierIndex(tier),
  auto: true,
});
const seconds = (globalThis.performance.now() - began) / 1000;
for (const message of messages) {
  if (message.type === 'tier') {
    const { at, from, level, reason, gainDb } = message;
    console.log(
      `tier at ${at.toFixed(4)} s: ${AUDIO_TIERS[from].name} -> ${AUDIO_TIERS[level].name} (${reason}), gain ${gainDb.toFixed(2)} dB`
    );
  } else if (message.type !== 'chunk') {
    console.log(message.type, message.level ?? '', message.totalSamples ?? '');
  }
}
console.log(`rendered in ${seconds.toFixed(2)} s`);
