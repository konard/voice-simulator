//! 1D digital waveguide (Kelly-Lochbaum) model of the vocal and nasal
//! tracts: a port of `src/acoustics/waveguide.js`.
//!
//! Every section is one step of delay, so the step rate is
//! sections * c / length. Waves are pressure waves; junctions use the
//! one-multiply form, the velum is a three-port junction, the piriform
//! fossae a closed side branch. The tract is split into `LOSS_STAGES`
//! groups (the nose into `NOSE_LOSS_STAGES`), each with a first-order
//! loss filter per travelling wave and a yielding wall (issue 36, see
//! [`crate::losses`]). Parity class B through `exp` in the glottal
//! reflection, `pow` in the section losses and the transcendental functions
//! of the loss filter design; the step itself uses the four basic
//! operations in the order of the JavaScript code.

use alloc::vec;
use alloc::vec::Vec;
use core::f64::consts::PI;
use core::mem::swap;

use crate::frame;
use crate::glottis::{glottal_reflection, SPEED_OF_SOUND};
use crate::losses::{
    viscothermal_loss, wall_surface, ShelfCache, AIR_DENSITY, LOSS_REFERENCE_SECTIONS, LOSS_SHAPE,
    LOSS_STAGES, NOSE_LOSS_STAGES,
};
use crate::math::{self, max, min};
use crate::radiation::{Radiation, RADIATION_BAFFLE};
use crate::solver::Solver;

/// Smallest section area (cm²).
pub const MIN_AREA: f64 = 1e-4;
/// Waves of a closed nose below this are silence (`NOSE_SILENCE`).
const NOSE_SILENCE: f64 = 1e-12;
/// Steps between the silence checks of a closed nose (`NOSE_CHECK_STEPS`).
const NOSE_CHECK_STEPS: u32 = 64;
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
    /// `head.wallMass` (g/cm²).
    pub wall_mass: f64,
    /// `head.wallResistance` (g/(cm² s)), before `wall_loss`.
    pub wall_resistance: f64,
    /// `head.wallStiffness` (g/(cm² s²)).
    pub wall_stiffness: f64,
    /// `head.glottalChink` (mm²).
    pub glottal_chink: f64,
    /// `head.vocalTractLength` (cm).
    pub vocal_tract_length: f64,
    /// The piriform branch.
    pub piriform: PiriformBranch,
}

/// Last section of each of `stages` groups of `sections` (`groupEnds`).
fn group_ends(sections: usize, stages: f64) -> Vec<usize> {
    let count = max(1.0, min(sections as f64, math::round_half_up(stages)));
    let groups = count as usize;
    (0..groups)
        .map(|group| {
            math::round_half_up((sections as f64 * (group + 1) as f64) / count) as usize - 1
        })
        .collect()
}

/// Loss filters at the ends of groups of sections (`lossStages`).
#[derive(Clone, Debug)]
struct Stages {
    ends: Vec<usize>,
    b0: Vec<f64>,
    b1: Vec<f64>,
    a1: Vec<f64>,
    right_input: Vec<f64>,
    right_output: Vec<f64>,
    left_input: Vec<f64>,
    left_output: Vec<f64>,
    design_k: Vec<f64>,
    design_rate: Vec<f64>,
}

impl Stages {
    fn new(sections: usize, stages: f64) -> Self {
        let ends = group_ends(sections, stages);
        let groups = ends.len();
        Self {
            ends,
            b0: vec![1.0; groups],
            b1: vec![0.0; groups],
            a1: vec![0.0; groups],
            right_input: vec![0.0; groups],
            right_output: vec![0.0; groups],
            left_input: vec![0.0; groups],
            left_output: vec![0.0; groups],
            design_k: vec![f64::NAN; groups],
            design_rate: vec![0.0; groups],
        }
    }

    /// `#setFilter`: redesign group `group` for `k` at `rate` if either changed.
    fn set_filter(&mut self, shelves: &mut ShelfCache, group: usize, k: f64, rate: f64) {
        if k == self.design_k[group] && rate == self.design_rate[group] {
            return;
        }
        self.design_k[group] = k;
        self.design_rate[group] = rate;
        let filter = shelves.design(k, rate);
        self.b0[group] = filter.b0;
        self.b1[group] = filter.b1;
        self.a1[group] = filter.a1;
    }

    /// `#filterStages`: the loss of each group on both waves of its last section.
    #[inline]
    fn filter(&mut self, right: &mut [f64], left: &mut [f64]) {
        for (group, &end) in self.ends.iter().enumerate() {
            let gain = self.b0[group];
            let zero = self.b1[group];
            let pole = self.a1[group];
            let to_right = right[end];
            let to_left = left[end];
            let out_right =
                gain * to_right + zero * self.right_input[group] - pole * self.right_output[group];
            let out_left =
                gain * to_left + zero * self.left_input[group] - pole * self.left_output[group];
            self.right_input[group] = to_right;
            self.right_output[group] = out_right;
            self.left_input[group] = to_left;
            self.left_output[group] = out_left;
            right[end] = out_right;
            left[end] = out_left;
        }
    }

    /// True if no filter state is above `limit`.
    fn quiet(&self, limit: f64) -> bool {
        [
            &self.right_input,
            &self.right_output,
            &self.left_input,
            &self.left_output,
        ]
        .iter()
        .all(|values| quiet(values, limit))
    }

    fn clear(&mut self) {
        for values in [
            &mut self.right_input,
            &mut self.right_output,
            &mut self.left_input,
            &mut self.left_output,
        ] {
            values.fill(0.0);
        }
    }
}

/// True if no |value| is above `limit`.
fn quiet(values: &[f64], limit: f64) -> bool {
    values
        .iter()
        .all(|value| value.is_nan() || math::abs(*value) <= limit)
}

/// The loss filter on the wave reflected at the far end of the piriform
/// fossae, with the K and rate it was designed for.
#[derive(Clone, Debug)]
struct EndFilter {
    b0: f64,
    b1: f64,
    a1: f64,
    input: f64,
    output: f64,
    k: f64,
    rate: f64,
}

#[derive(Clone, Debug)]
struct Piriform {
    index: usize,
    area: f64,
    right: Vec<f64>,
    left: Vec<f64>,
    damping: f64,
    filter: EndFilter,
    entering: f64,
    to_right: f64,
    to_left: f64,
}

/// The yielding walls of the groups of oral sections.
#[derive(Clone, Debug)]
struct Walls {
    mass: f64,
    resistance: f64,
    stiffness: f64,
    junction: Vec<usize>,
    drive: Vec<f64>,
    gain: Vec<f64>,
    drop: Vec<f64>,
    flow: Vec<f64>,
    volume: Vec<f64>,
    step: f64,
    spring: f64,
}

/// The waveguide (`Waveguide` of `waveguide.js`).
#[derive(Clone, Debug)]
pub struct Waveguide {
    /// Scale of the boundary losses.
    pub wall_loss: f64,
    /// Boundary-layer loss relative to a smooth round tube.
    pub loss_shape: f64,
    /// Baffle of the lips and nostrils.
    pub baffle: f64,
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
    /// Filter at the nostrils.
    pub nostrils: Radiation,
    stages: Stages,
    nose_stages: Stages,
    walls: Walls,
    shelves: ShelfCache,
    losses_stale: bool,
    right: Vec<f64>,
    left: Vec<f64>,
    spare_right: Vec<f64>,
    spare_left: Vec<f64>,
    specials: Vec<usize>,
    /// Section areas (cm²).
    pub areas: Vec<f64>,
    reflection: Vec<f64>,
    damping: Vec<f64>,
    nose_right: Vec<f64>,
    nose_left: Vec<f64>,
    spare_nose_right: Vec<f64>,
    spare_nose_left: Vec<f64>,
    nose_entering: f64,
    nose_silent: bool,
    nose_check: u32,
    /// Nose section areas (cm²); section 0 is the velopharyngeal port.
    pub nose_areas: Vec<f64>,
    nose_profile: Vec<f64>,
    nose_reflection: Vec<f64>,
    nose_damping: Vec<f64>,
    /// Area of the velopharyngeal port (cm²).
    pub velum_area: f64,
    /// Section of the velum junction.
    pub velum_index: usize,
    marked_velum: Option<usize>,
    velum_open: bool,
    velum_right: f64,
    velum_left: f64,
    /// Volume velocity leaving the lips at the last step.
    pub lip_output: f64,
    /// Volume velocity leaving the nostrils at the last step.
    pub nose_output: f64,
    piriform: Piriform,
    piriform_open: bool,
    /// Tract length (cm).
    pub length: f64,
    /// Step rate (steps per second).
    pub rate: f64,
}

impl Waveguide {
    /// `new Waveguide(options)`.
    pub fn new(options: &WaveguideOptions) -> Self {
        let n = options.sections;
        let nose = options.nose_sections;
        let wall_loss = options.wall_loss;
        let stages = Stages::new(n, LOSS_STAGES);
        let groups = stages.ends.len();
        let branch = options.piriform;
        let loss_exponent = LOSS_REFERENCE_SECTIONS / n as f64;
        let mut waveguide = Self {
            wall_loss,
            loss_shape: LOSS_SHAPE,
            baffle: RADIATION_BAFFLE,
            nasal_loss: options.nasal_loss,
            glottal_reflection: glottal_reflection(
                options.glottal_chink,
                options.vocal_tract_length,
            ),
            n,
            nose_n: nose,
            loss_exponent,
            lips: Radiation::new(),
            nostrils: Radiation::new(),
            stages,
            nose_stages: Stages::new(nose, NOSE_LOSS_STAGES),
            walls: Walls {
                mass: options.wall_mass,
                resistance: options.wall_resistance * wall_loss,
                stiffness: options.wall_stiffness,
                junction: vec![0; groups],
                drive: vec![0.0; groups],
                gain: vec![0.0; groups],
                drop: vec![0.0; groups],
                flow: vec![0.0; groups],
                volume: vec![0.0; groups],
                step: 0.0,
                spring: 0.0,
            },
            shelves: ShelfCache::new(),
            losses_stale: true,
            right: vec![0.0; n],
            left: vec![0.0; n],
            spare_right: vec![0.0; n],
            spare_left: vec![0.0; n],
            specials: Vec::new(),
            areas: vec![1.0; n],
            reflection: vec![0.0; n + 1],
            damping: vec![0.0; n],
            nose_right: vec![0.0; nose],
            nose_left: vec![0.0; nose],
            spare_nose_right: vec![0.0; nose],
            spare_nose_left: vec![0.0; nose],
            nose_entering: 0.0,
            nose_silent: false,
            nose_check: 0,
            nose_areas: vec![1.0; nose],
            nose_profile: vec![1.0; nose],
            nose_reflection: vec![0.0; nose + 1],
            nose_damping: vec![0.0; nose],
            velum_area: 0.0,
            velum_index: math::round_half_up(n as f64 * 0.45) as usize,
            marked_velum: None,
            velum_open: false,
            velum_right: 0.0,
            velum_left: 0.0,
            lip_output: 0.0,
            nose_output: 0.0,
            piriform: Piriform {
                index: branch.index,
                area: branch.area,
                right: vec![0.0; branch.sections],
                left: vec![0.0; branch.sections],
                damping: 0.0,
                filter: EndFilter {
                    b0: 1.0,
                    b1: 0.0,
                    a1: 0.0,
                    input: 0.0,
                    output: 0.0,
                    k: f64::NAN,
                    rate: 0.0,
                },
                entering: 0.0,
                to_right: 0.0,
                to_left: 0.0,
            },
            piriform_open: false,
            length: 0.0,
            rate: 0.0,
        };
        let unit = waveguide.loss(1.0);
        waveguide.damping.fill(unit);
        waveguide.nose_damping.fill(unit);
        waveguide.apply_port();
        waveguide.piriform.damping = waveguide.loss(branch.area / 2.0);
        waveguide.set_length(options.vocal_tract_length);
        waveguide
    }

    /// `#loss`: the constriction loss of a section of `area` (`lossFactor`).
    fn loss(&self, area: f64) -> f64 {
        let factor = 1.0 - min(0.3, 0.0001 / math::pow(max(area, 1e-3), 2.0));
        if self.loss_exponent == 1.0 {
            factor
        } else {
            math::pow(factor, self.loss_exponent)
        }
    }

    /// Volume velocity leaving the nostrils at the last step.
    pub fn nose_output(&self) -> f64 {
        self.nose_output
    }

    /// Tract length (cm): sets the step rate, the radiation filters and,
    /// at the next step, the loss filters.
    pub fn set_length(&mut self, length: f64) {
        self.length = length;
        self.rate = (self.n as f64 * SPEED_OF_SOUND) / length;
        self.lips
            .configure(self.areas[self.n - 1], self.rate, self.baffle);
        self.nostrils
            .configure(self.nose_areas[self.nose_n - 1], self.rate, self.baffle);
        self.losses_stale = true;
    }

    fn refresh_losses(&mut self) {
        self.losses_stale = false;
        self.configure_piriform();
        self.configure_losses();
        self.configure_nose_losses();
        if self.marked_velum != Some(self.velum_index) {
            self.marked_velum = Some(self.velum_index);
            self.mark_junctions();
        }
    }

    fn mark_junctions(&mut self) {
        let piriform = &self.piriform;
        self.piriform_open = !piriform.right.is_empty() && piriform.index != self.velum_index;
        self.specials.clear();
        self.specials.push(self.velum_index);
        if self.piriform_open {
            self.specials.push(piriform.index);
        }
        self.specials.sort_unstable();
    }

    fn configure_losses(&mut self) {
        if self.rate == 0.0 || self.rate.is_nan() {
            return;
        }
        let section_length = self.length / self.n as f64;
        let per_radius =
            viscothermal_loss(1.0, PI, self.loss_shape * self.wall_loss) * section_length;
        let perimeter = wall_surface(PI, section_length);
        let step = 1.0 / self.rate;
        let rate = step / self.walls.mass;
        let impedance = AIR_DENSITY * SPEED_OF_SOUND;
        self.walls.step = step;
        self.walls.spring = rate * self.walls.stiffness;
        let mut start = 0;
        for group in 0..self.stages.ends.len() {
            let end = self.stages.ends[group];
            let mut inverse = 0.0;
            let mut radii = 0.0;
            for &area in &self.areas[start..=end] {
                let radius = math::sqrt(area / PI);
                inverse += 1.0 / radius;
                radii += radius;
            }
            self.stages
                .set_filter(&mut self.shelves, group, per_radius * inverse, self.rate);
            let surface = perimeter * radii;
            let middle = math::round_half_up((start + end + 1) as f64 / 2.0);
            let mut junction = max(1.0, min((self.n - 1) as f64, middle)) as usize;
            if junction == self.velum_index || junction == self.piriform.index {
                junction = if junction > 1 {
                    junction - 1
                } else {
                    junction + 1
                };
            }
            self.walls.junction[group] = junction;
            let area = self.areas[junction - 1] + self.areas[junction];
            self.walls.drive[group] = rate * surface * impedance;
            self.walls.gain[group] =
                1.0 / (1.0 + rate * (self.walls.resistance + (surface * impedance) / area));
            self.walls.drop[group] = 1.0 / area;
            start = end + 1;
        }
    }

    fn configure_nose_losses(&mut self) {
        if self.rate == 0.0 || self.rate.is_nan() {
            return;
        }
        let section_length = self.length / self.n as f64;
        let scale = self.loss_shape * self.wall_loss * self.nasal_loss;
        let mut start = 0;
        for group in 0..self.nose_stages.ends.len() {
            let end = self.nose_stages.ends[group];
            let mut k = 0.0;
            for &area in &self.nose_areas[start..=end] {
                k += viscothermal_loss(1.0, area, scale) * section_length;
            }
            self.nose_stages
                .set_filter(&mut self.shelves, group, k, self.rate);
            start = end + 1;
        }
    }

    fn configure_piriform(&mut self) {
        if self.piriform.right.is_empty() || self.rate == 0.0 || self.rate.is_nan() {
            return;
        }
        let section_length = self.length / self.n as f64;
        let area = self.piriform.area / 2.0;
        self.piriform.damping = self.loss(area);
        let k = 2.0
            * self.piriform.right.len() as f64
            * viscothermal_loss(1.0, area, self.loss_shape * self.wall_loss)
            * section_length;
        let filter = &mut self.piriform.filter;
        if k != filter.k || self.rate != filter.rate {
            let design = self.shelves.design(k, self.rate);
            filter.b0 = design.b0;
            filter.b1 = design.b1;
            filter.a1 = design.a1;
            filter.k = k;
            filter.rate = self.rate;
        }
    }

    /// Nasal tract cross-sections (`setNose`); section 0 takes the port.
    pub fn set_nose(&mut self, areas: &[f64]) {
        let nose_n = self.nose_n;
        let last = areas.len() - 1;
        for (index, profile) in self.nose_profile.iter_mut().enumerate() {
            let position = (index as f64 / (nose_n - 1) as f64) * last as f64;
            let lower = math::floor(position);
            let upper = min(last as f64, lower + 1.0) as usize;
            let fraction = position - lower;
            let area = areas[lower as usize] * (1.0 - fraction) + areas[upper] * fraction;
            *profile = max(MIN_AREA, area);
        }
        for index in 1..nose_n {
            let area = self.nose_profile[index];
            self.nose_areas[index] = area;
            self.nose_damping[index] = self.loss(area);
        }
        for index in 2..nose_n {
            let a = self.nose_areas[index - 1];
            let b = self.nose_areas[index];
            self.nose_reflection[index] = (a - b) / (a + b);
        }
        self.apply_port();
        self.losses_stale = true;
        self.nostrils
            .configure(self.nose_areas[nose_n - 1], self.rate, self.baffle);
    }

    /// `#applyPort`: nose section 0 takes the port area.
    fn apply_port(&mut self) {
        let area = max(MIN_AREA, self.velum_area);
        self.nose_areas[0] = area;
        self.nose_damping[0] = self.loss(area);
        if self.nose_n > 1 {
            let next = self.nose_areas[1];
            self.nose_reflection[1] = (area - next) / (area + next);
        }
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
        self.apply_port();
        self.losses_stale = true;
        self.lips
            .configure(self.areas[self.n - 1], self.rate, self.baffle);
    }

    /// `#scatterOral`: scatter the oral waves into the spare buffers, with
    /// the noise and flow sources at junction `position` (or -1), and swap.
    #[inline]
    fn scatter_oral(
        &mut self,
        glottis: f64,
        lips: f64,
        position: f64,
        add_right: f64,
        add_left: f64,
    ) {
        let n = self.n;
        self.spare_right[0] = glottis * self.damping[0];
        let mut index = 1;
        let mut special = 0;
        loop {
            let mut stop = if special < self.specials.len() {
                self.specials[special] as f64
            } else {
                n as f64
            };
            if position >= index as f64 && position < stop {
                stop = position;
            }
            while (index as f64) < stop {
                let incoming_right = self.right[index - 1];
                let incoming_left = self.left[index];
                let w = self.reflection[index] * (incoming_right - incoming_left);
                self.spare_right[index] = (incoming_right + w) * self.damping[index];
                self.spare_left[index - 1] = (incoming_left + w) * self.damping[index - 1];
                index += 1;
            }
            if index >= n {
                break;
            }
            self.scatter_special(index, position, add_right, add_left);
            if special < self.specials.len() && index == self.specials[special] {
                special += 1;
            }
            index += 1;
        }
        self.spare_left[n - 1] = lips * self.damping[n - 1];
        self.yield_walls(position, add_right);
        swap(&mut self.right, &mut self.spare_right);
        swap(&mut self.left, &mut self.spare_left);
    }

    /// `#scatterSpecial`: a three-port junction or the noise source.
    #[inline]
    fn scatter_special(&mut self, index: usize, position: f64, add_right: f64, add_left: f64) {
        let incoming_right = self.right[index - 1];
        let incoming_left = self.left[index];
        let mut out_right;
        let mut out_left;
        if index == self.velum_index && self.velum_open {
            out_right = self.velum_right;
            out_left = self.velum_left;
        } else if index == self.piriform.index && self.piriform_open {
            out_right = self.piriform.to_right;
            out_left = self.piriform.to_left;
        } else {
            let w = self.reflection[index] * (incoming_right - incoming_left);
            out_right = incoming_right + w;
            out_left = incoming_left + w;
        }
        if index as f64 == position {
            out_right += add_right;
            out_left += add_left;
        }
        self.spare_right[index] = out_right * self.damping[index];
        self.spare_left[index - 1] = out_left * self.damping[index - 1];
    }

    #[inline]
    fn scatter_velum(&mut self) {
        let index = self.velum_index;
        let a = self.areas[index - 1];
        let b = self.areas[index];
        let c = self.velum_area;
        self.velum_open = c > MIN_AREA;
        if !self.velum_open {
            self.nose_entering = self.nose_left[0];
            return;
        }
        let from_left = self.right[index - 1];
        let from_right = self.left[index];
        let from_nose = self.nose_left[0];
        let pressure = (2.0 * (a * from_left + b * from_right + c * from_nose)) / (a + b + c);
        self.velum_right = pressure - from_right;
        self.velum_left = pressure - from_left;
        self.nose_entering = pressure - from_nose;
    }

    #[inline]
    fn scatter_piriform(&mut self) {
        if !self.piriform_open {
            return;
        }
        let index = self.piriform.index;
        let area = self.piriform.area;
        let a = self.areas[index - 1];
        let b = self.areas[index];
        let from_left = self.right[index - 1];
        let from_right = self.left[index];
        let from_side = self.piriform.left[0];
        let pressure = (2.0 * (a * from_left + b * from_right + area * from_side)) / (a + b + area);
        self.piriform.to_right = pressure - from_right;
        self.piriform.to_left = pressure - from_left;
        self.piriform.entering = pressure - from_side;
    }

    #[inline]
    fn propagate_piriform(&mut self) {
        let piriform = &mut self.piriform;
        let Some(last) = piriform.right.len().checked_sub(1) else {
            return;
        };
        let filter = &mut piriform.filter;
        let end =
            filter.b0 * piriform.right[last] + filter.b1 * filter.input - filter.a1 * filter.output;
        filter.input = piriform.right[last];
        filter.output = end;
        let damping = piriform.damping;
        for index in 0..last {
            piriform.left[index] = piriform.left[index + 1] * damping;
        }
        piriform.left[last] = end * damping;
        for index in (1..=last).rev() {
            piriform.right[index] = piriform.right[index - 1] * damping;
        }
        piriform.right[0] = piriform.entering * damping;
    }

    /// `#silenceNose`: clear and skip a closed nose whose waves died away.
    fn silence_nose(&mut self) {
        if !quiet(&self.nose_right, NOSE_SILENCE)
            || !quiet(&self.nose_left, NOSE_SILENCE)
            || !self.nose_stages.quiet(NOSE_SILENCE)
            || math::abs(self.nostrils.input) > NOSE_SILENCE
            || math::abs(self.nostrils.output) > NOSE_SILENCE
        {
            return;
        }
        self.nose_right.fill(0.0);
        self.nose_left.fill(0.0);
        self.nose_stages.clear();
        self.nostrils.reset();
        self.nose_output = 0.0;
        self.nose_silent = true;
    }

    /// `#scatterNose`: the nasal counterpart of [`Self::scatter_oral`].
    #[inline]
    fn scatter_nose(&mut self) {
        let n = self.nose_n;
        self.spare_nose_right[0] = self.nose_entering * self.nose_damping[0];
        for index in 1..n {
            let incoming_right = self.nose_right[index - 1];
            let incoming_left = self.nose_left[index];
            let w = self.nose_reflection[index] * (incoming_right - incoming_left);
            self.spare_nose_right[index] = (incoming_right + w) * self.nose_damping[index];
            self.spare_nose_left[index - 1] = (incoming_left + w) * self.nose_damping[index - 1];
        }
        let last = n - 1;
        let reflected = self.nostrils.process(self.nose_right[last]);
        self.spare_nose_left[last] = reflected * self.nose_damping[last];
        self.nose_output = (self.nose_right[last] - reflected) * self.nose_areas[last];
        swap(&mut self.nose_right, &mut self.spare_nose_right);
        swap(&mut self.nose_left, &mut self.spare_nose_left);
    }

    /// `#yieldWalls`: the flow of the yielding wall of each group leaves
    /// the tract at its junction (reads the old waves, lowers the new).
    #[inline]
    fn yield_walls(&mut self, position: f64, add_right: f64) {
        let walls = &mut self.walls;
        let mut junction = usize::MAX;
        let mut pressure = 0.0;
        for group in 0..walls.junction.len() {
            let index = walls.junction[group];
            if index != junction {
                junction = index;
                let incoming_right = self.right[index - 1];
                let incoming_left = self.left[index];
                pressure = incoming_right
                    + incoming_left
                    + self.reflection[index] * (incoming_right - incoming_left)
                    + if index as f64 == position {
                        add_right
                    } else {
                        0.0
                    };
            }
            let flow = (walls.flow[group] + walls.drive[group] * pressure
                - walls.spring * walls.volume[group])
                * walls.gain[group];
            walls.flow[group] = flow;
            walls.volume[group] += walls.step * flow;
            let drop = flow * walls.drop[group];
            pressure -= drop;
            self.spare_right[index] -= drop * self.damping[index];
            self.spare_left[index - 1] -= drop * self.damping[index - 1];
        }
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
        if self.losses_stale {
            self.refresh_losses();
        }
        let last = self.n - 1;
        let lip_wave = self.right[last];
        let reflected = self.lips.process(lip_wave);
        self.lip_output = (lip_wave - reflected) * self.areas[last];
        self.scatter_velum();
        self.scatter_piriform();
        let source = noise != 0.0 || flow != 0.0;
        self.scatter_oral(
            self.left[0] * self.glottal_reflection + glottal_flow / self.areas[0],
            reflected,
            if source {
                min(last as f64, max(1.0, noise_position))
            } else {
                -1.0
            },
            (flow + noise) * 0.5,
            (flow - noise) * 0.5,
        );
        self.propagate_piriform();
        self.stages.filter(&mut self.right, &mut self.left);
        if self.velum_open || !self.nose_silent {
            self.nose_silent = false;
            self.scatter_nose();
            self.nose_stages
                .filter(&mut self.nose_right, &mut self.nose_left);
            if !self.velum_open {
                self.nose_check += 1;
                if self.nose_check >= NOSE_CHECK_STEPS {
                    self.nose_check = 0;
                    self.silence_nose();
                }
            }
        }
        self.lip_output + self.nose_output
    }

    /// Pressure per section of the oral tract, then of the nose, into
    /// `out`; returns the number of values written.
    pub fn pressure(&self, out: &mut [f64]) -> usize {
        let pairs = self
            .right
            .iter()
            .zip(&self.left)
            .chain(self.nose_right.iter().zip(&self.nose_left));
        let mut count = 0;
        for (value, (right, left)) in out.iter_mut().zip(pairs) {
            *value = right + left;
            count += 1;
        }
        count
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
    use crate::losses::{WALL_MASS, WALL_RESISTANCE, WALL_STIFFNESS};

    fn options() -> WaveguideOptions {
        WaveguideOptions {
            sections: 22,
            nose_sections: 14,
            wall_loss: 1.0,
            nasal_loss: 3.0,
            wall_mass: WALL_MASS,
            wall_resistance: WALL_RESISTANCE,
            wall_stiffness: WALL_STIFFNESS,
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
    fn groups_split_the_sections() {
        assert_eq!(group_ends(44, 5.0), [8, 17, 25, 34, 43]);
        assert_eq!(group_ends(28, 2.0), [13, 27]);
        assert_eq!(group_ends(3, 5.0), [0, 1, 2]);
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
    fn closed_nose_falls_silent() {
        let mut waveguide = Waveguide::new(&options());
        waveguide.set_areas(&[3.0; 22], 0.0, 10.0);
        for _ in 0..NOSE_CHECK_STEPS {
            waveguide.advance(0.0, 5.0, 0.0, 0.0);
        }
        assert!(waveguide.nose_silent);
        waveguide.set_areas(&[3.0; 22], 0.5, 10.0);
        waveguide.advance(1.0, 5.0, 0.0, 0.0);
        assert!(!waveguide.nose_silent);
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
