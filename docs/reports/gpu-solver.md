# WebGPU 3D solver against the CPU kernel

Run: https://github.com/konard/voice-simulator/actions/runs/43708633732 (`Heavy checks`, suite `gpu`, commit 30b6d216c813a6fb65fc9f35cc9b2e5f3ddbe857, `ubuntu-24.04`)

- install of the software OpenGL ES driver (`libegl1 libgles2 libegl-mesa0 libgl1-mesa-dri`): 12 s
- `Run heavy checks` step: 27 s (`gpu-solver.test.js` 18.0 s, `tests/fdtd-gpu.test.js` 7.1 s, 13 tests passed)
- `Show the WebGPU adapter`: `{"description":"llvmpipe (LLVM 20.1.2, 256 bits)","vendor":"65541","architecture":"","fallback":true}`

Reproduce with `REQUIRE_GPU=1 npm run test:heavy -- --suite gpu` (needs Deno; see "Suite `gpu`" in [CONTRIBUTING.md](../CONTRIBUTING.md)).

Adapter: {"description":"llvmpipe (LLVM 20.1.2, 256 bits)","vendor":"65541","architecture":"","fallback":true}. Deno 2.9.8. Relative error = root of the error energy over the energy of the CPU output; the tolerance is 0.001. A software adapter says nothing about GPU speed.

| Comparison | Steps or samples | CPU seconds | GPU seconds | Relative error |
| --- | --- | --- | --- | --- |
| long run, 20000 steps | 20000 | 0.13 | 1.60 | 0.0000666 |
| həˈloʊ at tier high | 35156 | 0.54 | 2.69 | 4.76e-7 |
| həˈloʊ at tier ultra | 35156 | 2.60 | 10.34 | 7.40e-7 |
