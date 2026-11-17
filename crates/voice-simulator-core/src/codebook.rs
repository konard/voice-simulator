//! Numerical primitives of the JS codebook (issue 64), parity class B.
//! Table generation remains JavaScript until issue 77.
use crate::glottis::SPEED_OF_SOUND;
use crate::losses::{
    viscothermal_loss, AIR_DENSITY, LOSS_SHAPE, WALL_MASS, WALL_RESISTANCE, WALL_STIFFNESS,
};
use crate::math::{self, max, min};
use alloc::vec::Vec;
use core::f64::consts::{LN_10, PI};

/// Oral chain response in dB with the default yielding walls and lip load.
/// Returns false for invalid dimensions; does not construct complex objects.
pub fn tract_response(areas: &[f64], length: f64, frequencies: &[f64], out: &mut [f64]) -> bool {
    if areas.is_empty() || !length.is_finite() || length <= 0.0 || out.len() < frequencies.len() {
        return false;
    }
    let n = areas.len();
    let dx = length / n as f64;
    let rho_c = AIR_DENSITY * SPEED_OF_SOUND;
    let mut sections = Vec::with_capacity(n);
    for &input in areas {
        let area = max(input, 1e-4);
        let narrow = max(area, 1e-3);
        let kinetic = -math::ln(1.0 - min(0.3, 0.0001 / (narrow * narrow)));
        sections.push([
            area,
            dx / math::sqrt(area),
            kinetic * 44.0 / n as f64,
            2.0 * math::sqrt(PI * area) * dx * rho_c,
        ]);
    }
    let lip_area = max(areas[n - 1], 1e-3);
    let radius = math::sqrt(lip_area / PI);
    for (i, &frequency) in frequencies.iter().enumerate() {
        let omega = 2.0 * PI * frequency;
        let phase = omega * dx / SPEED_OF_SOUND;
        let co = math::cos(phase);
        let si = math::sin(phase);
        let loss = viscothermal_loss(frequency, 1.0, LOSS_SHAPE);
        let reactance = omega * WALL_MASS - WALL_STIFFNESS / omega;
        let wall_scale = 1.0 / (WALL_RESISTANCE * WALL_RESISTANCE + reactance * reactance);
        let ka = omega * radius / SPEED_OF_SOUND;
        let mut pr = ka * ka / 2.0 * 0.75 / lip_area;
        let mut pi = ka * (0.61 + 0.24 * 0.5) / lip_area;
        let mut ur = 1.0;
        let mut ui = 0.0;
        for s in sections.iter().rev() {
            let area = s[0];
            let scale = s[3] * wall_scale;
            let yr = WALL_RESISTANCE * scale;
            let yi = -reactance * scale;
            ur += pr * yr - pi * yi;
            ui += pr * yi + pi * yr;
            let e = math::exp(loss * s[1] + s[2]);
            let ch = (e + 1.0 / e) / 2.0;
            let sh = (e - 1.0 / e) / 2.0;
            let cr = co * ch;
            let ci = si * sh;
            let br = co * sh;
            let bi = si * ch;
            let next_pr = cr * pr - ci * pi + (br * ur - bi * ui) / area;
            let next_pi = cr * pi + ci * pr + (br * ui + bi * ur) / area;
            let next_ur = (br * pr - bi * pi) * area + cr * ur - ci * ui;
            ui = (br * pi + bi * pr) * area + cr * ui + ci * ur;
            pr = next_pr;
            pi = next_pi;
            ur = next_ur;
        }
        out[i] = -10.0 * (math::ln(ur * ur + ui * ui) / LN_10);
    }
    true
}

/// DCT coefficients 1..6 after removing the least-squares line from 16 bands.
/// Missing bands use the highest present band, exactly as in JavaScript.
pub fn envelope_key(envelope: &[f64; 24], out: &mut [f64; 6]) {
    let mut last = 0.0;
    for &value in &envelope[..16] {
        if value.is_finite() {
            last = value;
        }
    }
    let mut sum = 0.0;
    let mut slope = 0.0;
    for (i, &value) in envelope[..16].iter().enumerate() {
        let v = if value.is_finite() { value } else { last };
        sum += v;
        slope += (i as f64 - 7.5) * v;
    }
    slope /= 340.0;
    for (n, output) in out.iter_mut().enumerate() {
        let mut value = 0.0;
        for (i, &input) in envelope[..16].iter().enumerate() {
            let v = if input.is_finite() { input } else { last };
            value += (v - sum / 16.0 - slope * (i as f64 - 7.5))
                * math::cos(PI * (n + 1) as f64 * (i as f64 + 0.5) / 16.0);
        }
        *output = value;
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn level_and_tilt_have_no_key() {
        let mut envelope = [0.0; 24];
        for (i, value) in envelope.iter_mut().enumerate() {
            *value = 3.0 + 2.0 * i as f64;
        }
        let mut key = [0.0; 6];
        envelope_key(&envelope, &mut key);
        assert!(key.iter().all(|value| math::abs(*value) < 1e-10));
    }
    #[test]
    fn response_rejects_invalid_dimensions() {
        assert!(!tract_response(&[], 16.5, &[100.0], &mut [0.0]));
        assert!(!tract_response(&[2.0; 44], 0.0, &[100.0], &mut [0.0]));
    }
}
