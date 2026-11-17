//! Formant tracker primitive exports (issue 60); copies the input so the
//! caller may overlap the buffers.
use crate::{error, f32_slice, f64_slice};
use voice_simulator_core::formants::{candidate_width, tract_length_from_formants, RootFinder};

/// Largest LPC order and frame count one call accepts.
const MAX_ORDER: u32 = 64;
const MAX_FRAMES: u32 = 1 << 20;

/// Candidates per frame at most for LPC order `order`, or `BAD_ARGUMENT`.
#[no_mangle]
pub extern "C" fn vs_formant_width(order: u32) -> i32 {
    if !(2..=MAX_ORDER).contains(&order) {
        return error::BAD_ARGUMENT;
    }
    candidate_width(order as usize) as i32
}

/// Raw formant candidates of `frames` frames of `order` `f32` reflection
/// coefficients at `reflection` (the `reflection` of `analyzeFrames`). Writes
/// per frame `1 + 3 w` `f64` values at `out`, with `w = vs_formant_width`:
/// the count, then `w` frequencies, `w` bandwidths and `w` order ranks (Hz,
/// Hz, 0 to 2; unused slots stay 0). Returns `w` or an error.
#[no_mangle]
pub extern "C" fn vs_formant_candidates(
    reflection: u32,
    frames: u32,
    order: u32,
    rate: f64,
    max_bandwidth: f64,
    out: u32,
) -> i32 {
    if !(2..=MAX_ORDER).contains(&order)
        || frames > MAX_FRAMES
        || !(rate.is_finite() && rate > 0.0)
        || max_bandwidth.partial_cmp(&0.0) != Some(core::cmp::Ordering::Greater)
    {
        return error::BAD_ARGUMENT;
    }
    let p = order as usize;
    let width = candidate_width(p);
    let stride = 1 + 3 * width;
    let input = match f32_slice(reflection, frames * order) {
        Ok(s) => s.to_vec(),
        Err(code) => return code,
    };
    let output = match f64_slice(out, frames * stride as u32) {
        Ok(s) => s,
        Err(code) => return code,
    };
    output.fill(0.0);
    let mut finder = RootFinder::new(p);
    for (t, row) in output.chunks_exact_mut(stride).enumerate() {
        let (head, rest) = row.split_at_mut(1);
        let (frequency, rest) = rest.split_at_mut(width);
        let (bandwidth, rank) = rest.split_at_mut(width);
        let count = finder.find(
            &input[t * p..(t + 1) * p],
            rate,
            max_bandwidth,
            frequency,
            bandwidth,
            rank,
        );
        head[0] = count as f64;
    }
    width as i32
}

/// Least-squares tract length (cm) of F1 to F3 (`tractLengthFromFormants`).
#[no_mangle]
pub extern "C" fn vs_formant_tract_length(f1: f64, f2: f64, f3: f64) -> f64 {
    tract_length_from_formants(f1, f2, f3)
}
