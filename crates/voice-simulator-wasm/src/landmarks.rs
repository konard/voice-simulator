//! Batch landmark parity entry point. Packed layout is documented in the
//! core module and tests/rust-landmarks.test.js. Input is copied before
//! borrowing output, so the two ranges may overlap safely.
use crate::{error, f64_slice};
use voice_simulator_core::landmarks::{find_landmarks, Frames, Thresholds};

/// Input: count rows of 13+mel_bands doubles; thresholds: ten doubles.
/// Output: twelve doubles per frame: class, sonority, nucleus flag, start,
/// end (-1 if unknown), strength, then strengths for b+,b-,g+,g-,s+,s-.
#[no_mangle]
pub extern "C" fn vs_landmarks(
    input: u32,
    count: u32,
    mel_bands: u32,
    rate: f64,
    hop: f64,
    thresholds: u32,
    output: u32,
) -> i32 {
    if count > 1_000_000
        || !(1..=1024).contains(&mel_bands)
        || !rate.is_finite()
        || rate < 8000.0
        || (hop != 0.005 && hop != 0.01)
    {
        return error::BAD_ARGUMENT;
    }
    let Some(input_count) = count.checked_mul(13 + mel_bands) else {
        return error::BAD_ARGUMENT;
    };
    let rows = match f64_slice(input, input_count) {
        Ok(v) => v.to_vec(),
        Err(code) => return code,
    };
    let mut values = [0.0; 10];
    match f64_slice(thresholds, 10) {
        Ok(v) => values.copy_from_slice(v),
        Err(code) => return code,
    }
    if rows.iter().chain(values.iter()).any(|v| !v.is_finite())
        || values[1] < 0.0
        || values[1] > 1.0
        || values[8] < 0.0
        || values[9] <= 0.0
    {
        return error::BAD_ARGUMENT;
    }
    let result = find_landmarks(
        &Frames {
            rows: &rows,
            count: count as usize,
            mel_bands: mel_bands as usize,
            rate,
            hop,
        },
        &Thresholds(values),
    );
    let out = match f64_slice(output, count * 12) {
        Ok(v) => v,
        Err(code) => return code,
    };
    out.fill(0.0);
    for t in 0..count as usize {
        out[t * 12] = result.classes[t] as f64;
        out[t * 12 + 1] = result.sonority[t] as f64;
    }
    for nucleus in result.nuclei {
        let row = nucleus.frame * 12;
        out[row + 2] = 1.0;
        out[row + 3] = nucleus.start as f64;
        out[row + 4] = nucleus.end.map_or(-1.0, |t| t as f64);
        out[row + 5] = nucleus.strength;
    }
    for landmark in result.landmarks {
        out[landmark.frame * 12 + 6 + landmark.kind] = landmark.strength;
    }
    error::OK
}
