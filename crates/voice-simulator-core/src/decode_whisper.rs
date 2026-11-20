//! Whisper spectral trajectories and segment costs. Unlicense.
use super::{consolidate, Gap, PhoneCost, Weights, EPS, MIN_PHONE_DURATION, POINTS};
use crate::{inverse_whisper, math};
use alloc::{vec, vec::Vec};
use core::f64::consts::LN_10;

pub(super) const WHISPER_WEIGHTS: Weights = Weights {
    duration: 1.1,
    class: 0.0,
    phonotactic: 0.08,
};

pub struct Reference<'a> {
    pub duration: f64,
    pub trajectory: &'a [f64],
}

pub struct PhoneReferences<'a> {
    pub vowel: bool,
    pub contexts: Vec<Reference<'a>>,
}

pub struct WhisperInput<'a> {
    pub spans: Vec<(f64, f64)>,
    pub bands: usize,
    pub mel: &'a [f64],
    pub energy: &'a [f64],
    pub references: Vec<PhoneReferences<'a>>,
}

impl WhisperInput<'_> {
    pub(super) fn contains(&self, time: f64) -> bool {
        self.spans
            .iter()
            .any(|&(start, end)| start <= time && time < end)
    }

    pub(super) fn grid(&self, original: &[f64], pauses: &[Gap]) -> (Vec<f64>, Vec<f64>) {
        let (Some(&start), Some(&end)) = (original.first(), original.last()) else {
            return (Vec::new(), Vec::new());
        };
        let spans: Vec<_> = self
            .spans
            .iter()
            .copied()
            .filter(|&(a, b)| b > start && a < end)
            .collect();
        if spans.is_empty() {
            return (original.to_vec(), Vec::new());
        }
        let mut edges: Vec<_> = spans
            .iter()
            .flat_map(|&(a, b)| [a, b])
            .filter(|&time| time > start && time < end)
            .collect();
        edges.dedup();
        let mandatory: Vec<_> = [start, end]
            .into_iter()
            .chain(pauses.iter().flat_map(|p| [p.start, p.end]))
            .collect();
        let minimum = MIN_PHONE_DURATION - EPS;
        let edges: Vec<_> = edges
            .iter()
            .enumerate()
            .filter_map(|(i, &time)| {
                let before = i.checked_sub(1).map_or(f64::NEG_INFINITY, |j| edges[j]);
                let after = edges.get(i + 1).copied().unwrap_or(f64::INFINITY);
                (time - before >= minimum
                    && after - time >= minimum
                    && mandatory.iter().all(|&edge| (edge - time).abs() >= minimum))
                .then_some(time)
            })
            .collect();
        let mut candidates: Vec<_> = original.iter().map(|&time| (time, 2)).collect();
        candidates.extend(
            mandatory
                .into_iter()
                .chain(edges.iter().copied())
                .map(|time| (time, 4)),
        );
        for (a, b) in spans {
            let mut time = a.max(start) + MIN_PHONE_DURATION;
            while time < b.min(end) {
                if !pauses.iter().any(|p| p.start < time && time < p.end) {
                    candidates.push((time, 0));
                }
                time += MIN_PHONE_DURATION;
            }
        }
        (consolidate(candidates, pauses), edges)
    }

    pub(super) fn spectra(&self, origin: f64, hop: f64) -> Spectra<'_> {
        let row_at = |seconds: f64| {
            (math::ceil((seconds - origin) / hop - EPS) as usize).min(self.energy.len())
        };
        let rows = self
            .spans
            .iter()
            .map(|&(start, end)| {
                let first = row_at(start);
                let last = row_at(end);
                let mut mel = Vec::with_capacity((last - first) * self.bands);
                let mut energy = Vec::with_capacity(last - first);
                let mut spectrum = vec![0.0; self.bands];
                for row in 0..last - first {
                    inverse_whisper::pool_row(
                        &self.mel[first * self.bands..last * self.bands],
                        row,
                        self.bands,
                        1.0,
                        &mut spectrum,
                    );
                    let average: f64 = spectrum
                        .iter()
                        .map(|&value| f64::from(value as f32) / self.bands as f64)
                        .sum();
                    mel.extend(
                        spectrum
                            .iter()
                            .map(|&value| (f64::from(value as f32) - average) as f32),
                    );
                    let mut level = [0.0];
                    inverse_whisper::pool_row(
                        &self.energy[first..last],
                        row,
                        1,
                        LN_10 / 10.0,
                        &mut level,
                    );
                    energy.push(level[0] as f32);
                }
                let mut sorted = energy.clone();
                sorted.sort_by(f32::total_cmp);
                let nominal = sorted
                    .get((0.85 * sorted.len() as f64) as usize)
                    .copied()
                    .unwrap_or(0.0);
                Spectrum {
                    first,
                    mel,
                    energy,
                    nominal,
                }
            })
            .collect();
        Spectra {
            input: self,
            origin,
            hop,
            rows,
        }
    }
}

struct Spectrum {
    first: usize,
    mel: Vec<f32>,
    energy: Vec<f32>,
    nominal: f32,
}

pub(super) struct Spectra<'a> {
    input: &'a WhisperInput<'a>,
    origin: f64,
    hop: f64,
    rows: Vec<Spectrum>,
}

impl Spectrum {
    fn sample(&self, row: f64, bands: usize, output: &mut [f64]) {
        let row = (row - self.first as f64).clamp(0.0, (self.energy.len() - 1) as f64);
        let before = row as usize;
        let after = (before + 1).min(self.energy.len() - 1);
        let interpolated = |a: f32, b: f32| {
            let a = f64::from(a);
            a + (row - before as f64) * (f64::from(b) - a)
        };
        for (band, value) in output[..bands].iter_mut().enumerate() {
            let a = self.mel[before * bands + band];
            let b = self.mel[after * bands + band];
            *value = f64::from(interpolated(a, b) as f32);
        }
        let level = interpolated(self.energy[before], self.energy[after]) - f64::from(self.nominal);
        output[bands] = f64::from(level.max(-35.0) as f32);
    }
}

impl Spectra<'_> {
    pub(super) fn score(&self, start: f64, end: f64) -> Option<Vec<PhoneCost>> {
        let mid = (start + end) / 2.0;
        let i = self
            .input
            .spans
            .iter()
            .position(|&(a, b)| a <= mid && mid < b)?;
        let spectrum = &self.rows[i];
        if spectrum.energy.is_empty() {
            return None;
        }
        let width = self.input.bands + 1;
        let duration = end - start;
        let mut trajectory = vec![0.0; POINTS.len() * width];
        for (relative, values) in POINTS.into_iter().zip(trajectory.chunks_exact_mut(width)) {
            let row = (start + relative * duration - self.origin) / self.hop;
            spectrum.sample(row, self.input.bands, values);
        }
        Some(
            self.input
                .references
                .iter()
                .map(|phone| {
                    let mut best = f64::INFINITY;
                    let mut timing = 0.0;
                    let mut long = false;
                    for reference in &phone.contexts {
                        let ratio = duration / reference.duration;
                        let offset = math::ln(ratio);
                        let length_cost = 2.0 * (offset * offset);
                        let distance = inverse_whisper::trajectory_distance(
                            &trajectory,
                            reference.trajectory,
                            width,
                            phone.vowel,
                        );
                        let cost = duration * 8.0 * distance
                            + 0.85
                            + WHISPER_WEIGHTS.duration * length_cost;
                        if cost < best {
                            best = cost;
                            timing = length_cost;
                            long = ratio > 1.6;
                        }
                    }
                    PhoneCost {
                        acoustic: best - WHISPER_WEIGHTS.duration * timing,
                        duration: timing,
                        class: 0.0,
                        long,
                    }
                })
                .collect(),
        )
    }
}
