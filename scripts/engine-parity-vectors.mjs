/** Regenerate bounded Rust regression vectors exclusively from the JS reference. */
import { mkdirSync, writeFileSync } from 'node:fs';
import { URL } from 'node:url';
import { ENGINE_FEATURES } from '../src/engine/features.js';
import { FramePlanner } from '../src/engine/rust-renderer.js';
import { VoiceRenderer } from '../src/acoustics/voice.js';
import { RENDERER_CONFIG } from '../src/engine/layout.js';
import { prepareProbe } from '../tests/helpers/engine-features.js';

const PORTED = new Set([
  'solver.fdtd2d',
  'source.folds',
  'source.tract-interaction',
  'source.subglottal',
  'mode.whisper',
]);

export function writeVectors() {
  const directory = new URL(
    '../crates/voice-simulator-core/tests/vectors/',
    import.meta.url
  );
  mkdirSync(directory, { recursive: true });
  for (const feature of ENGINE_FEATURES.filter(({ id }) => PORTED.has(id))) {
    const { plan, renderOptions } = prepareProbe(feature);
    const planner = new FramePlanner(plan, renderOptions);
    const count = Math.min(8192, planner.totalSamples);
    planner.config[RENDERER_CONFIG.TOTAL_SAMPLES] = count;
    const blocks = planner.prepare(count);
    const samples = new Float32Array(count);
    new VoiceRenderer(plan, renderOptions).render(samples);
    const arrays = [
      planner.config,
      planner.model,
      planner.frames.values.subarray(0, blocks * planner.stride),
      samples,
    ];
    const json = `[\n${arrays
      .map((array) => JSON.stringify([...array]))
      .join(',\n')}\n]\n`;
    writeFileSync(new URL(`${feature.id}.json`, directory), json);
  }
}
