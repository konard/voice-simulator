// Bounded diagnosis of 2D parity across sources, grid sizes and nasal ports.
import { createEngine } from '../src/engine/index.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';
import { prepareUtterance } from '../src/synthesize.js';
const engine = await createEngine({ engine: 'rust', threads: 1, simd: false });
for (const dx of [1, 2]) {
  for (const ipa of ['ˈa', 'ˈana', 'ˈa{W sa W}na']) {
    for (const source of ['lf', 'folds']) {
      const { plan, renderOptions } = prepareUtterance(ipa, {
        ipa: true,
        tier: 'minimal',
        seed: 'fold-combinations',
        solver: 'fdtd2d',
        dx,
        source,
      });
      const js = new VoiceRenderer(plan, renderOptions);
      const rust = engine.createRenderer(plan, renderOptions);
      const a = new Float32Array(js.totalSamples);
      const b = new Float32Array(rust.totalSamples);
      js.render(a);
      rust.render(b);
      rust.free();
      let maximum = 0;
      let first = -1;
      let index = -1;
      for (let i = 0; i < a.length; i++) {
        const diff = Math.abs(a[i] - b[i]);
        if (diff > maximum) {
          maximum = diff;
          index = i;
        }
        if (diff > 1e-5 && first < 0) {
          first = i;
        }
      }
      console.log({ dx, ipa, source, maximum, first, index });
    }
  }
}
