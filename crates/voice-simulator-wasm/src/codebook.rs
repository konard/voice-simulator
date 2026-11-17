//! Codebook primitive exports; copies inputs so callers may overlap buffers.
use crate::{error, f64_slice};
use voice_simulator_core::codebook::{envelope_key, tract_response};

/// Default oral response: areas and frequencies are f64, output is dB f64.
#[no_mangle]
pub extern "C" fn vs_tract_response(
    areas: u32,
    sections: u32,
    length: f64,
    frequencies: u32,
    count: u32,
    out: u32,
) -> i32 {
    if sections == 0 || sections > 4096 || count > 65536 {
        return error::BAD_ARGUMENT;
    }
    let input = match f64_slice(areas, sections) {
        Ok(s) => s.to_vec(),
        Err(code) => return code,
    };
    let grid = match f64_slice(frequencies, count) {
        Ok(s) => s.to_vec(),
        Err(code) => return code,
    };
    match f64_slice(out, count) {
        Ok(output) => {
            if tract_response(&input, length, &grid, output) {
                error::OK
            } else {
                error::BAD_ARGUMENT
            }
        }
        Err(code) => code,
    }
}

/// Six detrended DCT coefficients of a 24-band envelope, both f64.
#[no_mangle]
pub extern "C" fn vs_codebook_key(envelope: u32, out: u32) -> i32 {
    let mut input = [0.0; 24];
    match f64_slice(envelope, 24) {
        Ok(s) => input.copy_from_slice(s),
        Err(code) => return code,
    }
    let mut key = [0.0; 6];
    envelope_key(&input, &mut key);
    match f64_slice(out, 6) {
        Ok(s) => {
            s.copy_from_slice(&key);
            error::OK
        }
        Err(code) => code,
    }
}
