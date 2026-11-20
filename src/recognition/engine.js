/** Select scalar recognition kernels through the shared engine loader. Unlicense. */
import { createEngine, ENGINE_NAMES, getEngine } from '../engine/index.js';
import { configureNodeRecognitionModels } from './node-models.js';

const requiredExports = [
  'rec_pitch',
  'rec_pitch_decimate',
  'rec_pitch_frame',
  'rec_pitch_refine',
  'rec_pitch_mark',
  'rec_inverse_filter',
  'rec_codebook_search',
  'rec_word_search',
];

export function checkRecognitionOptions({ engine = 'auto', threads = 'auto' }) {
  if (!ENGINE_NAMES.includes(engine)) {
    throw new RangeError(`Unknown recognition engine: ${engine}`);
  }
  if (threads !== 'auto' && (!Number.isSafeInteger(threads) || threads < 1)) {
    throw new RangeError('threads must be a positive integer or auto');
  }
}

function rustUnavailable(cause) {
  const error = new Error('Rust recognition kernels are unavailable', {
    cause,
  });
  error.code = 'ENGINE_UNAVAILABLE';
  return error;
}

function kernels(loaded, { engine = 'auto', threads = 'auto' }, cause) {
  const module = loaded?.module;
  if (
    requiredExports.every(
      (name) => typeof module?.exports?.[name] === 'function'
    )
  ) {
    return {
      name: 'rust',
      threads,
      module,
      renderer:
        typeof loaded.createRenderer === 'function' ? loaded : undefined,
    };
  }
  if (engine === 'rust') {
    throw rustUnavailable(cause);
  }
  return { name: 'js', threads, module: null };
}

export async function createRecognitionEngine(
  options = {},
  load = createEngine
) {
  checkRecognitionOptions(options);
  configureNodeRecognitionModels();
  const { engine = 'auto' } = options;
  if (engine === 'js') {
    return kernels(null, options);
  }
  let loaded;
  let cause;
  try {
    loaded = await load({ engine, threads: 1, simd: false });
  } catch (error) {
    cause = error;
  }
  return kernels(loaded, options, cause);
}

export function getRecognitionEngine(options) {
  checkRecognitionOptions(options);
  configureNodeRecognitionModels();
  const { engine = 'auto' } = options;
  const loaded =
    engine === 'js' ? null : getEngine({ engine, threads: 1, simd: false });
  return kernels(loaded, options);
}
