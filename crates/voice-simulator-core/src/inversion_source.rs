//! Batch source estimation for acoustic inversion. Unlicense.
use crate::inversion::noise_channels;
use crate::math::{ceil, expm1, pow, round_half_up};
use alloc::{vec, vec::Vec};

pub const FEATURES: usize = 7;
pub const CHANNELS: usize = 9;

/// Input rows contain energy, gravity, ZCR, periodicity, tilt, speech and f0.
/// Output rows contain f0, voicing, loudness, the three noise channels,
/// trill, glottal closure and lateral. Voicing uses the planner time constant.
pub fn estimate_source(
    frames: &[f64],
    hop: f64,
    time_constant: f64,
    fallback_pitch: f64,
    maps: &[[f64; 6]; 3],
    out: &mut [f64],
) {
    let count = frames.len() / FEATURES;
    let alpha = -expm1(-hop / time_constant);
    let window = (round_half_up(0.05 / hop) as usize).max(1);
    let left = window / 2;
    let mut levels = vec![0.0; count + 1];
    let mut energies = Vec::with_capacity(count);
    let mut forward = 0.0;
    let mut previous = None;
    for (t, frame) in frames.as_chunks::<FEATURES>().0.iter().enumerate() {
        let energy = frame[0];
        let pitch = frame[6];
        let voiced = if pitch > 0.0 {
            let i = energies.partition_point(|&value| value <= energy);
            energies.insert(i, energy);
            fill_pitch(out, previous, t, pitch);
            previous = Some((t, pitch));
            1.0
        } else {
            0.0
        };
        let row = &mut out[t * CHANNELS..][..CHANNELS];
        forward = if t == 0 {
            voiced
        } else {
            forward + alpha * (voiced - forward)
        };
        row[1] = forward;
        let reference = if energies.is_empty() {
            energy
        } else {
            energies[ceil(0.9 * energies.len() as f64) as usize - 1]
        };
        levels[t + 1] = levels[t];
        if frame[5] > 0.0 {
            let delta = energy - reference;
            levels[t + 1] += pow(10.0, delta / 20.0).min(1.5);
            let features = [1.0, delta, frame[1] / 1000.0, frame[2], frame[3], frame[4]];
            row[3..6].copy_from_slice(&noise_channels(&features, maps));
        } else {
            row[3..6].fill(0.0);
        }
        row[6..].fill(0.0);
    }
    let (start, pitch) = previous.map_or((0, fallback_pitch), |(t, p)| (t + 1, p));
    for t in start..count {
        out[t * CHANNELS] = pitch;
    }
    let mut voiced = forward;
    for (t, row) in out
        .as_chunks_mut::<CHANNELS>()
        .0
        .iter_mut()
        .enumerate()
        .rev()
    {
        voiced += alpha * (row[1] - voiced);
        row[1] = voiced;
        let a = t.saturating_sub(left);
        let b = count.min(t.saturating_add(window - left));
        row[2] = if frames[t * FEATURES + 5] > 0.0 {
            (levels[b] - levels[a]) / (b - a) as f64
        } else {
            0.0
        };
    }
    mark_trills(frames, hop, out);
}

fn fill_pitch(out: &mut [f64], previous: Option<(usize, f64)>, t: usize, pitch: f64) {
    let (start, old) = previous.unwrap_or((0, pitch));
    for i in start..t {
        out[i * CHANNELS] = old + (pitch - old) * (i - start) as f64 / (t - start) as f64;
    }
    out[t * CHANNELS] = pitch;
}

fn mark_trills(frames: &[f64], hop: f64, out: &mut [f64]) {
    let energy = |t: usize| frames[t * FEATURES];
    let mut extrema = [0; 5];
    let mut count = 0;
    let mut plateau_start = 0;
    let mut direction = 0.0;
    for t in 1..frames.len() / FEATURES {
        let delta = energy(t) - energy(t - 1);
        if delta == 0.0 {
            continue;
        }
        let change = delta.signum();
        let reversed = change == -direction;
        let middle = (plateau_start + t - 1) / 2;
        direction = change;
        plateau_start = t;
        if !reversed {
            continue;
        }
        extrema[count] = middle;
        count += 1;
        if count < extrema.len() {
            continue;
        }
        let [a, b, c, d, e] = extrema;
        let first = (c - a) as f64 * hop;
        let second = (e - c) as f64 * hop;
        if (1.0 / 40.0..=1.0 / 18.0).contains(&first)
            && (1.0 / 40.0..=1.0 / 18.0).contains(&second)
            && [a, b, c, d]
                .into_iter()
                .zip([b, c, d, e])
                .all(|(l, r)| (energy(l) - energy(r)).abs() >= 6.0)
        {
            for i in a..=e {
                out[i * CHANNELS + 6] = 1.0;
            }
        }
        extrema.copy_within(1.., 0);
        count -= 1;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detects_trill_cycles_with_flat_extrema() {
        let energy = [
            -24., -22., -19., -16., -16., -19., -22., -25., -25., -22., -19., -16., -16., -19.,
            -22., -25., -25., -22., -19., -16., -16., -19., -22.,
        ];
        let mut frames = [0.0; FEATURES * 23];
        let mut out = [0.0; CHANNELS * 23];
        for (t, value) in energy.into_iter().enumerate() {
            frames[t * FEATURES] = value;
        }
        mark_trills(&frames, 0.005, &mut out);
        for (t, row) in out.chunks_exact(CHANNELS).enumerate() {
            assert_eq!(row[6] == 1.0, (3..20).contains(&t));
        }
    }
}
