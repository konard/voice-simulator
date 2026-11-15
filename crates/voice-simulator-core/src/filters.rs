//! White noise and RBJ biquads: a port of `src/acoustics/filters.js`.
//!
//! Parity class B: the coefficients call `sin` and `cos`. `process` is
//! class A once the coefficients are equal (it only multiplies and adds,
//! in the order of the JavaScript code).

use core::f64::consts::PI;

use crate::math;
use crate::random::Random;

/// Deterministic white noise in [-1, 1]: `createNoise(seed)` for a seed
/// that `hashSeed` has already turned into a `u32`.
#[derive(Clone, Debug)]
pub struct Noise {
    random: Random,
}

impl Noise {
    /// Noise of `createRandom(seed)`.
    pub fn new(seed: u32) -> Self {
        Self {
            random: Random::new(seed),
        }
    }

    /// The next value: `random() * 2 - 1`.
    pub fn white(&mut self) -> f64 {
        self.random.next() * 2.0 - 1.0
    }
}

/// A second-order section, `Biquad` of `filters.js`.
#[derive(Clone, Debug)]
pub struct Biquad {
    pub b0: f64,
    pub b1: f64,
    pub b2: f64,
    pub a1: f64,
    pub a2: f64,
    pub x1: f64,
    pub x2: f64,
    pub y1: f64,
    pub y2: f64,
}

impl Default for Biquad {
    fn default() -> Self {
        Self::new()
    }
}

impl Biquad {
    /// A filter that passes its input unchanged.
    pub fn new() -> Self {
        Self {
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            x1: 0.0,
            x2: 0.0,
            y1: 0.0,
            y2: 0.0,
        }
    }

    /// Coefficients divided by `a0`.
    pub fn set_coefficients(
        &mut self,
        b0: f64,
        b1: f64,
        b2: f64,
        a0: f64,
        a1: f64,
        a2: f64,
    ) -> &mut Self {
        self.b0 = b0 / a0;
        self.b1 = b1 / a0;
        self.b2 = b2 / a0;
        self.a1 = a1 / a0;
        self.a2 = a2 / a0;
        self
    }

    /// `(cos, alpha)` of `#prepare`.
    fn prepare(frequency: f64, q: f64, rate: f64) -> (f64, f64) {
        let omega = (2.0 * PI * math::min(frequency, rate * 0.49)) / rate;
        let alpha = math::sin(omega) / (2.0 * q);
        (math::cos(omega), alpha)
    }

    /// Low-pass at `frequency` Hz with quality `q` for `rate` samples per second.
    pub fn lowpass(&mut self, frequency: f64, q: f64, rate: f64) -> &mut Self {
        let (cos, alpha) = Self::prepare(frequency, q, rate);
        self.set_coefficients(
            (1.0 - cos) / 2.0,
            1.0 - cos,
            (1.0 - cos) / 2.0,
            1.0 + alpha,
            -2.0 * cos,
            1.0 - alpha,
        )
    }

    /// High-pass, as [`Biquad::lowpass`].
    pub fn highpass(&mut self, frequency: f64, q: f64, rate: f64) -> &mut Self {
        let (cos, alpha) = Self::prepare(frequency, q, rate);
        self.set_coefficients(
            (1.0 + cos) / 2.0,
            -(1.0 + cos),
            (1.0 + cos) / 2.0,
            1.0 + alpha,
            -2.0 * cos,
            1.0 - alpha,
        )
    }

    /// Band-pass (constant 0 dB peak gain), as [`Biquad::lowpass`].
    pub fn bandpass(&mut self, frequency: f64, q: f64, rate: f64) -> &mut Self {
        let (cos, alpha) = Self::prepare(frequency, q, rate);
        self.set_coefficients(alpha, 0.0, -alpha, 1.0 + alpha, -2.0 * cos, 1.0 - alpha)
    }

    /// Filter one sample.
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let output = self.b0 * input + self.b1 * self.x1 + self.b2 * self.x2
            - self.a1 * self.y1
            - self.a2 * self.y2;
        self.x2 = self.x1;
        self.x1 = input;
        self.y2 = self.y1;
        self.y1 = output;
        output
    }

    /// Clear the state, keep the coefficients.
    pub fn reset(&mut self) {
        self.x1 = 0.0;
        self.x2 = 0.0;
        self.y1 = 0.0;
        self.y2 = 0.0;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_filter_passes_its_input() {
        let mut filter = Biquad::new();
        assert_eq!(filter.process(0.25), 0.25);
        assert_eq!(filter.process(-1.0), -1.0);
    }

    #[test]
    fn lowpass_has_unit_gain_at_dc() {
        let mut filter = Biquad::new();
        filter.lowpass(1000.0, 0.6, 48000.0);
        let mut value = 0.0;
        for _ in 0..20000 {
            value = filter.process(1.0);
        }
        assert!((value - 1.0).abs() < 1e-9);
    }

    #[test]
    fn bandpass_blocks_dc() {
        let mut filter = Biquad::new();
        filter.bandpass(800.0, 0.5, 40000.0);
        let mut value = 1.0;
        for _ in 0..20000 {
            value = filter.process(1.0);
        }
        assert!(value.abs() < 1e-9);
    }

    #[test]
    fn noise_is_the_random_generator_scaled() {
        // createNoise(1)() = createRandom(1)() * 2 - 1.
        let mut noise = Noise::new(1);
        let mut random = Random::new(1);
        for _ in 0..8 {
            assert_eq!(
                noise.white().to_bits(),
                (random.next() * 2.0 - 1.0).to_bits()
            );
        }
    }
}
