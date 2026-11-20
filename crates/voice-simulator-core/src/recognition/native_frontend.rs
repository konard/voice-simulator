//! Acoustic observations for the native default-head recognizer (Unlicense).
//! The input is mono f32 PCM; landmark rows follow landmarks::Frames and
//! envelope queries follow recognition::codebook::QUERY_WIDTH.
use super::{codebook::QUERY_WIDTH, pitch::CoarseCorrelation};
use crate::{
    codebook::envelope_key,
    inverse_dsp::{hann, log10, predictor, round, Fft},
    math::{cos, sin},
};
use alloc::{vec, vec::Vec};
use core::f64::consts::TAU;

pub const MEL: usize = 24;
const BANDS: [[f64; 2]; 6] = [
    [0.0, 400.0],
    [800.0, 1500.0],
    [1200.0, 2000.0],
    [2000.0, 3500.0],
    [3500.0, 5000.0],
    [5000.0, 8000.0],
];
pub const ROW: usize = 13 + MEL;

pub struct AcousticFrames {
    pub rows: Vec<f64>,
    pub speech: Vec<u8>,
}

fn frame(samples: &[f32], centre: usize, out: &mut [f64]) {
    let start = centre as isize - (out.len() / 2) as isize;
    for (i, sample) in out.iter_mut().enumerate() {
        *sample = f64::from(
            (start + i as isize)
                .try_into()
                .ok()
                .and_then(|i: usize| samples.get(i).copied())
                .unwrap_or(0.0),
        );
    }
}

fn spectrum(row: &mut [f64], power: &[f64], rate: f64, size: usize) {
    let hz_per_bin = rate / size as f64;
    let top_mel = crate::math::ln(1.0 + rate / 1400.0);
    let mut energy = 0.0;
    let mut moment = 0.0;
    let mut bands = [0.0; 6];
    let (mut low, mut high) = (0.0, 0.0);
    let mut mel = [0.0; MEL];
    for (k, &power) in power.iter().enumerate() {
        let hz = k as f64 * hz_per_bin;
        if k > 0 {
            energy += power;
        }
        moment += hz * power;
        for ([left, right], band) in BANDS.iter().zip(&mut bands) {
            if (*left..=*right).contains(&hz) {
                *band += power;
            }
        }
        if (50.0..=1000.0).contains(&hz) {
            low += power;
        }
        if (1000.0..=3800.0).contains(&hz) {
            high += power;
        }
        let position = crate::math::ln(1.0 + hz / 700.0) / top_mel * (MEL + 1) as f64;
        let i = position as usize;
        let fraction = position - i as f64;
        if (1..=MEL).contains(&i) {
            mel[i - 1] += power * (1.0 - fraction);
        }
        if i < MEL {
            mel[i] += power * fraction;
        }
    }
    row[5] = moment / energy.max(1e-12);
    row[6] = 10.0 * log10((low + 1e-12) / (high + 1e-12));
    row[7..13].copy_from_slice(&bands.map(|value| (10.0 * log10(value + 1e-12)).max(-100.0)));
    row[13..].copy_from_slice(&mel.map(|value| crate::math::ln(value.max(1e-12))));
}

pub fn analyze(samples: &[f32], rate: f64, hop: f64) -> AcousticFrames {
    let shift = rate * hop;
    let length = round(0.032 * rate);
    let count = if samples.is_empty() {
        0
    } else {
        ((samples.len() - 1) as f64 / shift) as usize + 1
    };
    let size = length.next_power_of_two();
    let window = hann(length);
    let fft = Fft::new(size);
    let mut real = vec![0.0; size];
    let mut imaginary = vec![0.0; size];
    let mut power = vec![0.0; size / 2 + 1];
    let mut rows = vec![0.0; count * ROW];
    let mut peak = -100.0f64;
    for (t, row) in rows.as_chunks_mut::<ROW>().0.iter_mut().enumerate() {
        frame(samples, round(t as f64 * shift), &mut real[..length]);
        let energy = real[..length].iter().map(|x| x * x).sum::<f64>() / length as f64;
        row[0] = (10.0 * log10(energy.max(1e-10))).max(-100.0);
        peak = peak.max(row[0]);
        row[4] = real[..length]
            .windows(2)
            .filter(|x| (x[0] < 0.0) != (x[1] < 0.0))
            .count() as f64
            / length as f64;
        for (value, weight) in real.iter_mut().zip(&window) {
            *value *= weight;
        }
        real[length..].fill(0.0);
        imaginary.fill(0.0);
        fft.transform(&mut real, &mut imaginary, false);
        for (k, value) in power.iter_mut().enumerate() {
            *value = (real[k] * real[k] + imaginary[k] * imaginary[k]) / (size * size) as f64;
        }
        spectrum(row, &power, rate, size);
    }
    let noise = (peak - 45.0).max(-100.0);
    let speech = rows
        .as_chunks_mut::<ROW>()
        .0
        .iter_mut()
        .map(|row| {
            row[1] = noise;
            let speech = u8::from(row[0] > noise + 5.0);
            row[2] = f64::from(speech);
            speech
        })
        .collect();
    AcousticFrames { rows, speech }
}

pub fn track_pitch(samples: &[f32], rate: f64, hop: f64, frames: &mut AcousticFrames) -> Vec<f32> {
    let length = round(0.05 * rate);
    let min_lag = round(rate / 400.0);
    let max_lag = round(rate / 60.0);
    let window = hann(length);
    let sum = window.iter().map(|x| x * x).sum::<f64>();
    let window_correlation: Vec<_> = (0..=max_lag + 1)
        .map(|lag| {
            window
                .iter()
                .zip(&window[lag..])
                .map(|(a, b)| a * b)
                .sum::<f64>()
                / sum
        })
        .collect();
    let mut correlation = CoarseCorrelation::new((length * 2).next_power_of_two());
    let mut lag_values = vec![0.0; max_lag + 2];
    let mut samples_window = vec![0.0; length];
    frames
        .rows
        .as_chunks_mut::<ROW>()
        .0
        .iter_mut()
        .zip(&frames.speech)
        .enumerate()
        .map(|(t, (row, &speech))| {
            if speech == 0 {
                return 0.0;
            }
            frame(samples, round(t as f64 * hop * rate), &mut samples_window);
            let mean = samples_window.iter().sum::<f64>() / length as f64;
            for (value, weight) in samples_window.iter_mut().zip(&window) {
                *value = (*value - mean) * weight;
            }
            if !correlation.measure(&samples_window, &window_correlation, &mut lag_values) {
                return 0.0;
            }
            let mut best = 0;
            let mut score = 0.45;
            for lag in min_lag..=max_lag {
                let value = lag_values[lag];
                let adjusted = value - 0.12 * lag as f64 / max_lag as f64;
                if value >= lag_values[lag - 1] && value >= lag_values[lag + 1] && adjusted > score
                {
                    best = lag;
                    score = adjusted;
                }
            }
            if best == 0 {
                return 0.0;
            }
            row[3] = lag_values[best].clamp(0.0, 1.0);
            let (lag, _) = super::pitch::refine(
                &samples_window,
                &window_correlation,
                samples_window.iter().map(|x| x * x).sum(),
                best as i32,
                0,
            );
            (rate / if lag > 0.0 { lag } else { best as f64 }) as f32
        })
        .collect()
}

pub fn envelope_queries(
    samples: &[f32],
    rate: f64,
    hop: f64,
    speech: &[u8],
    grid: &[f64; 24],
) -> Vec<f64> {
    let length = round(0.025 * rate);
    let order = 2 * round(rate / 2000.0) + 2;
    let window = hann(length);
    let mut samples_window = vec![0.0; length];
    let mut response = [f64::NAN; 24];
    let mut key = [0.0; 6];
    let mut out = vec![f64::NAN; speech.len() * QUERY_WIDTH];
    for (t, (row, &speech)) in out
        .as_chunks_mut::<QUERY_WIDTH>()
        .0
        .iter_mut()
        .zip(speech)
        .enumerate()
    {
        if speech == 0 {
            continue;
        }
        frame(samples, round(t as f64 * hop * rate), &mut samples_window);
        for i in (1..length).rev() {
            samples_window[i] -= 0.97 * samples_window[i - 1];
        }
        let a = predictor(&samples_window, &window, order);
        for (i, &frequency) in grid.iter().enumerate() {
            if frequency < 0.48 * rate {
                let omega = TAU * frequency / rate;
                let (mut re, mut im) = (1.0, 0.0);
                for (k, &a) in a.iter().enumerate() {
                    let angle = (k + 1) as f64 * omega;
                    re += a * cos(angle);
                    im -= a * sin(angle);
                }
                response[i] = -10.0 * log10((re * re + im * im).max(1e-12));
            }
        }
        let mean = response[..16].iter().sum::<f64>() / 16.0;
        response.iter_mut().for_each(|x| *x -= mean);
        envelope_key(&response, &mut key);
        row[..24].copy_from_slice(&response);
        row[24..].copy_from_slice(&key);
    }
    out
}
