//! Kelly–Lochbaum branch used by the sheet solver (`acoustics/nose-line.js`).
use crate::{losses::boundary_loss_factor, math, radiation::Radiation};
use alloc::{vec, vec::Vec};

/// A nasal or blind side branch, with one step of delay per section.
#[derive(Clone, Debug)]
pub struct NoseLine {
    /// Incoming wave at each section.
    pub left: Vec<f64>,
    right: Vec<f64>,
    junction_right: Vec<f64>,
    junction_left: Vec<f64>,
    areas: Vec<f64>,
    reflection: Vec<f64>,
    damping: Vec<f64>,
    wall_loss: f64,
    exponent: f64,
    closed: bool,
    radiation: Radiation,
    /// Port area in cm².
    pub port_area: f64,
    /// Radiation at the far end.
    pub output: f64,
}
impl NoseLine {
    /// Construct and resample the fixed profile.
    pub fn new(
        n: usize,
        wall_loss: f64,
        exponent: f64,
        closed: bool,
        profile: &[f64],
        port: f64,
    ) -> Self {
        let mut line = Self {
            left: vec![0.0; n],
            right: vec![0.0; n],
            junction_right: vec![0.0; n + 1],
            junction_left: vec![0.0; n + 1],
            areas: vec![1.0; n],
            reflection: vec![0.0; n + 1],
            damping: vec![0.0; n],
            wall_loss,
            exponent,
            closed,
            radiation: Radiation::new(),
            port_area: 0.0,
            output: 0.0,
        };
        for i in 1..n {
            let position = (i as f64 / (n - 1) as f64) * (profile.len() - 1) as f64;
            let lower = math::floor(position) as usize;
            let upper = (lower + 1).min(profile.len() - 1);
            let fraction = position - lower as f64;
            let area = math::max(
                1e-4,
                profile[lower] * (1.0 - fraction) + profile[upper] * fraction,
            );
            line.areas[i] = area;
            line.damping[i] = line.loss(area);
        }
        for i in 2..n {
            let a = line.areas[i - 1];
            let b = line.areas[i];
            line.reflection[i] = (a - b) / (a + b);
        }
        line.set_port(port);
        line.configure(1.0);
        line
    }
    fn loss(&self, area: f64) -> f64 {
        math::pow(
            math::max(0.0, boundary_loss_factor(area, self.wall_loss)),
            self.exponent,
        )
    }
    /// Set the variable area of section zero.
    pub fn set_port(&mut self, area: f64) {
        self.port_area = math::max(0.0, area);
        let port = math::max(1e-4, self.port_area);
        self.areas[0] = port;
        self.damping[0] = self.loss(port);
        self.reflection[1] = (port - self.areas[1]) / (port + self.areas[1]);
    }
    /// Whether the line takes flow through its port.
    pub fn open(&self) -> bool {
        self.port_area > 1e-4
    }
    /// Retune the radiation termination for a new physical step rate.
    pub fn configure(&mut self, rate: f64) {
        if !self.closed {
            self.radiation
                // NoseLine uses the fully baffled nostril, independently of the lip baffle.
                .configure(*self.areas.last().unwrap(), rate, 1.0);
        }
    }
    /// Scatter and propagate after the owner computes the outgoing port wave.
    pub fn step(&mut self, outgoing: f64) {
        self.junction_right[0] = outgoing;
        let n = self.left.len();
        for i in 1..n {
            let right = self.right[i - 1];
            let left = self.left[i];
            let w = self.reflection[i] * (right - left);
            self.junction_right[i] = right + w;
            self.junction_left[i] = left + w;
        }
        let reflected = if self.closed {
            self.right[n - 1]
        } else {
            self.radiation.process(self.right[n - 1])
        };
        self.junction_left[n] = reflected;
        self.output = if self.closed {
            0.0
        } else {
            (self.right[n - 1] - reflected) * self.areas[n - 1]
        };
        for i in 0..n {
            self.right[i] = self.junction_right[i] * self.damping[i];
            self.left[i] = self.junction_left[i + 1] * self.damping[i];
        }
    }
    /// Section pressures for field visualisation.
    pub fn field(&self, out: &mut [f64]) -> usize {
        let n = out.len().min(self.left.len());
        for (i, value) in out[..n].iter_mut().enumerate() {
            *value = self.left[i] + self.right[i];
        }
        n
    }
}
