//! Trachea and branching bronchi, port of `acoustics/subglottal.js`.
use crate::{glottis::SPEED_OF_SOUND, losses::boundary_loss_factor, math, radiation::Radiation};
use alloc::{vec, vec::Vec};

/// Half-rate travelling-wave line below the folds.
#[derive(Clone, Debug)]
pub struct Subglottal {
    scale: f64,
    wall_loss: f64,
    dt: f64,
    areas: Vec<f64>,
    reflection: Vec<f64>,
    damping: Vec<f64>,
    down: Vec<f64>,
    up: Vec<f64>,
    next_down: Vec<f64>,
    next_up: Vec<f64>,
    far: Radiation,
    input: f64,
    count: usize,
    arriving: f64,
}
impl Subglottal {
    /// Length scale follows the head's tract length; loss is a wall multiplier.
    pub fn new(length: f64, length_scale: f64, wall_loss: f64, loss: f64) -> Self {
        Self {
            scale: length / 16.5 * length_scale,
            wall_loss: wall_loss * loss,
            dt: f64::NAN,
            areas: Vec::new(),
            reflection: Vec::new(),
            damping: Vec::new(),
            down: Vec::new(),
            up: Vec::new(),
            next_down: Vec::new(),
            next_up: Vec::new(),
            far: Radiation::new(),
            input: 0.0,
            count: 0,
            arriving: 0.0,
        }
    }
    /// Build the spatial line once; retune radiation when the time step changes.
    pub fn configure(&mut self, dt: f64) {
        if dt == self.dt {
            return;
        }
        self.dt = dt;
        if !self.areas.is_empty() {
            self.far
                .configure(self.areas[self.areas.len() - 1], 1.0 / (2.0 * dt), 0.0);
            return;
        }
        let trachea = 10.0 * self.scale;
        let bronchi = 8.0 * self.scale;
        let length = trachea + bronchi;
        let n = math::max(
            2.0,
            math::round_half_up(length / (2.0 * SPEED_OF_SOUND * dt)),
        ) as usize;
        let step = length / n as f64;
        let growth = math::ln(20.0 / 2.5) / bronchi;
        self.areas = (0..n)
            .map(|i| {
                let distance = (i as f64 + 0.5) * step;
                if distance <= trachea {
                    2.5
                } else {
                    2.5 * math::exp(growth * math::min(bronchi, distance - trachea))
                }
            })
            .collect();
        self.reflection = vec![0.0; n];
        self.damping = vec![0.0; n];
        for i in 0..n {
            if i > 0 {
                let a = self.areas[i - 1];
                let b = self.areas[i];
                self.reflection[i] = (a - b) / (a + b);
            }
            self.damping[i] = math::pow(
                boundary_loss_factor(self.areas[i], self.wall_loss),
                step / (16.5 / 44.0),
            );
        }
        self.down = vec![0.0; n];
        self.up = vec![0.0; n];
        self.next_down = vec![0.0; n];
        self.next_up = vec![0.0; n];
        self.input = 0.0;
        self.count = 0;
        self.arriving = 0.0;
        self.far.configure(self.areas[n - 1], 1.0 / (2.0 * dt), 0.0);
    }
    /// Current incident wave and proximal area.
    pub fn load(&self) -> (f64, f64) {
        (self.arriving, self.areas[0])
    }
    /// Feed one solver sample; propagate on every second sample.
    pub fn step(&mut self, flow: f64) {
        self.input += flow;
        self.count += 1;
        if self.count < 2 {
            return;
        }
        let flow = self.input / 2.0;
        self.input = 0.0;
        self.count = 0;
        let n = self.areas.len();
        self.next_down[0] = (self.up[0] + flow / self.areas[0]) * self.damping[0];
        for i in 1..n {
            let wave = self.reflection[i] * (self.down[i - 1] - self.up[i]);
            self.next_down[i] = (self.down[i - 1] + wave) * self.damping[i];
            self.next_up[i - 1] = (self.up[i] + wave) * self.damping[i - 1];
        }
        self.next_up[n - 1] = self.far.process(self.down[n - 1]) * self.damping[n - 1];
        core::mem::swap(&mut self.down, &mut self.next_down);
        core::mem::swap(&mut self.up, &mut self.next_up);
        self.arriving = self.up[0];
    }
}
