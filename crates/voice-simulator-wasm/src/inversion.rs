//! Batch articulation lattice parity entry point.
use crate::{error, f64_slice};
use voice_simulator_core::inversion::{Lattice, ROW, WIDTH};
use voice_simulator_core::inversion_source::{estimate_source_with_whisper, CHANNELS, FEATURES};

/// One f64 packet: four 12-value vectors (minimum, range, step, default),
/// quantized codebook, frame-major candidate indices, then local costs.
/// The output has count * 25 doubles. A lag at least count requests batch.
#[no_mangle]
pub extern "C" fn vs_inversion(
    input: u32,
    count: u32,
    rows: u32,
    stride: u32,
    lag: u32,
    smoothness: f64,
    output: u32,
) -> i32 {
    if count > 100_000
        || rows == 0
        || rows > 100_000
        || !(1..=64).contains(&stride)
        || !smoothness.is_finite()
        || smoothness < 0.0
    {
        return error::BAD_ARGUMENT;
    }
    let cells = count as usize * stride as usize;
    let table = rows as usize * WIDTH;
    let input = match f64_slice(input, (WIDTH * 4 + table + cells * 2) as u32) {
        Ok(v) => v.to_vec(),
        Err(code) => return code,
    };
    let (settings, rest) = input.split_at(WIDTH * 4);
    let (shape, rest) = rest.split_at(table);
    let (index, cost) = rest.split_at(cells);
    if input.iter().any(|x| !x.is_finite())
        || settings[WIDTH..WIDTH * 3].iter().any(|&x| x <= 0.0)
        || index
            .iter()
            .any(|&i| i < -1.0 || i >= f64::from(rows) || (i as i32) as f64 != i)
    {
        return error::BAD_ARGUMENT;
    }
    let out = match f64_slice(output, count * ROW as u32) {
        Ok(v) => v,
        Err(code) => return code,
    };
    let lattice = Lattice {
        shape,
        index,
        cost,
        stride: stride as usize,
        min: settings[..WIDTH].try_into().unwrap(),
        range: settings[WIDTH..2 * WIDTH].try_into().unwrap(),
        step: settings[2 * WIDTH..3 * WIDTH].try_into().unwrap(),
        defaults: settings[3 * WIDTH..].try_into().unwrap(),
        smoothness,
    };
    lattice.solve_fixed_lag(lag as usize, out);
    error::OK
}

/// One f64 packet: 18 regression coefficients followed by frame rows.
/// Each output frame has nine source controls.
#[no_mangle]
pub extern "C" fn vs_inversion_source(
    input: u32,
    count: u32,
    hop: f64,
    voicing_tau: f64,
    fallback_pitch: f64,
    output: u32,
) -> i32 {
    inversion_source(
        input,
        count,
        hop,
        voicing_tau,
        fallback_pitch,
        output,
        false,
    )
}

/// The regular source packet followed by one 0/1 whisper flag per frame.
#[no_mangle]
pub extern "C" fn vs_inversion_source_whisper(
    input: u32,
    count: u32,
    hop: f64,
    voicing_tau: f64,
    fallback_pitch: f64,
    output: u32,
) -> i32 {
    inversion_source(input, count, hop, voicing_tau, fallback_pitch, output, true)
}

fn inversion_source(
    input: u32,
    count: u32,
    hop: f64,
    voicing_tau: f64,
    fallback_pitch: f64,
    output: u32,
    with_whisper: bool,
) -> i32 {
    if count > 100_000
        || [hop, voicing_tau, fallback_pitch]
            .iter()
            .any(|value| !value.is_finite() || *value <= 0.0)
    {
        return error::BAD_ARGUMENT;
    }
    let length = 18 + count * FEATURES as u32;
    let input = match f64_slice(input, length + if with_whisper { count } else { 0 }) {
        Ok(values) if values.iter().all(|value| value.is_finite()) => values.to_vec(),
        Ok(_) => return error::BAD_ARGUMENT,
        Err(code) => return code,
    };
    let out = match f64_slice(output, count * CHANNELS as u32) {
        Ok(values) => values,
        Err(code) => return code,
    };
    let maps = [
        input[..6].try_into().unwrap(),
        input[6..12].try_into().unwrap(),
        input[12..18].try_into().unwrap(),
    ];
    let (frames, whisper) = input[18..].split_at(count as usize * FEATURES);
    if whisper.iter().any(|&flag| flag != 0.0 && flag != 1.0) {
        return error::BAD_ARGUMENT;
    }
    estimate_source_with_whisper(
        frames,
        whisper,
        hop,
        voicing_tau,
        fallback_pitch,
        &maps,
        out,
    );
    error::OK
}
