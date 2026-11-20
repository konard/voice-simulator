//! Numerical primitives of the JS formant tracker (issue 60,
//! `src/recognition/formants.js`), parity class B: the formant candidates
//! of each frame (the roots of the LPC polynomials of orders p, p - 2 and
//! p - 4 by the Aberth-Ehrlich iteration, warm-started from the roots of
//! the frame before) and the tract length of three formants. The dynamic
//! programming numbering, the tract length search, the nasal flag and the
//! Kalman and Rauch-Tung-Striebel smoothing remain JavaScript until issue 77.
use crate::glottis::SPEED_OF_SOUND;
use crate::math::{self, js_hypot};
use alloc::vec;
use alloc::vec::Vec;
use core::f64::consts::PI;

/// Order steps below the frame order: p, p - 2, p - 4 (`ORDER_STEPS`).
pub const ORDER_STEPS: [usize; 3] = [0, 2, 4];
/// Rounds and step tolerance of the Aberth-Ehrlich iteration.
const ABERTH_ROUNDS: usize = 40;
const ABERTH_TOLERANCE: f64 = 1e-6;
/// Start values 0.9 exp(j (2 pi (i + 0.5) / m + 0.1)).
const START_RADIUS: f64 = 0.9;
const START_PHASE: f64 = 0.1;
/// A candidate lies above 90 Hz and 50 Hz below the Nyquist frequency.
const MIN_FREQUENCY: f64 = 90.0;
const NYQUIST_MARGIN: f64 = 50.0;
/// Weights 0.5^2 + 1.5^2 + 2.5^2 of the least-squares tract length.
const LENGTH_WEIGHT: f64 = 0.25 + 2.25 + 6.25;

/// Tract length (cm) of a uniform tube whose formants (2k - 1) c / (4 L)
/// fit F1 to F3 best in the least-squares sense (`tractLengthFromFormants`).
pub fn tract_length_from_formants(f1: f64, f2: f64, f3: f64) -> f64 {
    let spacing = (0.5 * f1 + 1.5 * f2 + 2.5 * f3) / LENGTH_WEIGHT;
    SPEED_OF_SOUND / (2.0 * spacing)
}

/// `ref[k] = (2k - 1) c / (4 L)`, k = 1 .. K, into `out` (index k - 1).
pub fn reference_formants(length: f64, out: &mut [f64]) {
    for (k, value) in out.iter_mut().enumerate() {
        *value = ((2 * k + 1) as f64 * SPEED_OF_SOUND) / (4.0 * length);
    }
}

/// Step-up recursion of `predictorFromReflection` (`src/recognition/lpc.js`):
/// a_1 .. a_order from the reflection coefficients k_1 .. k_order, in place
/// on `a`, which must start at zero.
pub fn predictor_from_reflection(k: &[f64], order: usize, a: &mut [f64]) {
    for m in 1..=order {
        step_up(a, m, k[m - 1], core::convert::identity);
    }
}

pub(crate) fn step_up(a: &mut [f64], order: usize, reflection: f64, round: impl Fn(f64) -> f64) {
    let mut i = 1;
    let mut j = order - 1;
    while i < j {
        let ai = a[i - 1];
        let aj = a[j - 1];
        a[i - 1] = round(ai + reflection * aj);
        a[j - 1] = round(aj + reflection * ai);
        i += 1;
        j -= 1;
    }
    if i == j {
        a[i - 1] = round(a[i - 1] + reflection * a[i - 1]);
    }
    a[order - 1] = round(reflection);
}

/// The start values of the root iteration into `re` and `im`.
#[inline(never)]
pub fn start_roots(re: &mut [f64], im: &mut [f64]) {
    let m = re.len();
    for i in 0..m {
        let angle = (2.0 * PI * (i as f64 + 0.5)) / m as f64 + START_PHASE;
        re[i] = START_RADIUS * math::cos(angle);
        im[i] = START_RADIUS * math::sin(angle);
    }
}

/// Roots of z^m + a_1 z^(m-1) + ... + a_m (m = `re.len()`) by the
/// Aberth-Ehrlich iteration, in place on `re` and `im`. Returns 1 when
/// every step of a round is below the tolerance, 0 after the last round and
/// -1 when a value is not finite, as `aberthRoots` does.
#[inline(never)]
pub fn aberth_roots(a: &[f64], re: &mut [f64], im: &mut [f64]) -> i32 {
    let m = re.len();
    for _ in 0..ABERTH_ROUNDS {
        let mut largest = 0.0;
        for i in 0..m {
            let zr = re[i];
            let zi = im[i];
            // Horner: P(z) and P'(z).
            let mut pr = 1.0;
            let mut pi = 0.0;
            let mut dr = 0.0;
            let mut di = 0.0;
            for &coefficient in &a[..m] {
                let ndr = dr * zr - di * zi + pr;
                di = dr * zi + di * zr + pi;
                dr = ndr;
                let npr = pr * zr - pi * zi + coefficient;
                pi = pr * zi + pi * zr;
                pr = npr;
            }
            let dd = dr * dr + di * di;
            let nr = (pr * dr + pi * di) / dd;
            let ni = (pi * dr - pr * di) / dd;
            let mut sr = 0.0;
            let mut si = 0.0;
            for j in 0..m {
                if j != i {
                    let xr = zr - re[j];
                    let xi = zi - im[j];
                    let xx = xr * xr + xi * xi;
                    sr += xr / xx;
                    si -= xi / xx;
                }
            }
            // w = n / (1 - n s)
            let qr = 1.0 - (nr * sr - ni * si);
            let qi = -(nr * si + ni * sr);
            let qq = qr * qr + qi * qi;
            let wr = (nr * qr + ni * qi) / qq;
            let wi = (ni * qr - nr * qi) / qq;
            re[i] = zr - wr;
            im[i] = zi - wi;
            let step = js_hypot(&[wr, wi]);
            if !re[i].is_finite() || !im[i].is_finite() {
                return -1;
            }
            // A root that P(z) = 0 hits exactly gives 0 / 0 = NaN: no step.
            if step.is_nan() {
                re[i] = zr;
                im[i] = zi;
            } else if step > largest {
                largest = step;
            }
        }
        if largest < ABERTH_TOLERANCE {
            return 1;
        }
    }
    0
}

/// The model orders p, p - 2, p - 4 that are at least 2, then 0 for the
/// orders that are not (they are always the last ones).
pub fn model_orders(order: usize) -> [usize; 3] {
    let mut orders = [0; 3];
    for (m, step) in orders.iter_mut().zip(ORDER_STEPS) {
        if order >= step + 2 {
            *m = order - step;
        }
    }
    orders
}

/// Candidates per frame at most: ceil(sum of m / 2) over the model orders.
pub fn candidate_width(order: usize) -> usize {
    model_orders(order).iter().sum::<usize>().div_ceil(2)
}

/// The root finder of `createRootFinder`: one call of [`RootFinder::find`]
/// per frame, in frame order, because each model order starts from its
/// roots of the frame before.
pub struct RootFinder {
    order: usize,
    reflection: Vec<f64>,
    predictor: Vec<f64>,
    /// Per model order: m real parts, then m imaginary parts.
    roots: Vec<f64>,
    started: [bool; 3],
}

impl RootFinder {
    /// A finder for frames of LPC order `order` (at least 2).
    pub fn new(order: usize) -> Self {
        let total: usize = model_orders(order).iter().sum();
        RootFinder {
            order,
            reflection: vec![0.0; order],
            predictor: vec![0.0; order],
            roots: vec![0.0; 2 * total],
            started: [false; 3],
        }
    }

    /// The raw candidates of one frame from its `order` reflection
    /// coefficients: positive angle, f > 90 Hz, f < rate / 2 - 50 Hz and
    /// B < `max_bandwidth`, with their order rank (0 for p, 1 for p - 2, 2
    /// for p - 4), at most `frequency.len()` of them. Returns how many.
    pub fn find(
        &mut self,
        reflection: &[f32],
        rate: f64,
        max_bandwidth: f64,
        frequency: &mut [f64],
        bandwidth: &mut [f64],
        rank: &mut [f64],
    ) -> usize {
        let width = frequency.len().min(bandwidth.len()).min(rank.len());
        for (value, &input) in self.reflection.iter_mut().zip(reflection) {
            *value = f64::from(input);
        }
        let mut count = 0;
        let mut offset = 0;
        for (index, m) in model_orders(self.order).into_iter().enumerate() {
            if m == 0 {
                break;
            }
            let (re, im) = self.roots[offset..offset + 2 * m].split_at_mut(m);
            offset += 2 * m;
            self.predictor.fill(0.0);
            predictor_from_reflection(&self.reflection, m, &mut self.predictor);
            if !self.started[index] {
                start_roots(re, im);
                self.started[index] = true;
            }
            // Not finite, or no convergence from the roots of the frame
            // before: start again from the first-frame values once.
            if aberth_roots(&self.predictor, re, im) != 1 {
                start_roots(re, im);
                if aberth_roots(&self.predictor, re, im) == -1 {
                    start_roots(re, im);
                    continue;
                }
            }
            for (&x, &y) in re.iter().zip(im.iter()) {
                // `!(im > 0)` of JavaScript, true for NaN.
                if y.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater) {
                    continue;
                }
                let f = (math::atan2(y, x) * rate) / (2.0 * PI);
                let b = (-math::ln(js_hypot(&[x, y])) * rate) / PI;
                if f > MIN_FREQUENCY
                    && f < rate / 2.0 - NYQUIST_MARGIN
                    && b < max_bandwidth
                    && count < width
                {
                    frequency[count] = f;
                    bandwidth[count] = b;
                    rank[count] = index as f64;
                    count += 1;
                }
            }
        }
        count
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn uniform_tube_gives_its_length() {
        let mut refs = [0.0; 3];
        reference_formants(17.5, &mut refs);
        assert_eq!(refs, [500.0, 1500.0, 2500.0]);
        let length = tract_length_from_formants(refs[0], refs[1], refs[2]);
        assert!(math::abs(length - 17.5) < 1e-12);
    }

    #[test]
    fn orders_and_width() {
        assert_eq!(model_orders(18), [18, 16, 14]);
        assert_eq!(model_orders(3), [3, 0, 0]);
        assert_eq!(candidate_width(18), 24);
        assert_eq!(candidate_width(9), 11);
    }

    #[test]
    fn finds_the_roots_of_a_known_polynomial() {
        // (z - 0.5)(z + 0.25)(z^2 + 0.81) = z^4 - 0.25 z^3 + 0.685 z^2
        // - 0.2025 z - 0.10125.
        let a = [-0.25, 0.685, -0.2025, -0.10125];
        let mut re = [0.0; 4];
        let mut im = [0.0; 4];
        start_roots(&mut re, &mut im);
        assert_eq!(aberth_roots(&a, &mut re, &mut im), 1);
        let mut found = [false; 4];
        let expected = [(0.5, 0.0), (-0.25, 0.0), (0.0, 0.9), (0.0, -0.9)];
        for i in 0..4 {
            for (n, &(r, j)) in expected.iter().enumerate() {
                if math::abs(re[i] - r) < 1e-9 && math::abs(im[i] - j) < 1e-9 {
                    found[n] = true;
                }
            }
        }
        assert_eq!(found, [true; 4]);
    }

    #[test]
    fn finds_a_resonance_from_reflection_coefficients() {
        // One pole pair at 1000 Hz with a bandwidth of 100 Hz at 10 kHz:
        // r = exp(-pi B / fs), a1 = -2 r cos(2 pi F / fs), a2 = r^2, so
        // k2 = a2 and k1 = a1 / (1 + a2).
        let rate = 10_000.0;
        let r = math::exp(-PI * 100.0 / rate);
        let a1 = -2.0 * r * math::cos(2.0 * PI * 1000.0 / rate);
        let a2 = r * r;
        let reflection = [(a1 / (1.0 + a2)) as f32, a2 as f32];
        let mut finder = RootFinder::new(2);
        let mut f = [0.0; 1];
        let mut b = [0.0; 1];
        let mut rank = [0.0; 1];
        assert_eq!(
            finder.find(&reflection, rate, 600.0, &mut f, &mut b, &mut rank),
            1
        );
        assert!(math::abs(f[0] - 1000.0) < 0.1);
        assert!(math::abs(b[0] - 100.0) < 0.1);
        assert_eq!(rank[0], 0.0);
    }
}
