//! Packed, additive ABI for batch source analysis (Unlicense).
//! Layout is documented in docs/INVERSE-FILTER.md; input is copied before
//! analysis, so allocation and an overlapping output cannot alias live views.
use crate::{error, f64_slice};
use voice_simulator_core::inverse_filter::{inverse_filter, Frames, Options};

fn integer(v: f64) -> Result<usize, i32> {
    if !v.is_finite() || v < 0.0 || v.fract() != 0.0 || v > u32::MAX as f64 {
        Err(error::BAD_ARGUMENT)
    } else {
        Ok(v as usize)
    }
}
fn run(input: &[f64]) -> Result<Vec<f64>, i32> {
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
    let required = 14usize
        .checked_add(n)
        .and_then(|v| v.checked_add(count.checked_mul(2 + bands + pitch_flag)?))
        .ok_or(error::BAD_ARGUMENT)?;
    if input.len() != required {
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
    let result = inverse_filter(&frames, options).map_err(|_| error::BAD_ARGUMENT)?;
    let mut out = vec![
        count as f64,
        n as f64,
        result.gci.len() as f64,
        f64::from(u8::from(result.low_band)),
    ];
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
/// Writes the packed result and returns its length, or a negative error.
/// `capacity` counts f64 values. A short output returns BAD_ARGUMENT.
#[no_mangle]
pub extern "C" fn vs_inverse_filter(input: u32, length: u32, output: u32, capacity: u32) -> i32 {
    let input = match f64_slice(input, length) {
        Ok(v) => v.to_vec(),
        Err(e) => return e,
    };
    // Check the output range before doing DSP, without retaining its view.
    if let Err(e) = f64_slice(output, capacity) {
        return e;
    }
    let values = match run(&input) {
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
/// Recognition entry point for the same source-analysis packet.
#[no_mangle]
pub extern "C" fn rec_inverse_filter(input: u32, length: u32, output: u32, capacity: u32) -> i32 {
    vs_inverse_filter(input, length, output, capacity)
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn malformed_layout() {
        assert_eq!(run(&[]).unwrap_err(), error::BAD_ARGUMENT);
        let mut input = [0.0; 14];
        input[4] = f64::INFINITY;
        assert_eq!(run(&input).unwrap_err(), error::BAD_ARGUMENT);
    }
}
