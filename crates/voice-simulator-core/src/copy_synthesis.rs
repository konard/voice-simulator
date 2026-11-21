//! Numeric controls for copy synthesis. Unlicense.
use alloc::vec::Vec;

use crate::math::{ceil, exp, floor, pow, round_half_up};

/// Play a source span against its measured start and end.
pub fn source_frame(time: f64, span: [f64; 4], frame_rate: f64) -> f64 {
    let [start, end, source_start, source_end] = span;
    let fraction = ((time - start) / (end - start)).min(1.0);
    (source_start + (source_end - source_start) * fraction) * frame_rate
}

/// Sample a nonempty control track between frames.
pub fn sample_track(values: &[f32], frame: f64) -> f64 {
    let frame = frame.clamp(0.0, (values.len() - 1) as f64);
    let left = floor(frame);
    let start = f64::from(values[left as usize]);
    start + (f64::from(values[ceil(frame) as usize]) - start) * (frame - left)
}

/// Target start and end, followed by source start and end, all in seconds.
pub type WarpSpan = [f64; 4];

/// Retiming one channel across the shared phone and pause anchors.
pub fn warp_track(
    values: &[f32],
    spans: &[WarpSpan],
    frame_rate: f64,
    frame_count: usize,
    mute_pauses: bool,
) -> Vec<f32> {
    let mut index = 0;
    (0..frame_count)
        .map(|frame| {
            let time = frame as f64 / frame_rate;
            while index + 1 < spans.len() && time >= spans[index][1] {
                index += 1;
            }
            let span = spans[index];
            if mute_pauses && span[3] <= span[2] {
                0.0
            } else {
                sample_track(values, source_frame(time, span, frame_rate)) as f32
            }
        })
        .collect()
}

/// Bound the stretch while allowing room for the unchanged release.
pub fn phone_duration(planned: f64, release: f64, requested: f64, clamp: bool) -> f64 {
    if !clamp && requested > release {
        requested
    } else {
        let minimum = (planned * 0.33).max(release + (planned - release) * 0.001);
        requested.clamp(minimum, planned * 3.0)
    }
}

fn voiced_median(values: &[f32], index: usize, radius: usize, buffer: &mut Vec<f32>) -> f64 {
    buffer.clear();
    let start = index.saturating_sub(radius);
    let end = index.saturating_add(radius).min(values.len() - 1);
    buffer.extend(values[start..=end].iter().copied().filter(|&f| f > 0.0));
    buffer.sort_unstable_by(f32::total_cmp);
    (f64::from(buffer[buffer.len() / 2]) + f64::from(buffer[(buffer.len() - 1) / 2])) * 0.5
}

/// Replace octave errors and turn outliers and unvoiced frames into gaps.
pub fn repair_octaves(values: &[f32], frame_rate: f64) -> Vec<f32> {
    let radius = round_half_up(0.1 * frame_rate) as usize;
    let mut buffer = Vec::new();
    values
        .iter()
        .enumerate()
        .map(|(i, &value)| {
            if value <= 0.0 || value.is_nan() {
                return f32::NAN;
            }
            let ratio = f64::from(value) / voiced_median(values, i, radius, &mut buffer);
            let distance = 12.0 * libm::log2(ratio);
            let octave = distance.signum();
            if distance.abs() <= 9.0 {
                value
            } else if (distance - 12.0 * octave).abs() <= 3.0 {
                (f64::from(value) * pow(2.0, -octave)) as f32
            } else {
                f32::NAN
            }
        })
        .collect()
}

fn fill_gaps(values: &mut [f32], fallback: f32) {
    let Some(first) = values.iter().position(|v| !v.is_nan()) else {
        values.fill(fallback);
        return;
    };
    let initial = values[first];
    values[..first].fill(initial);
    let mut from = first;
    for to in first + 1..values.len() {
        if !values[to].is_nan() {
            let left = f64::from(values[from]);
            let delta = f64::from(values[to]) - left;
            let width = (to - from) as f64;
            for (index, sample) in values[from + 1..to].iter_mut().enumerate() {
                *sample = (left + delta * ((index + 1) as f64 / width)) as f32;
            }
            from = to;
        }
    }
    let last = values[from];
    values[from..].fill(last);
}

fn smooth_pass<'a>(mut items: impl Iterator<Item = &'a mut f32>, alpha: f64) {
    if let Some(first) = items.next() {
        let mut state = f64::from(*first);
        for value in items {
            state += alpha * (f64::from(*value) - state);
            *value = state as f32;
        }
    }
}

/// Median filter, interpolate, and smooth pitch in both directions.
pub fn pitch_contour(measured: &[f32], frame_rate: f64, fallback: f32) -> Vec<f32> {
    let repaired = repair_octaves(measured, frame_rate);
    let mut scratch = Vec::new();
    let mut filtered: Vec<f32> = repaired
        .iter()
        .enumerate()
        .map(|(index, value)| {
            if value.is_nan() {
                *value
            } else {
                voiced_median(&repaired, index, 2, &mut scratch) as f32
            }
        })
        .collect();
    fill_gaps(&mut filtered, fallback);
    let alpha = 1.0 - exp(-1.0 / (0.01 * frame_rate));
    smooth_pass(filtered.iter_mut(), alpha);
    smooth_pass(filtered.iter_mut().rev(), alpha);
    filtered
}

/// RMS dB over 25 ms centered on the control frames, with the level gate.
pub fn rms_track(samples: &[f32], rate: f64, count: usize, frame_rate: f64) -> (Vec<f64>, f64) {
    let radius = rate * 0.0125;
    let mut loudest = f64::NEG_INFINITY;
    let values = (0..count)
        .map(|i| {
            let center = i as f64 * rate / frame_rate;
            let start = (round_half_up(center - radius) as usize).min(samples.len());
            let end = (round_half_up(center + radius) as usize).min(samples.len());
            let sum = samples[start..end].iter().fold(0.0, |sum, &sample| {
                sum + f64::from(sample) * f64::from(sample)
            });
            let level = if sum > 0.0 {
                10.0 * libm::log10(sum / (end - start) as f64)
            } else {
                f64::NEG_INFINITY
            };
            loudest = loudest.max(level);
            level
        })
        .collect();
    (values, loudest - 40.0)
}

/// Level correction for one pair of voiced windows.
pub fn loudness_gain(reference: f64, draft: f64) -> f64 {
    pow(10.0, 0.8 * (reference - draft) / 20.0).clamp(0.25, 4.0)
}

/// Apply one gated gain adjustment on the reference and draft level tracks.
pub fn match_levels(
    loudness: &mut [f32],
    (reference, reference_gate): (&[f64], f64),
    (draft, draft_gate): (&[f64], f64),
) {
    for ((level, &to), &from) in loudness.iter_mut().zip(reference).zip(draft) {
        if from > draft_gate && to > reference_gate {
            *level = (f64::from(*level) * loudness_gain(to, from)) as f32;
        }
    }
}

/// Blend a score channel with its inverted articulation.
pub fn blend(base: f32, estimated: f64, weight: f64) -> f32 {
    (f64::from(base) * (1.0 - weight) + estimated * weight) as f32
}

/// Apply a bounded triangular tweak around the syllable nucleus.
pub fn offset(value: f32, delta: f64, distance: usize, radius: usize) -> f32 {
    let change = delta * (1.0 - distance as f64 / radius as f64);
    (f64::from(value) + change).clamp(0.0, 1.0) as f32
}

/// Compare a candidate against the current error and current offset.
pub fn penalty_change(candidate: f64, previous: f64) -> f64 {
    4.0 * (candidate * candidate - previous * previous)
}
