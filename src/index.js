/**
 * voice-simulator: physical 3D voice simulation.
 *
 * text -> IPA (g2p) -> articulator trajectories (articulation) -> vocal
 * tract shape of a parametric head -> acoustic wave solver (1D waveguide or
 * 3D FDTD through the voxelised head) -> audio.
 */

export {
  synthesize,
  synthesizeAsync,
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
  renderPlanAsync,
  registerSolver,
} from './acoustics/voice.js';
export { Waveguide } from './acoustics/waveguide.js';
export { Fdtd3d } from './acoustics/fdtd3d.js';
export { FdtdGpu, requestGpuDevice } from './acoustics/fdtd-gpu.js';
export {
  MAX_ENCLOSURE_CELLS,
  MAX_RADIATION_RADIUS,
  buildVoxelModel,
  enclosureBounds,
  resolveEnclosure,
  voxelModelOptions,
} from './acoustics/voxel-model.js';
export {
  MICROPHONE_REFERENCE,
  createListener,
  microphoneDirection,
  microphonePosition,
  resolveMicrophone,
} from './acoustics/microphone.js';
export {
  ROOM_PRESETS,
  Room,
  resolveRoom,
  reverberationTime,
  roomImpulseResponse,
} from './acoustics/room.js';
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
  NOSE_ASPECT,
  noseAxes,
  sectionAxes,
  tractAxes,
  tubeMesh,
  updateTubeMesh,
  deformJaw,
  meshesToObj,
} from './geometry/mesh.js';
export { LIP_LODS, lipOpening, lipsMesh } from './geometry/lips.js';
export { headModel, headModelGlb, headModelObj } from './geometry/model.js';
export {
  PART_MATERIALS,
  meshesToGlb,
  parseGlb,
  vertexNormals,
} from './geometry/gltf.js';
export {
  AUDIO_TIERS,
  DEFAULT_AUDIO_TIER,
  VISUAL_TIERS,
  LodGovernor,
  OverloadDetector,
  chooseTier,
  fallbackLevel,
} from './perf/lod.js';
export { measureAudioTier, benchmarkAudioTiers } from './perf/benchmark.js';

// Audio formats (issue 5)
export { encodeAiff, decodeAiff } from './audio/aiff.js';
export { encodeAu, decodeAu, auHeader } from './audio/au.js';
export { encodeFlac, decodeFlac } from './audio/flac.js';
export {
  AUDIO_FORMATS,
  AUDIO_FORMAT_NAMES,
  audioFormat,
  audioEncoding,
  audioStreamEncoder,
  detectAudioFormat,
  decodeAudio,
  encodeAudio,
  encodeRaw,
  decodeRaw,
  formatFromFileName,
} from './audio/formats.js';
export { resample } from './audio/resample.js';

// Anatomy (issue 5): teeth, tongue, hard and soft palate, piriform fossae.
export {
  INCISOR_THICKNESS,
  REST_GAP,
  SIBILANT_GAP,
  incisorDepth,
  teethWidth,
  teethGap,
  dentition,
  carveTeeth,
} from './articulation/teeth.js';
export { arcPoint } from './geometry/centerline.js';
export {
  ANATOMY_LODS,
  jawAngle,
  jawOpenness,
  incisorEdges,
  upperTeethMesh,
  lowerTeethMesh,
  tongueMesh,
  palateMesh,
  velumMesh,
  anatomyMeshes,
  jawPose,
} from './geometry/anatomy.js';
// Anatomy from other 3D sources, switched part by part, and reference
// atlases cut like MRI slices
export {
  ANATOMY_PARTS,
  DENTAL_KEY_POINTS,
  PROCEDURAL,
  SOURCE_LOD_CELLS,
  anatomySelection,
  anatomySource,
  anatomySourceFromGlb,
  anatomySourceNames,
  anatomySourceParts,
  composeAnatomy,
  fitAnatomySource,
  registerAnatomySource,
  similarityFit,
  sourceHead,
  unregisterAnatomySource,
} from './geometry/anatomy-sources.js';
export { clusterVertices } from './geometry/decimate.js';
export { HRA, fetchHra, hraSource } from './geometry/hra.js';

// Mouths read as MRI is read, from any glTF (character heads, the Human
// Reference Atlas), and compared key point for key point.
export {
  glbJson,
  meshAccessors,
  gltfMeshes,
  readGlbMeshes,
  fetchGlbMeshes,
} from './geometry/gltf-read.js';
export {
  KEY_POINTS,
  HRA_PARTS,
  meshShells,
  classifyTeeth,
  midsagittalPoints,
  mouthKeyPoints,
  glottisPoint,
  modelKeyPoints,
  compareKeyPoints,
  referenceParts,
  referenceTeeth,
  sortedReferenceTeeth,
  referenceKeyPoints,
  sagittalLean,
  labialLean,
  incisorLean,
  modelIncisorLean,
  keyPointMeasures,
  mirrorX,
} from './geometry/reference-anatomy.js';

// Voice presets and matching (issue 5)
export {
  HEAD_PRESETS,
  HEAD_PRESET_NAMES,
  presetHeadConfig,
} from './head-config.js';
export { analyzeVoice } from './analysis/voice-features.js';
export {
  MATCH_TEXT,
  featureDistance,
  matchVoice,
  matchVoiceSteps,
} from './analysis/voice-match.js';
// Linguistics: text normalisation, accents, prosody, syllables, timeline
export { normalizeText, VERBALIZERS } from './g2p/normalize.js';
export {
  ACCENTS,
  resolveAccent,
  adaptEnglishWord,
  isNonRhotic,
} from './g2p/accents.js';
export {
  BOUNDARIES,
  CONTOURS,
  boundaryOf,
  pauseDuration,
  intonationPhrases,
} from './articulation/prosody.js';
export {
  sonority,
  syllabifyIpa,
  syllabifyTokens,
  syllableIpa,
} from './ipa/syllables.js';
export { syllableSpans, hindiAksharas } from './g2p/orthography.js';
export { utteranceTimeline, timelineAt } from './articulation/timeline.js';
// Face animation: ARKit blendshapes, VRM expressions and Oculus visemes
export {
  ARKIT_BLENDSHAPES,
  MAX_OPENING,
  OVR_VISEMES,
  VISEME_FORMATS,
  VRM_VISEMES,
  arkitBlendshapes,
  faceRig,
  ovrVisemes,
  rigFrames,
  rigWeights,
  visemeTrack,
  vowelShapes,
  vrmExpressions,
} from './animation/visemes.js';
export {
  bindRig,
  characterTrack,
  rigFrame,
  vrmVowelBinds,
} from './animation/rig-bridge.js';
