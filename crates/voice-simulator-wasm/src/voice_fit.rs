//! Bounded numerical voice-fit exports (issue 63). Unlicense.
use crate::{error, f64_slice};
use voice_simulator_core::voice_fit::{self, Histogram};

/// [quantile, median SD] of nonnegative finite histogram counts.
#[no_mangle]
pub extern "C" fn vs_voice_fit_histogram(
    bins: u32,
    count: u32,
    min: f64,
    step: f64,
    pitch: u32,
    p: f64,
    out: u32,
) -> i32 {
    if count == 0
        || count > 4096
        || !min.is_finite()
        || !step.is_finite()
        || step <= 0.0
        || !(0.0..=1.0).contains(&p)
        || pitch > 1
    {
        return error::BAD_ARGUMENT;
    }
    let bins = match f64_slice(bins, count) {
        Ok(v) => v.to_vec(),
        Err(code) => return code,
    };
    if bins.iter().any(|x| !x.is_finite() || *x < 0.0) {
        return error::BAD_ARGUMENT;
    }
    let h = Histogram {
        bins: &bins,
        min,
        step,
        pitch: pitch == 1,
    };
    let output = match f64_slice(out, 2) {
        Ok(v) => v,
        Err(code) => return code,
    };
    output.copy_from_slice(&[h.quantile(p), h.median_sd()]);
    0
}
/// Scaled feature distance; input is target, candidate, scales, each `count` long.
#[no_mangle]
pub extern "C" fn vs_voice_fit_distance(input: u32, count: u32, transcript: u32, mcd: f64) -> f64 {
    if count == 0 || count > 128 || transcript > 1 {
        return f64::NAN;
    }
    let data = match f64_slice(input, count * 3) {
        Ok(v) => v,
        Err(_) => return f64::NAN,
    };
    let n = count as usize;
    if data[2 * n..].iter().any(|s| !s.is_finite() || *s <= 0.0) {
        return f64::NAN;
    }
    voice_fit::distance(
        &data[..n],
        &data[n..2 * n],
        &data[2 * n..],
        transcript == 1,
        mcd,
    )
}
/// Numerical parity probe: minimize 100*sum((x-target)^2). Input is initial,
/// then target (`count` each). Output rows are cost followed by coordinates;
/// returns number of final vertices. Calls are bounded by `budget`.
#[no_mangle]
pub extern "C" fn vs_voice_fit_simplex(input: u32, count: u32, budget: u32, out: u32) -> i32 {
    if count == 0 || count > 32 || budget > 10000 {
        return error::BAD_ARGUMENT;
    }
    let data = match f64_slice(input, count * 2) {
        Ok(v) => v.to_vec(),
        Err(code) => return code,
    };
    if data
        .iter()
        .any(|x| !x.is_finite() || !(0.0..=1.0).contains(x))
    {
        return error::BAD_ARGUMENT;
    }
    let n = count as usize;
    let vertices = voice_fit::simplex(&data[..n], budget as usize, |x| {
        x.iter()
            .zip(&data[n..])
            .map(|(a, b)| {
                let d = a - b;
                100.0 * d * d
            })
            .sum()
    });
    let output = match f64_slice(out, ((n + 1) * (n + 1)) as u32) {
        Ok(v) => v,
        Err(code) => return code,
    };
    output.fill(0.0);
    for (row, v) in output.chunks_exact_mut(n + 1).zip(&vertices) {
        row[0] = v.cost;
        row[1..].copy_from_slice(&v.x);
    }
    vertices.len() as i32
}
