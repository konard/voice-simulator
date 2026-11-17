//! Layout of the renderer configuration: one `f64` array that the
//! JavaScript side fills once per renderer (issue 22). `src/engine/layout.js`
//! lists the same names in `RENDERER_CONFIG`; `tests/engine-layout.test.js`
//! compares the two files as text.
//!
//! The array has `HEADER` fixed fields, then `NOSE_AREA_COUNT` nose areas
//! (`noseShape(head).areas`), then `LISTENER_LENGTH` listener values (see
//! [`crate::listener`]). Flags are 0 or 1; seeds are `hashSeed` values.
//! The waveguide ignores the 3D fields (`FDTD_OUTPUT` to `MICROPHONE_Z`
//! and `LENGTH_SCALE`).

/// Output sample rate (Hz).
pub const SAMPLE_RATE: usize = 0;
/// Sections of the oral tract.
pub const SECTIONS: usize = 1;
/// Sections of the nasal tract.
pub const NOSE_SECTIONS: usize = 2;
/// Control interval in output samples.
pub const BLOCK_SIZE: usize = 3;
/// Samples of the whole render, the listener's tail included.
pub const TOTAL_SAMPLES: usize = 4;
/// `hashSeed('<seed>:glottis')`.
pub const GLOTTIS_SEED: usize = 5;
/// `hashSeed('<seed>:noise')`.
pub const NOISE_SEED: usize = 6;
/// `head.tenseness`.
pub const TENSENESS: usize = 7;
/// `head.breathiness`.
pub const BREATHINESS: usize = 8;
/// `head.jitter` (%).
pub const JITTER: usize = 9;
/// `head.shimmer` (%).
pub const SHIMMER: usize = 10;
/// `head.aspirationLevel`.
pub const ASPIRATION_LEVEL: usize = 11;
/// `head.glottalChink` (mm²).
pub const GLOTTAL_CHINK: usize = 12;
/// `head.lungPressure` (Pa).
pub const LUNG_PRESSURE: usize = 13;
/// `head.vocalTractLength` (cm).
pub const VOCAL_TRACT_LENGTH: usize = 14;
/// `head.fricationLevel`.
pub const FRICATION_LEVEL: usize = 15;
/// `head.outputGain`.
pub const OUTPUT_GAIN: usize = 16;
/// `head.wallLoss`.
pub const WALL_LOSS: usize = 17;
/// `head.nasalLoss`.
pub const NASAL_LOSS: usize = 18;
/// `head.pharynxWidth` (the piriform area below already includes it).
pub const PHARYNX_WIDTH: usize = 19;
/// Flag: the piriform fossae are simulated.
pub const PIRIFORM: usize = 20;
/// Flag: the incisors are carved (used by the JavaScript tract shape).
pub const TEETH: usize = 21;
/// Band limit of the output stage (Hz); 0 for none.
pub const BAND_LIMIT: usize = 22;
/// Junction section of the piriform branch.
pub const PIRIFORM_INDEX: usize = 23;
/// Opening of the piriform branch (cm²).
pub const PIRIFORM_AREA: usize = 24;
/// Sections of the piriform branch; 0 without it.
pub const PIRIFORM_SECTIONS: usize = 25;
/// Number of nose areas after the header.
pub const NOSE_AREA_COUNT: usize = 26;
/// Number of listener values after the nose areas.
pub const LISTENER_LENGTH: usize = 27;
/// `head.wallMass` (g/cm²).
pub const WALL_MASS: usize = 28;
/// `head.wallResistance` (g/(cm² s)).
pub const WALL_RESISTANCE: usize = 29;
/// `head.wallStiffness` (g/(cm² s²)).
pub const WALL_STIFFNESS: usize = 30;
/// Acoustic solver: 0 the 1D waveguide, 1 the 3D FDTD solver (which reads
/// the packed voxel model, see [`crate::fdtd::model`]).
pub const SOLVER: usize = 31;
/// 3D solver output: 0 the volume flow out of the lips and nostrils, 1 the
/// pressure at the receiver cell.
pub const FDTD_OUTPUT: usize = 32;
/// Flag: the 3D solver gives the free-air shell the spherical boundary.
pub const FDTD_SPHERICAL: usize = 33;
/// Point the 3D receiver cell is the closest free-air cell to (cm), x.
pub const MICROPHONE_X: usize = 34;
/// Same, y.
pub const MICROPHONE_Y: usize = 35;
/// Same, z.
pub const MICROPHONE_Z: usize = 36;
/// Gain of the breath noise of a breathy voice (`head.breathGain`).
pub const BREATH_GAIN: usize = 37;
/// Exponent of the breathiness in the breath noise (`head.breathExponent`).
pub const BREATH_EXPONENT: usize = 38;
/// Change of the LF Rd per unit of breathiness (`head.breathinessRd`).
pub const BREATHINESS_RD: usize = 39;
/// Noise of the glottal chink (`head.chinkNoise`).
pub const CHINK_NOISE: usize = 40;
/// Compliance behind a constriction, cm⁵/dyn (`head.oralCompliance`).
pub const ORAL_COMPLIANCE: usize = 41;
/// Reynolds number where turbulence starts (`head.reCritical`).
pub const RE_CRITICAL: usize = 42;
/// Mean glottal area of modal voicing, cm² (`head.glottisVoiced`).
pub const GLOTTIS_VOICED: usize = 43;
/// Glottal area of an open glottis, cm² (`head.glottisOpen`).
pub const GLOTTIS_OPEN: usize = 44;
/// Extra glottal area of a breathy voice, cm² (`head.glottisBreathy`).
pub const GLOTTIS_BREATHY: usize = 45;
/// Wall source against the obstacle source (`head.wallSource`).
pub const WALL_SOURCE: usize = 46;
/// Strouhal number of the jet (`head.strouhal`).
pub const STROUHAL: usize = 47;
/// Amplitude of the frication noise (`head.fricationGain`).
pub const FRICATION_GAIN: usize = 48;
/// Gain of the burst transient (`head.transientGain`).
pub const TRANSIENT_GAIN: usize = 49;
/// Boundary-layer loss relative to a round tube (`head.lossShape`).
pub const LOSS_SHAPE: usize = 50;
/// Baffle of the lips and nostrils (`head.radiationBaffle`).
pub const RADIATION_BAFFLE: usize = 51;
/// Tract length scale of the vowel table: the 3D solver puts the source
/// plane where a shape's length over it leaves (`lengthScale` of Fdtd3d,
/// `VOWEL_LENGTH_SCALE_3D` unless the options give one).
pub const LENGTH_SCALE: usize = 52;
/// Fixed fields before the nose areas.
/// source of the source (issue 82).
pub const SOURCE: usize = 53;
/// fold length of the source (issue 82).
pub const FOLD_LENGTH: usize = 54;
/// fold mass of the source (issue 82).
pub const FOLD_MASS: usize = 55;
/// fold stiffness of the source (issue 82).
pub const FOLD_STIFFNESS: usize = 56;
/// fold damping of the source (issue 82).
pub const FOLD_DAMPING: usize = 57;
/// pressure coefficient of the source (issue 82).
pub const PRESSURE_COEFFICIENT: usize = 58;
/// interaction of the source (issue 82).
pub const INTERACTION: usize = 59;
/// subglottal of the source (issue 82).
pub const SUBGLOTTAL: usize = 60;
/// subglottal length of the source (issue 82).
pub const SUBGLOTTAL_LENGTH: usize = 61;
/// subglottal loss of the source (issue 82).
pub const SUBGLOTTAL_LOSS: usize = 62;
/// pitch of the source (issue 82).
pub const PITCH: usize = 63;
/// Fixed header length.
pub const HEADER: usize = 64;

/// Values of [`SOLVER`].
pub const SOLVER_WAVEGUIDE: f64 = 0.0;
/// Values of [`SOLVER`].
pub const SOLVER_FDTD3D: f64 = 1.0;

/// Two-dimensional FDTD sheet.
pub const SOLVER_FDTD2D: f64 = 2.0;
