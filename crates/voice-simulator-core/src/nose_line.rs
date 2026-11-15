//! The nasal tract of the 1D waveguide: a port of the radiating
//! `NoseLine` of `src/acoustics/nose-line.js` (the closed variant, a blind
//! pouch, is used only by the 2D sheet and is not ported).
//!
//! Section 0 is the velopharyngeal port; the far end radiates through
//! [`Radiation`]. The owner reads `left[0]` and writes `junction_right[0]`.
//! Parity class A: `sqrt`, the four basic operations and `pow`, whose
//! fdlibm algorithm `libm` and V8 share.

use alloc::vec;
use alloc::vec::Vec;

use crate::math::{self, max, min};
use crate::radiation::Radiation;

/// Smallest area of a section (cm²).
pub const MIN_AREA: f64 = 1e-4;

/// Attenuation of a reference section of `area` cm² with the wall loss
/// scale `wall` (`lossFactor`).
pub fn loss_factor(area: f64, wall: f64) -> f64 {
    let boundary = 0.0004 / math::sqrt(max(area, 0.05));
    let constriction = min(0.3, 0.0001 / math::pow(max(area, 1e-3), 2.0));
    1.0 - 0.0007 * wall - boundary * wall - constriction
}

/// A radiating Kelly-Lochbaum line (`NoseLine`).
#[derive(Clone, Debug)]
pub struct NoseLine {
    /// Number of sections.
    pub n: usize,
    /// Scale of the wall losses.
    pub wall_loss: f64,
    /// Exponent that turns the loss factor into a section's attenuation.
    pub loss_exponent: f64,
    /// Filter at the nostrils.
    pub radiation: Radiation,
    /// Waves travelling away from the port.
    pub right: Vec<f64>,
    /// Waves travelling towards the port.
    pub left: Vec<f64>,
    /// Waves leaving each junction to the right.
    pub junction_right: Vec<f64>,
    /// Waves leaving each junction to the left.
    pub junction_left: Vec<f64>,
    /// Section areas (cm²); section 0 is the port.
    pub areas: Vec<f64>,
    /// Profile from [`NoseLine::set_profile`].
    pub profile: Vec<f64>,
    /// Reflection coefficients of the junctions.
    pub reflection: Vec<f64>,
    /// Attenuation per section.
    pub damping: Vec<f64>,
    /// Area of the port (cm²).
    pub port_area: f64,
    /// Step rate (steps per second).
    pub rate: f64,
    /// Volume velocity leaving the nostrils at the last step.
    pub output: f64,
}

impl NoseLine {
    /// `new NoseLine({sections, wallLoss, lossExponent})`.
    pub fn new(sections: usize, wall_loss: f64, loss_exponent: f64) -> Self {
        let n = sections.max(2);
        let mut line = Self {
            n,
            wall_loss,
            loss_exponent,
            radiation: Radiation::new(),
            right: vec![0.0; n],
            left: vec![0.0; n],
            junction_right: vec![0.0; n + 1],
            junction_left: vec![0.0; n + 1],
            areas: vec![1.0; n],
            profile: vec![1.0; n],
            reflection: vec![0.0; n + 1],
            damping: Vec::new(),
            port_area: 0.0,
            rate: 1.0,
            output: 0.0,
        };
        let loss = line.loss(1.0);
        line.damping = vec![loss; n];
        line.set_port(0.0);
        line
    }

    fn loss(&self, area: f64) -> f64 {
        math::pow(
            max(0.0, loss_factor(area, self.wall_loss)),
            self.loss_exponent,
        )
    }

    /// Cross-sections along the line, resampled to the sections; section
    /// 0 takes the port area instead (`setProfile`).
    pub fn set_profile(&mut self, areas: &[f64]) {
        let n = self.n;
        let Some(last) = areas.len().checked_sub(1) else {
            return;
        };
        for (index, profile) in self.profile.iter_mut().enumerate() {
            let position = (index as f64 / (n - 1) as f64) * last as f64;
            let lower = math::floor(position);
            let upper = min(last as f64, lower + 1.0);
            let fraction = position - lower;
            let area = areas[lower as usize] * (1.0 - fraction) + areas[upper as usize] * fraction;
            *profile = max(MIN_AREA, area);
        }
        for index in 1..n {
            let area = self.profile[index];
            self.areas[index] = area;
            self.damping[index] = self.loss(area);
        }
        for index in 2..n {
            let a = self.areas[index - 1];
            let b = self.areas[index];
            self.reflection[index] = (a - b) / (a + b);
        }
        self.set_port(self.port_area);
        self.configure(self.rate);
    }

    /// Area of the port, section 0 (`setPort`).
    pub fn set_port(&mut self, area: f64) {
        self.port_area = max(0.0, area);
        let port = max(MIN_AREA, self.port_area);
        self.areas[0] = port;
        self.damping[0] = self.loss(port);
        let next = self.areas[1];
        self.reflection[1] = (port - next) / (port + next);
    }

    /// Step rate for the radiation filter at the far end (`configure`).
    pub fn configure(&mut self, rate: f64) {
        self.rate = rate;
        self.radiation.configure(self.areas[self.n - 1], rate);
    }

    /// Scatter at the internal junctions and the far end.
    #[inline]
    pub fn scatter(&mut self) {
        for index in 1..self.n {
            let incoming_right = self.right[index - 1];
            let incoming_left = self.left[index];
            let w = self.reflection[index] * (incoming_right - incoming_left);
            self.junction_right[index] = incoming_right + w;
            self.junction_left[index] = incoming_left + w;
        }
        let last = self.n - 1;
        let reflected = self.radiation.process(self.right[last]);
        self.junction_left[self.n] = reflected;
        self.output = (self.right[last] - reflected) * self.areas[last];
    }

    /// Move the waves one section on.
    #[inline]
    pub fn propagate(&mut self) {
        for index in 0..self.n {
            self.right[index] = self.junction_right[index] * self.damping[index];
            self.left[index] = self.junction_left[index + 1] * self.damping[index];
        }
    }

    /// Pressure per section into `target`; returns the number written.
    pub fn pressure(&self, target: &mut [f64]) -> usize {
        let count = self.n.min(target.len());
        for (index, value) in target.iter_mut().take(count).enumerate() {
            *value = self.right[index] + self.left[index];
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn loss_matches_javascript() {
        // Printed by Node.js: lossFactor(3, 1), lossFactor(0.01, 2).
        assert_eq!(loss_factor(3.0, 1.0), 0.999057948781213);
        assert_eq!(loss_factor(0.01, 2.0), 0.6950222912360005);
    }

    #[test]
    fn profile_sets_reflections() {
        let mut line = NoseLine::new(6, 1.0, 1.0);
        line.set_profile(&[1.0, 2.0]);
        assert_eq!(line.areas[5], 2.0);
        // Widening: a negative reflection.
        assert!(line.reflection[2] < 0.0);
        line.set_port(0.5);
        assert_eq!(line.areas[0], 0.5);
    }
}
