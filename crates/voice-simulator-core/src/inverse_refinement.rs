//! Stationary LF/tract projection, matching inverse-refinement.js (Unlicense).
use crate::inverse_dsp::round;
use crate::{
    glottis::{lf_parameters, lf_waveform, LfPulse},
    math,
};
use alloc::{vec, vec::Vec};
struct Template {
    pulse: LfPulse,
    table: Vec<f64>,
}
fn solve(l: &[f64], b: &[f64], p: usize) -> Vec<f64> {
    let mut y = vec![0.0; p];
    let mut a = vec![0.0; p];
    for i in 0..p {
        let mut v = b[i];
        for j in 0..i {
            v -= l[i * p + j] * y[j];
        }
        y[i] = v / l[i * p + i];
    }
    for i in (0..p).rev() {
        let mut v = y[i];
        for j in i + 1..p {
            v -= l[j * p + i] * a[j];
        }
        a[i] = v / l[i * p + i];
    }
    a
}
/// Optional improvement; failures leave the IAIF predictor in place.
pub(crate) struct Refinement {
    templates: Vec<Template>,
}
impl Refinement {
    pub(crate) fn new() -> Self {
        Self {
            templates: (0..38)
                .map(|i| {
                    let pulse = lf_parameters(0.1 + i as f64 * 0.02, 0.2);
                    let table = (0..4096)
                        .map(|n| lf_waveform(&pulse, n as f64 / 4096.0))
                        .collect();
                    Template { pulse, table }
                })
                .collect(),
        }
    }
    pub(crate) fn fit(
        &self,
        s: &[f64],
        p: usize,
        f0: f64,
        rate: f64,
        gci: f64,
    ) -> Option<Vec<f64>> {
        let mut b = vec![0.0; p];
        let mut r = vec![0.0; p * p];
        for n in p..s.len() {
            for i in 0..p {
                let x = s[n - i - 1];
                b[i] += x * s[n];
                for j in 0..=i {
                    r[i * p + j] += x * s[n - j - 1];
                }
            }
        }
        if r[0] <= 1e-20 {
            return None;
        }
        let mut l = vec![0.0; p * p];
        for i in 0..p {
            for j in 0..=i {
                let mut value = r[i * p + j] + if i == j { r[0] * 1e-13 } else { 0.0 };
                for k in 0..j {
                    value -= l[i * p + k] * l[j * p + k];
                }
                if i == j && value <= 0.0 {
                    return None;
                }
                l[i * p + j] = if i == j {
                    math::sqrt(value)
                } else {
                    value / l[j * p + j]
                };
            }
        }
        let ax = solve(&l, &b, p);
        let mut res = vec![0.0; s.len()];
        let mut ep = 0.0;
        for n in p..s.len() {
            res[n] = s[n];
            for i in 0..p {
                res[n] -= ax[i] * s[n - i - 1];
            }
            ep += res[n] * res[n];
        }
        let mut best_error = f64::INFINITY;
        let mut best_i = 0;
        let mut best_shift = 0;
        let mut best = None;
        let candidate = |i: usize, shift: isize| {
            let Template { pulse, table } = &self.templates[i];
            let mut bm = vec![0.0; p];
            let (mut mm, mut rm) = (0.0, 0.0);
            for n in p..s.len() {
                let phase = ((n as f64 - gci - shift as f64) * f0 / rate + pulse.te + 100.0) % 1.0;
                let position = phase * 4096.0;
                let lo = math::floor(position) as usize;
                let m = table[lo] + (table[(lo + 1) % 4096] - table[lo]) * (position - lo as f64);
                mm += m * m;
                rm += m * res[n];
                for j in 0..p {
                    bm[j] += s[n - j - 1] * m;
                }
            }
            let am = solve(&l, &bm, p);
            let mut rr = mm;
            for j in 0..p {
                rr -= bm[j] * am[j];
            }
            let error = 1.0 - rm * rm / (rr * ep);
            if rm > 0.0 && error >= 0.0 {
                Some((
                    error,
                    am.iter()
                        .enumerate()
                        .map(|(j, v)| rm / rr * v - ax[j])
                        .collect(),
                ))
            } else {
                None
            }
        };
        let radius = round(rate * 0.0005) as isize;
        for shift in -radius..=radius {
            for i in (0..38).step_by(6) {
                if let Some((error, a)) = candidate(i, shift) {
                    if error < best_error {
                        best_error = error;
                        best_i = i;
                        best_shift = shift;
                        best = Some(a);
                    }
                }
            }
        }
        let seed_i = best_i;
        let seed_shift = best_shift;
        for i in seed_i.saturating_sub(5)..=37.min(seed_i + 5) {
            if let Some((error, a)) = candidate(i, seed_shift) {
                if error < best_error {
                    best_error = error;
                    best = Some(a);
                }
            }
        }
        if best_error < 0.5 {
            best
        } else {
            None
        }
    }
}
