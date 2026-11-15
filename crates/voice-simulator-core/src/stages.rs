//! The noise sources and the output stage of the voice renderer: ports of
//! `NoiseSources` and `OutputStage` of `src/acoustics/voice.js`.
//!
//! Parity class B: the biquad coefficients call `sin` and `cos` and the
//! soft limiter `tanh`.

use core::f64::consts::PI;

use alloc::vec::Vec;

use crate::filters::{Biquad, Noise};
use crate::math::{self, min};

/// Overall gain of the output stage (`OUTPUT_GAIN`).
pub const OUTPUT_GAIN: f64 = 0.3;
/// Q of the biquads of a fourth-order Butterworth low-pass.
pub const BUTTERWORTH_4: [f64; 2] = [0.54, 1.31];
/// Q of the biquads of an eighth-order Butterworth low-pass.
pub const BUTTERWORTH_8: [f64; 4] = [0.5098, 0.6013, 0.9, 2.5629];

/// White noise, the aspiration band-pass and the frication band-pass.
#[derive(Clone, Debug)]
pub struct NoiseSources {
    /// White noise of `'<seed>:noise'`.
    pub white: Noise,
    /// Band-pass of the aspiration noise at 800 Hz.
    pub aspiration: Biquad,
    /// Band-pass of the frication noise at the Strouhal frequency.
    pub frication: Biquad,
    /// Step rate the filters are designed for.
    pub rate: f64,
    /// Centre of the frication band-pass (Hz).
    pub frequency: f64,
}

impl NoiseSources {
    /// `new NoiseSources(seed)` with the seed already hashed
    /// (`hashSeed('<seed>:noise')`).
    pub fn new(seed: u32) -> Self {
        Self {
            white: Noise::new(seed),
            aspiration: Biquad::new(),
            frication: Biquad::new(),
            rate: 0.0,
            frequency: 0.0,
        }
    }

    /// Design the aspiration band-pass for the step `rate` unless it is
    /// within 1 % of the last one.
    pub fn configure(&mut self, rate: f64) {
        if math::abs(rate - self.rate) / rate < 0.01 {
            return;
        }
        self.rate = rate;
        self.aspiration.bandpass(800.0, 0.5, rate);
        self.frequency = 0.0;
    }

    /// Centre the frication band-pass on the jet's Strouhal frequency.
    pub fn tune(&mut self, frequency: f64) {
        if math::abs(frequency - self.frequency) <= 1e-3 * frequency {
            return;
        }
        self.frequency = frequency;
        self.frication.bandpass(frequency, 0.5, self.rate);
    }
}

/// Low-pass at the solver rate, DC blocker and soft limiter.
#[derive(Clone, Debug)]
pub struct OutputStage {
    /// Gain before the limiter.
    pub gain: f64,
    qualities: &'static [f64],
    lowpass: Vec<Biquad>,
    dc_input: f64,
    dc_output: f64,
    dc_coefficient: f64,
    /// Cut-off of the low-pass (Hz).
    pub cutoff: f64,
    /// Step rate the low-pass is designed for.
    pub rate: f64,
    band: Vec<Biquad>,
}

impl OutputStage {
    /// `new OutputStage(sampleRate, gain, bandLimit)`; `band_limit` is
    /// `None` without a band limit.
    pub fn new(sample_rate: f64, gain: f64, band_limit: Option<f64>) -> Self {
        let qualities: &'static [f64] = if band_limit.is_some() {
            &BUTTERWORTH_8
        } else {
            &BUTTERWORTH_4
        };
        let cutoff = match band_limit {
            Some(limit) => min(limit, 0.45 * sample_rate),
            None => min(sample_rate * 0.45, 20_000.0),
        };
        let band = match band_limit {
            Some(_) => BUTTERWORTH_8
                .iter()
                .map(|&quality| {
                    let mut filter = Biquad::new();
                    filter.lowpass(cutoff, quality, sample_rate);
                    filter
                })
                .collect(),
            None => Vec::new(),
        };
        Self {
            gain: OUTPUT_GAIN * gain,
            qualities,
            lowpass: qualities.iter().map(|_| Biquad::new()).collect(),
            dc_input: 0.0,
            dc_output: 0.0,
            dc_coefficient: 1.0 - (2.0 * PI * 30.0) / sample_rate,
            cutoff,
            rate: 0.0,
            band,
        }
    }

    /// Design the low-pass for the step `rate` unless it is within 1 % of
    /// the last one.
    pub fn configure(&mut self, rate: f64) {
        if math::abs(rate - self.rate) / rate < 0.01 {
            return;
        }
        self.rate = rate;
        for (filter, &quality) in self.lowpass.iter_mut().zip(self.qualities) {
            filter.lowpass(self.cutoff, quality, rate);
        }
    }

    /// Low-pass one solver output.
    #[inline]
    pub fn filter(&mut self, value: f64) -> f64 {
        let mut result = value;
        for filter in &mut self.lowpass {
            result = filter.process(result);
        }
        result
    }

    /// Band limit, DC blocker and limiter for one output sample.
    #[inline]
    pub fn finish(&mut self, input: f64) -> f64 {
        let mut value = input;
        for filter in &mut self.band {
            value = filter.process(value);
        }
        let output = value - self.dc_input + self.dc_coefficient * self.dc_output;
        self.dc_input = value;
        self.dc_output = output;
        math::tanh(output * self.gain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn configure_skips_close_rates() {
        let mut noise = NoiseSources::new(1);
        noise.configure(46_000.0);
        noise.tune(2000.0);
        assert_eq!(noise.frequency, 2000.0);
        noise.configure(46_100.0);
        assert_eq!(noise.rate, 46_000.0);
        assert_eq!(noise.frequency, 2000.0);
        noise.configure(50_000.0);
        assert_eq!(noise.frequency, 0.0);
    }

    #[test]
    fn band_limit_uses_eighth_order() {
        let wide = OutputStage::new(48_000.0, 1.0, None);
        assert_eq!(wide.lowpass.len(), 2);
        assert_eq!(wide.cutoff, 20_000.0);
        let narrow = OutputStage::new(8000.0, 1.0, Some(3400.0));
        assert_eq!(narrow.lowpass.len(), 4);
        assert_eq!(narrow.band.len(), 4);
        assert_eq!(narrow.cutoff, 3400.0);
    }

    #[test]
    fn silence_stays_silent() {
        let mut stage = OutputStage::new(22_050.0, 1.0, None);
        stage.configure(46_666.0);
        let value = stage.filter(0.0);
        assert_eq!(stage.finish(value), 0.0);
    }
}
