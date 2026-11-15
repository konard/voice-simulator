//! 1D digital waveguide (Kelly-Lochbaum) model of the vocal and nasal
//! tracts: a port of `src/acoustics/waveguide.js`.
//!
//! Every section is one step of delay, so the step rate is
//! sections * c / length. Waves are pressure waves; junctions use the
//! one-multiply form, the velum is a three-port junction, the piriform
//! fossae a closed side branch. Parity class B only through `exp` in the
//! glottal reflection; the step itself uses the four basic operations in
//! the order of the JavaScript code.

use alloc::vec;
use alloc::vec::Vec;

use crate::frame;
use crate::glottis::{glottal_reflection, SPEED_OF_SOUND};
use crate::math::{self, max, min};
use crate::nose_line::{loss_factor, NoseLine, MIN_AREA};
use crate::radiation::Radiation;
use crate::solver::Solver;

/// Sections over which `loss_factor` gives the attenuation of one section.
pub const LOSS_REFERENCE_SECTIONS: f64 = 44.0;
/// Combined opening of the piriform fossae (cm²).
pub const PIRIFORM_AREA: f64 = 0.5;
/// Rest length of the tract (cm).
pub const REST_LENGTH: f64 = 16.5;

/// The piriform branch of `piriformBranch(sections, 16.5, head)`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct PiriformBranch {
    /// Junction section.
    pub index: usize,
    /// Opening (cm²).
    pub area: f64,
    /// Number of sections; 0 leaves the branch out (`piriform: false`).
    pub sections: usize,
}

/// What `new Waveguide(options)` reads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct WaveguideOptions {
    /// Sections of the oral tract.
    pub sections: usize,
    /// Sections of the nasal tract.
    pub nose_sections: usize,
    /// `head.wallLoss`.
    pub wall_loss: f64,
    /// `head.nasalLoss`.
    pub nasal_loss: f64,
    /// `head.glottalChink` (mm²).
    pub glottal_chink: f64,
    /// `head.vocalTractLength` (cm).
    pub vocal_tract_length: f64,
    /// The piriform branch.
    pub piriform: PiriformBranch,
}

#[derive(Clone, Debug)]
struct Piriform {
    index: usize,
    area: f64,
    right: Vec<f64>,
    left: Vec<f64>,
    damping: f64,
    entering: f64,
}

/// The waveguide (`Waveguide` of `waveguide.js`).
#[derive(Clone, Debug)]
pub struct Waveguide {
    /// Scale of the boundary losses.
    pub wall_loss: f64,
    /// Extra boundary losses of the nose.
    pub nasal_loss: f64,
    /// Reflection at the glottis.
    pub glottal_reflection: f64,
    /// Sections of the oral tract.
    pub n: usize,
    /// Sections of the nasal tract.
    pub nose_n: usize,
    /// Exponent that turns the loss factor into a section's attenuation.
    pub loss_exponent: f64,
    /// Filter at the lips.
    pub lips: Radiation,
    right: Vec<f64>,
    left: Vec<f64>,
    junction_right: Vec<f64>,
    junction_left: Vec<f64>,
    /// Section areas (cm²).
    pub areas: Vec<f64>,
    reflection: Vec<f64>,
    damping: Vec<f64>,
    /// Nasal tract; its section 0 is the velopharyngeal port.
    pub nose: NoseLine,
    /// Area of the velopharyngeal port (cm²).
    pub velum_area: f64,
    /// Section of the velum junction.
    pub velum_index: usize,
    /// Volume velocity leaving the lips at the last step.
    pub lip_output: f64,
    piriform: Piriform,
    /// Tract length (cm).
    pub length: f64,
    /// Step rate (steps per second).
    pub rate: f64,
}

impl Waveguide {
    /// `new Waveguide(options)`.
    pub fn new(options: &WaveguideOptions) -> Self {
        let n = options.sections;
        let loss_exponent = LOSS_REFERENCE_SECTIONS / n as f64;
        let wall_loss = options.wall_loss;
        let unit = math::pow(max(0.0, loss_factor(1.0, wall_loss)), loss_exponent);
        let branch = options.piriform;
        let mut waveguide = Self {
            wall_loss,
            nasal_loss: options.nasal_loss,
            glottal_reflection: glottal_reflection(
                options.glottal_chink,
                options.vocal_tract_length,
            ),
            n,
            nose_n: options.nose_sections,
            loss_exponent,
            lips: Radiation::new(),
            right: vec![0.0; n],
            left: vec![0.0; n],
            junction_right: vec![0.0; n + 1],
            junction_left: vec![0.0; n + 1],
            areas: vec![1.0; n],
            reflection: vec![0.0; n + 1],
            damping: vec![unit; n],
            nose: NoseLine::new(
                options.nose_sections,
                wall_loss * options.nasal_loss,
                loss_exponent,
            ),
            velum_area: 0.0,
            velum_index: math::round_half_up(n as f64 * 0.45) as usize,
            lip_output: 0.0,
            piriform: Piriform {
                index: branch.index,
                area: branch.area,
                right: vec![0.0; branch.sections],
                left: vec![0.0; branch.sections],
                damping: 0.0,
                entering: 0.0,
            },
            length: 0.0,
            rate: 0.0,
        };
        waveguide.piriform.damping = waveguide.loss(PIRIFORM_AREA / 2.0);
        waveguide.set_length(options.vocal_tract_length);
        waveguide
    }

    fn loss(&self, area: f64) -> f64 {
        math::pow(
            max(0.0, loss_factor(area, self.wall_loss)),
            self.loss_exponent,
        )
    }

    /// Volume velocity leaving the nostrils at the last step.
    pub fn nose_output(&self) -> f64 {
        self.nose.output
    }

    /// Tract length (cm): sets the step rate and the radiation filters.
    pub fn set_length(&mut self, length: f64) {
        self.length = length;
        self.rate = (self.n as f64 * SPEED_OF_SOUND) / length;
        self.lips.configure(self.areas[self.n - 1], self.rate);
        self.nose.configure(self.rate);
    }

    /// Nasal tract cross-sections (`setNose`).
    pub fn set_nose(&mut self, areas: &[f64]) {
        self.nose.set_profile(areas);
    }

    /// Update the oral tract (`setShape`); `areas` has `n` entries.
    pub fn set_areas(&mut self, areas: &[f64], velum_area: f64, velum_index: f64) {
        for (index, &value) in areas.iter().take(self.n).enumerate() {
            let area = max(MIN_AREA, value);
            self.areas[index] = area;
            self.damping[index] = self.loss(area);
        }
        for index in 1..self.n {
            let a = self.areas[index - 1];
            let b = self.areas[index];
            self.reflection[index] = (a - b) / (a + b);
        }
        self.velum_area = max(0.0, velum_area);
        self.velum_index = min((self.n - 2) as f64, max(1.0, velum_index)) as usize;
        self.nose.set_port(self.velum_area);
        self.lips.configure(self.areas[self.n - 1], self.rate);
    }

    #[inline]
    fn scatter_oral(&mut self) {
        for index in 1..self.n {
            let incoming_right = self.right[index - 1];
            let incoming_left = self.left[index];
            let w = self.reflection[index] * (incoming_right - incoming_left);
            self.junction_right[index] = incoming_right + w;
            self.junction_left[index] = incoming_left + w;
        }
    }

    #[inline]
    fn scatter_velum(&mut self) {
        let index = self.velum_index;
        let a = self.areas[index - 1];
        let b = self.areas[index];
        let c = self.velum_area;
        if c <= MIN_AREA {
            self.nose.junction_right[0] = self.nose.left[0];
            return;
        }
        let from_left = self.right[index - 1];
        let from_right = self.left[index];
        let from_nose = self.nose.left[0];
        let pressure = (2.0 * (a * from_left + b * from_right + c * from_nose)) / (a + b + c);
        self.junction_right[index] = pressure - from_right;
        self.junction_left[index] = pressure - from_left;
        self.nose.junction_right[0] = pressure - from_nose;
    }

    #[inline]
    fn scatter_piriform(&mut self) {
        let index = self.piriform.index;
        if self.piriform.right.is_empty() || index == self.velum_index {
            return;
        }
        let area = self.piriform.area;
        let a = self.areas[index - 1];
        let b = self.areas[index];
        let from_left = self.right[index - 1];
        let from_right = self.left[index];
        let from_side = self.piriform.left[0];
        let pressure = (2.0 * (a * from_left + b * from_right + area * from_side)) / (a + b + area);
        self.junction_right[index] = pressure - from_right;
        self.junction_left[index] = pressure - from_left;
        self.piriform.entering = pressure - from_side;
    }

    #[inline]
    fn propagate_piriform(&mut self) {
        let piriform = &mut self.piriform;
        let Some(last) = piriform.right.len().checked_sub(1) else {
            return;
        };
        let damping = piriform.damping;
        let end = piriform.right[last];
        for index in 0..last {
            piriform.left[index] = piriform.left[index + 1] * damping;
        }
        piriform.left[last] = end * damping;
        for index in (1..=last).rev() {
            piriform.right[index] = piriform.right[index - 1] * damping;
        }
        piriform.right[0] = piriform.entering * damping;
    }

    #[inline]
    fn propagate(&mut self) {
        for index in 0..self.n {
            self.right[index] = self.junction_right[index] * self.damping[index];
            self.left[index] = self.junction_left[index + 1] * self.damping[index];
        }
        self.nose.propagate();
    }

    /// Advance one step (`step`): glottal flow derivative, junction of the
    /// turbulence source, its pressure and the flow transient there.
    /// Returns the radiated output (lips + nose).
    #[inline]
    pub fn advance(
        &mut self,
        glottal_flow: f64,
        noise_position: f64,
        noise: f64,
        flow: f64,
    ) -> f64 {
        self.junction_right[0] =
            self.left[0] * self.glottal_reflection + glottal_flow / self.areas[0];
        let last = self.n - 1;
        let reflected = self.lips.process(self.right[last]);
        self.junction_left[self.n] = reflected;
        self.lip_output = (self.right[last] - reflected) * self.areas[last];
        self.scatter_oral();
        self.scatter_velum();
        self.scatter_piriform();
        self.nose.scatter();
        if noise != 0.0 || flow != 0.0 {
            let position = min((self.n - 1) as f64, max(1.0, noise_position)) as usize;
            self.junction_right[position] += (flow + noise) * 0.5;
            self.junction_left[position] += (flow - noise) * 0.5;
        }
        self.propagate_piriform();
        self.propagate();
        self.lip_output + self.nose_output()
    }

    /// Pressure per section of the oral tract, then of the nose, into
    /// `out`; returns the number of values written.
    pub fn pressure(&self, out: &mut [f64]) -> usize {
        let count = self.n.min(out.len());
        for (index, value) in out.iter_mut().take(count).enumerate() {
            *value = self.right[index] + self.left[index];
        }
        count + self.nose.pressure(&mut out[count..])
    }
}

impl Solver for Waveguide {
    fn set_shape(&mut self, frame: &[f64]) {
        self.set_areas(
            &frame[frame::AREAS..],
            frame[frame::VELUM_AREA],
            frame[frame::VELUM_INDEX],
        );
        self.set_length(frame[frame::LENGTH]);
    }

    fn step_duration(&self) -> f64 {
        self.length / (self.n as f64 * SPEED_OF_SOUND)
    }

    #[inline]
    fn step(&mut self, flow: f64, noise_at: f64, noise: f64, transient: f64) -> f64 {
        self.advance(flow, noise_at, noise, transient)
    }

    fn field(&self, out: &mut [f64]) -> usize {
        self.pressure(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn options() -> WaveguideOptions {
        WaveguideOptions {
            sections: 22,
            nose_sections: 14,
            wall_loss: 1.0,
            nasal_loss: 3.0,
            glottal_chink: 0.0,
            vocal_tract_length: 16.5,
            piriform: PiriformBranch {
                index: 3,
                area: 0.5,
                sections: 3,
            },
        }
    }

    #[test]
    fn impulse_comes_out_after_the_tract() {
        let mut waveguide = Waveguide::new(&options());
        waveguide.set_areas(&[3.0; 22], 0.0, 10.0);
        let mut first = None;
        for step in 0..100 {
            let output = waveguide.advance(if step == 0 { 1.0 } else { 0.0 }, 5.0, 0.0, 0.0);
            if first.is_none() && output != 0.0 {
                first = Some(step);
            }
        }
        // One step per section: the wave reaches the lips after n steps.
        assert_eq!(first, Some(22));
    }

    #[test]
    fn field_lists_tract_and_nose() {
        let waveguide = Waveguide::new(&options());
        let mut out = [1.0; 40];
        assert_eq!(waveguide.field(&mut out), 36);
        assert_eq!(out[0], 0.0);
        assert!((waveguide.step_duration() - 16.5 / (22.0 * 35_000.0)).abs() < 1e-18);
    }
}
