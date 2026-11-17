//! Two-mass vocal folds and incident pressure, ported from `acoustics/folds.js`.
//! Units are cgs; the integration and collision order match the reference.

use crate::aerodynamics::{lag_factor, open_tract_strength_at, AIR_DENSITY};
use crate::glottis::{GlottalControl, GlottisOptions, SPEED_OF_SOUND};
use crate::math::{self, max, min};
use core::f64::consts::PI;

/// Scale from physical flow derivative to the source amplitude.
pub const FLOW_SCALE: f64 = 1.403e-6;

/// Rest area in cm², interpolated between open, breathy, modal and pressed.
pub fn rest_area(adduction: f64) -> f64 {
    let value = adduction.clamp(0.0, 1.0);
    let table = [(0.0, 0.3), (0.25, 0.1), (0.5, 0.05), (1.0, -0.02)];
    let mut index = 1;
    while index < table.len() - 1 && value > table[index].0 {
        index += 1;
    }
    let (x0, y0) = table[index - 1];
    let (x1, y1) = table[index];
    y0 + ((y1 - y0) * (value - x0)) / (x1 - x0)
}

/// Cancellation-free root of the interactive glottal flow equation.
pub fn interactive_flow(area: f64, below: f64, above: f64, drive: f64, k: f64) -> f64 {
    if area <= 0.0 || drive == 0.0 {
        return 0.0;
    }
    let ratio = area * (1.0 / below + 1.0 / above);
    let term = (4.0 * k * math::abs(drive)) / (AIR_DENSITY * SPEED_OF_SOUND * SPEED_OF_SOUND);
    let flow = ((area * SPEED_OF_SOUND) / k) * (term / (ratio + math::sqrt(ratio * ratio + term)));
    if drive < 0.0 {
        -flow
    } else {
        flow
    }
}

/// Pressure and tube area on either side of the glottis.
#[derive(Clone, Copy, Debug)]
pub struct Load {
    /// Incident pressure (dyn/cm²).
    pub pressure: f64,
    /// Tube area (cm²), infinity without a tube.
    pub area: f64,
}

/// Leaky integration of a solver's incident wave into physical pressure.
#[derive(Clone, Debug, Default)]
pub struct IncidentPressure {
    state: f64,
}
impl IncidentPressure {
    /// Integrate one wave at the solver's step duration.
    pub fn step(&mut self, wave: f64, dt: f64) -> f64 {
        self.state += wave * dt;
        self.state *= 1.0 - 2.0 * PI * 20.0 * dt;
        (self.state * AIR_DENSITY * SPEED_OF_SOUND) / FLOW_SCALE
    }
}

/// Physical parameters of the folds (head values).
#[derive(Clone, Copy, Debug)]
pub struct FoldOptions {
    /// Vibrating length (cm).
    pub length: f64,
    /// Mass multiplier.
    pub mass: f64,
    /// Stiffness multiplier.
    pub stiffness: f64,
    /// Damping multiplier.
    pub damping: f64,
    /// Glottal pressure coefficient.
    pub pressure_coefficient: f64,
}
impl Default for FoldOptions {
    fn default() -> Self {
        Self {
            length: 1.4,
            mass: 1.0,
            stiffness: 1.0,
            damping: 1.0,
            pressure_coefficient: 1.1,
        }
    }
}

/// Symmetric two-mass source. Pitch calibration remains in the host planner.
#[derive(Clone, Debug)]
pub struct VocalFolds {
    options: FoldOptions,
    breath_gain: f64,
    re_critical: f64,
    /// Aspiration gain of the head.
    pub aspiration_level: f64,
    /// Whether a first physical step has run.
    pub started: bool,
    /// Three-stage smoothed opening used by the airflow model.
    pub mean_area: f64,
    mean_stages: [f64; 3],
    x1: f64,
    x2: f64,
    v1: f64,
    v2: f64,
    u: f64,
    pressure: f64,
    oral_pressure: f64,
    slow_flow: f64,
    a02: f64,
    tension: f64,
    m1: f64,
    m2: f64,
    k1: f64,
    k2: f64,
    kc: f64,
    r1: f64,
    r2: f64,
    c1: f64,
    c2: f64,
    dt: f64,
    steps: usize,
    follow: f64,
    mean_follow: f64,
}
impl VocalFolds {
    /// Construct a source at rest with the same defaults as JavaScript.
    pub fn new(options: FoldOptions, source: &GlottisOptions) -> Self {
        Self {
            options,
            breath_gain: source.breath_gain * math::pow(source.breathiness, source.breath_exponent),
            re_critical: source.re_critical,
            aspiration_level: source.aspiration_level,
            started: false,
            mean_area: 0.0,
            mean_stages: [0.0; 3],
            x1: 0.0,
            x2: 0.0,
            v1: 0.0,
            v2: 0.0,
            u: 0.0,
            pressure: 0.0,
            oral_pressure: 0.0,
            slow_flow: 0.0,
            a02: 0.0,
            tension: f64::NAN,
            m1: 0.0,
            m2: 0.0,
            k1: 0.0,
            k2: 0.0,
            kc: 0.0,
            r1: 0.0,
            r2: 0.0,
            c1: 0.0,
            c2: 0.0,
            dt: f64::NAN,
            steps: 1,
            follow: 0.0,
            mean_follow: 0.0,
        }
    }
    fn set_tension(&mut self, q: f64) {
        if q == self.tension {
            return;
        }
        self.tension = q;
        let stiffness = q * self.options.stiffness;
        let mass = self.options.mass / q;
        let damping = self.options.damping / q;
        self.m1 = 0.125 * mass;
        self.m2 = 0.025 * mass;
        self.k1 = 80000.0 * stiffness;
        self.k2 = 8000.0 * stiffness;
        self.kc = 25000.0 * stiffness;
        self.r1 = 20.0 * damping;
        self.r2 = 20.0 * damping;
        self.c1 = (3.0 * self.k1) / (2.0 * self.options.length);
        self.c2 = (3.0 * self.k2) / (2.0 * self.options.length);
    }
    /// One solver step, optionally loaded by the tracts above and below.
    pub fn step(
        &mut self,
        dt: f64,
        control: &GlottalControl,
        noise: f64,
        load: Option<[Load; 2]>,
    ) -> f64 {
        self.set_tension(control.fold_tension.clamp(0.4, 5.0));
        if dt != self.dt {
            self.dt = dt;
            self.steps = max(1.0, math::ceil(dt * 44100.0)) as usize;
            self.follow = 1.0 - math::exp(-dt / 0.003);
            self.mean_follow = lag_factor(dt / 0.005);
        }
        let closure = control.closure;
        let target = max(0.0, control.lung_pressure.unwrap_or(800.0))
            * 10.0
            * (1.0 - closure)
            * if control.creak == 0.0 {
                1.0
            } else {
                1.0 - 0.5 * min(1.0, control.creak)
            };
        let target_area = rest_area(control.adduction);
        if self.started {
            self.pressure += self.follow * (target - self.pressure);
            self.a02 += self.follow * (target_area - self.a02);
        } else {
            self.pressure = target;
            self.a02 = target_area;
        }
        let a02 = self.a02;
        let a01 = a02 + 0.0005;
        let length = self.options.length;
        let two_l = 2.0 * length;
        let mut below_base = 0.0;
        let mut above_base = 0.0;
        let mut below_load = 0.0;
        let mut above_load = 0.0;
        let mut drive = length * 0.25 * self.pressure;
        if let Some([below, above]) = load {
            let oral = max(0.0, control.oral_pressure) * (1.0 - closure);
            self.oral_pressure = if self.started {
                self.oral_pressure + self.follow * (oral - self.oral_pressure)
            } else {
                oral
            };
            let impedance = AIR_DENSITY * SPEED_OF_SOUND;
            below_load = impedance / below.area;
            above_load = impedance / above.area;
            let slow = if self.started { self.slow_flow } else { 0.0 };
            below_base = self.pressure + 2.0 * below.pressure + below_load * slow;
            above_base = self.oral_pressure + 2.0 * above.pressure - above_load * slow;
            drive = (self.pressure - self.oral_pressure) / 2.0 + below.pressure - above.pressure
                + ((below_load + above_load) * slow) / 2.0;
        }
        let h = dt / self.steps as f64;
        let (mut x1, mut x2, mut v1, mut v2) = (self.x1, self.x2, self.v1, self.v2);
        for _ in 0..self.steps {
            let a1 = a01 + two_l * x1;
            let a2 = a02 + two_l * x2;
            let minimum = max(0.0, min(a1, a2));
            let mut f1 = -self.r1 * v1 - self.k1 * x1 - self.kc * (x1 - x2);
            let mut f2 = -self.r2 * v2 - self.k2 * x2 - self.kc * (x2 - x1);
            if let Some([below, above]) = load {
                let u = interactive_flow(
                    minimum,
                    below.area,
                    above.area,
                    drive,
                    self.options.pressure_coefficient,
                );
                let pressure_below = below_base - below_load * u;
                let pressure_above = above_base + above_load * u;
                f2 += length * 0.05 * pressure_above;
                if a1 > 0.0 {
                    let ratio = minimum / a1;
                    f1 += length
                        * 0.25
                        * (pressure_below - (pressure_below - pressure_above) * ratio * ratio);
                } else {
                    f1 += length * 0.25 * pressure_below - self.c1 * a1;
                }
            } else if a1 > 0.0 {
                let ratio = minimum / a1;
                f1 += drive * (1.0 - ratio * ratio);
            } else {
                f1 += drive - self.c1 * a1;
            }
            if a2 < 0.0 {
                f2 -= self.c2 * a2;
            }
            v1 += (h * f1) / self.m1;
            v2 += (h * f2) / self.m2;
            x1 += h * v1;
            x2 += h * v2;
        }
        self.x1 = x1;
        self.x2 = x2;
        self.v1 = v1;
        self.v2 = v2;
        let area = max(0.0, min(a01 + two_l * x1, a02 + two_l * x2));
        let flow = if let Some([below, above]) = load {
            interactive_flow(
                area,
                below.area,
                above.area,
                drive,
                self.options.pressure_coefficient,
            )
        } else {
            area * math::sqrt((2.0 * self.pressure) / AIR_DENSITY)
        };
        let previous = if self.started { self.u } else { flow };
        if self.started {
            let mut input = area * (1.0 - closure);
            for stage in &mut self.mean_stages {
                input = *stage + self.mean_follow * (input - *stage);
                *stage = input;
            }
            self.mean_area = input;
        } else {
            self.mean_area = max(0.0, a02) * (1.0 - closure);
            self.mean_stages.fill(self.mean_area);
        }
        if load.is_some() {
            self.slow_flow = if self.started {
                self.slow_flow + 2.0 * PI * 20.0 * dt * (flow - self.slow_flow)
            } else {
                flow
            };
        }
        self.started = true;
        self.u = flow;
        let derivative = ((flow - previous) / dt) * FLOW_SCALE;
        let voicing = max(0.0, control.voicing) * (1.0 - closure);
        let strength = control.aspiration_strength.unwrap_or_else(|| {
            open_tract_strength_at(self.pressure, self.mean_area, self.re_critical)
        });
        let breath = (control.aspiration + self.breath_gain * voicing) * (1.0 - closure);
        derivative + noise * breath * min(1.0, area / 0.1) * strength * 0.45 * self.aspiration_level
    }
}
