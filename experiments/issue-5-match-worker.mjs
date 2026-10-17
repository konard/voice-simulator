// Drive the app's match worker with a stubbed worker scope.
// Usage: node experiments/issue-5-match-worker.mjs
import { presetHeadConfig, synthesize } from '../src/index.js';

let handler = null;
globalThis.addEventListener = (type, listener) => {
  handler = listener;
};
globalThis.postMessage = (message) =>
  console.log(
    message.type,
    message.type === 'done'
      ? `${message.preset} pitch=${message.head.pitch} f0=${message.features.f0.toFixed(0)}`
      : JSON.stringify(message)
  );
await import('../examples/universal-app/src/engine/match-worker.js');

const text = 'Please read this sentence aloud for the simulator.';
const { samples, sampleRate } = synthesize(text, {
  head: presetHeadConfig('child'),
  sampleRate: 24000,
});
handler({ data: { samples, sampleRate, transcript: text, iterations: 3 } });
handler({ data: { samples: new Float32Array(8000), sampleRate: 8000 } });
