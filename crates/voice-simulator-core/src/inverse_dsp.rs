//! DSP of `src/recognition/inverse-dsp.js` (Unlicense, parity class B).
use crate::{
    formants::step_up,
    math::{self, cos, sin},
};
use alloc::{vec, vec::Vec};
use core::f64::consts::PI;

pub(crate) fn log10(x: f64) -> f64 {
    math::ln(x) / core::f64::consts::LN_10
}
pub(crate) fn round(x: f64) -> usize {
    math::round_half_up(x) as usize
}
pub(crate) fn hann(n: usize) -> Vec<f64> {
    (0..n)
        .map(|i| 0.5 - 0.5 * cos(2.0 * PI * i as f64 / (n - 1) as f64))
        .collect()
}
pub(crate) fn block(x: &[f64], centre: usize, n: usize) -> Vec<f64> {
    let start = centre as isize - (n / 2) as isize;
    (0..n).map(|i| sample(x, start + i as isize)).collect()
}
pub(crate) fn sample(x: &[f64], i: isize) -> f64 {
    if i < 0 {
        0.0
    } else {
        *x.get(i as usize).unwrap_or(&0.0)
    }
}
pub(crate) fn high_pass(x: &[f64], rate: f64) -> Vec<f64> {
    let mut y = x.to_vec();
    let r = 1.0 - 2.0 * PI * 50.0 / rate;
    for reverse in [false, true] {
        let (mut previous, mut output) = (0.0, 0.0);
        for i in 0..y.len() {
            let n = if reverse { y.len() - 1 - i } else { i };
            let input = y[n];
            output = input - previous + r * output;
            previous = input;
            y[n] = output;
        }
    }
    y
}
pub(crate) fn integrate(x: &[f64], leak: f64) -> Vec<f64> {
    let mut previous = 0.0;
    x.iter()
        .map(|v| {
            previous = *v + leak * previous;
            previous
        })
        .collect()
}
pub(crate) fn filter(x: &[f64], a: &[f64]) -> Vec<f64> {
    let mut y = x.to_vec();
    for n in 0..x.len() {
        for k in 0..a.len().min(n) {
            y[n] += a[k] * x[n - k - 1];
        }
    }
    y
}
fn predictor(x: &[f64], w: &[f64], p: usize) -> Vec<f64> {
    let first = w.iter().position(|v| *v != 0.0).unwrap_or(w.len());
    let x: Vec<f64> = (first..x.len()).map(|n| x[n] * w[n]).collect();
    let mut a = vec![0.0; p];
    let mut r = vec![0.0; p + 1];
    for lag in 0..=p {
        for n in 0..x.len().saturating_sub(lag) {
            r[lag] += x[n] * x[n + lag];
        }
    }
    let mut error = r[0];
    if error <= 0.0 {
        return a;
    }
    for m in 1..=p {
        let mut acc = r[m];
        for j in 1..m {
            acc += a[j - 1] * r[m - j];
        }
        let reflection = -acc / error;
        step_up(&mut a, m, reflection, core::convert::identity);
        error *= 1.0 - reflection * reflection;
    }
    if a.iter().any(|v| !v.is_finite()) {
        a.fill(0.0);
    }
    a
}
pub(crate) fn iaif(s: &[f64], w: &[f64], p: usize, q: usize, leak: f64) -> (Vec<f64>, Vec<f64>) {
    let u1 = filter(s, &predictor(s, w, 1));
    let g1 = integrate(&filter(s, &predictor(&u1, w, p)), leak);
    let u2 = integrate(&filter(s, &predictor(&g1, w, q)), leak);
    let d = filter(s, &predictor(&u2, w, p));
    let g = integrate(&d, leak);
    (d, g)
}
/// Radix-2 Cooley-Tukey; same tables and butterfly order as recognition/fft.js.
pub(crate) struct Fft {
    size: usize,
    cos: Vec<f64>,
    sin: Vec<f64>,
    reversed: Vec<usize>,
}
impl Fft {
    pub(crate) fn new(size: usize) -> Self {
        let bits = size.trailing_zeros();
        Self {
            size,
            cos: (0..size / 2)
                .map(|k| cos(2.0 * PI * k as f64 / size as f64))
                .collect(),
            sin: (0..size / 2)
                .map(|k| sin(2.0 * PI * k as f64 / size as f64))
                .collect(),
            reversed: (0..size)
                .map(|i| i.reverse_bits() >> (usize::BITS - bits))
                .collect(),
        }
    }
    pub(crate) fn transform(&self, re: &mut [f64], im: &mut [f64], inverse: bool) {
        for (i, &j) in self.reversed.iter().enumerate() {
            if j > i {
                re.swap(i, j);
                im.swap(i, j);
            }
        }
        let sign = if inverse { 1.0 } else { -1.0 };
        let mut width = 1;
        while width < self.size {
            let step = self.size / (2 * width);
            for start in (0..self.size).step_by(2 * width) {
                for k in 0..width {
                    let (wr, wi) = (self.cos[k * step], sign * self.sin[k * step]);
                    let (a, b) = (start + k, start + k + width);
                    let (tr, ti) = (re[b] * wr - im[b] * wi, re[b] * wi + im[b] * wr);
                    re[b] = re[a] - tr;
                    im[b] = im[a] - ti;
                    re[a] += tr;
                    im[a] += ti;
                }
            }
            width *= 2;
        }
        if inverse {
            for n in 0..self.size {
                re[n] /= self.size as f64;
                im[n] /= self.size as f64;
            }
        }
    }
}
pub(crate) struct Correlation {
    fft: Fft,
    w: Vec<f64>,
    wc: Vec<f64>,
    re: Vec<f64>,
    im: Vec<f64>,
}
impl Correlation {
    pub(crate) fn new(length: usize) -> Self {
        let size = (2 * length).next_power_of_two();
        let mut v = Self {
            fft: Fft::new(size),
            w: hann(length),
            wc: vec![],
            re: vec![0.0; size],
            im: vec![0.0; size],
        };
        v.re[..length].copy_from_slice(&v.w);
        v.autocorrelate();
        v.wc = v.re[..length].to_vec();
        v
    }
    fn autocorrelate(&mut self) {
        self.fft.transform(&mut self.re, &mut self.im, false);
        for k in 0..self.re.len() {
            self.re[k] = self.re[k] * self.re[k] + self.im[k] * self.im[k];
            self.im[k] = 0.0;
        }
        self.fft.transform(&mut self.re, &mut self.im, true);
    }
    pub(crate) fn measure(&mut self, x: &[f64]) -> Vec<f64> {
        self.re.fill(0.0);
        self.im.fill(0.0);
        let mut mean = 0.0;
        for v in x {
            mean += v / x.len() as f64;
        }
        for (n, v) in x.iter().enumerate() {
            self.re[n] = (v - mean) * self.w[n];
        }
        self.autocorrelate();
        let mut r = vec![0.0; x.len()];
        if self.re[0] > 1e-30 {
            for (lag, v) in r.iter_mut().enumerate() {
                if self.wc[lag] > 1e-12 {
                    *v = self.re[lag] / self.re[0] * (self.wc[0] / self.wc[lag]);
                }
            }
        }
        r
    }
}
pub(crate) fn harmonics(x: &[f64], rate: f64, f0: f64, count: usize) -> Vec<f64> {
    let w = hann(x.len());
    (1..=count)
        .map(|k| {
            let angle = 2.0 * PI * f0 * k as f64 / rate;
            let (cr, ci) = (cos(angle), sin(angle));
            let (mut wr, mut wi, mut re, mut im) = (1.0, 0.0, 0.0, 0.0);
            for n in 0..x.len() {
                re += x[n] * w[n] * wr;
                im -= x[n] * w[n] * wi;
                let next = wr * cr - wi * ci;
                wi = wi * cr + wr * ci;
                wr = next;
            }
            10.0 * log10(re * re + im * im + 1e-24)
        })
        .collect()
}
pub(crate) struct Cpp {
    fft: Fft,
    w: Vec<f64>,
    re: Vec<f64>,
    im: Vec<f64>,
    rate: f64,
    min: f64,
    max: f64,
}
impl Cpp {
    pub(crate) fn new(rate: f64, min: f64, max: f64) -> Self {
        let length = round(0.04 * rate);
        let size = length.next_power_of_two();
        Self {
            fft: Fft::new(size),
            w: hann(length),
            re: vec![0.0; size],
            im: vec![0.0; size],
            rate,
            min,
            max,
        }
    }
    pub(crate) fn measure(&mut self, x: &[f64], centre: usize) -> f64 {
        let start = centre as isize - (self.w.len() / 2) as isize;
        self.re.fill(0.0);
        self.im.fill(0.0);
        for n in 0..self.w.len() {
            self.re[n] = sample(x, start + n as isize) * self.w[n];
        }
        self.fft.transform(&mut self.re, &mut self.im, false);
        for k in 0..self.re.len() {
            self.re[k] = 10.0 * log10(self.re[k] * self.re[k] + self.im[k] * self.im[k] + 1e-12);
            self.im[k] = 0.0;
        }
        self.fft.transform(&mut self.re, &mut self.im, true);
        let first = math::ceil(0.001 * self.rate) as usize;
        let last = (self.re.len() / 2).min(math::floor(self.rate / self.min) as usize);
        let (mut sx, mut sy, mut sxx, mut sxy) = (0.0, 0.0, 0.0, 0.0);
        for (q, &value) in self.re.iter().enumerate().take(last + 1).skip(first) {
            let v = q as f64;
            sx += v;
            sy += value;
            sxx += v * v;
            sxy += v * value;
        }
        let count = (last - first + 1) as f64;
        let slope = (count * sxy - sx * sy) / (count * sxx - sx * sx);
        let intercept = (sy - slope * sx) / count;
        let mut peak = math::ceil(self.rate / self.max) as usize;
        for q in peak + 1..=last {
            if self.re[q] > self.re[peak] {
                peak = q;
            }
        }
        self.re[peak] - intercept - slope * peak as f64
    }
}
pub(crate) fn hnr(x: &[f64], centre: usize, period: f64, w: &[f64]) -> f64 {
    let length = w.len();
    let start = centre as isize - (length / 2) as isize;
    let mut mean = 0.0;
    for n in 0..length {
        mean += sample(x, start + n as isize) / length as f64;
    }
    let mut y = vec![0.0; length];
    let (mut r0, mut w0) = (0.0, 0.0);
    for n in 0..length {
        y[n] = (sample(x, start + n as isize) - mean) * w[n];
        r0 += y[n] * y[n];
        w0 += w[n] * w[n];
    }
    let lag = math::floor(period) as usize;
    let mut value = 0.0;
    for l in lag..=lag + 1 {
        let (mut r, mut wc) = (0.0, 0.0);
        for n in 0..length - l {
            r += y[n] * y[n + l];
            wc += w[n] * w[n + l];
        }
        let v = if r0 > 0.0 && wc > 0.0 {
            r * w0 / (r0 * wc)
        } else {
            0.0
        };
        value += v * if l == lag {
            1.0 - (period - lag as f64)
        } else {
            period - lag as f64
        };
    }
    value = value.clamp(0.001, 0.999);
    10.0 * log10(value / (1.0 - value))
}
