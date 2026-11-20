//! Acoustic whisper cues on the shared frame grid. Unlicense.
use crate::{
    inverse_dsp::{log10, Fft},
    math,
};
use alloc::{vec, vec::Vec};
use core::f64::consts::PI;

const EPS: f64 = 1e-9;
const RATIO_THRESHOLD: f64 = -20.82;
const TELEPHONE_THRESHOLD: f64 = -26.63;

#[derive(Clone, Copy)]
pub struct Frame {
    pub speech: bool,
    pub energy: f64,
    pub gravity: f64,
    pub f0: f64,
}

#[derive(Clone, Copy)]
pub struct Span {
    pub start: f64,
    pub end: f64,
    pub confidence: f64,
}

pub struct Signal<'a> {
    pub samples: &'a [f64],
    pub rate: f64,
    pub duration: f64,
    pub start: f64,
    pub hop: f64,
    pub frames: &'a [Frame],
}

#[derive(Clone, Copy, PartialEq)]
enum Edge {
    Leading,
    Trailing,
}

impl Signal<'_> {
    fn time(&self, row: usize) -> f64 {
        self.start + row as f64 * self.hop
    }

    fn ratio(&self, start: f64, end: f64) -> f64 {
        let a = (math::floor(start * self.rate) as usize).min(self.samples.len());
        let b = (math::ceil(end * self.rate) as usize).min(self.samples.len());
        energy_ratio(&self.samples[a..b], self.rate)
    }

    fn classify(&self, from: usize, to: usize, edge: Option<Edge>) -> Option<Span> {
        let (start, end) = (
            self.time(from),
            self.time(to).min(self.start + self.duration),
        );
        let mut voiced = 0;
        let mut consecutive = 0;
        let mut vowel_like = 0;
        for frame in &self.frames[from..to] {
            voiced += usize::from(frame.f0 > 0.0);
            consecutive = if frame.gravity < 2500.0 && frame.energy > -95.0 {
                consecutive + 1
            } else {
                0
            };
            vowel_like = vowel_like.max(consecutive);
        }
        let voiced = voiced as f64 / (to - from) as f64;
        if voiced >= 0.05 || vowel_like as f64 * self.hop < 0.05 - EPS {
            return None;
        }
        let threshold = if self.rate <= 8000.0 {
            TELEPHONE_THRESHOLD
        } else {
            RATIO_THRESHOLD
        };
        let mut ratio = self.ratio(start, end);
        if edge.is_some() && ratio < threshold {
            let mut time = start;
            while time + 0.3 <= end + EPS {
                ratio = ratio.max(self.ratio(time, time + 0.3));
                time += 0.15;
            }
        }
        (ratio >= threshold && !(edge == Some(Edge::Leading) && ratio > -10.0)).then(|| Span {
            start,
            end,
            confidence: (1.0 - voiced / 0.05).clamp(0.0, 1.0)
                * ((ratio + 18.0) / 12.0).clamp(0.0, 1.0),
        })
    }

    fn edge_spans(&self, from: usize, to: usize) -> Vec<Span> {
        let frames = &self.frames[from..to];
        let Some(first) = frames.iter().position(|frame| frame.f0 > 0.0) else {
            return Vec::new();
        };
        let last = frames.iter().rposition(|frame| frame.f0 > 0.0).unwrap();
        if (last - first) as f64 * self.hop < 0.08 {
            return Vec::new();
        }
        let peak = |frames: &[Frame]| {
            frames
                .iter()
                .map(|f| f.energy)
                .fold(f64::NEG_INFINITY, f64::max)
        };
        let level = peak(&frames[first..=last]);
        [
            (from, from + first, Edge::Leading),
            (from + last + 1, to, Edge::Trailing),
        ]
        .into_iter()
        .filter(|&(a, b, _)| {
            (b - a) as f64 * self.hop >= 0.3 - EPS && peak(&self.frames[a..b]) <= level - 10.0
        })
        .filter_map(|(a, b, edge)| self.classify(a, b, Some(edge)))
        .collect()
    }

    pub fn find(&self) -> Vec<Span> {
        let mut runs: Vec<(usize, usize)> = Vec::new();
        let mut cursor = 0;
        while cursor < self.frames.len() {
            if !self.frames[cursor].speech {
                cursor += 1;
                continue;
            }
            let from = cursor;
            while cursor < self.frames.len() && self.frames[cursor].speech {
                cursor += 1;
            }
            match runs.last_mut() {
                Some((_, to)) if (from - *to) as f64 * self.hop < 0.2 - EPS => *to = cursor,
                _ => runs.push((from, cursor)),
            }
        }
        let decisions: Vec<_> = runs
            .iter()
            .map(|&(from, to)| {
                if self.time(to).min(self.start + self.duration) - self.time(from) < 0.3 - EPS {
                    Vec::new()
                } else if let Some(span) = self.classify(from, to, None) {
                    vec![span]
                } else {
                    self.edge_spans(from, to)
                }
            })
            .collect();
        let mut spans: Vec<Span> = Vec::new();
        for (i, &(from, to)) in runs.iter().enumerate() {
            let start = self.time(from);
            let end = self.time(to).min(self.start + self.duration);
            let mut inherited = Vec::new();
            if end - start < 0.3 - EPS {
                let back = i
                    .checked_sub(1)
                    .map_or(f64::INFINITY, |j| start - self.time(runs[j].1));
                let forward = runs
                    .get(i + 1)
                    .map_or(f64::INFINITY, |&(a, _)| self.time(a) - end);
                if back.min(forward) <= 0.5 + EPS {
                    let source = if back <= forward {
                        decisions[i - 1].last()
                    } else {
                        decisions[i + 1].first()
                    };
                    if let Some(span) = source {
                        inherited.push(Span {
                            start,
                            end,
                            confidence: span.confidence,
                        });
                    }
                }
            }
            for span in decisions[i].iter().chain(&inherited) {
                match spans.last_mut() {
                    Some(previous) if previous.end + 0.2 > span.start + EPS => {
                        previous.confidence = previous.confidence.min(span.confidence);
                        previous.end = span.end;
                    }
                    _ => spans.push(*span),
                }
            }
        }
        spans
    }
}

fn energy_ratio(samples: &[f64], rate: f64) -> f64 {
    let size = (math::round_half_up(0.04 * rate) as usize).next_power_of_two();
    let bin_width = rate / size as f64;
    let fft = Fft::new(size);
    let window: Vec<_> = (0..size)
        .map(|i| 0.5 - 0.5 * math::cos(2.0 * PI * i as f64 / size as f64))
        .collect();
    let mut re = vec![0.0; size];
    let mut im = vec![0.0; size];
    let mut power = vec![0.0; size / 2 + 1];
    for from in (0..samples.len()).step_by(size / 2) {
        re.fill(0.0);
        im.fill(0.0);
        for (i, &sample) in samples[from..samples.len().min(from + size)]
            .iter()
            .enumerate()
        {
            re[i] = sample * window[i];
        }
        fft.transform(&mut re, &mut im, false);
        for (i, band) in power.iter_mut().enumerate() {
            *band += re[i] * re[i] + im[i] * im[i];
        }
    }
    let band = |from, to| {
        let a = (math::ceil(from / bin_width) as usize).min(power.len());
        let b = (math::ceil(to / bin_width) as usize).min(power.len());
        power[a..b].iter().sum::<f64>().max(1e-20)
    };
    10.0 * log10(band(2500.0, rate / 2.0 + bin_width) / band(50.0, 1000.0))
}

pub fn voicing(ratio: f64, level: f64, cues: &[[f64; 4]; 2]) -> f64 {
    let distance = |&[duration, spread, db, db_spread]: &[f64; 4]| {
        let a = (ratio - duration) / spread.max(1e-6);
        let b = (level - db) / db_spread.max(1e-6);
        math::sqrt(a * a + b * b)
    };
    1.0 / (1.0 + math::exp(distance(&cues[1]) - distance(&cues[0])))
}

pub fn tone_cost(observed: &[f64; 10], curve: &[f64; 10], length: f64, expected: f64) -> f64 {
    let mean = |values: &[f64; 10]| values.iter().sum::<f64>() / 10.0;
    let observed_mean = mean(observed);
    let curve_mean = mean(curve);
    let squared = observed
        .iter()
        .zip(curve)
        .map(|(&db, &st)| {
            let diff = db - observed_mean - 0.7 * (st - curve_mean);
            diff * diff
        })
        .sum::<f64>();
    let shape = (math::sqrt(squared / 10.0) / 4.0).min(1.0);
    let dur = (2.0 * (length - expected).abs()).min(1.0);
    0.25 + 0.5 * (0.6 * shape + 0.4 * dur)
}

pub fn trajectory_distance(input: &[f64], reference: &[f64], width: usize, vowel: bool) -> f64 {
    let level_scale = if vowel { 20.0 } else { 13.0 };
    let total = input
        .chunks_exact(width)
        .zip(reference.chunks_exact(width))
        .map(|(a, b)| {
            let last = width - 1;
            let spectral: f64 = a[..last]
                .iter()
                .zip(&b[..last])
                .map(|(&x, &y)| {
                    let d = x - y;
                    d * d
                })
                .sum();
            let level = (a[last] - b[last]) / level_scale;
            spectral / last as f64 + level * level
        })
        .sum::<f64>();
    total / (input.len() / width) as f64
}

/// Five-frame normalized-power averaging at one time and frequency band.
/// A scale of zero averages linear quantities such as autocorrelation.
pub fn pool_row(rows: &[f64], center: usize, width: usize, scale: f64, output: &mut [f64]) {
    let from = center.saturating_sub(2);
    let to = (center + 3).min(rows.len() / width);
    let count = (to - from) as f64;
    for (band, result) in output.iter_mut().enumerate() {
        if scale == 0.0 {
            *result = (from..to).map(|row| rows[row * width + band] / count).sum();
            continue;
        }
        let power: f64 = (from..to)
            .map(|row| math::exp(rows[row * width + band] * scale))
            .sum();
        *result = math::ln(power / count) / scale;
    }
}
