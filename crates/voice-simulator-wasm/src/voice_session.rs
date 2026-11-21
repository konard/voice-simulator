//! Numerical parity entry points for voice sessions. Unlicense.
use crate::{error, f64_slice};
use voice_simulator_core::voice_session;

/// Median, vowel pitch and pitch range of positive f0 samples.
#[no_mangle]
pub extern "C" fn vs_voice_session_pitch(input: u32, count: u32, out: u32) -> i32 {
    if count == 0 || count > 8192 {
        return error::BAD_ARGUMENT;
    }
    let values = match f64_slice(input, count) {
        Ok(values) => values,
        Err(code) => return code,
    };
    if values.iter().any(|x| !x.is_finite() || *x <= 0.0) {
        return error::BAD_ARGUMENT;
    }
    let median = voice_session::quantile(values, 0.5);
    let [pitch, range] = voice_session::vowel_pitch(values);
    match f64_slice(out, 3) {
        Ok(output) => output.copy_from_slice(&[median, pitch, range]),
        Err(code) => return code,
    }
    error::OK
}

/// Jackknife error of four leave-one-fold-out estimates.
#[no_mangle]
pub extern "C" fn vs_voice_session_jackknife(a: f64, b: f64, c: f64, d: f64) -> f64 {
    voice_session::jackknife_error([a, b, c, d])
}

/// Absolute change divided by the supported range.
#[no_mangle]
pub extern "C" fn vs_voice_session_change(before: f64, after: f64, min: f64, max: f64) -> f64 {
    voice_session::normalized_change(before, after, min, max)
}

/// Retained statistic weight after the given number of voiced seconds.
#[no_mangle]
pub extern "C" fn vs_voice_session_retain(voiced_seconds: f64, half_life: f64) -> f64 {
    voice_session::retained_weight(voiced_seconds, half_life)
}
