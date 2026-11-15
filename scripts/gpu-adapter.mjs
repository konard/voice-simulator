#!/usr/bin/env -S deno run -A

/**
 * Print the WebGPU adapter this runtime offers as one JSON line (see
 * describeGpuDevice), or `null` without one. Always exits with 0: the
 * `Heavy checks` workflow runs it before the tests to show the adapter,
 * and the tests themselves fail when REQUIRE_GPU=1 finds none.
 *
 * Usage: deno run -A scripts/gpu-adapter.mjs
 */

import {
  describeGpuDevice,
  requestGpuDevice,
} from '../src/acoustics/fdtd-gpu.js';

try {
  const device = await requestGpuDevice();
  console.log(JSON.stringify(describeGpuDevice(device)));
  device?.destroy?.();
} catch (error) {
  console.log('null');
  console.error(`Could not request a WebGPU device: ${error.message}`);
}
