/** Executable inventory of the JavaScript numerical engine (issue 82). */
const samples = Object.freeze({ kind: 'samples', maxError: 1e-4 });
const feature = (id, modules, options = {}, ipa = 'ˈasa') =>
  Object.freeze({
    id,
    modules: Object.freeze(modules),
    tolerance: samples,
    probe: Object.freeze({ ipa, options: Object.freeze(options) }),
  });

/** A new engine feature needs an entry here, a Rust id and a parity probe. */
export const ENGINE_FEATURES = Object.freeze([
  feature('solver.waveguide', [
    'src/acoustics/waveguide.js',
    'src/acoustics/constants.js',
  ]),
  feature(
    'solver.fdtd3d',
    ['src/acoustics/fdtd3d.js', 'src/acoustics/fdtd-kernel.js'],
    { solver: 'fdtd3d', dx: 3 },
    'ˈa'
  ),
  feature(
    'solver.fdtd2d',
    [
      'src/acoustics/fdtd2d.js',
      'src/acoustics/nose-line.js',
      'src/acoustics/sheet-model.js',
    ],
    { solver: 'fdtd2d', dx: 1 },
    'ˈanla'
  ),
  feature('source.lf', ['src/acoustics/glottis.js']),
  feature('source.folds', ['src/acoustics/folds.js'], { source: 'folds' }),
  feature(
    'source.tract-interaction',
    ['src/acoustics/folds.js', 'src/acoustics/subglottal.js'],
    { source: 'folds', interaction: true, subglottal: false }
  ),
  feature('source.subglottal', ['src/acoustics/subglottal.js'], {
    source: 'folds',
    interaction: true,
    subglottal: true,
  }),
  feature(
    'noise.turbulence',
    ['src/acoustics/aerodynamics.js', 'src/acoustics/voice.js'],
    {},
    'ˈapasa'
  ),
  feature('losses.frequency', ['src/acoustics/losses.js'], {
    head: { wallLoss: 1.5 },
  }),
  feature('filters.output', [
    'src/acoustics/filters.js',
    'src/acoustics/voice.js',
  ]),
  feature('radiation', ['src/acoustics/radiation.js']),
  feature('listener.microphone', ['src/acoustics/microphone.js'], {
    microphone: { distance: 30 },
  }),
  feature('listener.room', ['src/acoustics/room.js'], { room: 'studio' }, 'ˈa'),
  feature(
    'mode.whisper',
    ['src/acoustics/whisper.js', 'src/articulation/whisper.js'],
    {},
    '{W ˈasa W}'
  ),
  feature(
    'mode.phonation',
    ['src/acoustics/glottis.js', 'src/articulation/phonation.js'],
    {},
    'ˈa̤a̰a̤'
  ),
  feature('mode.effort', ['src/articulation/effort.js'], {}, '{f ˈa f}'),
  feature('articulators', ['src/articulation/tract-shape.js'], {
    head: { jawPosture: 0.2, larynxPosture: 0.1 },
  }),
  feature('tier.narrowband', ['src/perf/lod.js'], { tier: 'telephone' }),
]);

/** Host construction and analysis are deliberately outside the Rust step loop. */
export const JS_ONLY = Object.freeze(
  [
    {
      module: 'src/acoustics/fdtd-gpu.js',
      reason:
        'Browser WebGPU host and shader; explicitly outside Rust parity scope.',
    },
    {
      module: 'src/acoustics/voxel-model.js',
      reason:
        'Builds static geometry once in the JS host, packed for the Rust solver.',
    },
    {
      module: 'src/acoustics/sinuses.js',
      reason: 'Static anatomical geometry used by the host model builders.',
    },
    {
      module: 'src/acoustics/analysis.js',
      reason: 'Offline diagnostic analysis, outside the synthesis step loop.',
    },
    {
      module: 'src/acoustics/transfer.js',
      reason:
        'Offline frequency-domain analysis, outside the synthesis step loop.',
    },
  ].map(Object.freeze)
);
