//! Vocal effort (issue 52): the gains the renderer takes from the `effort`
//! field of a frame, a port of the gain functions of
//! `src/articulation/effort.js`. The planner (JavaScript) realises the
//! pitch, jaw, duration and lung pressure rules; the frames carry the
//! effort `E` in dB and the tension on the tenseness.
//!
//! Parity class B: `pow` of [`crate::math`] may round differently from V8.
//! At `E = 0` every gain is exactly 1, so plain speech is untouched.

use crate::math;

/// Gain (dB) of the tilt shelf of the voiced part at `E` dB (`TILT_SHELF`).
pub const TILT_SHELF: [[f64; 2]; 5] = [
    [-20.0, -6.0],
    [-10.0, -3.0],
    [0.0, 0.0],
    [10.0, 4.5],
    [20.0, 1.0],
];

/// Decibels taken from `E` in the gain of the voiced part (`LEVEL_TRIM`).
pub const LEVEL_TRIM: [[f64; 2]; 5] = [
    [-20.0, -2.0],
    [-10.0, -1.0],
    [0.0, 0.0],
    [10.0, 2.5],
    [20.0, 5.9],
];

/// Corner (Hz) of the second-order high-pass of the tilt shelf
/// (`TILT_CORNER`).
pub const TILT_CORNER: f64 = 1000.0;

/// Value of a polyline through `points` (sorted by x) at `x` (`polyline`).
fn polyline(points: &[[f64; 2]], x: f64) -> f64 {
    if x <= points[0][0] {
        return points[0][1];
    }
    for index in 1..points.len() {
        let [x1, y1] = points[index];
        if x <= x1 {
            let [x0, y0] = points[index - 1];
            return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
        }
    }
    points[points.len() - 1][1]
}

/// The noise rule (dB): `0.5 E` above normal effort, `1.25 E` below.
fn noise_decibels(effort: f64) -> f64 {
    if effort < 0.0 {
        1.25 * effort
    } else {
        0.5 * effort
    }
}

/// The lung pressure factor `2^(E/9)`.
fn lung_pressure_factor(effort: f64) -> f64 {
    math::pow(2.0, effort / 9.0)
}

/// Factor on the turbulence sources at `effort` dB (`effortNoiseGain`).
pub fn noise_gain(effort: f64) -> f64 {
    if effort == 0.0 {
        return 1.0;
    }
    math::pow(10.0, noise_decibels(effort) / 20.0) / math::pow(lung_pressure_factor(effort), 1.5)
}

/// Factor on the burst transient at `effort` dB (`effortTransientGain`).
pub fn transient_gain(effort: f64) -> f64 {
    if effort == 0.0 {
        return 1.0;
    }
    math::pow(10.0, noise_decibels(effort) / 20.0) / math::pow(lung_pressure_factor(effort), 0.5)
}

/// Gain on the voiced part of the LF source (`effortVoicedGain`).
pub fn voiced_gain(effort: f64) -> f64 {
    if effort == 0.0 {
        return 1.0;
    }
    math::pow(10.0, (effort - polyline(&LEVEL_TRIM, effort)) / 20.0)
}

/// Factor of the tilt shelf above [`TILT_CORNER`] (`effortTiltGain`).
pub fn tilt_gain(effort: f64) -> f64 {
    if effort == 0.0 {
        1.0
    } else {
        math::pow(10.0, polyline(&TILT_SHELF, effort) / 20.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normal_effort_changes_nothing() {
        assert_eq!(noise_gain(0.0), 1.0);
        assert_eq!(transient_gain(0.0), 1.0);
        assert_eq!(voiced_gain(0.0), 1.0);
        assert_eq!(tilt_gain(0.0), 1.0);
    }

    #[test]
    fn gains_follow_the_rules() {
        // +10 dB: level 10 - 2.5 dB, shelf 4.5 dB, noise 5 dB less the
        // growth of the turbulence with the pressure.
        assert!((voiced_gain(10.0) - math::pow(10.0, 7.5 / 20.0)).abs() < 1e-12);
        assert!((tilt_gain(10.0) - math::pow(10.0, 4.5 / 20.0)).abs() < 1e-12);
        let pressure = math::pow(2.0, 10.0 / 9.0);
        let noise = math::pow(10.0, 0.25);
        assert!((noise_gain(10.0) - noise / math::pow(pressure, 1.5)).abs() < 1e-12);
        assert!((transient_gain(10.0) - noise / math::sqrt(pressure)).abs() < 1e-12);
        // Below and beyond the points the polylines hold their ends.
        assert_eq!(polyline(&TILT_SHELF, -30.0), -6.0);
        assert_eq!(polyline(&TILT_SHELF, 30.0), 1.0);
        assert!((polyline(&LEVEL_TRIM, 15.0) - 4.2).abs() < 1e-12);
    }
}
