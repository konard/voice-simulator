//! Numerical kernels for timed analysis-by-synthesis. Unlicense.
use alloc::{vec, vec::Vec};
use core::f64::consts::{LN_10, PI, SQRT_2};
use core::ops::Range;
use libm::{ceil, cos, log, log10, pow, round, sqrt};

use crate::inverse_dsp::Fft;

/// Piecewise-linear time map with unit slopes outside the anchored interval.
pub fn map_time(anchors: &[[f64; 2]], time: f64, reverse: bool) -> f64 {
    let from = usize::from(reverse);
    let to = 1 - from;
    let index = anchors.partition_point(|edge| edge[from] <= time);
    let before = index.checked_sub(1).and_then(|i| anchors.get(i));
    let after = anchors.get(index);
    match (before, after) {
        (Some(a), Some(b)) if a[from] != a[to] || b[from] != b[to] => {
            let fraction = (time - a[from]) / (b[from] - a[from]);
            a[to] + fraction * (b[to] - a[to])
        }
        (Some(edge), _) | (_, Some(edge)) => time + (edge[to] - edge[from]),
        _ => time,
    }
}

/// Linear interpolation, clamped to the first and last control frame.
pub fn interpolate(values: &[f64], position: f64) -> f64 {
    let index = position.clamp(0.0, (values.len() - 1) as f64);
    let before = index as usize;
    let after = (before + 1).min(values.len() - 1);
    values[before] + (index - before as f64) * (values[after] - values[before])
}

/// Plan-local duration, recording offset, and inverse-warped source frames.
pub fn warp_positions(
    anchors: &[[f64; 2]],
    duration: f64,
    frame_rate: f64,
) -> (f64, f64, Vec<f64>) {
    let offset = map_time(anchors, 0.0, false);
    let duration = map_time(anchors, duration, false) - offset;
    let count = ceil(duration * frame_rate) as usize + 1;
    let positions = (0..count)
        .map(|i| frame_rate * map_time(anchors, offset + i as f64 / frame_rate, true))
        .collect();
    (duration, offset, positions)
}

/// Sample a pitch or loudness track at a warped plan's control frames.
pub fn retime_prosody(
    values: &[f64],
    source_start: f64,
    source_rate: f64,
    offset: f64,
    output_rate: f64,
    count: usize,
) -> Vec<f64> {
    (0..count)
        .map(|i| {
            interpolate(
                values,
                (offset + i as f64 / output_rate - source_start) * source_rate,
            )
        })
        .collect()
}

const FILTERS: usize = 26;

/// Output length in coefficients (excluding c0) and window/hop in samples.
pub fn mfcc_settings(rate: u32) -> (usize, usize, usize) {
    let width = if rate < 16000 { 10 } else { 13 };
    (
        width,
        round(0.025 * f64::from(rate)) as usize,
        round(0.01 * f64::from(rate)) as usize,
    )
}

fn mel_weights(size: usize, rate: f64) -> Vec<Vec<(usize, f64)>> {
    let top = 2595.0 * log10(1.0 + rate / (2.0 * 700.0));
    let edges: Vec<_> = (0..FILTERS + 2)
        .map(|i| 700.0 * (pow(10.0, (top * i as f64 / (FILTERS + 1) as f64) / 2595.0) - 1.0))
        .collect();
    edges
        .windows(3)
        .map(|e| {
            let [left, centre, right] = [e[0], e[1], e[2]];
            (0..=size / 2)
                .filter_map(|k| {
                    let frequency = k as f64 * rate / size as f64;
                    if frequency > left && frequency <= centre {
                        Some((k, (frequency - left) / (centre - left)))
                    } else if frequency > centre && frequency < right {
                        Some((k, (right - frequency) / (right - centre)))
                    } else {
                        None
                    }
                })
                .collect()
        })
        .collect()
}

struct Spectrum {
    fft: Fft,
    window: Vec<f64>,
    filters: Vec<Vec<(usize, f64)>>,
    re: Vec<f64>,
    im: Vec<f64>,
}

impl Spectrum {
    fn new(rate: f64, window: usize) -> Self {
        let size = window.next_power_of_two();
        Self {
            fft: Fft::new(size),
            window: (0..window)
                .map(|i| 0.5 - 0.5 * cos(2.0 * PI * i as f64 / window as f64))
                .collect(),
            filters: mel_weights(size, rate),
            re: vec![0.0; size],
            im: vec![0.0; size],
        }
    }

    fn energies(&mut self, samples: &[f64]) -> [f64; FILTERS] {
        self.re.fill(0.0);
        self.im.fill(0.0);
        for ((re, window), sample) in self.re.iter_mut().zip(&self.window).zip(samples) {
            *re = window * sample;
        }
        self.fft.transform(&mut self.re, &mut self.im, false);
        for (re, im) in self.re.iter_mut().zip(&self.im) {
            *re = *re * *re + im * im;
        }
        core::array::from_fn(|i| self.filters[i].iter().map(|&(k, w)| w * self.re[k]).sum())
    }
}

/// 10 ms hop, 25 ms Hann window, 26 mel bands. Returns row-major c1..cN.
pub fn mfcc(samples: &[f64], rate: u32) -> Vec<f64> {
    if samples.is_empty() {
        return Vec::new();
    }
    let (width, window, hop) = mfcc_settings(rate);
    let count = samples.len().saturating_sub(window) / hop + 1;
    let mut spectrum = Spectrum::new(f64::from(rate), window);
    let energies: Vec<_> = (0..count)
        .map(|i| spectrum.energies(&samples[i * hop..]))
        .collect();
    let floor = (energies.iter().flatten().copied().fold(0.0, f64::max) * 1e-6).max(1e-10);
    let basis: Vec<[f64; FILTERS]> = (1..=width)
        .map(|n| {
            core::array::from_fn(|m| {
                sqrt(2.0 / FILTERS as f64) * cos(PI * n as f64 * (m as f64 + 0.5) / FILTERS as f64)
            })
        })
        .collect();
    let mut out = Vec::with_capacity(count * width);
    for row in energies {
        let logs = row.map(|value| log(value.max(floor)));
        out.extend(
            basis
                .iter()
                .map(|b| b.iter().zip(logs).map(|(w, e)| w * e).sum::<f64>()),
        );
    }
    out
}

/// Mean recording-minus-render bias of corresponding speech frames.
pub fn bias(recording: &[f64], reference: &[f64], speech: &[bool], width: usize) -> Vec<f64> {
    let mut out = vec![0.0; width];
    let mut count = 0;
    for ((x, y), voiced) in recording
        .chunks_exact(width)
        .zip(reference.chunks_exact(width))
        .zip(speech)
    {
        if *voiced {
            for (b, (u, v)) in out.iter_mut().zip(x.iter().zip(y)) {
                *b += u - v;
            }
            count += 1;
        }
    }
    if count > 0 {
        for b in &mut out {
            *b /= f64::from(count);
        }
    }
    out
}

fn distortion(x: &[f64], y: &[f64], bias: &[f64]) -> f64 {
    let squares: f64 = x
        .iter()
        .zip(y)
        .zip(bias)
        .map(|((x, y), b)| {
            let delta = x - y - b;
            delta * delta
        })
        .sum();
    (10.0 * SQRT_2 / LN_10) * sqrt(squares)
}

/// DTW with a 0.1 Sakoe-Chiba band, then mean MCD over in-region pairs.
/// The caller supplies two windows sampled on the same 10 ms grid.
pub fn score(recording: &[f64], render: &[f64], bias: &[f64], region: Range<usize>) -> f64 {
    let width = bias.len();
    let n = recording.len() / width;
    let local = |i, j| {
        distortion(
            &recording[i * width..][..width],
            &render[j * width..][..width],
            bias,
        )
    };
    let mut steps = vec![0_u8; n * n];
    let mut previous = vec![f64::INFINITY; n];
    let mut current = vec![f64::INFINITY; n];
    let norm = (n - 1).max(1) as f64;
    for i in 0..n {
        current.fill(f64::INFINITY);
        for j in 0..n {
            if (i as f64 / norm - j as f64 / norm).abs() > 0.1 {
                continue;
            }
            if i == 0 && j == 0 {
                current[j] = local(i, j);
                continue;
            }
            let mut best = f64::INFINITY;
            let mut step = 0;
            for (value, candidate) in [
                (
                    if i > 0 && j > 0 {
                        previous[j - 1]
                    } else {
                        f64::INFINITY
                    },
                    1,
                ),
                (if i > 0 { previous[j] } else { f64::INFINITY }, 2),
                (if j > 0 { current[j - 1] } else { f64::INFINITY }, 3),
            ] {
                if value < best {
                    best = value;
                    step = candidate;
                }
            }
            current[j] = best + local(i, j);
            steps[i * n + j] = step;
        }
        core::mem::swap(&mut current, &mut previous);
    }
    let (mut i, mut j) = (n - 1, n - 1);
    let mut pairs = Vec::new();
    loop {
        if region.contains(&i) && region.contains(&j) {
            pairs.push((i, j));
        }
        if i == 0 && j == 0 {
            break;
        }
        let step = steps[i * n + j];
        i -= usize::from(step != 3);
        j -= usize::from(step != 2);
    }
    if pairs.is_empty() {
        pairs.extend(region.map(|i| (i, i)));
    }
    pairs.iter().rev().map(|&(i, j)| local(i, j)).sum::<f64>() / pairs.len() as f64
}

/// Local acoustic penalties and J values for one region, in input order.
pub fn alternative_costs(
    phones: usize,
    weight: f64,
    costs: &[f64],
    scores: &[f64],
) -> Vec<[f64; 2]> {
    let scale = weight * phones as f64;
    costs
        .iter()
        .zip(scores)
        .map(|(cost, score)| {
            let penalty = scale * score;
            [penalty, cost + penalty]
        })
        .collect()
}
