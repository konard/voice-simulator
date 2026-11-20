//! Numerical recognition exports (Unlicense).
use crate::{check_range, error, f64_slice};
use voice_simulator_core::recognition::word_search::{SearchScratch, Trie};

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
    let gaps = f64_read(gaps, nodes)?;
    let input = f64_read(distances, input_len)?;
    let table = u32_slice(topology, bound)?;
    let n = nodes as usize;
    let (child_offsets, rest) = table.split_at(n + 1);
    let (children, rest) = rest.split_at(n - 1);
    let (feature, terminal) = rest.split_at(n);
    if child_offsets[0] != 0 || child_offsets[n] != nodes - 1 {
        return Err(error::BAD_ARGUMENT);
    }
    let trie = Trie {
        child_offsets,
        children,
        feature,
        gaps,
        terminal,
    };
    WORD_SCRATCH.with_borrow_mut(|scratch| {
        trie.search(input, stride as usize, beam as usize, scratch)
            .ok_or(error::BAD_ARGUMENT)
    })
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
    static WORD_SCRATCH: RefCell<SearchScratch> = RefCell::new(SearchScratch::default());
    static CORRELATIONS: RefCell<BTreeMap<u32, CoarseCorrelation>> = const { RefCell::new(BTreeMap::new()) };
}

#[no_mangle]
pub extern "C" fn rec_pitch_decimate(
    samples: u32,
    length: u32,
    kernel: u32,
    taps: u32,
    start: i32,
    factor: u32,
    output: u32,
    count: u32,
) -> i32 {
    let run = || {
        if factor == 0 || taps == 0 || count > i32::MAX as u32 {
            return Err(error::BAD_ARGUMENT);
        }
        check_range(samples, length, 4)?;
        let samples: &[f32] = if length == 0 {
            &[]
        } else {
            // SAFETY: the input is aligned, in range and checked against the output below.
            unsafe { core::slice::from_raw_parts(samples as usize as *const f32, length as usize) }
        };
        let kernel = f64_read(kernel, taps)?;
        disjoint(output, count, samples)?;
        disjoint(output, count, kernel)?;
        let output = f64_slice(output, count)?;
        pitch::decimate(samples, kernel, start, factor, output);
        Ok(0)
    };
    run().unwrap_or_else(core::convert::identity)
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
pub extern "C" fn rec_pitch_frame(
    input: u32,
    count: u32,
    leading_zeros: u32,
    length: u32,
    window: u32,
    output: u32,
    stats: u32,
) -> i32 {
    if length == 0 || leading_zeros > length || count > length - leading_zeros {
        return error::BAD_ARGUMENT;
    }
    let run = || {
        let bytes = length.checked_mul(8).ok_or(error::BAD_ARGUMENT)?;
        let mut ranges = [
            (input, count * 4),
            (window, bytes),
            (output, bytes),
            (stats, 16),
        ];
        ranges.sort_unstable();
        if ranges
            .windows(2)
            .any(|pair| u64::from(pair[0].0) + u64::from(pair[0].1) > u64::from(pair[1].0))
        {
            return Err(error::BAD_ARGUMENT);
        }
        let samples = f32_slice(input, count)?;
        let window = f64_read(window, length)?;
        let output = f64_slice(output, length)?;
        let (energy, peak) = pitch::window_frame(samples, leading_zeros as usize, window, output);
        f64_slice(stats, 2)?.copy_from_slice(&[energy, peak]);
        Ok(0)
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
    cache: u32,
    output: u32,
) -> i32 {
    if !(0..=64).contains(&radius) || !(0..=1_000_000).contains(&centre) {
        return error::BAD_ARGUMENT;
    }
    let run = || {
        let frame = f64_read(frame, length)?;
        let window = f64_read(window, lags)?;
        disjoint(cache, lags, frame)?;
        disjoint(cache, lags, window)?;
        let cache = f64_slice(cache, lags)?;
        let (lag, score) = pitch::refine_cached(frame, window, energy, centre, radius, cache);
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

fn disjoint<T>(offset: u32, count: u32, input: &[T]) -> Result<(), i32> {
    let start = u64::from(offset);
    let end = start + u64::from(count) * 8;
    let first = input.as_ptr() as u64;
    let last = first + core::mem::size_of_val(input) as u64;
    if !input.is_empty() && count != 0 && start < last && first < end {
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
