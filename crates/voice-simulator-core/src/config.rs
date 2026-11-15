//! Layout of the renderer configuration: one `f64` array that the
//! JavaScript side fills once per renderer (issue 22). `src/engine/layout.js`
//! lists the same names in `RENDERER_CONFIG`; `tests/engine-layout.test.js`
//! compares the two files as text.
//!
//! The array has `HEADER` fixed fields, then `NOSE_AREA_COUNT` nose areas
//! (`noseShape(head).areas`), then `LISTENER_LENGTH` listener values (see
//! [`crate::listener`]). Flags are 0 or 1; seeds are `hashSeed` values.
//! The waveguide ignores the 3D fields (`FDTD_OUTPUT` to `MICROPHONE_Z`).

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
/// Fixed fields before the nose areas.
pub const HEADER: usize = 37;

/// Values of [`SOLVER`].
pub const SOLVER_WAVEGUIDE: f64 = 0.0;
/// Values of [`SOLVER`].
pub const SOLVER_FDTD3D: f64 = 1.0;
