//! Air flow and turbulence noise sources: port of
//! `src/acoustics/aerodynamics.js` and of `strouhalFrequency` of
//! `src/acoustics/voice.js` (issue 35).
//!
//! The lungs push air through two orifices in series: the glottis (area
//! A_g) and the narrowest place of the mouth (A_c, plus the velopharyngeal
//! port). The pressure in the mouth P_o splits the lung pressure P_L between
//! them; the walls and the air behind the constriction are a compliance, so
//! P_o follows its steady target with a lag. Turbulent air makes noise with
//! a strength that grows as dp^1.5 A^0.5 (Stevens 1971), above a critical
//! Reynolds number.
//!
//! All quantities are cgs: areas cm², flow cm³/s, pressure dyn/cm².
//!
//! Parity: every function is class A (only `+ - * /` and `sqrt`, in the
//! order of the JavaScript code), [`Aerodynamics::step`] included: its lag
//! uses [`lag_factor`] instead of `exp`.

use crate::math;

/// Density of air (g/cm³), `AIR_DENSITY` of `src/acoustics/transfer.js`.
pub const AIR_DENSITY: f64 = 0.00114;

/// Compliance of the walls and the air behind a constriction (cm⁵/dyn).
pub const ORAL_COMPLIANCE: f64 = 1e-3;

/// Kinematic viscosity of air (cm²/s).
pub const VISCOSITY: f64 = 0.15;

/// Reynolds number above which the jet becomes turbulent.
pub const RE_CRITICAL: f64 = 1800.0;

/// Mean glottal area of modal voicing (cm²).
pub const GLOTTIS_VOICED: f64 = 0.05;

/// Glottal area of an open glottis: \[h\], voiceless obstruents (cm²).
pub const GLOTTIS_OPEN: f64 = 0.25;

/// Extra mean glottal area of a fully breathy voice (cm²).
pub const GLOTTIS_BREATHY: f64 = 0.1;

/// Reference lung pressure of the relative strengths (dyn/cm²).
pub const REFERENCE_LUNG_PRESSURE: f64 = 8000.0;
/// Reference glottal area of the relative strengths (cm²).
pub const REFERENCE_GLOTTIS: f64 = 0.25;
/// Reference constriction area of the relative strengths (cm²).
pub const REFERENCE_CONSTRICTION: f64 = 0.09;

/// Strouhal number of the jet, `STROUHAL` of `src/acoustics/voice.js`.
pub const STROUHAL: f64 = 0.2;

/// Frequency range of the noise band-pass (Hz).
pub const STROUHAL_RANGE: [f64; 2] = [500.0, 6000.0];

/// `Math.min` of two finite numbers.
#[inline]
fn min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else {
        b
    }
}

/// `Math.max` of two finite numbers.
#[inline]
fn max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else {
        b
    }
}

/// `value > 0` of JavaScript, false for NaN as well.
#[inline]
fn positive(value: f64) -> bool {
    value > 0.0
}

/// Reynolds number of a jet of flow `flow` (cm³/s) through `area` (cm²),
/// with the diameter of a circle of that area.
pub fn reynolds(flow: f64, area: f64) -> f64 {
    if !positive(area) {
        return 0.0;
    }
    ((flow / area) * math::sqrt((4.0 * area) / core::f64::consts::PI)) / VISCOSITY
}

/// Strength of the turbulence noise of a pressure drop `dp` (dyn/cm²)
/// across an orifice of `area` (cm²) carrying `flow` (cm³/s):
/// dp^1.5 A^0.5, gated by the Reynolds number between [`RE_CRITICAL`] and
/// twice that.
pub fn source_strength(dp: f64, area: f64, flow: f64) -> f64 {
    source_strength_at(dp, area, flow, RE_CRITICAL)
}

/// [`source_strength`] with the critical Reynolds number `re_critical`
/// (`head.reCritical`).
pub fn source_strength_at(dp: f64, area: f64, flow: f64, re_critical: f64) -> f64 {
    if !positive(dp) || !positive(area) {
        return 0.0;
    }
    let gate = min(
        1.0,
        max(0.0, (reynolds(flow, area) - re_critical) / re_critical),
    );
    if gate == 0.0 {
        return 0.0;
    }
    gate * dp * math::sqrt(dp) * math::sqrt(area)
}

/// Steady state of the two orifices: (mouth pressure, flow).
pub fn steady_flow(lung_pressure: f64, glottal_area: f64, constriction_area: f64) -> (f64, f64) {
    let g2 = glottal_area * glottal_area;
    let c2 = constriction_area * constriction_area;
    let oral_pressure = if g2 + c2 > 0.0 {
        (lung_pressure * g2) / (g2 + c2)
    } else {
        0.0
    };
    let flow = constriction_area * math::sqrt((2.0 * oral_pressure) / AIR_DENSITY);
    (oral_pressure, flow)
}

/// Strength at the constriction of a default voiceless fricative: the unit
/// of the relative frication strength.
pub fn frication_reference() -> f64 {
    let (oral_pressure, flow) = steady_flow(
        REFERENCE_LUNG_PRESSURE,
        REFERENCE_GLOTTIS,
        REFERENCE_CONSTRICTION,
    );
    source_strength(oral_pressure, REFERENCE_CONSTRICTION, flow)
}

/// Strength at an open glottis under an open tract: the unit of the
/// relative aspiration strength.
pub fn aspiration_reference() -> f64 {
    source_strength(
        REFERENCE_LUNG_PRESSURE,
        REFERENCE_GLOTTIS,
        REFERENCE_GLOTTIS * math::sqrt((2.0 * REFERENCE_LUNG_PRESSURE) / AIR_DENSITY),
    )
}

/// Relative aspiration strength of a glottis of `glottal_area` (cm²) under
/// an open tract at `lung_pressure` (dyn/cm²).
pub fn open_tract_strength(lung_pressure: f64, glottal_area: f64) -> f64 {
    open_tract_strength_at(lung_pressure, glottal_area, RE_CRITICAL)
}

/// [`open_tract_strength`] with the critical Reynolds number
/// `re_critical`.
pub fn open_tract_strength_at(lung_pressure: f64, glottal_area: f64, re_critical: f64) -> f64 {
    let flow = glottal_area * math::sqrt((2.0 * lung_pressure) / AIR_DENSITY);
    source_strength_at(lung_pressure, glottal_area, flow, re_critical) / aspiration_reference()
}

/// The glottal areas of a head (cm²): modal voicing, an open glottis and
/// the extra area of a breathy voice (`head.glottisVoiced`,
/// `head.glottisOpen` and `head.glottisBreathy`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlottalAreas {
    /// Mean glottal area of modal voicing.
    pub voiced: f64,
    /// Glottal area of an open glottis.
    pub open: f64,
    /// Extra mean glottal area of a fully breathy voice.
    pub breathy: f64,
}

impl Default for GlottalAreas {
    fn default() -> Self {
        Self {
            voiced: GLOTTIS_VOICED,
            open: GLOTTIS_OPEN,
            breathy: GLOTTIS_BREATHY,
        }
    }
}

/// Mean glottal area (cm²) of the LF source for the control channels
/// `voicing`, `aspiration` and `closure`, the head `breathiness` (0 to 1)
/// and the glottal `chink` (mm²).
pub fn glottal_area(
    voicing: f64,
    aspiration: f64,
    closure: f64,
    breathiness: f64,
    chink: f64,
) -> f64 {
    glottal_area_of(
        voicing,
        aspiration,
        closure,
        breathiness,
        chink,
        &GlottalAreas::default(),
    )
}

/// [`glottal_area`] with the glottal `areas` of a head.
pub fn glottal_area_of(
    voicing: f64,
    aspiration: f64,
    closure: f64,
    breathiness: f64,
    chink: f64,
    areas: &GlottalAreas,
) -> f64 {
    let voicing = max(0.0, voicing);
    let aspiration = max(0.0, aspiration);
    let closure = min(1.0, max(0.0, closure));
    (areas.voiced * voicing + areas.open * aspiration + areas.breathy * breathiness * voicing)
        * (1.0 - closure)
        + max(0.0, chink) / 100.0
}

/// Peak frequency (Hz) of the turbulence noise of a jet of `flow` (cm³/s)
/// through `area` (cm²), clamped to [`STROUHAL_RANGE`].
pub fn strouhal_frequency(flow: f64, area: f64) -> f64 {
    strouhal_frequency_at(flow, area, STROUHAL)
}

/// [`strouhal_frequency`] with the Strouhal number `strouhal`
/// (`head.strouhal`).
pub fn strouhal_frequency_at(flow: f64, area: f64, strouhal: f64) -> f64 {
    if !positive(area) {
        return STROUHAL_RANGE[0];
    }
    let frequency = (strouhal * (flow / area)) / math::sqrt((4.0 * area) / core::f64::consts::PI);
    min(STROUHAL_RANGE[1], max(STROUHAL_RANGE[0], frequency))
}

/// 1 - exp(-x) of a first-order lag over `x` time constants, with exp(-x)
/// replaced by 1 / (1 + x + x²/2 + x³/6), `lagFactor` of the JavaScript
/// code: between 0 and 1 for every x >= 0 and bit-identical everywhere.
pub fn lag_factor(x: f64) -> f64 {
    1.0 - 1.0 / (1.0 + x * (1.0 + x * (0.5 + x / 6.0)))
}

/// One step of [`Aerodynamics::step`].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AirflowState {
    /// Flow through the constriction (cm³/s).
    pub flow: f64,
    /// Change of the flow per second (cm³/s²).
    pub flow_derivative: f64,
    /// Pressure in the mouth P_o (dyn/cm²).
    pub oral_pressure: f64,
    /// Pressure drop across the glottis (dyn/cm²).
    pub glottal_drop: f64,
    /// Pressure drop across the constriction (dyn/cm²).
    pub constriction_drop: f64,
}

/// Mouth pressure that follows the steady state of the two orifices with
/// the lag of the oral compliance.
#[derive(Clone, Debug)]
pub struct Aerodynamics {
    /// Compliance (cm⁵/dyn).
    pub compliance: f64,
    /// Pressure in the mouth (dyn/cm²).
    pub oral_pressure: f64,
    /// Flow of the last step (cm³/s).
    pub flow: f64,
}

impl Default for Aerodynamics {
    fn default() -> Self {
        Self::new(ORAL_COMPLIANCE)
    }
}

impl Aerodynamics {
    /// A state at rest with the given compliance.
    pub fn new(compliance: f64) -> Self {
        Self {
            compliance,
            oral_pressure: 0.0,
            flow: 0.0,
        }
    }

    /// Back to rest.
    pub fn reset(&mut self) {
        self.oral_pressure = 0.0;
        self.flow = 0.0;
    }

    /// Advance by `dt` seconds with constant inputs: lung pressure P_L
    /// (dyn/cm²), glottal area A_g and constriction area A_c (cm²).
    pub fn step(
        &mut self,
        dt: f64,
        lung_pressure: f64,
        glottal_area: f64,
        constriction_area: f64,
    ) -> AirflowState {
        let lung = max(0.0, lung_pressure);
        let glottis = max(0.0, glottal_area);
        let constriction = max(0.0, constriction_area);
        let total = glottis + constriction;
        if total > 0.0 {
            let g2 = glottis * glottis;
            let target = (lung * g2) / (g2 + constriction * constriction);
            let tau = (self.compliance * math::sqrt((AIR_DENSITY * lung) / 2.0)) / total;
            self.oral_pressure += if tau > 0.0 {
                (target - self.oral_pressure) * lag_factor(dt / tau)
            } else {
                target - self.oral_pressure
            };
        }
        let flow = constriction * math::sqrt((2.0 * max(0.0, self.oral_pressure)) / AIR_DENSITY);
        let flow_derivative = if dt > 0.0 {
            (flow - self.flow) / dt
        } else {
            0.0
        };
        self.flow = flow;
        AirflowState {
            flow,
            flow_derivative,
            oral_pressure: self.oral_pressure,
            glottal_drop: lung - self.oral_pressure,
            constriction_drop: self.oral_pressure,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strength_is_gated_by_reynolds() {
        // A slow jet stays laminar: no noise.
        assert_eq!(source_strength(100.0, 0.1, 1.0), 0.0);
        assert_eq!(source_strength(0.0, 0.1, 500.0), 0.0);
        assert!(source_strength(7000.0, 0.09, 316.0) > 0.0);
    }

    #[test]
    fn references_are_unity() {
        let (oral, flow) = steady_flow(8000.0, 0.25, 0.09);
        assert_eq!(
            source_strength(oral, 0.09, flow) / frication_reference(),
            1.0
        );
        assert_eq!(open_tract_strength(8000.0, 0.25), 1.0);
    }

    #[test]
    fn steady_state_is_reached() {
        let mut air = Aerodynamics::default();
        let mut state = air.step(1.0 / 48000.0, 8000.0, 0.25, 0.09);
        for _ in 0..4800 {
            state = air.step(1.0 / 48000.0, 8000.0, 0.25, 0.09);
        }
        let (oral, flow) = steady_flow(8000.0, 0.25, 0.09);
        assert!((state.oral_pressure - oral).abs() < 1e-6 * oral);
        assert!((state.flow - flow).abs() < 1e-6 * flow);
        assert_eq!(state.glottal_drop + state.constriction_drop, 8000.0);
    }

    #[test]
    fn lag_factor_stays_in_range() {
        assert_eq!(lag_factor(0.0), 0.0);
        assert!((lag_factor(0.1) - (1.0 - math::exp(-0.1))).abs() < 5e-6);
        assert!(lag_factor(1e6) <= 1.0 && lag_factor(1e6) > 0.999);
    }

    #[test]
    fn strouhal_is_clamped() {
        assert_eq!(strouhal_frequency(0.0, 0.0), 500.0);
        assert_eq!(strouhal_frequency(1e6, 0.01), 6000.0);
        let frequency = strouhal_frequency(316.0, 0.09);
        assert!(frequency > 500.0 && frequency < 6000.0);
    }

    #[test]
    fn glottal_area_adds_the_chink() {
        assert_eq!(glottal_area(0.0, 0.0, 1.0, 0.2, 10.0), 0.1);
        assert_eq!(glottal_area(0.0, 1.0, 0.0, 0.2, 0.0), 0.25);
    }
}
