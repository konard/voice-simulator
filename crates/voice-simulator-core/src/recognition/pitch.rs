//! Pitch DSP (Unlicense). Coarse FFT values, window correlations and output
//! occupy contiguous f64 arrays indexed by sample/lag. Refined candidates
//! return pairs (lag, height), with a negative lag for an unusable peak.
//! Mark search consumes the original f32 samples, with signed local offsets.
use crate::{inverse_dsp::Fft, math};
use alloc::{vec, vec::Vec};

pub struct CoarseCorrelation {
    fft: Fft,
    real: Vec<f64>,
    imaginary: Vec<f64>,
}

impl CoarseCorrelation {
    pub fn new(size: usize) -> Self {
        Self {
            fft: Fft::new(size),
            real: vec![0.0; size],
            imaginary: vec![0.0; size],
        }
    }

    pub fn measure(
        &mut self,
        windowed: &[f64],
        window_correlation: &[f64],
        output: &mut [f64],
    ) -> bool {
        self.real[..windowed.len()].copy_from_slice(windowed);
        self.real[windowed.len()..].fill(0.0);
        self.imaginary.fill(0.0);
        self.fft
            .transform(&mut self.real, &mut self.imaginary, false);
        for (re, im) in self.real.iter_mut().zip(&mut self.imaginary) {
            *re = *re * *re + *im * *im;
            *im = 0.0;
        }
        self.fft
            .transform(&mut self.real, &mut self.imaginary, true);
        if self.real[0] <= 0.0 {
            return false;
        }
        for (lag, value) in output.iter_mut().enumerate() {
            *value = self.real[lag] / (self.real[0] * window_correlation[lag]);
        }
        true
    }
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
    let at = |lag: i32| {
        if lag < 1 || lag as usize >= window_correlation.len() || lag as usize >= frame.len() {
            return -1.0;
        }
        let lag = lag as usize;
        let mut sum = 0.0;
        for (a, b) in frame.iter().zip(&frame[lag..]) {
            sum += a * b;
        }
        sum / (energy * window_correlation[lag])
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
    let at = |place: i32| {
        let (mut ab, mut aa, mut bb) = (0.0, 0.0, 0.0);
        for t in 0..span {
            let a = sample(anchor + t);
            let b = sample(place + t);
            ab += a * b;
            aa += a * a;
            bb += b * b;
        }
        if aa > 0.0 && bb > 0.0 {
            ab / math::sqrt(aa * bb)
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
    fn periodic_frame_refines_and_marks_to_first_equal_peak() {
        let frame = [0.0, 1.0, 0.0, -1.0, 0.0, 1.0, 0.0, -1.0];
        assert_eq!(refine(&frame, &[1.0; 6], 4.0, 4, 1), (4.0, 0.5));
        let samples = [0.0_f32, 1.0, 0.0, -1.0, 0.0, 1.0, 0.0, -1.0, 0.0, 1.0];
        assert_eq!(mark(&samples, 0, 3, 8, 2), 4.0);
    }
}
