//! Layout of a control frame: the numbers the JavaScript side prepares for
//! one control block of the Rust renderer (issue 22). `src/engine/layout.js`
//! lists the same names in `FRAME`; `tests/engine-layout.test.js` compares
//! the two files as text.
//!
//! A frame has `STRIDE + sections + EXTRA_VALUES` values: the fixed
//! fields below, the area of every section (cm²), then the extra values:
//! the incisor gap (cm) of the shape (`shape.teeth.gap`, 0 when TEETH is
//! 0). The waveguide reads only the areas; the 3D solver also the gap.

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
/// Flag: the shape has incisors (`shape.teeth` is not null), so the
/// extra values hold the gap between them.
pub const TEETH: usize = 15;
/// Number of extra values after the areas, always [`EXTRA_VALUES`].
pub const EXTRA: usize = 16;
/// First section area.
pub const AREAS: usize = 17;
/// Fixed fields before the areas.
pub const STRIDE: usize = 17;
/// Values after the areas: the incisor gap (cm).
pub const EXTRA_VALUES: usize = 1;

/// Values per frame for a tract of `sections` sections.
pub const fn stride(sections: usize) -> usize {
    STRIDE + sections + EXTRA_VALUES
}

/// The section areas of a frame.
pub fn areas(frame: &[f64]) -> &[f64] {
    &frame[AREAS..frame.len() - EXTRA_VALUES]
}

/// The incisor gap (cm) of a frame, `None` without incisors.
pub fn teeth_gap(frame: &[f64]) -> Option<f64> {
    if frame[TEETH] != 0.0 {
        Some(frame[frame.len() - EXTRA_VALUES])
    } else {
        None
    }
}
