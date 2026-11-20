//! Whisper detector parity on shared pitch and frontend frames. Unlicense.
use crate::{error, f64_slice};
use voice_simulator_core::inverse_whisper::{Frame, Signal};

/// Packet: rate, start, duration, hop, waveform, then rows of
/// [speech, energy, gravity, f0]. Result: triples of start, end, confidence.
#[no_mangle]
pub extern "C" fn vs_find_whisper(
    input: u32,
    samples: u32,
    frames: u32,
    out: u32,
    capacity: u32,
) -> i32 {
    if samples > 30 * 96000 || frames > 6000 || capacity > 6000 {
        return error::BAD_ARGUMENT;
    }
    let values = match f64_slice(input, 4 + samples + frames * 4) {
        Ok(values) => values.to_vec(),
        Err(code) => return code,
    };
    let [rate, start, duration, hop] = values[..4].try_into().expect("four header values");
    if !(8000.0..=96000.0).contains(&rate)
        || start < 0.0
        || !(0.0..=30.0).contains(&duration)
        || !(0.005..=0.01).contains(&hop)
        || values.iter().any(|v| !v.is_finite())
    {
        return error::BAD_ARGUMENT;
    }
    let end = 4 + samples as usize;
    let rows = values[end..]
        .as_chunks::<4>()
        .0
        .iter()
        .map(|r| Frame {
            speech: r[0] != 0.0,
            energy: r[1],
            gravity: r[2],
            f0: r[3],
        })
        .collect::<Vec<_>>();
    let found = Signal {
        samples: &values[4..end],
        rate,
        start,
        duration,
        hop,
        frames: &rows,
    }
    .find();
    if found.len() > capacity as usize {
        return error::BAD_ARGUMENT;
    }
    let output = match f64_slice(out, capacity * 3) {
        Ok(output) => output,
        Err(code) => return code,
    };
    for (result, span) in output.as_chunks_mut::<3>().0.iter_mut().zip(&found) {
        result.copy_from_slice(&[span.start, span.end, span.confidence]);
    }
    found.len() as i32
}
