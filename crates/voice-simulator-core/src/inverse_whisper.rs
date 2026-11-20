//! Acoustic whisper cues on the shared frame grid. Unlicense.
use crate::{
    formants::step_up,
    inverse_dsp::{hann, log10, round, sample, Fft},
    math,
};
use alloc::{vec, vec::Vec};
use core::f64::consts::PI;

const EPS: f64 = 1e-9;
const RATIO_THRESHOLD: f64 = -20.82;
const TELEPHONE_THRESHOLD: f64 = -26.63;
const EDGE_LEVEL_DROP: f64 = 10.0;
const EDGE_RATIO_RISE: f64 = 5.0;
const EDGE_RATIO_ALLOWANCE: f64 = 6.0;
const PERIODIC_FRAME: f64 = 0.6;
const PERIODIC_SHARE: f64 = 0.75;

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

#[derive(Clone, Copy)]
enum Edge {
    Leading,
    AfterVoice { voiced_from: usize, closed: bool },
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

    fn classify(
        &self,
        from: usize,
        to: usize,
        edge: Option<Edge>,
        periodicity: &[f64],
    ) -> Option<Span> {
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
        let base = if self.rate <= 8000.0 {
            TELEPHONE_THRESHOLD
        } else {
            RATIO_THRESHOLD
        };
        let mut threshold = base;
        if let Some(Edge::AfterVoice { voiced_from, .. }) = edge {
            let before = self.time(voiced_from).max(start - 0.3);
            let preceding = self.ratio(before, start);
            threshold =
                (threshold - EDGE_RATIO_ALLOWANCE).max(threshold.min(preceding + EDGE_RATIO_RISE));
        }
        let mut ratio = self.ratio(start, end);
        if edge.is_some() && ratio < threshold {
            let mut time = start;
            while time + 0.3 <= end + EPS {
                ratio = ratio.max(self.ratio(time, time + 0.3));
                time += 0.15;
            }
        }
        let closed = matches!(
            edge,
            Some(Edge::Leading | Edge::AfterVoice { closed: true, .. })
        );
        if ratio < threshold || (closed && ratio > -10.0) {
            return None;
        }
        if self.rate <= 8000.0 && ratio < base {
            let count = periodicity
                .get(from..to)
                .unwrap_or_default()
                .iter()
                .filter(|&&value| value >= PERIODIC_FRAME)
                .count();
            if count as f64 >= PERIODIC_SHARE * (to - from) as f64 {
                return None;
            }
        }
        Some(Span {
            start,
            end,
            confidence: (1.0 - voiced / 0.05).clamp(0.0, 1.0)
                * ((ratio + 18.0) / 12.0).clamp(0.0, 1.0),
        })
    }

    fn edge_spans(&self, from: usize, to: usize, periodicity: &[f64]) -> Vec<Span> {
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
        let first = from + first;
        let last = from + last;
        let level = peak(&self.frames[first..=last]);
        let mut spans = Vec::new();
        let mut consider = |a: usize, b: usize, edge| {
            if (b - a) as f64 * self.hop >= 0.3 - EPS
                && peak(&self.frames[a..b]) <= level - EDGE_LEVEL_DROP
            {
                spans.extend(self.classify(a, b, Some(edge), periodicity));
            }
        };
        consider(from, first, Edge::Leading);
        let mut previous = first;
        for (offset, frame) in self.frames[first + 1..=last].iter().enumerate() {
            if frame.f0 > 0.0 {
                let i = first + 1 + offset;
                consider(
                    previous + 1,
                    i,
                    Edge::AfterVoice {
                        voiced_from: first,
                        closed: true,
                    },
                );
                previous = i;
            }
        }
        consider(
            last + 1,
            to,
            Edge::AfterVoice {
                voiced_from: first,
                closed: false,
            },
        );
        spans
    }

    pub fn find(&self) -> Vec<Span> {
        self.find_with_periodicity(&[])
    }

    /// Frame-aligned normalized autocorrelation corroborates weak pitch edges.
    pub fn find_with_periodicity(&self, periodicity: &[f64]) -> Vec<Span> {
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
                } else if let Some(span) = self.classify(from, to, None, periodicity) {
                    vec![span]
                } else {
                    self.edge_spans(from, to, periodicity)
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

/// Whisper LPC uses the mean autocorrelation across at most five frames.
pub fn pooled_lpc(
    samples: &[f64],
    hop_samples: f64,
    length: usize,
    rows: core::ops::Range<usize>,
    coefficients: &mut [f64],
    reflection: &mut [f64],
) -> f64 {
    let order = coefficients.len();
    let window = hann(length);
    let mut signal = vec![0.0; length];
    let mut pooled = vec![0.0; order + 1];
    let count = rows.len() as f64;
    for row in rows {
        let start = round(row as f64 * hop_samples) as isize - (length / 2) as isize;
        let mut previous = sample(samples, start - 1);
        for (i, value) in signal.iter_mut().enumerate() {
            let current = sample(samples, start + i as isize);
            *value = (current - 0.97 * previous) * window[i];
            previous = current;
        }
        for (lag, value) in pooled.iter_mut().enumerate() {
            let power: f64 = signal[lag..].iter().zip(&signal).map(|(a, b)| a * b).sum();
            *value += (power / length as f64) / count;
        }
    }
    let round = |value: f64| f64::from(value as f32);
    let mut error = pooled[0];
    coefficients.fill(0.0);
    reflection.fill(0.0);
    if error > 0.0 {
        for m in 1..=order {
            let mut acc = pooled[m];
            for j in 1..m {
                acc += coefficients[j - 1] * pooled[m - j];
            }
            let k = -acc / error;
            reflection[m - 1] = round(k);
            step_up(coefficients, m, k, round);
            error *= 1.0 - k * k;
        }
    }
    round(10.0 * log10(error + 1e-10))
}
