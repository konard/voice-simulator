//! Layout of a control frame: the numbers the JavaScript side prepares for
//! one control block of the Rust renderer (issue 22). `src/engine/layout.js`
//! lists the same names in `FRAME`; `tests/engine-layout.test.js` compares
//! the two files as text.
//!
//! A frame has `STRIDE + sections` values: the fixed fields below, then
//! the area of every section (cm²).

/// Tract length (cm).
pub const LENGTH: usize = 0;
/// Area of the velopharyngeal port (cm²).
pub const VELUM_AREA: usize = 1;
/// Section of the velum junction.
pub const VELUM_INDEX: usize = 2;
/// Section of the narrowest constriction, the turbulence source.
pub const FRICATION_INDEX: usize = 3;
/// Junction where the noise enters (`frication.position`).
pub const FRICATION_POSITION: usize = 4;
/// Area of the constriction (cm²).
pub const FRICATION_AREA: usize = 5;
/// Gain of the frication noise (`frication.gain`).
pub const FRICATION_GAIN: usize = 6;
/// Sibilance (0..1) of the frication.
pub const FRICATION_SIBILANCE: usize = 7;
/// Obstacle (teeth) downstream of the jet (0 or 1).
pub const FRICATION_OBSTACLE: usize = 8;
/// Fundamental frequency (Hz).
pub const F0: usize = 9;
/// Voicing (0..1).
pub const VOICING: usize = 10;
/// Aspiration (0..1).
pub const ASPIRATION: usize = 11;
/// Glottal closure (0..1).
pub const CLOSURE: usize = 12;
/// Loudness (0..1).
pub const LOUDNESS: usize = 13;
/// Lung pressure (Pa): `state.lungPressure ?? head.lungPressure`. The
/// issue reserves fields 14 and 15; this one carries the respiratory drive.
pub const LUNG_PRESSURE: usize = 14;
/// Reserved, zero.
pub const RESERVED: usize = 15;
/// First section area.
pub const AREAS: usize = 16;
/// Fixed fields before the areas.
pub const STRIDE: usize = 16;

/// Values per frame for a tract of `sections` sections.
pub const fn stride(sections: usize) -> usize {
    STRIDE + sections
}
