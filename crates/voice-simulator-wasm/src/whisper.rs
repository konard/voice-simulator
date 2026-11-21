//! Whisper detector parity on shared pitch and frontend frames. Unlicense.
use crate::{error, f64_slice};
use voice_simulator_core::inverse_whisper::{self, Frame, Signal};

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
    find_whisper(input, samples, frames, out, capacity, false)
}

/// The same packet with one normalized autocorrelation value per frame appended.
#[no_mangle]
pub extern "C" fn vs_find_whisper_periodic(
    input: u32,
    samples: u32,
    frames: u32,
    out: u32,
    capacity: u32,
) -> i32 {
    find_whisper(input, samples, frames, out, capacity, true)
}

fn find_whisper(
    input: u32,
    samples: u32,
    frames: u32,
    out: u32,
    capacity: u32,
    has_periodicity: bool,
) -> i32 {
    if samples > 30 * 96000 || frames > 6000 || capacity > 6000 {
        return error::BAD_ARGUMENT;
    }
    let packet_end = 4 + samples + frames * 4;
    let values = match f64_slice(input, packet_end + frames * u32::from(has_periodicity)) {
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
    let rows = values[end..packet_end as usize]
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
    .find_with_periodicity(&values[packet_end as usize..]);
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

/// Ratio, relative dB, and two rows of duration mean/SD and dB mean/SD.
#[no_mangle]
pub extern "C" fn vs_whisper_voicing(input: u32) -> f64 {
    let Ok(data) = f64_slice(input, 10) else {
        return f64::NAN;
    };
    let cues = data[2..]
        .as_chunks::<4>()
        .0
        .try_into()
        .expect("two cue rows");
    inverse_whisper::voicing(data[0], data[1], cues)
}

/// Ten energy samples, ten semitone offsets, and the measured/expected lengths.
#[no_mangle]
pub extern "C" fn vs_whisper_tone_cost(input: u32) -> f64 {
    let Ok(data) = f64_slice(input, 22) else {
        return f64::NAN;
    };
    inverse_whisper::tone_cost(
        data[..10].try_into().expect("ten energy samples"),
        data[10..20].try_into().expect("ten pitch samples"),
        data[20],
        data[21],
    )
}

/// Two five-point trajectories of spectral bands followed by relative level.
#[no_mangle]
pub extern "C" fn vs_whisper_distance(input: u32, width: u32, vowel: u32) -> f64 {
    if !(2..=128).contains(&width) {
        return f64::NAN;
    }
    let Ok(data) = f64_slice(input, 10 * width) else {
        return f64::NAN;
    };
    let (input, reference) = data.split_at(5 * width as usize);
    inverse_whisper::trajectory_distance(input, reference, width as usize, vowel != 0)
}

/// Pool one row in a bounded spectral or autocorrelation array.
#[no_mangle]
pub extern "C" fn vs_whisper_pool(
    input: u32,
    rows: u32,
    width: u32,
    center: u32,
    scale: f64,
    output: u32,
) -> i32 {
    if !(1..=6000).contains(&rows)
        || !(1..=128).contains(&width)
        || center >= rows
        || !scale.is_finite()
    {
        return error::BAD_ARGUMENT;
    }
    let mut pooled = [0.0; 128];
    let pooled = &mut pooled[..width as usize];
    match f64_slice(input, rows * width) {
        Ok(data) => inverse_whisper::pool_row(data, center as usize, width as usize, scale, pooled),
        Err(code) => return code,
    }
    match f64_slice(output, width) {
        Ok(output) => output.copy_from_slice(pooled),
        Err(code) => return code,
    }
    0
}

/// One pooled LPC row. Input is the hop in samples and the waveform. Output
/// is the gain in dB, then the predictor and reflection coefficients.
#[no_mangle]
pub extern "C" fn vs_whisper_lpc(
    input: u32,
    samples: u32,
    first: u32,
    count: u32,
    length: u32,
    order: u32,
    output: u32,
) -> i32 {
    if samples > 30 * 96000
        || first > 6000
        || !(1..=5).contains(&count)
        || !(4..=65536).contains(&length)
        || !(1..=127).contains(&order)
        || order >= length
    {
        return error::BAD_ARGUMENT;
    }
    let mut result = [0.0; 255];
    let (gain, terms) = result[..1 + 2 * order as usize].split_at_mut(1);
    let (coefficients, reflection) = terms.split_at_mut(order as usize);
    match f64_slice(input, 1 + samples) {
        Ok(data) if (1.0..=f64::from(length)).contains(&data[0]) => {
            gain[0] = inverse_whisper::pooled_lpc(
                &data[1..],
                data[0],
                length as usize,
                first as usize..(first + count) as usize,
                coefficients,
                reflection,
            );
        }
        Ok(_) => return error::BAD_ARGUMENT,
        Err(code) => return code,
    }
    match f64_slice(output, 1 + 2 * order) {
        Ok(output) => output.copy_from_slice(&result[..output.len()]),
        Err(code) => return code,
    }
    0
}
