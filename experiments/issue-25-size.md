# Issue 25 size budget

Commands: `npm run example:web:build` (vite 6.4.6), then
`du -sb examples/universal-app/dist`, `ls -l examples/universal-app/dist/assets`
and `gzip -9c <file> | wc -c`. Before: origin/main af731fb. After: this branch
with af731fb merged (73eb7e3).

|                          |    before |                     after |    delta |
| ------------------------ | --------: | ------------------------: | -------: |
| `du -sb dist`            | 2,234,269 |                 2,448,103 | +213,834 |
| main bundle `index-*.js` |   387,767 |                   389,621 |   +1,854 |
| `synth-worker-*.js`      |   365,444 |                   365,184 |     -260 |
| `match-worker-*.js`      |   369,374 |                   386,658 |  +17,284 |
| `voice-simulator-*.wasm` |         - | 194,956 (gzip -9: 74,544) | +194,956 |

The JavaScript added to the main bundle is 1,854 bytes, under the limit of
20,000 bytes.
