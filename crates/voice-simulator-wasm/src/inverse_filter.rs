//! Packed, additive ABI for batch source analysis (Unlicense).
//! Layout is documented in docs/INVERSE-FILTER.md. Read the input before
//! opening the output so overlapping packets cannot alias live views.
use crate::{check_range, error, f32_slice, f64_slice, u8_slice};
use voice_simulator_core::inverse_filter::{
    inverse_filter, inverse_mode_measures, Frames, Options,
};

fn integer(v: f64) -> Result<usize, i32> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v > u32::MAX as f64 {
        Err(error::BAD_ARGUMENT)
    } else {
        Ok(v as usize)
    }
}
fn run(input: &[f64], modes: bool) -> Result<Vec<f64>, i32> {
    if input.len() < 14 {
        return Err(error::BAD_ARGUMENT);
    }
    let count = integer(input[4])?;
    let n = integer(input[5])?;
    let bands = integer(input[6])?;
    let p = integer(input[7])?;
    let q = integer(input[8])?;
    let pitch_flag = integer(input[13])?;
    if pitch_flag > 1 {
        return Err(error::BAD_ARGUMENT);
    }
    let stride = bands
        .checked_add(2 + pitch_flag)
        .ok_or(error::BAD_ARGUMENT)?;
    let required = 14usize
        .checked_add(n)
        .and_then(|v| v.checked_add(count.checked_mul(stride)?))
        .ok_or(error::BAD_ARGUMENT)?;
    if input.len() < required || (!modes && input.len() != required) {
        return Err(error::BAD_ARGUMENT);
    }
    let mut at = 14;
    let mut take = |length: usize| {
        let values = &input[at..at + length];
        at += length;
        values
    };
    let samples: Vec<f32> = take(n).iter().map(|v| *v as f32).collect();
    let speech: Vec<u8> = take(count).iter().map(|v| u8::from(*v != 0.0)).collect();
    let periodicity: Vec<f32> = take(count).iter().map(|v| *v as f32).collect();
    let mel: Vec<f32> = take(count * bands).iter().map(|v| *v as f32).collect();
    let pitch: Option<Vec<f32>> = if pitch_flag == 1 {
        Some(take(count).iter().map(|v| *v as f32).collect())
    } else {
        None
    };
    let frames = Frames {
        rate: input[0],
        hop: input[1],
        window: input[2],
        start_time: input[3],
        count,
        sample_count: n,
        mel_bands: bands,
        samples: &samples,
        speech: &speech,
        periodicity: &periodicity,
        mel: &mel,
    };
    let options = Options {
        pitch: pitch.as_deref(),
        tract_order: p,
        glottis_order: q,
        leak: input[9],
        step: input[10],
        min_f0: input[11],
        max_f0: input[12],
    };
    if modes {
        let rows = input[required..]
            .iter()
            .map(|&row| integer(row))
            .collect::<Result<Vec<_>, _>>()?;
        let measures =
            inverse_mode_measures(&frames, options, &rows).map_err(|_| error::BAD_ARGUMENT)?;
        return Ok(measures.into_iter().flatten().map(f64::from).collect());
    }
    let result = inverse_filter(&frames, options).map_err(|_| error::BAD_ARGUMENT)?;
    let mut out = Vec::with_capacity(4 + 2 * n + result.gci.len() + 10 * count + 36);
    out.extend([
        count as f64,
        n as f64,
        result.gci.len() as f64,
        f64::from(u8::from(result.low_band)),
    ]);
    out.extend(result.flow.iter().map(|v| *v as f64));
    out.extend(result.flow_derivative.iter().map(|v| *v as f64));
    out.extend(result.gci);
    for values in result.measures {
        out.extend(values.iter().map(|v| *v as f64));
    }
    out.extend(result.reliable.iter().map(|v| *v as f64));
    for s in result.summary {
        out.extend([
            s.median.unwrap_or(f64::NAN),
            s.low.unwrap_or(f64::NAN),
            s.high.unwrap_or(f64::NAN),
            s.frames as f64,
        ]);
    }
    Ok(out)
}
fn write_result(input: u32, length: u32, output: u32, capacity: u32, modes: bool) -> i32 {
    let values = match f64_slice(input, length).and_then(|input| {
        check_range(output, capacity, 8)?;
        run(input, modes)
    }) {
        Ok(v) => v,
        Err(e) => return e,
    };
    if values.len() > capacity as usize || values.len() > i32::MAX as usize {
        return error::BAD_ARGUMENT;
    }
    match f64_slice(output, capacity) {
        Ok(out) => {
            out[..values.len()].copy_from_slice(&values);
            values.len() as i32
        }
        Err(e) => e,
    }
}
/// Writes the packed result and returns its length, or a negative error.
/// `capacity` counts f64 values. A short output returns BAD_ARGUMENT.
#[no_mangle]
pub extern "C" fn vs_inverse_filter(input: u32, length: u32, output: u32, capacity: u32) -> i32 {
    write_result(input, length, output, capacity, false)
}
/// Recognition entry point for the same source-analysis packet.
#[no_mangle]
pub extern "C" fn rec_inverse_filter(input: u32, length: u32, output: u32, capacity: u32) -> i32 {
    vs_inverse_filter(input, length, output, capacity)
}
/// Reads an inverse packet followed by zero-based vowel frame indices.
/// Writes the three source measure columns for mode recognition.
#[no_mangle]
pub extern "C" fn rec_inverse_modes(input: u32, length: u32, output: u32, capacity: u32) -> i32 {
    write_result(input, length, output, capacity, true)
}

fn mode_input(
    header: u32,
    input: u32,
    speech: u32,
    indices: u32,
    rows: u32,
    capacity: u32,
) -> Result<[Vec<f32>; 3], i32> {
    let header: [f64; 14] = f64_slice(header, 14)?[..].try_into().unwrap();
    let count = integer(header[4])?;
    let n = integer(header[5])?;
    let bands = integer(header[6])?;
    let pitch_flag = integer(header[13])?;
    if pitch_flag > 1 || count > capacity as usize / 3 || rows > i32::MAX as u32 / 8 {
        return Err(error::BAD_ARGUMENT);
    }
    let mel_len = count.checked_mul(bands).ok_or(error::BAD_ARGUMENT)?;
    let length = n
        .checked_add(count)
        .and_then(|v| v.checked_add(mel_len))
        .and_then(|v| v.checked_add(count * pitch_flag))
        .filter(|&v| v <= i32::MAX as usize / 4)
        .ok_or(error::BAD_ARGUMENT)?;
    let rows = f64_slice(indices, rows)?
        .iter()
        .map(|&row| integer(row))
        .collect::<Result<Vec<_>, _>>()?;
    check_range(input, length as u32, 4)?;
    let values = if length == 0 {
        &[]
    } else {
        // SAFETY: the range is aligned and in linear memory. The samples
        // and speech flags are only read, including if their ranges overlap.
        unsafe { core::slice::from_raw_parts(input as usize as *const f32, length) }
    };
    let (samples, rest) = values.split_at(n);
    let (periodicity, rest) = rest.split_at(count);
    let (mel, pitch) = rest.split_at(mel_len);
    let frames = Frames {
        rate: header[0],
        hop: header[1],
        window: header[2],
        start_time: header[3],
        count,
        sample_count: n,
        mel_bands: bands,
        samples,
        speech: u8_slice(speech, count as u32)?,
        periodicity,
        mel,
    };
    let options = Options {
        pitch: (pitch_flag == 1).then_some(pitch),
        tract_order: integer(header[7])?,
        glottis_order: integer(header[8])?,
        leak: header[9],
        step: header[10],
        min_f0: header[11],
        max_f0: header[12],
    };
    inverse_mode_measures(&frames, options, &rows).map_err(|_| error::BAD_ARGUMENT)
}

/// Like `rec_inverse_modes`, with waveform and feature columns of their
/// native widths. `header` and `indices` still contain f64 values.
#[no_mangle]
pub extern "C" fn rec_inverse_modes_f32(
    header: u32,
    input: u32,
    speech: u32,
    indices: u32,
    rows: u32,
    output: u32,
    capacity: u32,
) -> i32 {
    if capacity > i32::MAX as u32 / 4 {
        return error::BAD_ARGUMENT;
    }
    if let Err(e) = check_range(output, capacity, 4) {
        return e;
    }
    let values = match mode_input(header, input, speech, indices, rows, capacity) {
        Ok(values) => values,
        Err(e) => return e,
    };
    // mode_input has returned, so the output may overlap its input buffers.
    let out = match f32_slice(output, capacity) {
        Ok(out) => out,
        Err(e) => return e,
    };
    let mut at = 0;
    for column in values {
        let end = at + column.len();
        out[at..end].copy_from_slice(&column);
        at = end;
    }
    at as i32
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_layout() {
        assert_eq!(run(&[], false).unwrap_err(), error::BAD_ARGUMENT);
        let mut input = [0.0; 14];
        input[4] = f64::INFINITY;
        assert_eq!(run(&input, false).unwrap_err(), error::BAD_ARGUMENT);
    }
}
