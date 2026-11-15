//! Frequency-dependent losses of the vocal tract walls (issue 36): the
//! parts of `src/acoustics/losses.js` the waveguide uses.
//!
//! The waveguide filters its waves with one first-order shelf per group of
//! sections whose gain follows exp(-K sqrt(f)) from 250 Hz to 8 kHz
//! (`designLossFilter`), and lets its walls yield as a mass, a resistance
//! and a spring per cm². The shelf's pole and loss slopes are fitted once
//! per 500 Hz of step rate (`shelfShape`); [`ShelfCache`] keeps them per
//! waveguide where JavaScript keeps them per module, which gives the same
//! numbers. Parity class B: `cos`, `exp`, `expm1`, `ln` and `pow`, in the
//! order of the JavaScript code.

use alloc::vec::Vec;
use core::f64::consts::PI;

use crate::glottis::SPEED_OF_SOUND;
use crate::math::{self, max};

/// Kinematic viscosity (cm²/s).
const VISCOSITY: f64 = 0.15;
/// Thermal diffusivity (cm²/s).
const DIFFUSIVITY: f64 = 0.21;
/// cp / cv.
const GAMMA: f64 = 1.4;

/// Air density (g/cm³), `AIR_DENSITY` of `constants.js`.
pub const AIR_DENSITY: f64 = 0.00114;
/// Boundary-layer loss relative to a smooth round tube (`LOSS_SHAPE`).
pub const LOSS_SHAPE: f64 = 1.3;
/// Groups of oral sections sharing one loss filter and wall (`LOSS_STAGES`).
pub const LOSS_STAGES: f64 = 5.0;
/// Groups of nose sections (`NOSE_LOSS_STAGES`).
pub const NOSE_LOSS_STAGES: f64 = 2.0;
/// Wall mass (g/cm²), `WALL_MASS`.
pub const WALL_MASS: f64 = 2.1;
/// Wall resistance (g/(cm² s)), `WALL_RESISTANCE`.
pub const WALL_RESISTANCE: f64 = 800.0;
/// Wall stiffness (g/(cm² s²)), `WALL_STIFFNESS`.
pub const WALL_STIFFNESS: f64 = 84_500.0;
/// Sections of a tract whose length is the reference length of the
/// constriction loss (`LOSS_REFERENCE_SECTIONS`).
pub const LOSS_REFERENCE_SECTIONS: f64 = 44.0;
/// Largest |zero| of a loss filter (`ZERO_LIMIT`).
const ZERO_LIMIT: f64 = 0.999;
/// Frequencies of the design grid (`designGrid`).
const GRID_POINTS: usize = 41;

/// Viscous and thermal attenuation (nepers per cm) of a plane wave at
/// `frequency` (Hz) in a tube of `area` (cm²), `shape` times a smooth round
/// tube (`viscothermalLoss`).
pub fn viscothermal_loss(frequency: f64, area: f64, shape: f64) -> f64 {
    let radius = math::sqrt(max(area, 1e-4) / PI);
    (shape
        * math::sqrt(PI * frequency)
        * (math::sqrt(VISCOSITY) + (GAMMA - 1.0) * math::sqrt(DIFFUSIVITY)))
        / (radius * SPEED_OF_SOUND)
}

/// Wall area (cm²) of a section of `area` (cm²) and `length` (cm)
/// (`wallSurface`).
pub fn wall_surface(area: f64, length: f64) -> f64 {
    2.0 * math::sqrt(PI * max(area, 0.0)) * length
}

/// Coefficients of a loss filter y = b0 x + b1 x[n-1] - a1 y[n-1].
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LossFilter {
    /// Gain of the input.
    pub b0: f64,
    /// Gain of the previous input.
    pub b1: f64,
    /// Feedback of the previous output.
    pub a1: f64,
}

/// The pole, slopes and band ends of the best shelf at one rate.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Shelf {
    a: f64,
    low: f64,
    high: f64,
    slope_low: f64,
    slope_high: f64,
    pole_low: f64,
    pole_high: f64,
}

/// The result of `fitShelf`.
#[derive(Clone, Copy, Debug)]
struct Fit {
    a: f64,
    c: f64,
    d: f64,
    error: f64,
}

/// Frequencies (Hz) the loss filter is fitted on (`designGrid`).
fn design_grid(rate: f64) -> [f64; GRID_POINTS] {
    let top = math::min(8000.0, 0.45 * rate);
    let mut grid = [0.0; GRID_POINTS];
    for (index, frequency) in grid.iter_mut().enumerate() {
        *frequency = 250.0 * math::pow(top / 250.0, index as f64 / (GRID_POINTS - 1) as f64);
    }
    grid
}

/// For a pole at -a, the C, D of `fitShelf`.
fn fit_shelf(a: f64, grid: &[f64; GRID_POINTS], rate: f64) -> Fit {
    let mut rows = [(0.0, 0.0); GRID_POINTS];
    for (row, &frequency) in rows.iter_mut().zip(grid) {
        let c = math::cos((2.0 * PI * frequency) / rate);
        let s = math::sqrt(frequency);
        *row = (1.0 / s, (a + c) / (1.0 + a * a + 2.0 * a * c) / s);
    }
    let mut weights = [1.0 / GRID_POINTS as f64; GRID_POINTS];
    let mut best = Fit {
        a,
        c: f64::NAN,
        d: f64::NAN,
        error: f64::INFINITY,
    };
    for _ in 0..40 {
        let (mut s11, mut s12, mut s22, mut t1, mut t2) = (0.0, 0.0, 0.0, 0.0, 0.0);
        for (&(x, y), &w) in rows.iter().zip(&weights) {
            s11 += w * x * x;
            s12 += w * x * y;
            s22 += w * y * y;
            t1 += w * x;
            t2 += w * y;
        }
        let det = s11 * s22 - s12 * s12;
        let c = (t1 * s22 - t2 * s12) / det;
        let d = (s11 * t2 - s12 * t1) / det;
        let mut error: f64 = 0.0;
        let mut total = 0.0;
        for (&(x, y), weight) in rows.iter().zip(weights.iter_mut()) {
            let residual = math::abs(c * x + d * y - 1.0);
            error = max(error, residual);
            *weight *= residual;
            total += *weight;
        }
        if error < best.error {
            best = Fit { a, c, d, error };
        }
        if total.is_nan() || total <= 0.0 {
            break;
        }
        for weight in &mut weights {
            *weight /= total;
        }
    }
    best
}

/// Loss (nepers) of a zero at -b at a frequency with cos w = c (`zeroLoss`).
fn zero_loss(b: f64, c: f64) -> f64 {
    -0.5 * math::ln(1.0 + b * b + 2.0 * b * c)
}

/// The shelf of a rate rounded to 500 Hz (`shelfShape` without its cache).
fn shelf(rate: f64) -> Shelf {
    let grid = design_grid(rate);
    // Golden-section search for the pole.
    let ratio = (math::sqrt(5.0) - 1.0) / 2.0;
    let mut low = -0.98;
    let mut high = 0.5;
    let mut x1 = high - ratio * (high - low);
    let mut x2 = low + ratio * (high - low);
    let mut f1 = fit_shelf(x1, &grid, rate);
    let mut f2 = fit_shelf(x2, &grid, rate);
    for _ in 0..30 {
        if f1.error < f2.error {
            high = x2;
            x2 = x1;
            f2 = f1;
            x1 = high - ratio * (high - low);
            f1 = fit_shelf(x1, &grid, rate);
        } else {
            low = x1;
            x1 = x2;
            f1 = f2;
            x2 = low + ratio * (high - low);
            f2 = fit_shelf(x2, &grid, rate);
        }
    }
    let fit = if f1.error < f2.error { f1 } else { f2 };
    let band_low = math::cos((2.0 * PI * grid[0]) / rate);
    let band_high = math::cos((2.0 * PI * grid[GRID_POINTS - 1]) / rate);
    let a = fit.a;
    let h = |c: f64| (a + c) / (1.0 + math::pow(a, 2.0) + 2.0 * a * c);
    Shelf {
        a,
        low: band_low,
        high: band_high,
        slope_low: fit.c + fit.d * h(band_low),
        slope_high: fit.c + fit.d * h(band_high),
        pole_low: zero_loss(a, band_low),
        pole_high: zero_loss(a, band_high),
    }
}

/// The shelves of the rates a waveguide has asked for (`shelves` and
/// `lastRate` of `losses.js`).
#[derive(Clone, Debug, Default)]
pub struct ShelfCache {
    shelves: Vec<(f64, Shelf)>,
    last: Option<(f64, usize)>,
}

impl ShelfCache {
    /// An empty cache.
    pub fn new() -> Self {
        Self::default()
    }

    fn shape(&mut self, sample_rate: f64) -> Shelf {
        if let Some((rate, index)) = self.last {
            if rate == sample_rate {
                return self.shelves[index].1;
            }
        }
        let rate = max(500.0, math::round_half_up(sample_rate / 500.0) * 500.0);
        let index = match self.shelves.iter().position(|(key, _)| *key == rate) {
            Some(index) => index,
            None => {
                self.shelves.push((rate, shelf(rate)));
                self.shelves.len() - 1
            }
        };
        self.last = Some((sample_rate, index));
        self.shelves[index].1
    }

    /// First-order filter whose gain follows exp(-K sqrt(f)) from 250 Hz to
    /// 8 kHz at `sample_rate` (`designLossFilter`).
    pub fn design(&mut self, k: f64, sample_rate: f64) -> LossFilter {
        let shape = self.shape(sample_rate);
        let want_low = k * shape.slope_low + shape.pole_low;
        let want_high = k * shape.slope_high + shape.pole_high;
        let target = want_low - want_high;
        let gap = -math::expm1(-2.0 * target);
        let q = shape.low - (1.0 - gap) * shape.high;
        let root = math::sqrt(q * q - gap * gap);
        let sign = if q > 0.0 {
            1.0
        } else if q < 0.0 {
            -1.0
        } else {
            q
        };
        let mut zero = if q * q > gap * gap {
            -gap / (q + sign * root)
        } else {
            f64::NAN
        };
        if zero.is_nan() || math::abs(zero) > ZERO_LIMIT {
            let error = zero_loss(ZERO_LIMIT, shape.low) - zero_loss(ZERO_LIMIT, shape.high);
            zero = if error > target {
                ZERO_LIMIT
            } else {
                -ZERO_LIMIT
            };
        }
        let b0 = math::exp(zero_loss(zero, shape.low) - want_low);
        LossFilter {
            b0,
            b1: b0 * zero,
            a1: shape.a,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gain(filter: LossFilter, frequency: f64, rate: f64) -> f64 {
        let c = math::cos((2.0 * PI * frequency) / rate);
        let numerator =
            filter.b0 * filter.b0 + filter.b1 * filter.b1 + 2.0 * filter.b0 * filter.b1 * c;
        let denominator = 1.0 + filter.a1 * filter.a1 + 2.0 * filter.a1 * c;
        math::sqrt(numerator / denominator)
    }

    #[test]
    fn filter_follows_the_square_root_of_frequency_at_the_band_ends() {
        let mut cache = ShelfCache::new();
        let rate = 44.0 * 35_000.0 / 16.5;
        let k = 0.002;
        let filter = cache.design(k, rate);
        for frequency in [250.0, 8000.0] {
            let wanted = math::exp(-k * math::sqrt(frequency));
            let relative =
                math::abs(math::ln(gain(filter, frequency, rate)) / math::ln(wanted) - 1.0);
            assert!(relative < 0.12, "{frequency} Hz: {relative}");
        }
        // The cache gives the same filter again.
        assert_eq!(cache.design(k, rate), filter);
    }

    #[test]
    fn no_loss_is_a_unit_filter() {
        let mut cache = ShelfCache::new();
        let filter = cache.design(0.0, 50_000.0);
        assert!(math::abs(gain(filter, 1000.0, 50_000.0) - 1.0) < 1e-9);
    }

    #[test]
    fn round_tube_loss_matches_flanagan() {
        // About 5.1e-5 shape sqrt(f / area).
        let loss = viscothermal_loss(1000.0, 1.0, 1.0);
        assert!(math::abs(loss / (5.1e-5 * math::sqrt(1000.0)) - 1.0) < 0.05);
        assert_eq!(wall_surface(PI, 1.0), 2.0 * PI);
    }
}
