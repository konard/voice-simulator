//! Whisper posture, noise and effort rules from `acoustics/whisper.js`.
use crate::{glottis::GlottalControl, math};

/// Unvoiced drive after oral closures and frication.
pub fn drive(control: &GlottalControl) -> f64 {
    control.whisper.clamp(0.0, 1.0)
        * control.voicing.clamp(0.0, 1.0)
        * (1.0 - control.closure.clamp(0.0, 1.0))
        * (1.0 - 0.5 * control.stop_closure.clamp(0.0, 1.0))
        * (1.0 - 0.75 * control.fricative.clamp(0.0, 1.0))
}
/// Half-open glottal posture in cm².
pub fn posture(control: &GlottalControl) -> f64 {
    drive(control) * (40.0 + (20.0 - 40.0) * (control.effort / 10.0).clamp(0.0, 1.0)) / 100.0
}
/// Gain replacing the normal effort noise rule in a whisper.
pub fn quiet(whisper: f64, effort: f64) -> f64 {
    let change = if effort == 0.0 {
        0.0
    } else {
        (if effort < 0.0 { 0.42 } else { -0.1 }) * effort
            - (if effort < 0.0 { 1.25 } else { 0.5 }) * effort
    };
    math::pow(10.0, ((-10.0 + change) * whisper.clamp(0.0, 1.0)) / 20.0)
}
/// Turbulent whisper sample, before the source's aspiration gain.
pub fn noise(control: &GlottalControl, sample: f64, strength: f64, pitch: f64) -> f64 {
    let pitch_gain = if control.f0 > 0.0 && pitch > 0.0 {
        math::pow(
            10.0,
            (0.7 * 12.0 * (math::ln(control.f0 / pitch) / math::ln(2.0))).clamp(-6.0, 6.0) / 20.0,
        )
    } else {
        1.0
    };
    let share = control.whisper.clamp(0.0, 1.0);
    sample
        * drive(control)
        * strength
        * 1.2
        * pitch_gain
        * math::pow(10.0, (6.0 * 4.0 * share * (1.0 - share)) / 20.0)
}
