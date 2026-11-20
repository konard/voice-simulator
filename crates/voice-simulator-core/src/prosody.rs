//! Numerical prosody scoring, shared with the timed JS recognition stages.
//! The caller supplies voiced pitch samples and vowel features.
use crate::math;
use alloc::vec;
use alloc::vec::Vec;

pub const TONES: [u32; 6] = [5, 35, 214, 51, 0, 21];
const CONTOURS: [&[f64]; 6] = [
    &[5.0],
    &[3.0, 5.0],
    &[2.0, 1.0, 4.0],
    &[5.0, 1.0],
    &[],
    &[2.0, 1.0],
];
const WEIGHTS: [f64; 4] = [0.4, 0.2, 0.2, 0.2];

pub fn prominence(rows: &[[Option<f64>; 4]]) -> Vec<f64> {
    let mut scores = vec![0.0; rows.len()];
    for (column, weight) in WEIGHTS.into_iter().enumerate() {
        let values = || rows.iter().filter_map(|row| row[column]);
        let count = values().count().max(1) as f64;
        let mean = values().sum::<f64>() / count;
        let sd = math::sqrt(values().map(|x| (x - mean) * (x - mean)).sum::<f64>() / count);
        if sd > 1e-9 {
            for (score, row) in scores.iter_mut().zip(rows) {
                if let Some(x) = row[column] {
                    *score += weight * (x - mean) / sd;
                }
            }
        }
    }
    scores
}

pub struct ToneFit {
    pub observed: [f64; 10],
    pub times: [f64; 10],
    pub value: f64,
    pub duration: f64,
    pub shift: f64,
    pub scale: f64,
}

fn resample(frames: &[f64]) -> [f64; 10] {
    core::array::from_fn(|i| {
        let at = (i * (frames.len() - 1)) as f64 / 9.0;
        let low = at as usize;
        frames[low] + (frames[math::ceil(at) as usize] - frames[low]) * (at - low as f64)
    })
}

fn error(observed: &[f64; 10], predicted: &[f64; 10]) -> f64 {
    let sum = observed
        .iter()
        .zip(predicted)
        .enumerate()
        .map(|(i, (a, b))| {
            let residual = a - b;
            (0.5 + i as f64 / 9.0) * (residual * residual)
        })
        .sum::<f64>();
    math::sqrt(sum / 10.0) / 3.0
}

fn neutral(previous: u32) -> f64 {
    match previous {
        35 => 3.0,
        214 | 21 => 4.0,
        51 => 1.0,
        _ => 2.0,
    }
}

struct Approach {
    from: f64,
    slope: f64,
    rate: f64,
    c1: f64,
    c2: f64,
    c3: f64,
}

impl Approach {
    fn new([value, velocity, acceleration]: [f64; 3], from: f64, slope: f64, rate: f64) -> Self {
        let c1 = value - from + (3.0 * slope) / rate;
        let c2 = velocity + c1 * rate - slope;
        let c3 = (acceleration + 2.0 * c2 * rate - c1 * (rate * rate)) / 2.0;
        Self {
            from,
            slope,
            rate,
            c1,
            c2,
            c3,
        }
    }

    fn evaluate(&self, time: f64) -> [f64; 3] {
        let decay = math::exp(-self.rate * time);
        let polynomial = self.c1 + self.c2 * time + self.c3 * time * time;
        let derivative = self.c2 + 2.0 * self.c3 * time;
        [
            self.slope * time + self.from - (3.0 * self.slope) / self.rate + polynomial * decay,
            self.slope + (derivative - self.rate * polynomial) * decay,
            (2.0 * self.c3 - 2.0 * self.rate * derivative + (self.rate * self.rate) * polynomial)
                * decay,
        ]
    }
}

fn curve(contour: &[f64], previous: u32, fit: &ToneFit, aligned: bool) -> [f64; 10] {
    let neutral_tone = [neutral(previous)];
    let levels = if contour.is_empty() {
        &neutral_tone
    } else {
        contour
    };
    let positions: &[f64] = if levels.len() == 3 {
        &[0.0, 0.4, 1.0]
    } else {
        &[0.0, 1.0]
    };
    let mut state = [fit.value, 0.0, 0.0];
    let mut start = 0.0;
    let mut i = 0;
    let mut curve = [0.0; 10];
    for (j, pair) in positions.windows(2).enumerate() {
        let from = levels[j];
        let to = levels.get(j + 1).copied().unwrap_or(from);
        let duration = (pair[1] - pair[0]) * fit.duration;
        let rate = if from != to {
            40.0
        } else if from <= 2.0 && !contour.is_empty() {
            35.0
        } else {
            25.0
        };
        let from = (from - 3.0) * fit.scale + fit.shift;
        let to = (to - 3.0) * fit.scale + fit.shift;
        let approach = Approach::new(state, from, (to - from) / duration, rate);
        let end = start + duration;
        while i < curve.len() {
            let time = fit.times[i];
            if if aligned {
                time > end + 1e-9
            } else {
                j + 2 < positions.len() && time >= end - 1e-9
            } {
                break;
            }
            curve[i] = approach.evaluate(time - start)[0];
            i += 1;
        }
        state = approach.evaluate(duration);
        start = end;
    }
    if !aligned {
        curve[9] = state[0];
    }
    curve
}

pub fn tone_costs(
    frames: &[f64],
    duration: f64,
    scale: f64,
    previous: u32,
    reduced: bool,
    aligned: Option<&ToneFit>,
) -> Option<[f64; 6]> {
    if frames.len() < 3 || duration <= 0.0 {
        return None;
    }
    let observed = resample(frames);
    let fit = ToneFit {
        observed,
        times: core::array::from_fn(|i| i as f64 / (9.0 / duration)),
        value: observed[0],
        duration,
        shift: 0.0,
        scale,
    };
    Some(CONTOURS.map(|contour| {
        let raw = error(&observed, &curve(contour, previous, &fit, false));
        let distance = aligned.map_or(raw, |fit| {
            0.05 * raw + 0.95 * error(&fit.observed, &curve(contour, previous, fit, true))
        });
        let bonus = if reduced && contour.is_empty() {
            0.3
        } else {
            0.0
        };
        (distance.min(1.0) - bonus).max(0.0)
    }))
}

pub fn tone_penalty(costs: &[f64; 6], tone: u32) -> f64 {
    0.5 * TONES
        .iter()
        .position(|&id| id == tone)
        .map_or(1.0, |i| costs[i])
}

pub fn stress_penalty(primary: Option<usize>, prominence: &[Option<f64>]) -> f64 {
    let best = prominence
        .iter()
        .flatten()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    match primary {
        Some(i) if prominence.len() >= 2 && prominence[i].unwrap_or(f64::NEG_INFINITY) < best => {
            0.3
        }
        _ => 0.0,
    }
}

fn mean(values: &[f64]) -> f64 {
    values.iter().sum::<f64>() / values.len().max(1) as f64
}

fn quantile(values: &[f64], fraction: f64) -> f64 {
    if values.is_empty() {
        return 0.0;
    }
    let mut values = values.to_vec();
    values.sort_by(f64::total_cmp);
    let at = fraction * (values.len() - 1) as f64;
    let low = at as usize;
    values[low] + (values[math::ceil(at) as usize] - values[low]) * (at - low as f64)
}

/// Rising pitch, median level, span, loudness, rise between outer thirds,
/// and difference in upper register from the rest of the utterance.
pub fn phrase_cues(
    voiced: &[f64],
    tail: &[f64],
    phrase_energy: f64,
    utterance_energy: f64,
    other: &[f64],
) -> [f64; 6] {
    let tail_window = tail.len().min(3);
    let third = (voiced.len() / 3).max(1).min(voiced.len());
    let upper = quantile(voiced, 0.95);
    [
        quantile(&tail[tail.len() - tail_window..], 0.5) - quantile(&tail[..tail_window], 0.5),
        quantile(voiced, 0.5),
        upper - quantile(voiced, 0.05),
        10.0 * math::ln(phrase_energy.max(1e-20) / utterance_energy.max(1e-20))
            / core::f64::consts::LN_10,
        mean(&voiced[voiced.len() - third..]) - mean(&voiced[..third]),
        upper - quantile(other, 0.95),
    ]
}

/// Least-squares pitch peak baseline used for focus.
pub fn expected_peak(peaks: &[[f64; 2]], time: f64) -> f64 {
    let count = peaks.len().max(1) as f64;
    let x = peaks.iter().map(|p| p[0]).sum::<f64>() / count;
    let y = peaks.iter().map(|p| p[1]).sum::<f64>() / count;
    let variance = peaks.iter().map(|p| (p[0] - x) * (p[0] - x)).sum::<f64>();
    let covariance = peaks.iter().map(|p| (p[0] - x) * (p[1] - y)).sum::<f64>();
    let slope = if variance == 0.0 {
        0.0
    } else {
        covariance / variance
    };
    y + slope * (time - x)
}
