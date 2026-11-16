## 3D solver on several threads: kernel steps

2000 bare kernel steps after the first 480 samples of "Hello." (seed 1), median of 3 runs, Node.js v26.13.0, linux x64, 6 logical cores. Speed-up = steps per second on n threads / on 1 thread. Native = `voice-simulator-cli kernel-steps`; WebAssembly = src/engine/voice-simulator-threads.wasm (1 thread: the same file without helpers). Rule: THREAD_MIN_LINKS = links of the smallest grid where 2 threads are at least 1.3× faster than 1, on both platforms; else `usize::MAX`.

### Native

| Grid | Links | Steps/s 1 | 2 | 3 | 4 | Speed-up 2 | 3 | 4 | Same field |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dx 1 | 1,634 | 194042.9 | 142116.1 | 18482.6 | 9751.5 | 0.73× | 0.10× | 0.05× | yes |
| dx 0.5 | 12,270 | 28309.0 | 13784.5 | 10399.0 | 2259.3 | 0.49× | 0.37× | 0.08× | yes |
| dx 0.4 | 23,964 | 10520.1 | 8874.4 | 8549.8 | 2394.8 | 0.84× | 0.81× | 0.23× | yes |
| dx 1, 40 cm box | 173,501 | 1453.4 | 699.5 | 353.9 | 344.5 | 0.48× | 0.24× | 0.24× | yes |
| dx 0.5, 40 cm box | 1,409,887 | 143.0 | 106.0 | 148.8 | 80.9 | 0.74× | 1.04× | 0.57× | yes |

### WebAssembly

| Grid | Links | Steps/s 1 | 2 | 3 | 4 | Speed-up 2 | 3 | 4 | Same field |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| dx 1 | 1,634 | 122308.2 | 38324.3 | 60333.3 | 32598.6 | 0.31× | 0.49× | 0.27× | yes |
| dx 0.5 | 12,270 | 19436.0 | 14338.4 | 13827.2 | 10394.2 | 0.74× | 0.71× | 0.53× | yes |
| dx 0.4 | 23,964 | 8793.9 | 5859.2 | 5198.1 | 2908.0 | 0.67× | 0.59× | 0.33× | yes |
| dx 1, 40 cm box | 173,501 | 1068.4 | 1089.2 | 822.3 | 836.5 | 1.02× | 0.77× | 0.78× | yes |
| dx 0.5, 40 cm box | 1,409,887 | 98.7 | 114.6 | 115.0 | 101.0 | 1.16× | 1.17× | 1.02× | yes |

The rule gives THREAD_MIN_LINKS = `usize::MAX` (native `usize::MAX`, WebAssembly `usize::MAX`); parallel.rs has 100,000: DIFFERENT.

parallel.rs had 100,000 during this run; it was then set to the value of the rule, `usize::MAX`, so a run now reports "the same".
