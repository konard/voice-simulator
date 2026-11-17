//! Batch glottal inverse filtering and source measures (issue 61, Unlicense).
//! JavaScript reference: src/recognition/inverse-filter.js; parity class B.
use crate::inverse_dsp::*;
use crate::inverse_refinement::Refinement;
use crate::{
    glottis::{lf_parameters, lf_waveform},
    math,
};
use alloc::{collections::BTreeMap, vec, vec::Vec};

/// Borrowed front-end arrays. Only `count` rows and `sample_count` samples
/// are used; times in the returned GCIs include `start_time`.
pub struct Frames<'a> {
    pub rate: f64,
    pub hop: f64,
    pub window: f64,
    pub start_time: f64,
    pub count: usize,
    pub sample_count: usize,
    pub mel_bands: usize,
    pub samples: &'a [f32],
    pub speech: &'a [u8],
    pub periodicity: &'a [f32],
    pub mel: &'a [f32],
}
/// Defaults derive LPC orders from rate when an order is zero.
pub struct Options<'a> {
    pub pitch: Option<&'a [f32]>,
    pub tract_order: usize,
    pub glottis_order: usize,
    pub leak: f64,
    pub step: f64,
    pub min_f0: f64,
    pub max_f0: f64,
}
impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            pitch: None,
            tract_order: 0,
            glottis_order: 0,
            leak: 0.99,
            step: 0.01,
            min_f0: 60.0,
            max_f0: 400.0,
        }
    }
}
/// Percentiles over finite, reliable frames. No values means `None`.
#[derive(Debug)]
pub struct Summary {
    pub median: Option<f64>,
    pub low: Option<f64>,
    pub high: Option<f64>,
    pub frames: usize,
}
/// `measures` columns in order: f0, rd, fit, oq, naq, h1h2,
/// h1h2Source, hnr, cpp. Unvoiced f0 is zero, other columns are NaN.
pub struct Result {
    pub hop: f64,
    pub start_time: f64,
    pub count: usize,
    pub rate: f64,
    pub flow: Vec<f32>,
    pub flow_derivative: Vec<f32>,
    pub gci: Vec<f64>,
    pub measures: Vec<Vec<f32>>,
    pub reliable: Vec<u8>,
    pub low_band: bool,
    pub summary: Vec<Summary>,
}
/// Effective tenseness at the reference breathiness.
pub fn rd_to_tenseness(rd: f64) -> f64 {
    1.0 - rd / 3.0
}
/// Harmonic levels 1..10 of a 256-point unwindowed LF period.
pub fn lf_harmonics(tenseness: f64) -> [f64; 10] {
    let p = lf_parameters(tenseness, 0.2);
    let mut re: Vec<f64> = (0..256)
        .map(|n| lf_waveform(&p, n as f64 / 256.0))
        .collect();
    let mut im = vec![0.0; 256];
    Fft::new(256).transform(&mut re, &mut im, false);
    core::array::from_fn(|k| 10.0 * log10(re[k + 1] * re[k + 1] + im[k + 1] * im[k + 1] + 1e-24))
}
struct Model {
    rd: f64,
    oq: f64,
    levels: [f64; 10],
}
fn models() -> Vec<Model> {
    (0..38)
        .map(|i| {
            let t = 0.1 + i as f64 * 0.02;
            let p = lf_parameters(t, 0.2);
            Model {
                rd: 3.0 * (1.0 - t),
                oq: (p.te + p.ta).min(1.0),
                levels: lf_harmonics(t),
            }
        })
        .collect()
}
fn fit_pulse(h: &[f64], models: &[Model]) -> (f64, f64, f64) {
    let mean = h.iter().sum::<f64>() / h.len() as f64;
    let (mut rd, mut oq, mut best) = (0.0, 0.0, f64::INFINITY);
    for model in models {
        let mut m = 0.0;
        for &level in model.levels.iter().take(h.len()) {
            m += level / h.len() as f64;
        }
        let mut error = 0.0;
        for (k, v) in h.iter().enumerate() {
            let d = (v - mean) - (model.levels[k] - m);
            error += d * d;
        }
        error = math::sqrt(error / h.len() as f64);
        if error < best {
            rd = model.rd;
            oq = model.oq;
            best = error;
        }
    }
    (rd, oq, best)
}
fn local_pitch(frames: &Frames<'_>, x: &[f64], o: &Options<'_>) -> Vec<f32> {
    let mut f0 = vec![0.0; frames.count];
    let length = round(frames.window.max(1.5 / o.min_f0) * frames.rate);
    let mut plan = if o.pitch.is_none() {
        Some(Correlation::new(length))
    } else {
        None
    };
    for t in 0..frames.count {
        if let Some(pitch) = o.pitch {
            let v = pitch[t];
            f0[t] = if v.is_finite() && v > 0.0 { v } else { 0.0 };
        } else if frames.speech[t] != 0 && frames.periodicity[t] >= 0.5 {
            let r = plan.as_mut().unwrap().measure(&block(
                x,
                round(t as f64 * frames.hop * frames.rate),
                length,
            ));
            let mut lag = math::ceil(frames.rate / o.max_f0) as usize;
            for k in lag + 1..=math::floor(frames.rate / o.min_f0) as usize {
                if r[k] > r[lag] {
                    lag = k;
                }
            }
            let curvature = r[lag - 1] - 2.0 * r[lag] + r[lag + 1];
            let offset = if curvature < 0.0 {
                (0.5 * (r[lag - 1] - r[lag + 1]) / curvature).clamp(-0.5, 0.5)
            } else {
                0.0
            };
            f0[t] = (frames.rate / (lag as f64 + offset)) as f32;
        }
    }
    if o.pitch.is_some() {
        return f0;
    }
    (0..f0.len())
        .map(|t| {
            if f0[t] == 0.0 {
                return 0.0;
            }
            let mut values: Vec<f32> = f0[t.saturating_sub(2)..f0.len().min(t + 3)]
                .iter()
                .copied()
                .filter(|v| *v > 0.0)
                .collect();
            values.sort_by(f32::total_cmp);
            values[values.len() / 2]
        })
        .collect()
}
fn minimum(x: &[f64], first: f64, last: f64) -> usize {
    let mut best = math::ceil(first).max(0.0) as usize;
    let end = math::floor(last).max(0.0) as usize;
    for n in best + 1..=end.min(x.len() - 1) {
        if x[n] < x[best] {
            best = n;
        }
    }
    best
}
fn refine_stationary(
    frames: &Frames<'_>,
    raw: &[f64],
    f0: &[f32],
    o: &Options<'_>,
    x: &[f64],
    d: &mut [f64],
    g: &mut [f64],
) {
    if o.tract_order > 32 {
        return;
    }
    let (rate, hop) = (frames.rate, frames.hop);
    let mut t = 0;
    let mut refinement = None;
    while t < f0.len() {
        if f0[t] == 0.0 {
            t += 1;
            continue;
        }
        let first = t;
        while t < f0.len() && f0[t] > 0.0 {
            t += 1;
        }
        if (t - first) as f64 * hop < 0.2 {
            continue;
        }
        let centre = round((first + t - 1) as f64 * hop * rate / 2.0);
        let pitch = f0[(first + t - 1) / 2] as f64;
        let mut steady = true;
        for v in &f0[first..t] {
            if math::abs(*v as f64 / pitch - 1.0) > 0.01 {
                steady = false;
            }
        }
        if !steady {
            continue;
        }
        let length = round(0.064 * rate);
        let mut reference: Option<Vec<f64>> = None;
        for fraction in [0.25, 0.5, 0.75] {
            let position = round((first as f64 + fraction * (t - first - 1) as f64) * hop * rate);
            let mut h = harmonics(
                &block(raw, position, round(4.0 * rate / pitch)),
                rate,
                pitch,
                10,
            );
            let mean = h.iter().sum::<f64>() / h.len() as f64;
            for v in &mut h {
                *v -= mean;
            }
            if let Some(previous) = &reference {
                for k in 0..h.len() {
                    if math::abs(h[k] - previous[k]) > 1.0 {
                        steady = false;
                    }
                }
            }
            reference = Some(h);
        }
        if !steady {
            continue;
        }
        let seed = minimum(
            d,
            centre as f64 - 0.5 * rate / pitch,
            centre as f64 + 0.5 * rate / pitch,
        );
        let fitter = refinement.get_or_insert_with(Refinement::new);
        let Some(a) = fitter.fit(
            &block(raw, centre, length),
            o.tract_order,
            pitch,
            rate,
            seed as f64 - centre as f64 + (length / 2) as f64,
        ) else {
            continue;
        };
        let left = round(((first as f64 - 0.5) * hop * rate).max(0.0));
        let right = x.len().min(round((t as f64 - 0.5) * hop * rate));
        let start = left.saturating_sub(round(0.05 * rate));
        let residual = filter(&x[start..right], &a);
        let flow = integrate(&residual, o.leak);
        let fade = round(0.032 * rate) as f64;
        for n in left..right {
            let mix = 1.0_f64
                .min((n - left) as f64 / fade)
                .min((right - 1 - n) as f64 / fade);
            d[n] = d[n] * (1.0 - mix) + residual[n - start] * mix;
            g[n] = g[n] * (1.0 - mix) + flow[n - start] * mix;
        }
    }
}
fn recover(frames: &Frames<'_>, raw: &[f64], f0: &[f32], o: &Options<'_>) -> (Vec<f32>, Vec<f32>) {
    let x = high_pass(raw, frames.rate);
    let mut d = vec![0.0; x.len()];
    let mut g = vec![0.0; x.len()];
    let mut weight = vec![0.0; x.len()];
    let mut windows = BTreeMap::new();
    let mut time = 0.0;
    while time < x.len() as f64 / frames.rate {
        let row = (f0.len() - 1).min(round(time / frames.hop));
        if f0[row] > 0.0 {
            let centre = round(time * frames.rate);
            let length = round(0.032_f64.max(2.5 / f0[row] as f64) * frames.rate);
            let w = windows.entry(length).or_insert_with(|| hann(length));
            let history = round(0.05 * frames.rate);
            let mut extended_w = vec![0.0; history + length];
            extended_w[history..].copy_from_slice(w);
            let start = centre as isize - (length / 2) as isize;
            let extended: Vec<f64> = (0..history + length)
                .map(|n| sample(&x, start - history as isize + n as isize))
                .collect();
            let (pd, pg) = iaif(
                &extended,
                &extended_w,
                o.tract_order,
                o.glottis_order,
                o.leak,
            );
            for n in 0..length {
                let index = start + n as isize;
                if index >= 0 && (index as usize) < x.len() {
                    let i = index as usize;
                    d[i] += w[n] * pd[n + history];
                    g[i] += w[n] * pg[n + history];
                    weight[i] += w[n];
                }
            }
        }
        time += o.step;
    }
    for n in 0..x.len() {
        let row = (f0.len() - 1).min(round(n as f64 / (frames.rate * frames.hop)));
        if weight[n] > 0.01 && f0[row] > 0.0 {
            d[n] /= weight[n];
            g[n] /= weight[n];
        } else {
            d[n] = 0.0;
            g[n] = 0.0;
        }
    }
    refine_stationary(frames, raw, f0, o, &x, &mut d, &mut g);
    (
        g.into_iter().map(|v| v as f32).collect(),
        d.into_iter().map(|v| v as f32).collect(),
    )
}
fn closures(frames: &Frames<'_>, f0: &[f32], d: &[f64]) -> Vec<f64> {
    let mut marks = vec![];
    let (rate, hop) = (frames.rate, frames.hop);
    let mut t = 0;
    while t < f0.len() {
        if f0[t] == 0.0 {
            t += 1;
            continue;
        }
        let first = t;
        while t < f0.len() && f0[t] > 0.0 {
            t += 1;
        }
        let left = round(((first as f64 - 0.5) * hop * rate).max(0.0)) as f64;
        let right = ((d.len() - 1) as f64).min(round((t as f64 - 0.5) * hop * rate) as f64);
        let middle = (left + right) / 2.0;
        let seed = minimum(
            d,
            left.max(middle - 0.015 * rate),
            right.min(middle + 0.015 * rate),
        );
        marks.push(seed);
        for direction in [-1.0, 1.0] {
            let mut n = seed;
            loop {
                let row = (f0.len() - 1).min(first.max(round(n as f64 / (hop * rate))));
                let period = rate / f0[row] as f64;
                let expected = n as f64 + direction * period;
                if expected < left || expected > right {
                    break;
                }
                let next = minimum(
                    d,
                    left.max(expected - 0.3 * period),
                    right.min(expected + 0.3 * period),
                );
                if direction * (next as f64 - n as f64) < 0.5 * period {
                    break;
                }
                marks.push(next);
                n = next;
            }
        }
    }
    marks.sort_unstable();
    marks
        .into_iter()
        .map(|n| frames.start_time + n as f64 / rate)
        .collect()
}
fn low_band(frames: &Frames<'_>, f0: &[f32]) -> bool {
    let bands = frames.mel_bands;
    let mel = |f: f64| 2595.0 * log10(1.0 + f / 700.0);
    let bottom = mel(60.0);
    let top = mel((frames.rate / 2.0).min(7600.0));
    let (mut low, mut mid) = (vec![], vec![]);
    for m in 0..bands {
        let hz = 700.0
            * (math::pow(
                10.0,
                (bottom + (top - bottom) * (m + 1) as f64 / (bands + 1) as f64) / 2595.0,
            ) - 1.0);
        if hz < 250.0 {
            low.push(m);
        }
        if (300.0..=1000.0).contains(&hz) {
            mid.push(m);
        }
    }
    if low.is_empty() || mid.is_empty() {
        return true;
    }
    let (mut sum, mut count) = (0.0, 0);
    for (t, v) in f0.iter().enumerate() {
        if *v == 0.0 {
            continue;
        }
        let average = |indices: &[usize]| {
            indices
                .iter()
                .map(|m| frames.mel[t * bands + m] as f64)
                .sum::<f64>()
                / indices.len() as f64
        };
        sum += average(&low) - average(&mid);
        count += 1;
    }
    count == 0 || sum / count as f64 >= -4.6
}
fn summarize(values: &[f32], reliable: &[u8]) -> Summary {
    let mut x: Vec<f64> = values
        .iter()
        .enumerate()
        .filter(|(t, v)| reliable[*t] != 0 && v.is_finite())
        .map(|(_, v)| *v as f64)
        .collect();
    x.sort_by(f64::total_cmp);
    let percentile = |p: f64| {
        if x.is_empty() {
            return None;
        }
        let index = p * (x.len() - 1) as f64;
        let i = math::floor(index) as usize;
        Some(x[i] + (x[(i + 1).min(x.len() - 1)] - x[i]) * (index - i as f64))
    };
    Summary {
        median: percentile(0.5),
        low: percentile(0.25),
        high: percentile(0.75),
        frames: x.len(),
    }
}
/// No streaming state. Invalid input returns an error without running DSP.
pub fn inverse_filter(
    frames: &Frames<'_>,
    mut o: Options<'_>,
) -> core::result::Result<Result, &'static str> {
    let rate = frames.rate;
    if !rate.is_finite() || !(8000.0..=48000.0).contains(&rate) {
        return Err("invalid working rate");
    }
    if o.tract_order == 0 {
        o.tract_order = 2 * round(rate / 2000.0) + 4;
    }
    if o.glottis_order == 0 {
        o.glottis_order = 2 * round(rate / 4000.0);
    }
    if !o.min_f0.is_finite()
        || o.min_f0 < 20.0
        || !o.max_f0.is_finite()
        || o.max_f0 <= o.min_f0
        || o.max_f0 >= rate / 4.0
        || math::floor(rate / o.min_f0) <= math::ceil(0.001 * rate)
        || !(1..=128).contains(&o.tract_order)
        || !(1..=128).contains(&o.glottis_order)
        || !o.leak.is_finite()
        || !(0.0..1.0).contains(&o.leak)
        || !o.step.is_finite()
        || o.step < 1.0 / rate
        || o.step > 0.032
    {
        return Err("invalid inverse filter options");
    }
    let count = frames.count;
    if !frames.hop.is_finite()
        || frames.hop <= 0.0
        || frames.hop > 1.0
        || !frames.window.is_finite()
        || frames.window <= 0.0
        || frames.window > 1.0
        || !frames.start_time.is_finite()
        || frames.mel_bands == 0
        || (count > 0 && (count - 1) as f64 * frames.hop * rate >= frames.sample_count as f64)
        || frames.samples.len() < frames.sample_count
        || frames.speech.len() < count
        || frames.periodicity.len() < count
        || frames.mel.len() < count.saturating_mul(frames.mel_bands)
        || o.pitch.is_some_and(|p| p.len() < count)
    {
        return Err("invalid frame set or pitch");
    }
    if frames.samples[..frames.sample_count]
        .iter()
        .any(|v| !v.is_finite())
        || o.pitch.is_some_and(|p| {
            p[..count]
                .iter()
                .any(|v| v.is_finite() && *v > 0.0 && (*v < 20.0 || *v as f64 > rate / 4.0))
        })
    {
        return Err("invalid samples or voiced pitch");
    }
    let raw: Vec<f64> = frames.samples[..frames.sample_count]
        .iter()
        .map(|v| *v as f64)
        .collect();
    let f0 = local_pitch(frames, &raw, &o);
    let (flow, flow_derivative) = if count == 0 {
        (vec![0.0; raw.len()], vec![0.0; raw.len()])
    } else {
        recover(frames, &raw, &f0, &o)
    };
    let low_band = low_band(frames, &f0);
    let mut measures = vec![vec![f32::NAN; count]; 9];
    measures[0] = f0;
    let d: Vec<f64> = flow_derivative.iter().map(|v| *v as f64).collect();
    let g: Vec<f64> = flow.iter().map(|v| *v as f64).collect();
    let gci = if d.is_empty() {
        vec![]
    } else {
        closures(frames, &measures[0], &d)
    };
    let mut reliable = vec![0; count];
    let models = models();
    let mut cpp = Cpp::new(rate, o.min_f0, o.max_f0);
    let mut windows = BTreeMap::new();
    for t in 0..count {
        let f0 = measures[0][t] as f64;
        if f0 == 0.0 {
            continue;
        }
        let centre = round(t as f64 * frames.hop * rate);
        let period = rate / f0;
        let length = round(2.0 * period);
        let source = block(&d, centre, length);
        let h = harmonics(
            &source,
            rate,
            f0,
            10.min(math::floor(0.45 * rate / f0) as usize),
        );
        let (rd, oq, fit) = fit_pulse(&h, &models);
        measures[1][t] = rd as f32;
        measures[2][t] = fit as f32;
        measures[3][t] = oq as f32;
        measures[6][t] = h.get(1).map_or(f32::NAN, |h2| (h[0] - h2) as f32);
        let speech = harmonics(&block(&raw, centre, length), rate, f0, 2);
        measures[5][t] = (speech[0] - speech[1]) as f32;
        let flow = block(&g, centre, length);
        let (mut lo, mut hi, mut peak) = (f64::INFINITY, f64::NEG_INFINITY, 0.0_f64);
        for n in 0..length {
            lo = lo.min(flow[n]);
            hi = hi.max(flow[n]);
            peak = peak.max(-source[n]);
        }
        measures[4][t] = if peak > 0.0 {
            ((hi - lo) / (peak * period)) as f32
        } else {
            f32::NAN
        };
        let hn = round(6.0 * period);
        let w = windows.entry(hn).or_insert_with(|| hann(hn));
        measures[7][t] = hnr(&raw, centre, period, w) as f32;
        measures[8][t] = cpp.measure(&raw, centre) as f32;
        reliable[t] = u8::from(f0 <= o.max_f0 && fit <= 6.0);
    }
    if !low_band {
        for col in [1, 3, 4, 5, 6] {
            measures[col].fill(f32::NAN);
        }
    }
    let summary = measures.iter().map(|v| summarize(v, &reliable)).collect();
    Ok(Result {
        hop: frames.hop,
        start_time: frames.start_time,
        count,
        rate,
        flow,
        flow_derivative,
        gci,
        measures,
        reliable,
        low_band,
        summary,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn silence_and_defaults() {
        let samples = vec![0.0; 800];
        let mut frames = Frames {
            rate: 8000.0,
            hop: 0.005,
            window: 0.025,
            start_time: 1.0,
            count: 20,
            sample_count: 800,
            mel_bands: 24,
            samples: &samples,
            speech: &[0; 20],
            periodicity: &[0.0; 20],
            mel: &[0.0; 480],
        };
        let r = inverse_filter(&frames, Options::default()).unwrap();
        assert_eq!(r.flow.len(), 800);
        assert!(r.gci.is_empty());
        assert!(r.summary[1].median.is_none());
        assert_eq!(rd_to_tenseness(1.5), 0.5);
        assert!(lf_harmonics(0.5).iter().all(|v| v.is_finite()));
        assert!(inverse_filter(
            &frames,
            Options {
                min_f0: 1000.0,
                max_f0: 1500.0,
                ..Options::default()
            }
        )
        .is_err());
        for rate in [f64::NAN, f64::INFINITY, 1e100, 0.0] {
            frames.rate = rate;
            assert!(inverse_filter(&frames, Options::default()).is_err());
        }
        frames.rate = 8000.0;
        let pitch = [2000.0; 20];
        let r = inverse_filter(
            &frames,
            Options {
                pitch: Some(&pitch),
                ..Options::default()
            },
        )
        .unwrap();
        assert!(r.measures[6].iter().all(|v| v.is_nan()));
        assert!(r.reliable.iter().all(|v| *v == 0));
    }
}
