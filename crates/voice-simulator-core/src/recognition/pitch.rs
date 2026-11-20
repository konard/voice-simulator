//! Pitch DSP (Unlicense). Coarse FFT values, window correlations and output
//! occupy contiguous f64 arrays indexed by sample/lag. Refined candidates
//! return pairs (lag, height), with a negative lag for an unusable peak.
//! Full-rate frames and mark search consume the original f32 samples.
//! Decimation takes the original f32 samples and f64 low-pass taps, both
//! in time order. Output samples are separated by `factor` input samples.
//! The full-rate frame uses a flat f64 Hann window and returns energy and peak.
use crate::{inverse_dsp::Fft, math};
use alloc::{vec, vec::Vec};
use core::f64::consts::PI;

pub fn decimate(input: &[f32], taps: &[f64], start: i32, factor: u32, output: &mut [f64]) {
    let mut first_tap = i64::from(start);
    for value in output {
        let first = (-first_tap).clamp(0, taps.len() as i64) as usize;
        let end = (input.len() as i64 - first_tap).clamp(0, taps.len() as i64) as usize;
        let mut sum = 0.0;
        if first < end {
            let from = (first_tap + first as i64) as usize;
            for (&weight, &sample) in taps[first..end]
                .iter()
                .zip(&input[from..from + end - first])
            {
                sum += weight * f64::from(sample);
            }
        }
        *value = sum;
        first_tap += i64::from(factor);
    }
}

pub struct CoarseCorrelation {
    fft: Fft,
    real: Vec<f64>,
    imaginary: Vec<f64>,
    power_real: Vec<f64>,
    power_imaginary: Vec<f64>,
    twiddles: Vec<(f64, f64)>,
}

impl CoarseCorrelation {
    pub fn new(size: usize) -> Self {
        let half = size / 2;
        Self {
            fft: Fft::new(half),
            real: vec![0.0; half],
            imaginary: vec![0.0; half],
            power_real: vec![0.0; half],
            power_imaginary: vec![0.0; half],
            twiddles: (0..half)
                .map(|k| {
                    let angle = 2.0 * PI * k as f64 / size as f64;
                    (math::cos(angle), math::sin(angle))
                })
                .collect(),
        }
    }

    pub fn measure(
        &mut self,
        windowed: &[f64],
        window_correlation: &[f64],
        output: &mut [f64],
    ) -> bool {
        self.real.fill(0.0);
        self.imaginary.fill(0.0);
        for (i, pair) in windowed.chunks(2).enumerate() {
            self.real[i] = pair[0];
            self.imaginary[i] = pair.get(1).copied().unwrap_or_default();
        }
        // A real transform packs the even and odd samples into a complex
        // transform of half the length. Recover the two real-input spectra
        // at k and k + N/2 from each conjugate pair.
        self.fft
            .transform(&mut self.real, &mut self.imaginary, false);
        let half = self.real.len();
        for (k, &(cosine, sine)) in self.twiddles.iter().enumerate() {
            let mirror = (half - k) & (half - 1);
            let (ar, ai) = (self.real[k], self.imaginary[k]);
            let (br, bi) = (self.real[mirror], self.imaginary[mirror]);
            let even_re = (ar + br) * 0.5;
            let even_im = (ai - bi) * 0.5;
            let odd_re = (ai + bi) * 0.5;
            let odd_im = (br - ar) * 0.5;
            let shifted_re = cosine * odd_re + sine * odd_im;
            let shifted_im = cosine * odd_im - sine * odd_re;
            // Pack the inverse transform of the real, symmetric power
            // spectrum into even and odd output lags in the same way.
            let mean = even_re * even_re + even_im * even_im + odd_re * odd_re + odd_im * odd_im;
            let difference = 2.0 * (even_re * shifted_re + even_im * shifted_im);
            self.power_real[k] = mean - sine * difference;
            self.power_imaginary[k] = cosine * difference;
        }
        self.fft
            .transform(&mut self.power_real, &mut self.power_imaginary, true);
        let energy = self.power_real[0];
        if energy <= 0.0 {
            return false;
        }
        for (lag, (value, window)) in output.iter_mut().zip(window_correlation).enumerate() {
            let spectrum = if lag % 2 == 0 {
                &self.power_real
            } else {
                &self.power_imaginary
            };
            *value = spectrum[lag / 2] / (energy * window);
        }
        true
    }
}

pub fn window_frame(
    input: &[f32],
    leading_zeros: usize,
    window: &[f64],
    output: &mut [f64],
) -> (f64, f64) {
    debug_assert!(leading_zeros + input.len() <= output.len());
    debug_assert_eq!(window.len(), output.len());
    let mut mean = 0.0;
    let mut largest = 0.0_f64;
    output.fill(0.0);
    for (raw, &value) in output[leading_zeros..].iter_mut().zip(input) {
        *raw = f64::from(value);
        mean += *raw;
        largest = largest.max(raw.abs());
    }
    mean /= output.len() as f64;
    let mut energy = 0.0;
    for (value, &weight) in output.iter_mut().zip(window) {
        *value = (*value - mean) * weight;
        energy += *value * *value;
    }
    (energy, largest)
}

fn peak(a: f64, b: f64, c: f64) -> (f64, f64) {
    let curvature = a - 2.0 * b + c;
    if curvature >= 0.0 {
        return (0.0, b);
    }
    let offset = 0.5 * (a - c) / curvature;
    (offset, b - 0.25 * (a - c) * offset)
}

pub fn refine(
    frame: &[f64],
    window_correlation: &[f64],
    energy: f64,
    centre: i32,
    radius: i32,
) -> (f64, f64) {
    refine_cached(frame, window_correlation, energy, centre, radius, &mut [])
}

pub fn refine_cached(
    frame: &[f64],
    window_correlation: &[f64],
    energy: f64,
    centre: i32,
    radius: i32,
    cache: &mut [f64],
) -> (f64, f64) {
    let mut at = |lag: i32| {
        if lag < 1 || lag as usize >= window_correlation.len() || lag as usize >= frame.len() {
            return -1.0;
        }
        let lag = lag as usize;
        let cached = cache.get_mut(lag);
        if let Some(&value) = cached.as_deref().filter(|value| !value.is_nan()) {
            return value;
        }
        let mut sum = 0.0;
        for (a, b) in frame.iter().zip(&frame[lag..]) {
            sum += a * b;
        }
        let score = sum / (energy * window_correlation[lag]);
        if let Some(cached) = cached {
            *cached = score;
        }
        score
    };
    let mut best = f64::NEG_INFINITY;
    let mut place = -1;
    for lag in centre - radius..=centre + radius {
        let score = at(lag);
        if score > best {
            best = score;
            place = lag;
        }
    }
    if place < 2 {
        return (-1.0, -1.0);
    }
    let (offset, height) = peak(at(place - 1), best, at(place + 1));
    (place as f64 + offset, height.min(1.0))
}

pub fn mark(samples: &[f32], anchor: i32, lo: i32, hi: i32, span: i32) -> f64 {
    let sample = |index: i32| f64::from(samples.get(index as usize).copied().unwrap_or_default());
    let window = |start: i32| {
        let start = usize::try_from(start).ok()?;
        let end = start.checked_add(usize::try_from(span).ok()?)?;
        samples.get(start..end)
    };
    let anchor_samples = window(anchor);
    let anchor_energy = (0..span)
        .map(|t| sample(anchor + t))
        .fold(0.0, |sum, value| sum + value * value);
    let at = |place: i32| {
        let (mut ab, mut bb) = (0.0, 0.0);
        let mut accumulate = |a: f64, b: f64| {
            ab += a * b;
            bb += b * b;
        };
        if let (Some(left), Some(right)) = (anchor_samples, window(place)) {
            for (&a, &b) in left.iter().zip(right) {
                accumulate(f64::from(a), f64::from(b));
            }
        } else {
            for t in 0..span {
                accumulate(sample(anchor + t), sample(place + t));
            }
        }
        if anchor_energy > 0.0 && bb > 0.0 {
            ab / math::sqrt(anchor_energy * bb)
        } else {
            -1.0
        }
    };
    let mut best = f64::NEG_INFINITY;
    let mut place = lo;
    for i in lo..=hi {
        let score = at(i);
        if score > best {
            best = score;
            place = i;
        }
    }
    let (offset, _) = peak(at(place - 1), best, at(place + 1));
    place as f64 + offset.clamp(-0.5, 0.5)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn decimation_matches_the_reference_with_padding_on_both_ends() {
        let mut coarse = [0.0; 5];
        decimate(
            &[1.0, 5.0, -2.0, 3.0],
            &[0.25, 0.5, 0.25],
            -3,
            2,
            &mut coarse,
        );
        assert_eq!(coarse, [0.0, 1.75, 1.0, 0.75, 0.0]);
    }

    #[test]
    fn full_rate_window_centers_samples_with_padding_before_tapering() {
        let mut output = [42.0; 4];
        let (energy, largest) = window_frame(&[3.0, -1.0], 1, &[0.0, 0.5, 0.5, 0.0], &mut output);
        assert_eq!(output, [0.0, 1.25, -0.75, 0.0]);
        assert_eq!(energy, 2.125);
        assert_eq!(largest, 3.0);
    }

    #[test]
    fn real_fft_matches_direct_window_correlation() {
        let frame = [0.2, -0.7, 1.0, 0.4, 0.8];
        let energy: f64 = frame.iter().map(|x| x * x).sum();
        let mut result = [0.0; 6];
        assert!(CoarseCorrelation::new(16).measure(&frame, &[1.0; 6], &mut result));
        for (lag, actual) in result.iter().enumerate() {
            let expected = frame
                .iter()
                .zip(&frame[lag..])
                .map(|(a, b)| a * b)
                .sum::<f64>()
                / energy;
            assert!(
                (actual - expected).abs() < 1e-12,
                "lag {lag}: {actual} != {expected}"
            );
        }
    }

    #[test]
    fn periodic_frame_refines_and_marks_to_first_equal_peak() {
        let frame = [0.0, 1.0, 0.0, -1.0, 0.0, 1.0, 0.0, -1.0];
        let expected = refine(&frame, &[1.0; 6], 4.0, 4, 1);
        assert_eq!(expected, (4.0, 0.5));
        let mut cache = [f64::NAN; 6];
        assert_eq!(
            refine_cached(&frame, &[1.0; 6], 4.0, 4, 1, &mut cache),
            expected
        );
        assert_eq!(cache[4], 0.5);
        let samples = [0.0_f32, 1.0, 0.0, -1.0, 0.0, 1.0, 0.0, -1.0, 0.0, 1.0];
        assert_eq!(mark(&samples, 0, 3, 8, 2), 4.0);
    }
}
