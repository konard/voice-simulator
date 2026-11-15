//! Layout of the renderer configuration: one `f64` array that the
//! JavaScript side fills once per renderer (issue 22). `src/engine/layout.js`
//! lists the same names in `RENDERER_CONFIG`; `tests/engine-layout.test.js`
//! compares the two files as text.
//!
//! The array has `HEADER` fixed fields, then `NOSE_AREA_COUNT` nose areas
//! (`noseShape(head).areas`), then `LISTENER_LENGTH` listener values (see
//! [`crate::listener`]). Flags are 0 or 1; seeds are `hashSeed` values.

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
/// Fixed fields before the nose areas.
pub const HEADER: usize = 28;
