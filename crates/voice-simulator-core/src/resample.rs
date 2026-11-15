//! Band-limited sample-rate conversion: a port of `src/audio/resample.js`
//! (Blackman-windowed sinc), whole buffers and the streaming form.
//!
//! Parity class B: the kernel calls `sin` and `cos`. The operations are the
//! ones of JavaScript in the same order, so an output differs only where
//! libm and the JavaScript engine round a sine or cosine differently.

use alloc::vec::Vec;
use core::f64::consts::PI;

use crate::math;

/// Zero crossings of the filter of [`resample`] in JavaScript.
pub const ZERO_CROSSINGS: f64 = 16.0;
/// Zero crossings of the filter of [`StreamResampler`] in JavaScript.
pub const STREAM_ZERO_CROSSINGS: f64 = 8.0;

/// A rate is not a positive number.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct BadRate;

fn blackman(x: f64) -> f64 {
    0.42 + 0.5 * math::cos(PI * x) + 0.08 * math::cos(2.0 * PI * x)
}

fn sinc(x: f64) -> f64 {
    if x == 0.0 {
        return 1.0;
    }
    let angle = PI * x;
    math::sin(angle) / angle
}

/// The filter shared by both forms.
#[derive(Clone, Copy, Debug)]
struct Kernel {
    ratio: f64,
    cutoff: f64,
    half_width: f64,
}

impl Kernel {
    fn new(from_rate: f64, to_rate: f64, zero_crossings: f64) -> Result<Self, BadRate> {
        // Refuses NaN too, like `!(rate > 0)` in JavaScript.
        let positive = |rate: f64| rate > 0.0;
        if !positive(from_rate) || !positive(to_rate) {
            return Err(BadRate);
        }
        let ratio = to_rate / from_rate;
        // A small guard band below the lower Nyquist frequency.
        let cutoff = ratio.min(1.0) * 0.97;
        Ok(Self {
            ratio,
            cutoff,
            half_width: zero_crossings / cutoff,
        })
    }

    /// Output `index` from `input`, whose first sample is sample `base` of
    /// the stream; the window stops before sample `limit`.
    fn output(&self, index: usize, input: &[f64], base: usize, limit: usize) -> f64 {
        let center = index as f64 / self.ratio;
        let first = math::ceil(center - self.half_width).max(0.0) as usize;
        let last = math::floor(center + self.half_width);
        let mut sum = 0.0;
        if limit == 0 || last < first as f64 {
            return sum;
        }
        let last = (last as usize).min(limit - 1);
        for source in first..=last {
            let distance = center - source as f64;
            sum += input[source - base]
                * self.cutoff
                * sinc(self.cutoff * distance)
                * blackman(distance / self.half_width);
        }
        sum
    }
}

/// `Math.round(length * toRate / fromRate)`: the output length.
pub fn output_length(length: usize, from_rate: f64, to_rate: f64) -> usize {
    math::round_half_up(length as f64 * (to_rate / from_rate)) as usize
}

/// `resample(samples, fromRate, toRate, {zeroCrossings})` of JavaScript.
pub fn resample(
    samples: &[f32],
    from_rate: f64,
    to_rate: f64,
    zero_crossings: f64,
) -> Result<Vec<f32>, BadRate> {
    let kernel = Kernel::new(from_rate, to_rate, zero_crossings)?;
    if from_rate == to_rate {
        return Ok(samples.to_vec());
    }
    let input: Vec<f64> = samples.iter().map(|&value| f64::from(value)).collect();
    let length = output_length(samples.len(), from_rate, to_rate);
    Ok((0..length)
        .map(|index| kernel.output(index, &input, 0, input.len()) as f32)
        .collect())
}

/// `createStreamResampler(fromRate, toRate, {zeroCrossings})` of
/// JavaScript: the kernel of [`resample`], fed one chunk at a time.
///
/// [`push`](Self::push) returns every output whose whole window has
/// arrived, [`flush`](Self::flush) the rest (missing input counts as 0).
/// Joined, the outputs are those of [`resample`] for the whole input. Only
/// the input that a later output still needs is kept.
#[derive(Clone, Debug)]
pub struct StreamResampler {
    kernel: Kernel,
    /// Equal rates: every chunk is copied through.
    copy: bool,
    /// Kept input: samples `base` .. `base + kept.len() - 1` of the stream.
    kept: Vec<f64>,
    base: usize,
    /// Total input so far and the index of the next output sample.
    received: usize,
    next: usize,
}

impl StreamResampler {
    /// A resampler from `from_rate` to `to_rate` with a filter of
    /// `zero_crossings` ([`STREAM_ZERO_CROSSINGS`] in JavaScript).
    pub fn new(from_rate: f64, to_rate: f64, zero_crossings: f64) -> Result<Self, BadRate> {
        Ok(Self {
            kernel: Kernel::new(from_rate, to_rate, zero_crossings)?,
            copy: from_rate == to_rate,
            kept: Vec::new(),
            base: 0,
            received: 0,
            next: 0,
        })
    }

    /// Input samples held for the outputs still to come.
    pub fn held(&self) -> usize {
        self.kept.len()
    }

    /// Appends `chunk` and returns the outputs that are now complete.
    pub fn push(&mut self, chunk: &[f32]) -> Vec<f32> {
        if self.copy {
            return chunk.to_vec();
        }
        self.kept
            .extend(chunk.iter().map(|&value| f64::from(value)));
        self.received += chunk.len();
        let Kernel {
            ratio, half_width, ..
        } = self.kernel;
        // An output is ready when the last input of its window has arrived.
        let mut end = self.next;
        while math::floor(end as f64 / ratio + half_width) < self.received as f64 {
            end += 1;
        }
        self.take(end)
    }

    /// Returns the outputs still missing for the input so far.
    pub fn flush(&mut self) -> Vec<f32> {
        if self.copy {
            return Vec::new();
        }
        let length = math::round_half_up(self.received as f64 * self.kernel.ratio) as usize;
        self.take(length.max(self.next))
    }

    /// Outputs `next` .. `end - 1`, then drops the input no later output needs.
    fn take(&mut self, end: usize) -> Vec<f32> {
        let result = (self.next..end)
            .map(|index| {
                self.kernel
                    .output(index, &self.kept, self.base, self.received) as f32
            })
            .collect();
        self.next = end;
        let needed = math::ceil(self.next as f64 / self.kernel.ratio - self.kernel.half_width);
        let needed = needed.max(0.0) as usize;
        let drop = needed.saturating_sub(self.base).min(self.kept.len());
        if drop > 0 {
            self.kept.drain(..drop);
            self.base += drop;
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tone(rate: f64, count: usize) -> Vec<f32> {
        (0..count)
            .map(|index| (0.5 * math::sin(2.0 * PI * 440.0 * index as f64 / rate)) as f32)
            .collect()
    }

    #[test]
    fn rejects_bad_rates() {
        assert_eq!(resample(&[], 0.0, 1.0, 16.0).err(), Some(BadRate));
        assert!(StreamResampler::new(1.0, f64::NAN, 8.0).is_err());
    }

    #[test]
    fn lengths_follow_math_round() {
        assert_eq!(output_length(3, 16_000.0, 48_000.0), 9);
        assert_eq!(output_length(1, 48_000.0, 16_000.0), 0);
        assert_eq!(output_length(3, 2.0, 1.0), 2);
        assert_eq!(
            resample(&[0.0; 160], 16_000.0, 44_100.0, 16.0)
                .unwrap()
                .len(),
            441
        );
    }

    #[test]
    fn equal_rates_copy() {
        let mut stream = StreamResampler::new(8_000.0, 8_000.0, 8.0).unwrap();
        assert_eq!(stream.push(&[0.25, -1.0]), [0.25, -1.0]);
        assert!(stream.flush().is_empty());
        assert_eq!(resample(&[0.5], 8_000.0, 8_000.0, 16.0).unwrap(), [0.5]);
    }

    #[test]
    fn stream_joins_to_the_whole_buffer() {
        for (from, to) in [
            (16_000.0, 48_000.0),
            (48_000.0, 44_100.0),
            (8_000.0, 44_100.0),
        ] {
            let input = tone(from, 3_001);
            let whole = resample(&input, from, to, STREAM_ZERO_CROSSINGS).unwrap();
            let mut stream = StreamResampler::new(from, to, STREAM_ZERO_CROSSINGS).unwrap();
            let mut joined = Vec::new();
            for chunk in input.chunks(97) {
                joined.extend(stream.push(chunk));
                // The kept input stays near one filter window.
                assert!(stream.held() < 97 + 64);
            }
            joined.extend(stream.flush());
            assert_eq!(joined.len(), whole.len());
            assert!(joined
                .iter()
                .zip(&whole)
                .all(|(a, b)| a.to_bits() == b.to_bits()));
        }
    }

    #[test]
    fn a_tone_keeps_its_level() {
        let output = resample(&tone(16_000.0, 1_600), 16_000.0, 48_000.0, 16.0).unwrap();
        let peak = output[1_000..3_800]
            .iter()
            .fold(0.0_f32, |max, value| max.max(value.abs()));
        assert!((peak - 0.5).abs() < 0.005);
    }
}
