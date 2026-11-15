---
'voice-simulator': patch
---

Add `describeGpuDevice(device)`, which names the WebGPU adapter a device runs
on. `renderPlanAsync` and `synthesizeAsync` free the GPU buffers of their
solver when they are done. The WebGPU solver is compared with the CPU kernel
in suite `gpu` of the heavy checks (through Deno and Mesa's software adapter on
Linux), and `REQUIRE_GPU=1` makes a missing adapter a test failure.
