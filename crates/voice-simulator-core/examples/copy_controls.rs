//! Native parity probe for the JavaScript copy controls. Unlicense.
use voice_simulator_core::copy_synthesis::*;
use voice_simulator_core::glottis::pitch_before_phonation;

fn main() {
    let f0: Vec<_> = (0..72)
        .map(|i| match i {
            0..=4 | 60..=62 => 0.0,
            23..=27 => 240.0 + i as f32 * 0.5,
            49 => 800.0,
            _ => 120.0 + i as f32 * 0.25,
        })
        .collect();
    let audio: Vec<_> = (0..640).map(|i| ((i % 31) as f32 - 15.0) / 128.0).collect();
    let (levels, threshold) = rms_track(&audio, 16000.0, 11, 200.0);
    println!("{:?}", pitch_contour(&f0, 200.0, 130.0));
    println!("{levels:?}");
    let control = [
        threshold,
        loudness_gain(-22.0, -42.0),
        loudness_gain(-42.0, -22.0),
        loudness_gain(-28.0, -32.0),
        phone_duration(0.1, 0.025, 0.003, true),
        phone_duration(0.1, 0.05, 0.003, true),
        phone_duration(0.1, 0.025, 0.6, true),
        phone_duration(0.1, 0.025, 0.6, false),
        source_frame(0.161, [0.1, 0.2, 0.2, 0.3], 200.0),
        sample_track(&[1.0, 2.0, 3.0], 1.25),
        f64::from(blend(0.375, 0.614, 0.5)),
        f64::from(offset(0.375, -0.05, 4, 10)),
        penalty_change(0.1, 0.05),
        pitch_before_phonation(240.0, 0.0, 1.0),
        pitch_before_phonation(25.0, 1.0, 0.0),
        pitch_before_phonation(60.0, 0.7, 0.2),
    ];
    println!("{control:?}");
    let input = [0.3, 0.5, 0.7, 0.8, 0.9];
    let spans = [
        [0.0, 0.005, 0.0, 0.0],
        [0.005, 0.035, 0.0, 0.02],
        [0.035, 0.04, 0.02, 0.02],
    ];
    println!("{:?}", warp_track(&input, &spans, 200.0, 9, true));

    let mut loudness = input;
    match_levels(
        &mut loudness,
        (&[-25.0, -45.0, -35.0, -20.0, -18.0], -40.0),
        (&[-28.0, -60.0, -60.0, -25.0, -12.0], -50.0),
    );
    println!("{loudness:?}");
}
