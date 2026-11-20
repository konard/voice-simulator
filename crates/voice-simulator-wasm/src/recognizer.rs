//! Speech recognizer policy parity probe. Unlicense.
use crate::{error, f64_slice};
use voice_simulator_core::recognizer::{adaptive_level, noisy_frames, LEVELS};

#[no_mangle]
pub extern "C" fn vs_recognizer_policy(
    input: u32,
    count: u32,
    duration: f64,
    level: u32,
    recent_load: f64,
    sustained_load: f64,
    output: u32,
) -> i32 {
    let Some(settings) = LEVELS.get(level as usize) else {
        return error::BAD_ARGUMENT;
    };
    if count > 200_000 {
        return error::BAD_ARGUMENT;
    }
    let noisy = match f64_slice(input, count) {
        Ok(values) => noisy_frames(values, duration),
        Err(code) => return code,
    };
    match f64_slice(output, 5) {
        Ok(out) => {
            out.copy_from_slice(&[
                f64::from(settings.rate),
                settings.hop,
                f64::from(settings.beam),
                adaptive_level(level as usize, recent_load, sustained_load) as f64,
                f64::from(u8::from(noisy)),
            ]);
            error::OK
        }
        Err(code) => code,
    }
}
