//! Analysis-by-synthesis parity entry points. Unlicense.
use crate::{error, f64_slice};
use voice_simulator_core::rescoring::{interpolate, mfcc, mfcc_settings, score, warp_positions};

/// Retimes one f64 control channel. Input is anchor pairs followed by the
/// channel. Output is duration, offset, then the new control frames.
#[no_mangle]
pub extern "C" fn vs_rescoring_warp(
    input: u32,
    anchors: u32,
    frames: u32,
    duration: f64,
    rate: f64,
    output: u32,
    capacity: u32,
) -> i32 {
    if anchors > 100_000
        || !(1..=100_000).contains(&frames)
        || !(0.0..=600.0).contains(&duration)
        || !(1.0..=1000.0).contains(&rate)
    {
        return error::BAD_ARGUMENT;
    }
    let data = match f64_slice(input, anchors * 2 + frames) {
        Ok(values) if values.iter().all(|value| value.is_finite()) => values.to_vec(),
        Ok(_) => return error::BAD_ARGUMENT,
        Err(code) => return code,
    };
    let (times, channel) = data.split_at(anchors as usize * 2);
    let pairs = times.as_chunks::<2>().0;
    if pairs.iter().flatten().any(|time| time.abs() > 3600.0)
        || pairs
            .windows(2)
            .any(|pair| pair[0][0] >= pair[1][0] || pair[0][1] >= pair[1][1])
    {
        return error::BAD_ARGUMENT;
    }
    let (duration, offset, positions) = warp_positions(pairs, duration, rate);
    let count = positions.len() as u32;
    if capacity < count + 2 {
        return error::BAD_ARGUMENT;
    }
    let out = match f64_slice(output, count + 2) {
        Ok(values) => values,
        Err(code) => return code,
    };
    out[0] = duration;
    out[1] = offset;
    for (sample, position) in out[2..].iter_mut().zip(positions) {
        *sample = interpolate(channel, position);
    }
    count as i32
}

/// Computes c1..cN from f64 PCM, returning the number of output frames.
#[no_mangle]
pub extern "C" fn vs_rescoring_mfcc(
    input: u32,
    count: u32,
    rate: u32,
    output: u32,
    capacity: u32,
) -> i32 {
    if ![8000, 11025, 16000].contains(&rate) || count > 1_000_000 {
        return error::BAD_ARGUMENT;
    }
    let samples = match f64_slice(input, count) {
        Ok(values) if values.iter().all(|value| value.is_finite()) => values.to_vec(),
        Ok(_) => return error::BAD_ARGUMENT,
        Err(code) => return code,
    };
    let values = mfcc(&samples, rate);
    if values.len() > capacity as usize {
        return error::BAD_ARGUMENT;
    }
    let out = match f64_slice(output, values.len() as u32) {
        Ok(values) => values,
        Err(code) => return code,
    };
    out.copy_from_slice(&values);
    (values.len() / mfcc_settings(rate).0) as i32
}

/// DTW score on the common hop grid. Input is bias, recording rows, render rows.
#[no_mangle]
pub extern "C" fn vs_rescoring_score(
    input: u32,
    rows: u32,
    width: u32,
    first: u32,
    last: u32,
    output: u32,
) -> i32 {
    if !(1..=1000).contains(&rows) || ![10, 13].contains(&width) || first >= last || last > rows {
        return error::BAD_ARGUMENT;
    }
    let data = match f64_slice(input, width * (1 + 2 * rows)) {
        Ok(values)
            if values
                .iter()
                .all(|value| value.is_finite() && value.abs() < 1e100) =>
        {
            values.to_vec()
        }
        Ok(_) => return error::BAD_ARGUMENT,
        Err(code) => return code,
    };
    let (bias, windows) = data.split_at(width as usize);
    let (recording, render) = windows.split_at((width * rows) as usize);
    let value = score(recording, render, bias, first as usize..last as usize);
    match f64_slice(output, 1) {
        Ok(out) => {
            out[0] = value;
            error::OK
        }
        Err(code) => code,
    }
}
