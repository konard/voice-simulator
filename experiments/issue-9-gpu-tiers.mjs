/**
 * Benchmark the audio tiers as the web app does: the 3D tiers on WebGPU
 * when the runtime has an adapter, the waveguide tiers on the CPU.
 *
 *   deno run -A experiments/issue-9-gpu-tiers.mjs
 *   node experiments/issue-9-gpu-tiers.mjs    (no WebGPU: CPU only)
 */

import {
  AUDIO_TIERS,
  benchmarkAudioTiersAsync,
  requestGpuDevice,
} from '../src/index.js';

const device = await requestGpuDevice().catch(() => null);
const result = await benchmarkAudioTiersAsync({ device });
console.log(device ? 'WebGPU adapter found' : 'no WebGPU adapter');
AUDIO_TIERS.forEach((tier, index) => {
  const cpu = result.loads[index];
  const gpu = result.gpuLoads[index];
  const text = (load) => (load === undefined ? '-' : load.toFixed(2));
  console.log(
    `  ${tier.name.padEnd(10)} cpu ${text(cpu)}${
      cpu !== undefined && !result.measured[index] ? ' (predicted)' : ''
    }  gpu ${gpu === null ? '-' : gpu.toFixed(2)}`
  );
});
console.log(`chosen: ${result.tier.name} on the ${result.gpu ? 'GPU' : 'CPU'}`);
device?.destroy?.();
