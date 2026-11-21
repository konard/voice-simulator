//! Scalar oral transfer used to prepare the codebook (Unlicense).
//! Frequency rows are angular frequency, cosine, sine, boundary loss,
//! negated wall reactance and inverse squared wall impedance. Section rows
//! from glottis to lips contain area, boundary-loss scale, constriction
//! loss, scaled wall perimeter and inverse area. All values are f64.
use crate::{glottis::SPEED_OF_SOUND, losses::WALL_RESISTANCE, math, radiation::RADIATION_BAFFLE};
use core::f64::consts::PI;

pub fn power(bins: &[[f64; 6]], sections: &[[f64; 5]], lip_area: f64, output: &mut [f64]) {
    let radius = math::sqrt(lip_area / PI);
    for (value, &[omega, cosine, sine, loss, reactance, wall]) in output.iter_mut().zip(bins) {
        let ka = (omega * radius) / SPEED_OF_SOUND;
        let mut pr = (ka * ka / 2.0) * (0.5 + 0.5 * RADIATION_BAFFLE) / lip_area;
        let mut pi = ka * (0.61 + 0.24 * RADIATION_BAFFLE) / lip_area;
        let (mut ur, mut ui) = (1.0, 0.0);
        for &[area, boundary, constriction, perimeter, inverse_area] in sections.iter().rev() {
            let scale = perimeter * wall;
            let yr = WALL_RESISTANCE * scale;
            let yi = reactance * scale;
            ur += pr * yr - pi * yi;
            ui += pr * yi + pi * yr;
            let a = loss * boundary + constriction;
            let (ch, sh) = if (0.0..=1.0 / 16.0).contains(&a) {
                let x = a * a;
                (
                    1.0 + x * (0.5 + x * (1.0 / 24.0 + x * (1.0 / 720.0 + x / 40320.0))),
                    a * (1.0
                        + x * (1.0 / 6.0 + x * (1.0 / 120.0 + x * (1.0 / 5040.0 + x / 362880.0)))),
                )
            } else {
                let e = math::exp(a);
                let inverse = 1.0 / e;
                ((e + inverse) / 2.0, (e - inverse) / 2.0)
            };
            let (cr, ci, br, bi) = (cosine * ch, sine * sh, cosine * sh, sine * ch);
            let next_pr = cr * pr - ci * pi + (br * ur - bi * ui) * inverse_area;
            let next_pi = cr * pi + ci * pr + (br * ui + bi * ur) * inverse_area;
            let next_ur = (br * pr - bi * pi) * area + cr * ur - ci * ui;
            ui = (br * pi + bi * pr) * area + cr * ui + ci * ur;
            (pr, pi, ur) = (next_pr, next_pi, next_ur);
        }
        *value = ur * ur + ui * ui;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oral_power_matches_the_javascript_reference() {
        let frequencies = [
            [1200.0, 0.96, 0.28, 0.02, -30.0, 1.0 / 640900.0],
            [3700.0, 0.8, 0.6, 0.04, -100.0, 1.0 / 650000.0],
        ];
        let sections = [[1.0, 0.5, 0.1, 1.0, 1.0], [2.0, 0.25, 0.0, 2.0, 0.5]];
        let mut output = [0.0; 2];
        power(&frequencies, &sections, 2.0, &mut output);
        for (actual, expected) in output
            .into_iter()
            .zip([0.7764616564912884, 0.18446884170753516])
        {
            assert!((actual - expected).abs() <= 1e-14);
        }
    }
}
