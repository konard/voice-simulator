//! Fixed-bin statistics and bounded Nelder–Mead for voice fitting (issue 63).
//! JavaScript is the reference; transcendental operations are parity class B.
//! Unlicense.
use crate::math;
use alloc::{vec, vec::Vec};

/// Fixed bins, optionally quarter semitones above 50 Hz.
#[derive(Clone, Copy)]
pub struct Histogram<'a> {
    pub bins: &'a [f64],
    pub min: f64,
    pub step: f64,
    pub pitch: bool,
}
impl Histogram<'_> {
    fn value(&self, index: usize) -> f64 {
        if self.pitch {
            50.0 * math::pow(2.0, index as f64 / 48.0)
        } else {
            self.min + index as f64 * self.step
        }
    }
    pub fn count(&self) -> f64 {
        self.bins.iter().sum()
    }
    /// Linear interpolation between order statistics, including even medians.
    pub fn quantile(&self, p: f64) -> f64 {
        let count = self.count();
        if count == 0.0 {
            return 0.0;
        }
        let at = p * (count - 1.0);
        let mut sum = 0.0;
        let mut lo = None;
        for (index, n) in self.bins.iter().enumerate() {
            sum += n;
            if lo.is_none() && sum > math::floor(at) {
                lo = Some(self.value(index));
            }
            if sum > math::ceil(at) {
                let a = lo.unwrap_or(0.0);
                return a + (self.value(index) - a) * (at - math::floor(at));
            }
        }
        self.value(self.bins.len() - 1)
    }
    /// MAD standard error: twenty 5 ms frames count as one observation.
    pub fn median_sd(&self) -> f64 {
        let count = self.count();
        if count == 0.0 {
            return 0.0;
        }
        let centre = self.quantile(0.5);
        let mut deviations: Vec<_> = self
            .bins
            .iter()
            .enumerate()
            .map(|(i, n)| (math::abs(self.value(i) - centre), *n))
            .collect();
        deviations.sort_by(|a, b| a.0.total_cmp(&b.0));
        let at = (count - 1.0) / 2.0;
        let mut sum = 0.0;
        let mut lo = None;
        let mut mad = 0.0;
        for (d, n) in deviations {
            sum += n;
            if lo.is_none() && sum > math::floor(at) {
                lo = Some(d);
            }
            if sum > math::ceil(at) {
                let a = lo.unwrap_or(0.0);
                mad = a + (d - a) * (at - math::floor(at));
                break;
            }
        }
        let width = if self.pitch {
            centre * (math::pow(2.0, 1.0 / 48.0) - 1.0)
        } else {
            self.step
        };
        1.4826 * math::max(mad, width / 2.0) / math::sqrt(count / 20.0)
    }
}
/// Position in a histogram; non-finite and nonpositive pitch have no bin.
pub fn bin_index(value: f64, min: f64, max: f64, step: f64, pitch: bool) -> Option<usize> {
    if !value.is_finite() || (pitch && value <= 0.0) {
        return None;
    }
    let x = if pitch {
        48.0 * (math::ln(value / 50.0) / core::f64::consts::LN_2)
    } else {
        value
    };
    Some(math::round_half_up((x.clamp(min, max) - min) / step) as usize)
}
/// Linear inverse of the measured HNR table, retaining its low-noise ambiguity.
pub fn table_inverse(value: f64, table: &[(f64, f64)]) -> f64 {
    let mut best = (f64::INFINITY, 0.0);
    for row in table.windows(2) {
        let (a, x) = row[0];
        let (b, y) = row[1];
        let t = ((value - x) / (y - x)).clamp(0.0, 1.0);
        let residual = math::abs(value - (x + (y - x) * t));
        if residual < best.0 {
            best = (residual, a + (b - a) * t);
        }
    }
    best.1
}
/// Mean centered mel energy in dB from accumulated natural-log powers.
pub fn centered_mel(log_power_sums: &[f64], voiced_frames: usize) -> Vec<f64> {
    let mel: Vec<_> = log_power_sums
        .iter()
        .map(|x| 10.0 * x / core::f64::consts::LN_10 / voiced_frames.max(1) as f64)
        .collect();
    let mean = mel.iter().sum::<f64>() / mel.len().max(1) as f64;
    mel.into_iter().map(|x| x - mean).collect()
}
/// Index of the ln syllable rate in the feature vector.
const RATE: usize = 11;
/// Weight of the dF and F1 to F3 terms without a transcript (JS
/// `TEXT_FORMANT_WEIGHT`).
const TEXT_FORMANT_WEIGHT: f64 = 0.1;
/// Syllable rate of an average text over MATCH_TEXT (JS `TEXT_SYLLABLE_RATIO`).
const TEXT_SYLLABLE_RATIO: f64 = 0.9391;
/// Weight of feature `i`: without a transcript the words differ, so the
/// formant terms count less and the mel terms 0.3.
fn term_weight(i: usize, transcript: bool) -> f64 {
    if transcript {
        1.0
    } else if i >= 12 {
        0.3
    } else if (2..=5).contains(&i) {
        TEXT_FORMANT_WEIGHT
    } else {
        1.0
    }
}
/// Feature RMS, with NaN indicating an unavailable feature.
pub fn distance(
    target: &[f64],
    candidate: &[f64],
    scales: &[f64],
    transcript: bool,
    mcd: f64,
) -> f64 {
    let mut sum = 0.0;
    let mut weight = 0.0;
    for (i, ((x, y), scale)) in target.iter().zip(candidate).zip(scales).enumerate() {
        if !x.is_finite() || !y.is_finite() {
            continue;
        }
        // Without a transcript the candidate says MATCH_TEXT: the target's
        // syllable rate as MATCH_TEXT at the same speechRate would read.
        let x = if !transcript && i == RATE {
            x - math::ln(TEXT_SYLLABLE_RATIO)
        } else {
            *x
        };
        let w = term_weight(i, transcript);
        let error = (y - x) / scale;
        sum += w * error * error;
        weight += w;
    }
    if transcript && !mcd.is_finite() {
        return f64::INFINITY;
    }
    if transcript {
        sum += 4.0 * mcd * mcd;
        weight += 4.0;
    }
    if weight > 0.0 {
        math::sqrt(sum / weight)
    } else {
        f64::INFINITY
    }
}
/// Prior penalty in parameter coordinates scaled to 0..1.
pub fn penalty(theta: &[f64], initial: &[f64]) -> f64 {
    0.05 * theta
        .iter()
        .zip(initial)
        .map(|(x, a)| {
            let d = (x - a) / 0.25;
            d * d
        })
        .sum::<f64>()
}
#[derive(Clone, Debug)]
pub struct Vertex {
    pub x: Vec<f64>,
    pub cost: f64,
}
fn evaluate<F: FnMut(&[f64]) -> f64>(
    x: Vec<f64>,
    budget: usize,
    used: &mut usize,
    f: &mut F,
) -> Option<Vertex> {
    if *used >= budget {
        return None;
    }
    *used += 1;
    let x: Vec<_> = x.into_iter().map(|v| v.clamp(0.0, 1.0)).collect();
    Some(Vertex { cost: f(&x), x })
}
/// Returns the final simplex, with at most `budget` calls of `f`.
/// The first vertex is `initial`; remaining vertices move 0.1 towards 0.5.
pub fn simplex<F: FnMut(&[f64]) -> f64>(initial: &[f64], budget: usize, f: F) -> Vec<Vertex> {
    simplex_with_step(initial, budget, 0.1, f)
}

pub fn simplex_with_step<F: FnMut(&[f64]) -> f64>(
    initial: &[f64],
    budget: usize,
    step: f64,
    mut f: F,
) -> Vec<Vertex> {
    if initial.is_empty() || budget == 0 {
        return Vec::new();
    }
    let mut used = 0;
    let mut vertices = vec![evaluate(initial.to_vec(), budget, &mut used, &mut f).unwrap()];
    for i in 0..initial.len() {
        if used >= budget {
            break;
        }
        let mut x = initial.to_vec();
        x[i] += if x[i] < 0.5 { step } else { -step };
        vertices.push(evaluate(x, budget, &mut used, &mut f).unwrap());
    }
    let n = initial.len();
    if vertices.len() < n + 1 {
        return vertices;
    }
    while used < budget {
        vertices.sort_by(|a, b| a.cost.total_cmp(&b.cost));
        if vertices[n].cost - vertices[0].cost < 0.01 {
            break;
        }
        let centre: Vec<_> = (0..n)
            .map(|i| vertices[..n].iter().map(|v| v.x[i]).sum::<f64>() / n as f64)
            .collect();
        let worst = vertices[n].clone();
        let point = |factor: f64| {
            centre
                .iter()
                .zip(&worst.x)
                .map(|(v, x)| (v + factor * (v - x)).clamp(0.0, 1.0))
                .collect()
        };
        let reflected = evaluate(point(1.0), budget, &mut used, &mut f).unwrap();
        if reflected.cost < vertices[0].cost {
            let expanded = evaluate(point(2.0), budget, &mut used, &mut f);
            vertices[n] = match expanded {
                Some(v) if v.cost < reflected.cost => v,
                _ => reflected,
            };
        } else if reflected.cost < vertices[n - 1].cost {
            vertices[n] = reflected;
        } else {
            let outside = reflected.cost < worst.cost;
            if let Some(contracted) = evaluate(
                point(if outside { 0.5 } else { -0.5 }),
                budget,
                &mut used,
                &mut f,
            ) {
                if contracted.cost < if outside { reflected.cost } else { worst.cost } {
                    vertices[n] = contracted;
                } else {
                    for i in 1..vertices.len() {
                        if used >= budget {
                            break;
                        }
                        let x = vertices[0]
                            .x
                            .iter()
                            .zip(&vertices[i].x)
                            .map(|(a, b)| a + 0.5 * (b - a))
                            .collect();
                        vertices[i] = evaluate(x, budget, &mut used, &mut f).unwrap();
                    }
                }
            } else if outside {
                // No budget for contraction: retain the measured improvement.
                vertices[n] = reflected;
            }
        }
    }
    vertices.sort_by(|a, b| a.cost.total_cmp(&b.cost));
    vertices
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_reflection_at_budget_limit() {
        let mut calls = 0;
        let vertices = simplex(&[0.2], 3, |x| {
            calls += 1;
            100.0 * (x[0] - 0.32) * (x[0] - 0.32)
        });
        assert_eq!(calls, 3);
        assert_eq!(vertices.len(), 2);
        assert!((vertices[0].x[0] - 0.3).abs() < 1e-12);
        assert!((vertices[1].x[0] - 0.4).abs() < 1e-12);
    }
    #[test]
    fn bounded_budget_and_convergence() {
        let mut calls = 0;
        let vertices = simplex(&[0.9, 0.1], 80, |x| {
            calls += 1;
            100.0 * ((x[0] - 0.2) * (x[0] - 0.2) + (x[1] - 0.7) * (x[1] - 0.7))
        });
        assert!(calls <= 80);
        assert!(vertices[0].cost < 0.02);
        assert!(vertices
            .iter()
            .all(|v| v.x.iter().all(|x| (0.0..=1.0).contains(x))));
    }
    #[test]
    fn fixed_histogram() {
        let h = Histogram {
            bins: &[0.0, 2.0, 0.0, 2.0],
            min: 10.0,
            step: 5.0,
            pitch: false,
        };
        assert_eq!(h.quantile(0.5), 20.0);
        assert!(h.median_sd() > 0.0);
        assert_eq!(bin_index(40.0, 10.0, 25.0, 5.0, false), Some(3));
    }
}
