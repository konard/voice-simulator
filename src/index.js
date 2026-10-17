/**
 * voice-simulator: physical 3D voice simulation.
 *
 * text -> IPA (g2p) -> articulator trajectories (articulation) -> vocal
 * tract shape of a parametric head -> acoustic wave solver (1D waveguide or
 * 3D FDTD through the voxelised head) -> audio.
 */

export {
  synthesize,
  synthesizeStream,
  prepareUtterance,
  getAudioTier,
} from './synthesize.js';
export {
  textToIpa,
  detectLanguage,
  scriptLanguage,
  LANGUAGES,
} from './g2p/index.js';
export { parseIpa, formatIpa } from './ipa/parse.js';
export {
  getPhoneme,
  listSymbols,
  VOWELS,
  CONSONANTS,
} from './ipa/inventory.js';
export { planUtterance, CONTROL_RATE, CHANNELS } from './articulation/plan.js';
export {
  sampleState,
  tractShape,
  noseShape,
  TRACT_SECTIONS,
} from './articulation/tract-shape.js';
export {
  HEAD_PARAMETERS,
  DEFAULT_HEAD,
  normalizeHeadConfig,
  randomHeadConfig,
  encodeHeadConfig,
  decodeHeadConfig,
  getHeadParameter,
} from './head-config.js';
export { createRandom, createSeed, hashSeed } from './random.js';
export {
  VoiceRenderer,
  renderPlan,
  registerSolver,
} from './acoustics/voice.js';
export { Waveguide } from './acoustics/waveguide.js';
export { Fdtd3d } from './acoustics/fdtd3d.js';
export { buildVoxelModel } from './acoustics/voxel-model.js';
export { Glottis } from './acoustics/glottis.js';
export { tubeFormants, tubeSpectrum } from './acoustics/transfer.js';
export {
  estimateFormants,
  estimatePitch,
  rms,
  spectralPeaks,
} from './acoustics/analysis.js';
export { encodeWav, decodeWav, wavHeader } from './audio/wav.js';
export {
  headLandmarks,
  tractCenterline,
  nasalCenterline,
} from './geometry/centerline.js';
export {
  MESH_LODS,
  headMesh,
  tubeMesh,
  updateTubeMesh,
  lipsMesh,
  deformJaw,
  meshesToObj,
} from './geometry/mesh.js';
export { headModel, headModelObj } from './geometry/model.js';
export {
  AUDIO_TIERS,
  VISUAL_TIERS,
  LodGovernor,
  OverloadDetector,
  chooseTier,
  fallbackLevel,
} from './perf/lod.js';
export { measureAudioTier, benchmarkAudioTiers } from './perf/benchmark.js';
