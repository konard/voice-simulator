//! Packets for feature scoring in the timed recognition pipeline.
use crate::recognition::{packet_run, Reader};
use voice_simulator_core::prosody::{self, ToneFit};

fn read_array<const N: usize>(r: &mut Reader<'_>) -> Option<[f64; N]> {
    let mut values = [0.0; N];
    for value in &mut values {
        *value = r.number()?;
    }
    Some(values)
}

fn prominence(data: &[f64]) -> Option<Vec<f64>> {
    let mut r = Reader { data, at: 0 };
    let (rows, remainder) = data.as_chunks::<5>();
    if !remainder.is_empty() {
        return None;
    }
    let mut features = Vec::with_capacity(rows.len());
    let mut whispered = Vec::with_capacity(rows.len());
    for _ in rows {
        let present = r.integer()?;
        if present > 31 {
            return None;
        }
        let values = read_array::<4>(&mut r)?;
        features.push(core::array::from_fn(|i| {
            (present & (1 << i) != 0).then_some(values[i])
        }));
        whispered.push(present & 16 != 0);
    }
    Some(prosody::prominence_with_whisper(&features, &whispered))
}

fn tones(data: &[f64]) -> Option<Vec<f64>> {
    let mut r = Reader { data, at: 0 };
    let duration = r.number()?;
    let scale = r.number()?;
    let previous = r.integer()? as u32;
    let reduced = r.integer()? != 0;
    let fit = if r.integer()? != 0 {
        let fit = ToneFit {
            duration: r.number()?,
            value: r.number()?,
            shift: r.number()?,
            scale: r.number()?,
            observed: read_array(&mut r)?,
            times: read_array(&mut r)?,
        };
        if fit.duration <= 0.0
            || fit.times[0] < 0.0
            || fit.times[9] > fit.duration + 1e-9
            || fit.times.windows(2).any(|p| p[0] > p[1])
        {
            return None;
        }
        Some(fit)
    } else {
        None
    };
    let frames = data[r.at..]
        .iter()
        .copied()
        .filter(|x| x.is_finite())
        .collect::<Vec<_>>();
    if frames.len() != data.len() - r.at {
        return None;
    }
    Some(
        prosody::tone_costs(&frames, duration, scale, previous, reduced, fit.as_ref())
            .map_or_else(Vec::new, |v| v.to_vec()),
    )
}

#[no_mangle]
pub extern "C" fn vs_prosody_prominence(data: u32, count: u32, output: u32, capacity: u32) -> i32 {
    packet_run(data, count, output, capacity, prominence)
}

#[no_mangle]
pub extern "C" fn vs_prosody_tones(data: u32, count: u32, output: u32, capacity: u32) -> i32 {
    packet_run(data, count, output, capacity, tones)
}

fn frames<'a>(r: &mut Reader<'a>) -> Option<&'a [f64]> {
    let n = r.integer()?;
    let values = r.data.get(r.at..r.at.checked_add(n)?)?;
    r.at += n;
    values.iter().all(|v| v.is_finite()).then_some(values)
}

fn phrase(data: &[f64]) -> Option<Vec<f64>> {
    let mut r = Reader { data, at: 0 };
    let phrase_energy = r.number()?;
    let utterance_energy = r.number()?;
    let voiced = frames(&mut r)?;
    let tail = frames(&mut r)?;
    let other = frames(&mut r)?;
    if r.at != data.len() {
        return None;
    }
    Some(prosody::phrase_cues(voiced, tail, phrase_energy, utterance_energy, other).to_vec())
}

fn focus(data: &[f64]) -> Option<Vec<f64>> {
    let mut r = Reader { data, at: 0 };
    let time = r.number()?;
    let (peaks, remainder) = data[1..].as_chunks::<2>();
    if !remainder.is_empty() || peaks.iter().flatten().any(|v| !v.is_finite()) {
        return None;
    }
    Some(vec![prosody::expected_peak(peaks, time)])
}

#[no_mangle]
pub extern "C" fn vs_prosody_phrase(data: u32, count: u32, output: u32, capacity: u32) -> i32 {
    packet_run(data, count, output, capacity, phrase)
}

#[no_mangle]
pub extern "C" fn vs_prosody_focus(data: u32, count: u32, output: u32, capacity: u32) -> i32 {
    packet_run(data, count, output, capacity, focus)
}
