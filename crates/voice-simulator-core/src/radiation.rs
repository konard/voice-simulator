//! Sound radiation from the lips and nostrils for the 1D waveguide: a port
//! of `src/acoustics/radiation.js`.
//!
//! Flanagan's piston in a baffle, R = 128 / (9 pi²) in parallel with
//! L = 8 a / (3 pi c), turned into a first-order filter by the bilinear
//! transform at the waveguide step rate. Parity class A: only `sqrt` and
//! the four basic operations, in the order of the JavaScript code.

use core::f64::consts::PI;

use crate::glottis::SPEED_OF_SOUND;
use crate::math::{self, max};

/// Radiation resistance relative to rho c / A (`RADIATION_RESISTANCE`).
pub const RADIATION_RESISTANCE: f64 = 128.0 / (9.0 * (PI * PI));

/// The reflection filter at an open end (`Radiation`).
#[derive(Clone, Debug, PartialEq)]
pub struct Radiation {
    /// Feed-forward coefficient of the incident wave.
    pub b0: f64,
    /// Feed-forward coefficient of the previous incident wave.
    pub b1: f64,
    /// Feedback coefficient of the previous reflected wave.
    pub a1: f64,
    /// Previous incident wave.
    pub input: f64,
    /// Previous reflected wave.
    pub output: f64,
}

impl Default for Radiation {
    fn default() -> Self {
        Self::new()
    }
}

impl Radiation {
    /// A full negative reflection (-1) until [`Radiation::configure`].
    pub fn new() -> Self {
        Self {
            b0: -1.0,
            b1: 0.0,
            a1: 0.0,
            input: 0.0,
            output: 0.0,
        }
    }

    /// Set the opening `area` (cm²) and the step `rate` (steps per second).
    pub fn configure(&mut self, area: f64, rate: f64) {
        let radius = math::sqrt(max(area, 0.0) / PI);
        let inertance = (8.0 * radius) / (3.0 * PI * SPEED_OF_SOUND);
        let k = 2.0 * rate * inertance;
        let r = RADIATION_RESISTANCE;
        let scale = k * (r + 1.0) + r;
        self.b0 = (k * (r - 1.0) - r) / scale;
        self.b1 = -(k * (r - 1.0) + r) / scale;
        self.a1 = -(k * (r + 1.0) - r) / scale;
    }

    /// Reflected wave for an `incident` one.
    #[inline]
    pub fn process(&mut self, incident: f64) -> f64 {
        let reflected = self.b0 * incident + self.b1 * self.input - self.a1 * self.output;
        self.input = incident;
        self.output = reflected;
        reflected
    }

    /// Clear the state.
    pub fn reset(&mut self) {
        self.input = 0.0;
        self.output = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_javascript() {
        // Printed by Node.js: RADIATION_RESISTANCE and
        // new Radiation().configure(3, 46666.666666666664).
        assert_eq!(RADIATION_RESISTANCE, 1.441012389579915);
        let mut radiation = Radiation::new();
        radiation.configure(3.0, 46_666.666_666_666_664);
        assert_eq!(radiation.b0, -0.06805459132757398);
        assert_eq!(radiation.b1, -0.35327037060097216);
        assert_eq!(radiation.a1, -0.5786750380714539);
    }

    #[test]
    fn closed_until_configured() {
        let mut radiation = Radiation::default();
        assert_eq!(radiation.process(0.5), -0.5);
        radiation.reset();
        assert_eq!(radiation.input, 0.0);
    }
}
