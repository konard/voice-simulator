//! Statistical reductions for phone-conditioned voice refinement. Unlicense.
use crate::math;
use alloc::vec::Vec;

/// Linear interpolation between adjacent order statistics.
pub fn quantile(values: &[f64], q: f64) -> f64 {
    if values.is_empty() {
        return f64::NAN;
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    let index = q * (sorted.len() - 1) as f64;
    let lower = math::floor(index) as usize;
    sorted[lower] + (sorted[math::ceil(index) as usize] - sorted[lower]) * (index - lower as f64)
}

fn semitones(value: f64, reference: f64) -> f64 {
    12.0 * math::ln(value / reference) / core::f64::consts::LN_2
}

/// Median vowel f0 and 5th–95th percentile range after octave rejection.
pub fn vowel_pitch(values: &[f64]) -> [f64; 2] {
    let mut accepted = Vec::with_capacity(values.len());
    for &value in values {
        let running = &accepted[accepted.len().saturating_sub(101)..];
        if !running.is_empty() && semitones(value, quantile(running, 0.5)).abs() > 9.0 {
            continue;
        }
        accepted.push(value);
    }
    [
        quantile(&accepted, 0.5),
        semitones(quantile(&accepted, 0.95), quantile(&accepted, 0.05)),
    ]
}

/// Standard error from the four leave-one-fold-out parameter estimates.
pub fn jackknife_error(values: [f64; 4]) -> f64 {
    let mean = values.iter().sum::<f64>() / 4.0;
    let squared_error = values.iter().map(|value| (value - mean) * (value - mean));
    math::sqrt(0.75 * squared_error.sum::<f64>())
}

/// Absolute change relative to the parameter's supported range.
pub fn normalized_change(before: f64, after: f64, min: f64, max: f64) -> f64 {
    (after - before).abs() / (max - min)
}

/// Exponential forgetting in voiced seconds.
pub fn retained_weight(voiced_seconds: f64, half_life: f64) -> f64 {
    math::pow(2.0, -voiced_seconds / half_life)
}
