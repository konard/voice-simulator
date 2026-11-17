//! Acoustic landmark stage (issue 62), parity class B, limit 1e-6.
//! Rows: energy, noise, speech, periodicity, zcr, gravity, tilt, six bands,
//! then log mel energies. Values originate in the shared front end.
use crate::math;
use alloc::{vec, vec::Vec};

/// Names in class-number order.
pub const BROAD_CLASSES: [&str; 8] = [
    "silence",
    "vowel",
    "glide",
    "nasal",
    "voiced-fricative",
    "voiceless-fricative",
    "closure",
    "burst",
];
/// A borrowed frame set; row width is 13 + mel_bands.
pub struct Frames<'a> {
    pub rows: &'a [f64],
    pub count: usize,
    pub mel_bands: usize,
    pub rate: f64,
    pub hop: f64,
}
impl Frames<'_> {
    fn get(&self, t: usize, column: usize) -> f64 {
        self.rows[t * (13 + self.mel_bands) + column]
    }
    fn round(&self, seconds: f64) -> usize {
        math::round_half_up(seconds / self.hop) as usize
    }
    fn rise(&self, t: usize, b: usize, d: usize) -> f64 {
        self.get((t + d).min(self.count - 1), 7 + b) - self.get(t.saturating_sub(d), 7 + b)
    }
}
/// Thresholds in the same order as landmark-thresholds.js.
pub struct Thresholds(pub [f64; 10]);
/// Fine-pass frame, type (b+,b-,g+,g-,s+,s-) and coarse strength.
#[derive(Clone)]
pub struct Landmark {
    pub frame: usize,
    pub kind: usize,
    pub strength: f64,
}
/// Boundaries are frame indices; end remains None until known.
pub struct Nucleus {
    pub frame: usize,
    pub start: usize,
    pub end: Option<usize>,
    pub strength: f64,
}
/// Capacity-independent valid rows of a batch result.
pub struct Output {
    pub sonority: Vec<f32>,
    pub classes: Vec<u8>,
    pub landmarks: Vec<Landmark>,
    pub nuclei: Vec<Nucleus>,
}

/// Mel selection and 40 ms centred mean, rounded through Float32 as in JS.
pub fn sonority(f: &Frames<'_>) -> Vec<f32> {
    let bottom = 2595.0 * math::ln(1.0 + 60.0 / 700.0) / math::ln(10.0);
    let top = 2595.0 * math::ln(1.0 + math::min(f.rate / 2.0, 7600.0) / 700.0) / math::ln(10.0);
    let selected: Vec<_> = (0..f.mel_bands)
        .filter(|m| {
            let centre = 700.0
                * (math::pow(
                    10.0,
                    (bottom + (top - bottom) * (*m + 1) as f64 / (f.mel_bands + 1) as f64) / 2595.0,
                ) - 1.0);
            centre >= 300.0 && centre <= if f.rate == 8000.0 { 2800.0 } else { 3000.0 }
        })
        .collect();
    let raw: Vec<f32> = (0..f.count)
        .map(|t| {
            let sum: f64 = selected.iter().map(|m| math::exp(f.get(t, 13 + m))).sum();
            (10.0 * math::ln(math::max(sum, 1e-10)) / math::ln(10.0)) as f32
        })
        .collect();
    let width = f.round(0.04).max(1);
    let left = width / 2;
    let right = width - left - 1;
    (0..f.count)
        .map(|t| {
            let lo = t.saturating_sub(left);
            let hi = (t + right).min(f.count - 1);
            let sum: f64 = raw[lo..=hi].iter().map(|v| *v as f64).sum();
            (sum / (hi - lo + 1) as f64) as f32
        })
        .collect()
}
struct BandPeak {
    t: usize,
    b: usize,
    sign: f64,
    strength: f64,
}
fn fine_peak(f: &Frames<'_>, t: usize, b: usize, sign: f64) -> Option<usize> {
    let fine = f.round(0.013).max(1);
    let radius = f.round(0.02);
    let mut nearest: Option<usize> = None;
    for j in t.saturating_sub(radius).max(1)..=(t + radius).min(f.count - 2) {
        let value = sign * f.rise(j, b, fine);
        if value > 0.0
            && value > sign * f.rise(j - 1, b, fine)
            && value >= sign * f.rise(j + 1, b, fine)
            && nearest.is_none_or(|old| j.abs_diff(t) < old.abs_diff(t))
        {
            nearest = Some(j);
        }
    }
    nearest
}
/// Six-band coarse/fine candidate selection and 20 ms deduplication.
pub fn landmarks(f: &Frames<'_>, threshold: f64) -> Vec<Landmark> {
    if f.count < 3 {
        return Vec::new();
    }
    let coarse = f.round(0.025).max(1);
    let mut peaks = Vec::new();
    for b in 0..6 {
        for t in 1..f.count - 1 {
            let value = f.rise(t, b, coarse);
            let strength = math::abs(value);
            if strength < threshold
                || strength <= math::abs(f.rise(t - 1, b, coarse))
                || strength < math::abs(f.rise(t + 1, b, coarse))
            {
                continue;
            }
            let sign = if value > 0.0 { 1.0 } else { -1.0 };
            if let Some(at) = fine_peak(f, t, b, sign) {
                peaks.push(BandPeak {
                    t: at,
                    b,
                    sign,
                    strength,
                });
            }
        }
    }
    let mut candidates = Vec::new();
    for peak in &peaks {
        let BandPeak {
            t,
            b,
            sign,
            strength,
        } = *peak;
        let before = f.get(t.saturating_sub(coarse), 3) >= 0.45;
        let after = f.get((t + coarse).min(f.count - 1), 3) >= 0.45;
        if b == 0 && before != after && (sign > 0.0) == after {
            candidates.push(Landmark {
                frame: t,
                kind: if sign > 0.0 { 2 } else { 3 },
                strength,
            });
        }
        if b == 0 {
            continue;
        }
        let voiced = f.get(t, 3) >= 0.45;
        let max_band = if voiced { 4 } else { 5 };
        if b > max_band {
            continue;
        }
        // Retain first-insertion order, as JavaScript Map does.
        let mut bands: Vec<(usize, f64)> = Vec::new();
        for other in &peaks {
            if other.b >= 1
                && other.b <= max_band
                && other.sign == sign
                && other.t.abs_diff(t) <= f.round(0.01)
            {
                if let Some(pair) = bands.iter_mut().find(|pair| pair.0 == other.b) {
                    pair.1 = math::max(pair.1, other.strength);
                } else {
                    bands.push((other.b, other.strength));
                }
            }
        }
        if bands.len() >= 3 {
            candidates.push(Landmark {
                frame: t,
                kind: if voiced {
                    if sign > 0.0 {
                        4
                    } else {
                        5
                    }
                } else if sign > 0.0 {
                    0
                } else {
                    1
                },
                strength: bands.iter().map(|p| p.1).sum::<f64>() / bands.len() as f64,
            });
        }
    }
    candidates.sort_by(|a, b| {
        a.frame
            .cmp(&b.frame)
            .then(a.kind.cmp(&b.kind))
            .then(b.strength.total_cmp(&a.strength))
    });
    let mut kept: Vec<Landmark> = Vec::new();
    for item in candidates {
        let previous = kept.iter().rposition(|p| p.kind == item.kind);
        if let Some(prior) =
            previous.filter(|i| (item.frame - kept[*i].frame) as f64 * f.hop < 0.02 - 1e-9)
        {
            if item.strength > kept[prior].strength {
                kept[prior] = item;
            }
        } else {
            kept.push(item);
        }
    }
    kept.sort_by(|a, b| a.frame.cmp(&b.frame).then(a.kind.cmp(&b.kind)));
    kept
}
fn classify(
    f: &Frames<'_>,
    s: &[f32],
    t: usize,
    peak: f64,
    burst: bool,
    thresholds: &Thresholds,
) -> u8 {
    let k = &thresholds.0;
    if f.get(t, 2) == 0.0 && f.get(t, 0) - f.get(t, 1) < k[0] {
        return 0;
    }
    if f.get(t, 3) < k[1] {
        return if burst { 7 } else { 5 };
    }
    if f.get(t, 4) > k[2] || f.get(t, 5) > k[3] {
        return 4;
    }
    if f.get(t, 7) - f.get(t, 9) > k[4] && (s[t] as f64) < peak - k[5] {
        return 3;
    }
    if (s[t] as f64) < peak - k[6] {
        return 2;
    }
    1
}
/// Median of five, bounded silence -> closure, then short-run replacement.
pub fn clean_classes(raw: &[u8], hop: f64) -> Vec<u8> {
    let count = raw.len();
    let mut median = vec![0; count];
    for (t, value) in median.iter_mut().enumerate() {
        let mut window = [0; 5];
        for (k, v) in window.iter_mut().enumerate() {
            *v = raw[(t + k).saturating_sub(2).min(count - 1)];
        }
        window.sort();
        *value = window[2];
    }
    let mut closed = median.clone();
    let mut start = 0;
    while start < count {
        let mut end = start + 1;
        while end < count && median[end] == median[start] {
            end += 1;
        }
        if median[start] == 0
            && start > 0
            && end < count
            && ((end - start) as f64) * hop < 0.15 - 1e-9
        {
            closed[start..end].fill(6);
        }
        start = end;
    }
    let mut output = closed.clone();
    start = 0;
    while start < count {
        let mut end = start + 1;
        while end < count && closed[end] == closed[start] {
            end += 1;
        }
        let minimum = if closed[start] == 7 { 0.005 } else { 0.015 };
        if ((end - start) as f64) * hop < minimum - 1e-9 {
            let mut left = start;
            while left > 0 && closed[left - 1] == closed[start - 1] {
                left -= 1;
            }
            let mut right = end;
            while right < count && closed[right] == closed[end] {
                right += 1;
            }
            if start > 0 || end < count {
                output[start..end].fill(
                    if start > 0 && (end == count || start - left >= right - end) {
                        closed[start - 1]
                    } else {
                        closed[end]
                    },
                );
            }
        }
        start = end;
    }
    output
}
fn minimum(s: &[f32], first: usize, end: usize) -> usize {
    let mut at = first;
    for t in first + 1..=end {
        if s[t] < s[at] {
            at = t;
        }
    }
    at
}
fn emit(
    s: &[f32],
    pending: &mut Option<usize>,
    left: usize,
    right: Option<usize>,
    output: &mut Vec<Nucleus>,
) -> Option<usize> {
    let t = pending.take()?;
    output.push(Nucleus {
        frame: t,
        start: left,
        end: right,
        strength: (s[t] as f64)
            - math::min(s[left] as f64, right.map_or(s[t] as f64, |r| s[r] as f64)),
    });
    Some(t)
}
/// Same causal confirmation order as the JavaScript stage, even in batch.
pub fn nuclei(f: &Frames<'_>, s: &[f32], thresholds: &Thresholds) -> Vec<Nucleus> {
    let mut output: Vec<Nucleus> = Vec::new();
    let mut pending = None;
    let mut pending_left = 0;
    let mut last_peak = None;
    let mut valley = 0;
    let radius = f.round(0.04);
    let separation = math::ceil(0.08 / f.hop) as usize;
    for t in 0..f.count {
        if s[t] <= s[valley] {
            valley = t;
        }
        if let (Some(prev), Some(last)) = (output.last_mut(), last_peak) {
            if prev.end.is_none()
                && (f.get(t, 2) == 0.0
                    || (t > 0 && t + 1 < f.count && s[t] <= s[t - 1] && s[t] < s[t + 1]))
            {
                prev.end = Some(t);
                prev.strength = (s[last] as f64) - math::min(s[prev.start] as f64, s[t] as f64);
            }
        }
        let mut is_peak = (s[t] as f64) >= f.get(t, 1) + thresholds.0[7] && f.get(t, 3) >= 0.45;
        if is_peak {
            for j in t.saturating_sub(radius)..=(t + radius).min(f.count - 1) {
                if s[j] > s[t] || (j < t && s[j] == s[t]) {
                    is_peak = false;
                    break;
                }
            }
        }
        if let Some(last) = last_peak {
            if is_peak {
                let between = minimum(s, last, t);
                is_peak =
                    (s[between] as f64) <= math::min(s[last] as f64, s[t] as f64) - thresholds.0[8];
            }
        }
        if is_peak && last_peak.is_none_or(|last| t - last >= separation) {
            if let Some(p) = pending {
                let between = minimum(s, p, t);
                let separate = t - p >= separation
                    && (s[between] as f64) <= math::min(s[p] as f64, s[t] as f64) - thresholds.0[8];
                if separate {
                    last_peak = emit(s, &mut pending, pending_left, Some(between), &mut output);
                    pending = Some(t);
                    pending_left = between;
                } else if s[t] > s[p] {
                    pending = Some(t);
                }
            } else {
                pending = Some(t);
                pending_left = valley;
                if let Some(last) = last_peak {
                    let between = minimum(s, last, t);
                    pending_left = between;
                    output.last_mut().unwrap().end = Some(between);
                }
            }
            valley = t;
        }
        if let Some(p) = pending {
            let available = (t + radius).min(f.count - 1);
            let right = minimum(s, p, available);
            if (s[right] as f64) <= (s[p] as f64) - thresholds.0[8]
                || ((available - p) as f64) * f.hop >= 0.1
            {
                last_peak = emit(
                    s,
                    &mut pending,
                    pending_left,
                    if f.get(right, 2) == 0.0 {
                        Some(right)
                    } else {
                        None
                    },
                    &mut output,
                );
            }
        }
    }
    if pending.is_some() {
        last_peak = emit(s, &mut pending, pending_left, None, &mut output);
    }
    if let (Some(prev), Some(last)) = (output.last_mut(), last_peak) {
        if prev.end.is_none() {
            for t in last + 1..f.count {
                if f.get(t, 2) == 0.0 {
                    prev.end = Some(t);
                    break;
                }
            }
        }
    }
    output
}
/// Batch detector on the same numerical rows as JavaScript.
pub fn find_landmarks(f: &Frames<'_>, thresholds: &Thresholds) -> Output {
    let s = sonority(f);
    let lm = landmarks(f, thresholds.0[9]);
    let mut raw = vec![0; f.count];
    for t in 0..f.count {
        let mut peak = f64::NEG_INFINITY;
        for value in &s[t.saturating_sub(f.round(0.2))..=(t + f.round(0.04)).min(f.count - 1)] {
            peak = math::max(peak, *value as f64);
        }
        let earlier = t.saturating_sub(f.round(0.02));
        let burst = (raw[earlier] == 0 || raw[earlier] == 6)
            && lm.iter().any(|item| {
                item.kind == 0
                    && item.frame <= t
                    && ((t - item.frame) as f64) * f.hop <= 0.02 + 1e-9
            });
        raw[t] = classify(f, &s, t, peak, burst, thresholds);
    }
    let classes = clean_classes(&raw, f.hop);
    let nuclei = nuclei(f, &s, thresholds);
    Output {
        sonority: s,
        classes,
        landmarks: lm,
        nuclei,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn nucleus_does_not_require_speech_flag() {
        let count = 80;
        let mut rows = vec![0.0; count * 14];
        for t in 0..count {
            rows[t * 14 + 1] = -80.0;
            rows[t * 14 + 3] = 0.9;
        }
        let frames = Frames {
            rows: &rows,
            count,
            mel_bands: 1,
            rate: 8000.0,
            hop: 0.005,
        };
        let s: Vec<f32> = (0..count).map(|t| 20.0 - t.abs_diff(40) as f32).collect();
        let thresholds = Thresholds([7.0, 0.75, 0.225, 800.0, 18.0, 0.6, 1.0, 10.0, 2.0, 9.0]);
        let result = nuclei(&frames, &s, &thresholds);
        assert_eq!(result.len(), 1);
        assert_eq!(result[0].frame, 40);
    }
    #[test]
    fn silence_and_bounded_closure() {
        let mut raw = vec![1; 100];
        raw[40..60].fill(0);
        assert!(clean_classes(&raw, 0.005)[40..60].iter().all(|v| *v == 6));
        raw[40..80].fill(0);
        assert_eq!(clean_classes(&raw, 0.005)[50], 0);
        assert!(clean_classes(&[], 0.005).is_empty());
    }
}
