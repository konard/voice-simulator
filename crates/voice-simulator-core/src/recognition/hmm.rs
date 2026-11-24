//! Gaussian HMM scoring of the word decoder (issue 75, Unlicense).
//!
//! Ports `stateScore` of `src/recognition/hmm-model.js` and `applyLda` of
//! `src/recognition/hmm-features.js` with the same order of operations:
//! the mixture means and inverse variances are f32 and every sum is
//! accumulated in f64 (parity class B, `exp` and `ln` from libm).

use crate::math;

/// Diagonal Gaussian mixtures of all states, flat as in the JavaScript
/// model: the mixtures of state `m` are `first[m]..first[m + 1]`, mixture
/// `c` has the means `mu[c * dims..]`, the halved inverse variances
/// `inv[c * dims..]` and the log weight plus normaliser `norm[c]`.
pub struct Mixtures<'a> {
    pub first: &'a [i32],
    pub mu: &'a [f32],
    pub inv: &'a [f32],
    pub norm: &'a [f64],
    pub dims: usize,
}

impl Mixtures<'_> {
    /// Number of states.
    pub fn states(&self) -> usize {
        self.first.len().saturating_sub(1)
    }

    /// Checks that the arrays agree, so `score` cannot index out of range.
    pub fn valid(&self) -> bool {
        let total = self.norm.len();
        self.dims > 0
            && !self.first.is_empty()
            && self.first[0] == 0
            && self.first.windows(2).all(|w| w[0] <= w[1])
            && self.first.last().is_some_and(|&n| n as usize == total)
            && self.mu.len() == total * self.dims
            && self.inv.len() == total * self.dims
    }

    /// Log likelihood of the frame `x` (`dims` values) for state `m`: the
    /// log of the sum of the mixture densities, summed from the largest.
    pub fn score(&self, m: usize, x: &[f32]) -> f64 {
        let dims = self.dims;
        let mut max = f64::NEG_INFINITY;
        let mut sum = 0.0;
        for c in self.first[m] as usize..self.first[m + 1] as usize {
            let mut s = self.norm[c];
            let base = c * dims;
            for d in 0..dims {
                let e = f64::from(x[d]) - f64::from(self.mu[base + d]);
                s -= e * e * f64::from(self.inv[base + d]);
            }
            if s > max {
                sum = sum * math::exp(max - s) + 1.0;
                max = s;
            } else {
                sum += math::exp(s - max);
            }
        }
        max + math::ln(sum)
    }
}

/// Scores of the given states for every frame of `feats` (`dims` values per
/// frame), frame-major: `out[t * states.len() + i]` is state `states[i]` at
/// frame `t`. Returns false when a state is out of range or `out` is too
/// short.
pub fn state_scores(model: &Mixtures, feats: &[f32], states: &[u32], out: &mut [f64]) -> bool {
    let dims = model.dims;
    if dims == 0 || !feats.len().is_multiple_of(dims) {
        return false;
    }
    let frames = feats.len() / dims;
    let count = model.states();
    if out.len() < frames * states.len() || states.iter().any(|&m| m as usize >= count) {
        return false;
    }
    for (t, x) in feats.chunks_exact(dims).enumerate() {
        for (i, &m) in states.iter().enumerate() {
            out[t * states.len() + i] = model.score(m as usize, x);
        }
    }
    true
}

/// Linear discriminant projection of issue 75.
pub struct Lda<'a> {
    /// Frames of context on each side.
    pub ctx: usize,
    /// Values per frame of the statics (`dim / 2` of the JavaScript model).
    pub stat: usize,
    /// `dims` rows of `width = (2 ctx + 1) stat` values.
    pub rows: &'a [f32],
    /// Mean of the stacked statics (`width` values).
    pub mean: &'a [f32],
    /// Output dimensions.
    pub dims: usize,
}

impl Lda<'_> {
    pub fn width(&self) -> usize {
        (2 * self.ctx + 1) * self.stat
    }

    /// Projects the statics (`stat` values per frame, frame-major): each
    /// frame stacks frames t-ctx..t+ctx, clamped at the ends, minus the
    /// mean, times the rows. Returns false when the sizes disagree.
    pub fn apply(&self, statics: &[f64], out: &mut [f32]) -> bool {
        let width = self.width();
        if self.stat == 0
            || !statics.len().is_multiple_of(self.stat)
            || self.rows.len() != self.dims * width
            || self.mean.len() != width
        {
            return false;
        }
        let frames = statics.len() / self.stat;
        if out.len() < frames * self.dims {
            return false;
        }
        let mut x = alloc::vec![0.0f64; width];
        let ctx = self.ctx as isize;
        for t in 0..frames {
            for j in -ctx..=ctx {
                let source = (t as isize + j).clamp(0, frames as isize - 1) as usize;
                let row = &statics[source * self.stat..(source + 1) * self.stat];
                let base = (j + ctx) as usize * self.stat;
                for (d, &value) in row.iter().enumerate() {
                    x[base + d] = value - f64::from(self.mean[base + d]);
                }
            }
            for r in 0..self.dims {
                let base = r * width;
                let mut s = 0.0;
                for d in 0..width {
                    s += f64::from(self.rows[base + d]) * x[d];
                }
                out[t * self.dims + r] = s as f32;
            }
        }
        true
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn one_gaussian_scores_its_log_density() {
        // Unit variance in one dimension: inv = 0.5, norm = -0.5 ln 2π.
        let norm = [-0.5 * math::ln(2.0 * core::f64::consts::PI)];
        let model = Mixtures {
            first: &[0, 1],
            mu: &[1.0],
            inv: &[0.5],
            norm: &norm,
            dims: 1,
        };
        assert!(model.valid());
        let got = model.score(0, &[3.0]);
        assert!((got - (norm[0] - 2.0)).abs() < 1e-12);
    }

    #[test]
    fn two_equal_mixtures_add_ln_two() {
        let model = Mixtures {
            first: &[0, 2],
            mu: &[0.0, 0.0],
            inv: &[0.5, 0.5],
            norm: &[-1.0, -1.0],
            dims: 1,
        };
        let mut out = [0.0; 2];
        assert!(state_scores(&model, &[0.0, 2.0], &[0], &mut out));
        assert!((out[0] - (-1.0 + math::ln(2.0))).abs() < 1e-12);
        assert!((out[1] - (-3.0 + math::ln(2.0))).abs() < 1e-12);
        assert!(!state_scores(&model, &[0.0], &[1], &mut out));
    }

    #[test]
    fn lda_clamps_context_at_the_ends() {
        // One static, one frame of context, a row that sums the stack.
        let lda = Lda {
            ctx: 1,
            stat: 1,
            rows: &[1.0, 1.0, 1.0],
            mean: &[0.0, 0.0, 0.0],
            dims: 1,
        };
        let mut out = [0.0f32; 3];
        assert!(lda.apply(&[1.0, 2.0, 4.0], &mut out));
        assert_eq!(out, [4.0, 7.0, 10.0]);
    }
}
