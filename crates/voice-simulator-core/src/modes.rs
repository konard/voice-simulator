//! Acoustic mode rules, reference: src/recognition/mode-rules.js. Unlicense.
//! Features: alpha, pitch, F1 difference, voiced, H1-H2, HNR, CPP,
//! jitter, rate, energy ratio, pitch span. Missing F1 is passed separately.
use crate::math::{abs, ln, round_half_up, sqrt};

pub const WIDTH: usize = 11;
pub type Features = [f64; WIDTH];
fn clamp(x: f64, low: f64, high: f64) -> f64 {
    x.clamp(low, high)
}
fn st(pitch: f64, base: f64) -> f64 {
    if pitch > 0.0 && base > 0.0 {
        12.0 * ln(pitch / base) / core::f64::consts::LN_2
    } else {
        0.0
    }
}
fn degree(x: f64) -> f64 {
    [0.33, 0.67, 1.0][clamp(round_half_up(x * 3.0) - 1.0, 0.0, 2.0) as usize]
}
/// Analytical inverse and quantization of the effort correlates.
pub fn effort(w: &Features, b: &Features, has_f1: bool) -> [f64; 3] {
    let tilt = (w[0] - b[0]) / 0.2;
    let pitch = (w[1] - b[1]) / 5.0;
    let e = if has_f1 {
        0.6 * tilt + 0.2 * pitch + 0.2 * w[2] / 3.5
    } else {
        0.75 * tilt + 0.25 * pitch
    };
    [
        e,
        round_half_up(clamp(0.5 + e / 40.0, 0.0, 1.0) * 4.0) / 4.0,
        clamp(1.0 - abs(tilt - pitch) / 20.0, 0.0, 1.0),
    ]
}
/// E, effort, effort confidence, quality id, degree, tempo. Quality ids:
/// 0 none, 1 W, 2 C, 3 F, 4 harsh, 5 creaky, 6 pressed, 7 breathy,
/// 8 whispery, 9 lax, 10 effort. Values are partial-mode decisions.
pub fn classify(w: &Features, b: &Features, has_f1: bool, known: bool) -> [f64; 6] {
    let [e, mut level, confidence] = effort(w, b, has_f1);
    let dp = st(w[1], b[1]);
    let dh = w[4] - b[4];
    let dn = w[5] - b[5];
    let dc = w[6] - b[6];
    if known && w[1] - b[1] >= 25.0 && w[0] > b[0] + 1.0 {
        level = round_half_up(clamp(0.5 + (w[1] - b[1]) / 200.0, 0.0, 1.0) * 4.0) / 4.0;
    }
    let (id, value) =
        if w[3] < 0.25 && w[1] == 0.0 && (w[9] >= b[9] + 1.0 || (!known && w[0] > -30.0)) {
            (1.0, 1.0)
        } else if w[1] > 0.0 && (if known { dp <= -10.5 } else { w[1] < 70.0 }) {
            (2.0, 1.0)
        } else if (dp >= 6.0 || (!known && w[1] >= 150.0))
            && w[4] >= 8.0
            && (dc <= -1.0 || (!known && w[6] < 2.0))
        {
            (3.0, 0.67)
        } else if w[4] < 0.0 && dn <= -3.0 && abs(dp) < 4.0 && (w[7] >= 1.0 || dc <= -1.0) {
            (4.0, 0.67)
        } else if (w[7] >= 3.0 && (w[4] < 0.0 || dp <= -8.0))
            || (w[1] > 0.0 && dp <= -6.0 && w[7] >= 2.0)
        {
            (
                5.0,
                if w[7] > 0.0 {
                    degree(clamp(w[7] / 7.0, 0.0, 1.0))
                } else {
                    0.67
                },
            )
        } else if dh <= -3.0 && dn >= -2.0 {
            (6.0, 0.67)
        } else if dh >= 4.0 && (dc <= -1.5 || dn <= -5.0) {
            (7.0, degree(clamp(dh / 3.2, 0.0, 1.0)))
        } else if w[3] > 0.05
            && ((w[5] < 12.0 && dn <= -4.0) || (abs(dp) < 2.0 && abs(dh) < 3.0 && dc <= -1.4))
        {
            (8.0, 0.5)
        } else if (3.0..=8.0).contains(&dh) && dn >= -2.0 && dc > -1.0 {
            (9.0, -0.67)
        } else if known && level != 0.5 {
            (10.0, level)
        } else {
            (0.0, 0.0)
        };
    let ratio = if b[8] > 0.0 { w[8] / b[8] } else { 1.0 };
    let tempo = if ratio >= 1.2 {
        1.3
    } else if ratio <= 0.83 {
        0.75
    } else {
        0.0
    };
    [e, level, confidence, id, value, tempo]
}
/// Six scaled components of the phrase vector.
pub fn vector(w: &Features, b: &Features, has_f1: bool) -> [f64; 6] {
    [
        st(w[1], b[1]) / 2.0,
        (w[10] - b[10]) / 2.0,
        (w[8] / b[8].max(1e-9) - 1.0) / 0.15,
        effort(w, b, has_f1)[0] / 5.0,
        (w[4] - b[4]) / 3.0,
        (w[5] - b[5]) / 3.0,
    ]
}
/// Activation; nearest and next distances; reference-relative intensity;
/// name confidence. Names are accepted by the caller using the two margins.
pub fn emotion(v: &[f64; 6], refs: &[[f64; 6]]) -> [f64; 6] {
    let norm = |a: &[f64; 6]| sqrt(a.iter().map(|x| x * x).sum());
    let length = norm(v);
    let mut nearest = f64::INFINITY;
    let mut next = f64::INFINITY;
    let mut winner = 0;
    for (i, r) in refs.iter().enumerate() {
        let mut d = [0.0; 6];
        for j in 0..6 {
            d[j] = v[j] - r[j];
        }
        let distance = norm(&d);
        if distance < nearest {
            next = nearest;
            nearest = distance;
            winner = i;
        } else if distance < next {
            next = distance;
        }
    }
    let intensity = refs
        .get(winner)
        .map_or(0.0, |r| clamp(length / norm(r).max(1e-9), 0.0, 1.0));
    [
        clamp(v[..4].iter().sum::<f64>() / 8.0, -1.0, 1.0),
        winner as f64,
        nearest,
        next,
        intensity,
        if next > 0.0 {
            1.0 - nearest / next
        } else {
            0.0
        },
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn inverse_and_ordered_rules() {
        let b = [-20.0, 120.0, 0.0, 1.0, 4.0, 20.0, 5.0, 0.0, 4.0, -30.0, 3.0];
        let mut w = b;
        w[0] += 2.0;
        w[1] += 50.0;
        w[2] = 35.0;
        assert!((effort(&w, &b, true)[0] - 10.0).abs() < 1e-12);
        assert_eq!(classify(&w, &b, true, true)[3], 10.0);
        w[1] = 0.0;
        w[3] = 0.0;
        w[9] = -20.0;
        assert_eq!(classify(&w, &b, false, true)[3], 1.0);
    }
}
