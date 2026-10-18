// Compare the WebGPU step loop with the CPU kernel on the same input and
// time both. Needs a runtime with WebGPU (deno run -A, or a browser).
// Usage: deno run -A experiments/fdtd-gpu-compare.mjs [dx] [steps] [output]
import { Fdtd3d } from '../src/acoustics/fdtd3d.js';
import { requestGpuDevice } from '../src/acoustics/fdtd-gpu.js';
import { DEFAULT_HEAD } from '../src/head-config.js';
import { tractShape, noseShape } from '../src/articulation/tract-shape.js';
import { vowelTarget } from '../src/articulation/phones.js';
import { getPhoneme } from '../src/ipa/inventory.js';

const args = globalThis.Deno?.args ?? process.argv.slice(2);
const dx = Number(args[0] ?? 1);
const steps = Number(args[1] ?? 2000);
const output = args[2] ?? 'flow';
const device = await requestGpuDevice();
if (!device) {
  console.log('no WebGPU adapter');
  globalThis.Deno?.exit(0);
}
const microphone = output === 'microphone' ? { distance: 10 } : undefined;
const solvers = [
  new Fdtd3d({ head: DEFAULT_HEAD, dx, microphone }),
  new Fdtd3d({ head: DEFAULT_HEAD, dx, microphone, device }),
];
const shapes = ['a', 'i'].map((vowel) =>
  tractShape(
    { ...vowelTarget({ phoneme: getPhoneme(vowel) }), rhotic: 0 },
    DEFAULT_HEAD,
    { sections: 44 }
  )
);
const results = [];
for (const solver of solvers) {
  solver.setNose(noseShape(DEFAULT_HEAD).areas);
  const began = globalThis.performance.now();
  for (let step = 0; step < steps; step++) {
    if (step % 100 === 0) {
      const shape = shapes[(step / 100) % 2];
      solver.setShape(
        shape.areas,
        shape.velumArea,
        shape.velumIndex,
        shape.teeth
      );
    }
    const flow = Math.sin(step * 0.05) * (step % 80 < 40 ? 1 : 0);
    const noise = step > steps / 2 ? Math.sin(step * 1.7) * 0.3 : 0;
    solver.queueStep(flow, 30, noise);
    if (step % 1000 === 999) {
      results.push(...(await solver.flushSteps()));
    }
  }
  results.push(...(await solver.flushSteps()));
  const seconds = (globalThis.performance.now() - began) / 1000;
  console.log(
    solver.gpu ? 'gpu' : 'cpu',
    `${(steps / seconds).toFixed(0)} steps/s`
  );
}
const cpu = results.slice(0, steps);
const gpu = results.slice(steps);
let error = 0;
let energy = 0;
for (let step = 0; step < steps; step++) {
  error += (cpu[step] - gpu[step]) ** 2;
  energy += cpu[step] ** 2;
}
console.log(
  `dx ${dx} cells ${solvers[0].cellCount} links ${solvers[0].linkCount} workgroup ${solvers[1].gpu.workgroup}`
);
console.log(`relative RMS error ${Math.sqrt(error / energy).toExponential(2)}`);
console.log('cpu', cpu.slice(1990, 1995), 'gpu', gpu.slice(1990, 1995));
