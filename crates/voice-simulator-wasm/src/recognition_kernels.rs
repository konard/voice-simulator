//! Numerical recognition exports (Unlicense).
use crate::{check_range, error, f64_slice};
use voice_simulator_core::recognition::word_search::Trie;

fn u32_slice<'a>(offset: u32, count: u32) -> Result<&'a [u32], i32> {
    check_range(offset, count, 4)?;
    if count == 0 {
        return Ok(&[]);
    }
    // SAFETY: range and alignment were checked, and the result is read-only.
    Ok(unsafe { core::slice::from_raw_parts(offset as usize as *const u32, count as usize) })
}

fn words(
    topology: u32,
    nodes: u32,
    gaps: u32,
    distances: u32,
    rows: u32,
    stride: u32,
    beam: u32,
) -> Result<Vec<f64>, i32> {
    let bound = nodes.checked_mul(4).ok_or(error::BAD_ARGUMENT)?;
    if nodes == 0 || stride < 2 || beam == 0 {
        return Err(error::BAD_ARGUMENT);
    }
    let input_len = rows.checked_mul(stride).ok_or(error::BAD_ARGUMENT)?;
    // Keep owned copies because the caller can pass overlapping ranges.
    let gaps = f64_slice(gaps, nodes)?.to_vec();
    let input = f64_slice(distances, input_len)?.to_vec();
    let table = u32_slice(topology, bound)?;
    let n = nodes as usize;
    let (child_offsets, rest) = table.split_at(n + 1);
    let (children, rest) = rest.split_at(n - 1);
    let (feature, terminal) = rest.split_at(n);
    if child_offsets[0] != 0
        || child_offsets[n] != nodes - 1
        || child_offsets.windows(2).any(|p| p[0] > p[1])
        || children.iter().any(|&id| id >= nodes)
        || feature.iter().any(|&id| id >= stride - 1)
    {
        return Err(error::BAD_ARGUMENT);
    }
    let trie = Trie {
        child_offsets,
        children,
        feature,
        gaps: &gaps,
        terminal,
    };
    Ok(trie.search(&input, stride as usize, beam as usize))
}

/// Writes triples for the approximate word search. Returns the required
/// capacity and only writes when the entire output fits.
#[no_mangle]
pub extern "C" fn rec_word_search(
    topology: u32,
    nodes: u32,
    gaps: u32,
    distances: u32,
    rows: u32,
    stride: u32,
    beam: u32,
    out: u32,
    capacity: u32,
) -> i32 {
    let values = match words(topology, nodes, gaps, distances, rows, stride, beam) {
        Ok(values) => values,
        Err(code) => return code,
    };
    write_result(&values, out, capacity)
}

fn write_result(values: &[f64], out: u32, capacity: u32) -> i32 {
    if values.len() > i32::MAX as usize {
        return error::BAD_ARGUMENT;
    }
    if values.len() <= capacity as usize {
        match f64_slice(out, capacity) {
            Ok(buf) => buf[..values.len()].copy_from_slice(values),
            Err(code) => return code,
        }
    }
    values.len() as i32
}

use crate::f32_slice;
use std::{cell::RefCell, collections::BTreeMap};
use voice_simulator_core::recognition::pitch::{self, CoarseCorrelation};

thread_local! {
    static CORRELATIONS: RefCell<BTreeMap<u32, CoarseCorrelation>> = const { RefCell::new(BTreeMap::new()) };
}

#[no_mangle]
pub extern "C" fn rec_pitch(
    frame: u32,
    length: u32,
    window: u32,
    lags: u32,
    size: u32,
    output: u32,
) -> i32 {
    if !(2..=16384).contains(&size) || !size.is_power_of_two() || length > size || lags > size {
        return error::BAD_ARGUMENT;
    }
    let run = || {
        let frame = f64_read(frame, length)?;
        let window = f64_read(window, lags)?;
        disjoint(output, lags, frame)?;
        disjoint(output, lags, window)?;
        let output = f64_slice(output, lags)?;
        Ok(CORRELATIONS.with_borrow_mut(|plans| {
            i32::from(
                plans
                    .entry(size)
                    .or_insert_with(|| CoarseCorrelation::new(size as usize))
                    .measure(frame, window, output),
            )
        }))
    };
    run().unwrap_or_else(core::convert::identity)
}

#[no_mangle]
pub extern "C" fn rec_pitch_refine(
    frame: u32,
    length: u32,
    window: u32,
    lags: u32,
    energy: f64,
    centre: i32,
    radius: i32,
    output: u32,
) -> i32 {
    if !(0..=64).contains(&radius) || !(0..=1_000_000).contains(&centre) {
        return error::BAD_ARGUMENT;
    }
    let run = || {
        let frame = f64_read(frame, length)?;
        let window = f64_read(window, lags)?;
        let (lag, score) = pitch::refine(frame, window, energy, centre, radius);
        f64_slice(output, 2)?.copy_from_slice(&[lag, score]);
        Ok(0)
    };
    run().unwrap_or_else(core::convert::identity)
}

#[no_mangle]
pub extern "C" fn rec_pitch_mark(
    input: u32,
    length: u32,
    anchor: i32,
    lo: i32,
    hi: i32,
    span: i32,
) -> f64 {
    if lo < 0
        || hi < lo
        || hi > 1_000_000
        || !(0..=1_000_000).contains(&anchor)
        || !(1..=8192).contains(&span)
    {
        return f64::NAN;
    }
    match f32_slice(input, length) {
        Ok(samples) => pitch::mark(samples, anchor, lo, hi, span),
        Err(_) => f64::NAN,
    }
}

fn f64_read<'a>(offset: u32, count: u32) -> Result<&'a [f64], i32> {
    check_range(offset, count, 8)?;
    if count == 0 {
        return Ok(&[]);
    }
    // SAFETY: checked aligned bounds. Callers keep overlapping writes separated.
    Ok(unsafe { core::slice::from_raw_parts(offset as usize as *const f64, count as usize) })
}

fn disjoint(offset: u32, count: u32, input: &[f64]) -> Result<(), i32> {
    let start = u64::from(offset);
    let end = start + u64::from(count) * 8;
    let first = input.as_ptr() as u64;
    let last = first + input.len() as u64 * 8;
    if start < last && first < end {
        Err(error::BAD_ARGUMENT)
    } else {
        Ok(())
    }
}

use crate::u8_slice;
use voice_simulator_core::recognition::codebook::{Codebook, QUERY_WIDTH};

#[no_mangle]
pub extern "C" fn rec_codebook_search(
    table: u32,
    keys: u32,
    envelope: u32,
    entries: u32,
    queries: u32,
    frames: u32,
    k: u32,
    output: u32,
    capacity: u32,
) -> i32 {
    if !(1..=64).contains(&k) || entries == 0 || entries > 1_000_000 {
        return error::BAD_ARGUMENT;
    }
    let run = || {
        let book = Codebook::new(
            u32_slice(table, 4 * entries)?,
            f32_read(keys, 6 * entries)?,
            u8_slice(envelope, 24 * entries)?,
        )
        .ok_or(error::BAD_ARGUMENT)?;
        let count = frames
            .checked_mul(QUERY_WIDTH as u32)
            .ok_or(error::BAD_ARGUMENT)?;
        let values = book.query(f64_read(queries, count)?, k as usize);
        Ok(write_result(&values, output, capacity))
    };
    run().unwrap_or_else(core::convert::identity)
}

fn f32_read<'a>(offset: u32, count: u32) -> Result<&'a [f32], i32> {
    check_range(offset, count, 4)?;
    if count == 0 {
        return Ok(&[]);
    }
    // SAFETY: checked aligned bounds, input is read-only.
    Ok(unsafe { core::slice::from_raw_parts(offset as usize as *const f32, count as usize) })
}
