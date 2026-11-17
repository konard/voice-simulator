//! Bounded mode-rule packets, class B parity (1e-10). Unlicense.
use crate::{error, f64_slice};
use voice_simulator_core::modes::{classify, emotion, vector, WIDTH};

/// Read two feature rows (word, baseline), write 6 decisions and 6 vector
/// components. Copies input first, permitting overlapping buffers.
#[no_mangle]
pub extern "C" fn vs_mode_rules(input: u32, has_f1: u32, known: u32, out: u32) -> i32 {
    if has_f1 > 1 || known > 1 {
        return error::BAD_ARGUMENT;
    }
    let values = match f64_slice(input, (2 * WIDTH) as u32) {
        Ok(s) => s.to_vec(),
        Err(code) => return code,
    };
    if values.iter().any(|x| !x.is_finite()) {
        return error::BAD_ARGUMENT;
    }
    let word = values[..WIDTH].try_into().expect("fixed word width");
    let base = values[WIDTH..].try_into().expect("fixed baseline width");
    let output = match f64_slice(out, 12) {
        Ok(s) => s,
        Err(code) => return code,
    };
    output[..6].copy_from_slice(&classify(word, base, has_f1 != 0, known != 0));
    output[6..].copy_from_slice(&vector(word, base, has_f1 != 0));
    error::OK
}

/// Phrase vector followed by 2..12 reference vectors, each six f64 values.
/// Writes activation, winning index, near/next distances, intensity, confidence.
#[no_mangle]
pub extern "C" fn vs_mode_emotion(input: u32, count: u32, out: u32) -> i32 {
    if !(2..=12).contains(&count) {
        return error::BAD_ARGUMENT;
    }
    let values = match f64_slice(input, (count + 1) * 6) {
        Ok(s) => s.to_vec(),
        Err(code) => return code,
    };
    if values.iter().any(|x| !x.is_finite()) {
        return error::BAD_ARGUMENT;
    }
    let vector = values[..6].try_into().expect("fixed vector width");
    let references = values[6..].as_chunks::<6>().0;
    let output = match f64_slice(out, 6) {
        Ok(s) => s,
        Err(code) => return code,
    };
    output.copy_from_slice(&emotion(vector, references));
    error::OK
}
