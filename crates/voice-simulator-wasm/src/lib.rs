//! WebAssembly interface of the voice simulator engine.
//!
//! Plain `#[no_mangle] pub extern "C"` functions, loaded by the hand-written
//! `src/engine/wasm-loader.js`; no wasm-bindgen and no generated glue. The
//! rules of the interface are in `docs/RUST-ENGINE.md`:
//!
//! - every export starts with `vs_`; arguments and results are `u32`, `i32`
//!   or `f64` only;
//! - arrays cross as (offset, length in elements) into the linear memory;
//! - errors are the negative codes of [`error`].
//!
//! Offsets are only meaningful on `wasm32`, where a pointer is a `u32`
//! offset into the one linear memory. The safe functions the exports call
//! ([`fill_uniform`], [`fill_normal`], [`run_airflow`], [`resampler_new`]
//! and the other `resampler_*` functions) are what the host tests exercise.

// The assembly of `vs_thread_init` (threads.rs) needs the nightly
// compiler of the threads build (`THREADS_TOOLCHAIN` of
// `scripts/build-wasm.mjs`); every other build is on stable Rust.
#![cfg_attr(
    all(target_arch = "wasm32", target_feature = "atomics"),
    feature(asm_experimental_arch)
)]

use std::alloc::{alloc, dealloc, Layout};
use std::cell::RefCell;

use voice_simulator_core::aerodynamics::{self, Aerodynamics};
use voice_simulator_core::random::{hash_seed_utf16, Random};
use voice_simulator_core::resample::{output_length, resample, StreamResampler};

pub mod codebook;
pub mod components;
pub mod decode;
pub mod fdtd;
pub mod formants;
pub mod inverse_filter;
pub mod inversion;
pub mod landmarks;
pub mod language_id;
pub mod modes;
pub mod prosody;
pub mod recognition;
pub mod renderer;
pub mod rescoring;
pub mod threads;
pub mod voice_fit;
pub mod whisper;

/// Version of the interface; raise it on any breaking change of a `vs_`
/// export (a removed or renamed function, a changed signature or meaning).
pub const ABI_VERSION: u32 = 5;

/// Number of capabilities compiled into this engine.
#[no_mangle]
pub extern "C" fn vs_features_count() -> usize {
    voice_simulator_core::features::FEATURES.len()
}
/// UTF-8 bytes of a capability (valid for the module's lifetime).
#[no_mangle]
pub extern "C" fn vs_feature_ptr(index: usize) -> *const u8 {
    voice_simulator_core::features::FEATURES
        .get(index)
        .map_or(core::ptr::null(), |id| id.as_ptr())
}
/// Byte length of a capability; zero for an invalid index.
#[no_mangle]
pub extern "C" fn vs_feature_len(index: usize) -> usize {
    voice_simulator_core::features::FEATURES
        .get(index)
        .map_or(0, |id| id.len())
}

/// Alignment of every block that [`vs_alloc`] returns.
pub const ALLOC_ALIGN: usize = 8;

/// Status codes of the exports that return `i32`: 0 or a negative error.
/// The same table is in `docs/RUST-ENGINE.md`.
pub mod error {
    /// Success.
    pub const OK: i32 = 0;
    /// The offset is 0 while the length is not.
    pub const NULL: i32 = -1;
    /// The offset is not a multiple of the element size.
    pub const MISALIGNED: i32 = -2;
    /// The range runs past the end of the linear memory.
    pub const OUT_OF_BOUNDS: i32 = -3;
    /// The engine could not allocate memory.
    pub const NO_MEMORY: i32 = -4;
    /// The integer handle names no live object.
    pub const BAD_HANDLE: i32 = -5;
    /// A number argument is out of its range (a sample rate that is not
    /// positive, an output of the wrong length).
    pub const BAD_ARGUMENT: i32 = -6;
}

/// Writes `out.len()` uniform values of `createRandom(seed)` into `out`.
pub fn fill_uniform(seed: u32, out: &mut [f64]) {
    let mut random = Random::new(seed);
    for value in out {
        *value = random.next();
    }
}

/// Writes `out.len()` values of `randomNormal(createRandom(seed))` into `out`.
pub fn fill_normal(seed: u32, out: &mut [f64]) {
    let mut random = Random::new(seed);
    for value in out {
        *value = random.normal();
    }
}

/// Values per step of [`run_airflow`]: three inputs, overwritten by five
/// outputs.
pub const AIRFLOW_STRIDE: usize = 5;

/// Steps an [`Aerodynamics`] state through `steps.len() / 5` steps of `dt`
/// seconds. Each step reads `[lung pressure, glottal area, constriction
/// area, -, -]` and writes `[flow, flow derivative, oral pressure, glottal
/// drop, constriction drop]` in place.
pub fn run_airflow(dt: f64, compliance: f64, steps: &mut [f64]) {
    let mut air = Aerodynamics::new(compliance);
    for step in steps.as_chunks_mut::<AIRFLOW_STRIDE>().0 {
        let state = air.step(dt, step[0], step[1], step[2]);
        step.copy_from_slice(&[
            state.flow,
            state.flow_derivative,
            state.oral_pressure,
            state.glottal_drop,
            state.constriction_drop,
        ]);
    }
}

/// A stream resampler of [`vs_resampler_new`] and the outputs it has
/// computed that [`vs_resampler_read`] has not taken yet.
struct Resampler {
    stream: StreamResampler,
    ready: Vec<f32>,
}

thread_local! {
    /// The live resamplers; handle `h` is slot `h - 1`.
    static RESAMPLERS: RefCell<Vec<Option<Resampler>>> = const { RefCell::new(Vec::new()) };
}

/// Whether `value` is a positive number (NaN is not).
pub(crate) fn positive(value: f64) -> bool {
    value > 0.0
}

/// A new stream resampler; returns its handle (> 0) or [`error::BAD_ARGUMENT`].
pub fn resampler_new(from_rate: f64, to_rate: f64, zero_crossings: f64) -> i32 {
    if !positive(zero_crossings) {
        return error::BAD_ARGUMENT;
    }
    let Ok(stream) = StreamResampler::new(from_rate, to_rate, zero_crossings) else {
        return error::BAD_ARGUMENT;
    };
    let resampler = Resampler {
        stream,
        ready: Vec::new(),
    };
    RESAMPLERS.with_borrow_mut(|slots| {
        let index = match slots.iter().position(Option::is_none) {
            Some(index) => {
                slots[index] = Some(resampler);
                index
            }
            None => {
                slots.push(Some(resampler));
                slots.len() - 1
            }
        };
        i32::try_from(index + 1).unwrap_or(error::NO_MEMORY)
    })
}

/// Runs `action` on the resampler of `handle`, or returns [`error::BAD_HANDLE`].
fn with_resampler(handle: i32, action: impl FnOnce(&mut Resampler) -> i32) -> i32 {
    let Some(index) = usize::try_from(handle).ok().and_then(|h| h.checked_sub(1)) else {
        return error::BAD_HANDLE;
    };
    RESAMPLERS.with_borrow_mut(|slots| match slots.get_mut(index) {
        Some(Some(resampler)) => action(resampler),
        _ => error::BAD_HANDLE,
    })
}

/// The number of outputs waiting to be read, as an `i32` result.
fn ready_count(resampler: &Resampler) -> i32 {
    i32::try_from(resampler.ready.len()).unwrap_or(error::NO_MEMORY)
}

/// Pushes `chunk`; returns the number of outputs waiting to be read.
pub fn resampler_push(handle: i32, chunk: &[f32]) -> i32 {
    with_resampler(handle, |resampler| {
        let output = resampler.stream.push(chunk);
        resampler.ready.extend(output);
        ready_count(resampler)
    })
}

/// Flushes the stream; returns the number of outputs waiting to be read.
pub fn resampler_flush(handle: i32) -> i32 {
    with_resampler(handle, |resampler| {
        let output = resampler.stream.flush();
        resampler.ready.extend(output);
        ready_count(resampler)
    })
}

/// Moves the first `out.len()` waiting outputs (or fewer) into `out`;
/// returns how many.
pub fn resampler_read(handle: i32, out: &mut [f32]) -> i32 {
    with_resampler(handle, |resampler| {
        let count = out.len().min(resampler.ready.len());
        out[..count].copy_from_slice(&resampler.ready[..count]);
        resampler.ready.drain(..count);
        i32::try_from(count).unwrap_or(error::NO_MEMORY)
    })
}

/// Input samples the resampler of `handle` holds.
pub fn resampler_held(handle: i32) -> i32 {
    with_resampler(handle, |resampler| {
        i32::try_from(resampler.stream.held()).unwrap_or(error::NO_MEMORY)
    })
}

/// Frees the resampler of `handle`; the handle may be given out again.
pub fn resampler_free(handle: i32) -> i32 {
    let code = with_resampler(handle, |_| error::OK);
    if code == error::OK {
        RESAMPLERS.with_borrow_mut(|slots| slots[handle as usize - 1] = None);
    }
    code
}

/// Size in bytes of the linear memory right now.
#[cfg(target_arch = "wasm32")]
fn memory_bytes() -> u64 {
    core::arch::wasm32::memory_size::<0>() as u64 * 65_536
}

/// Off `wasm32` there is no linear memory to measure; the exports are not
/// meant to be called there.
#[cfg(not(target_arch = "wasm32"))]
fn memory_bytes() -> u64 {
    1 << 32
}

/// Checks that `count` elements of `size` bytes fit at `offset`.
pub(crate) fn check_range(offset: u32, count: u32, size: u32) -> Result<(), i32> {
    if count == 0 {
        return Ok(());
    }
    if offset == 0 {
        return Err(error::NULL);
    }
    if !offset.is_multiple_of(size) {
        return Err(error::MISALIGNED);
    }
    let end = u64::from(offset) + u64::from(count) * u64::from(size);
    if end > memory_bytes() {
        return Err(error::OUT_OF_BOUNDS);
    }
    Ok(())
}

/// Stops the module: a trap is a `WebAssembly.RuntimeError` in JavaScript.
fn trap() -> ! {
    #[cfg(target_arch = "wasm32")]
    core::arch::wasm32::unreachable();
    #[cfg(not(target_arch = "wasm32"))]
    std::process::abort();
}

/// The layout [`vs_alloc`] and [`vs_free`] agree on; `None` when too large.
fn block_layout(bytes: u32) -> Option<Layout> {
    Layout::from_size_align((bytes as usize).max(1), ALLOC_ALIGN).ok()
}

/// A mutable view of `count` `f64` values at `offset`, after [`check_range`].
pub(crate) fn f64_slice<'a>(offset: u32, count: u32) -> Result<&'a mut [f64], i32> {
    check_range(offset, count, 8)?;
    if count == 0 {
        return Ok(&mut []);
    }
    // SAFETY: the range is non-null, aligned to 8 and inside the linear
    // memory (checked above); JavaScript owns the block and does not run
    // while the export holds the slice.
    Ok(unsafe { core::slice::from_raw_parts_mut(offset as usize as *mut f64, count as usize) })
}

/// A mutable view of `count` `f32` values at `offset`, after [`check_range`].
pub(crate) fn f32_slice<'a>(offset: u32, count: u32) -> Result<&'a mut [f32], i32> {
    check_range(offset, count, 4)?;
    if count == 0 {
        return Ok(&mut []);
    }
    // SAFETY: as in `f64_slice`, with an alignment of 4.
    Ok(unsafe { core::slice::from_raw_parts_mut(offset as usize as *mut f32, count as usize) })
}

/// A view of the `count` bytes at `offset`, after [`check_range`].
pub(crate) fn u8_slice<'a>(offset: u32, count: u32) -> Result<&'a [u8], i32> {
    check_range(offset, count, 1)?;
    if count == 0 {
        return Ok(&[]);
    }
    // SAFETY: as in `f64_slice`, with an alignment of 1.
    Ok(unsafe { core::slice::from_raw_parts(offset as usize as *const u8, count as usize) })
}

/// A copy of the `count` `f32` values at `offset`, so the input may overlap
/// the output of the same call.
fn f32_input(offset: u32, count: u32) -> Result<Vec<f32>, i32> {
    f32_slice(offset, count).map(|slice| slice.to_vec())
}

/// Version of this interface; the loader refuses any other value.
#[no_mangle]
pub extern "C" fn vs_abi_version() -> u32 {
    ABI_VERSION
}

/// 1 when this file was built with `-C target-feature=+simd128` (the 3D
/// solver then steps with the SIMD kernel), else 0.
#[no_mangle]
pub extern "C" fn vs_simd() -> u32 {
    u32::from(cfg!(target_feature = "simd128"))
}

/// Allocates `bytes` bytes (at least 1) aligned to 8; returns the offset, or
/// 0 when the memory is exhausted. Can grow the memory: JavaScript must
/// create its typed-array views again afterwards.
#[no_mangle]
pub extern "C" fn vs_alloc(bytes: u32) -> u32 {
    match block_layout(bytes) {
        // SAFETY: the layout has a non-zero size.
        Some(layout) => unsafe { alloc(layout) as usize as u32 },
        None => 0,
    }
}

/// Frees a block of [`vs_alloc`]; `bytes` must be the number given to it.
/// Offset 0 is ignored.
#[no_mangle]
pub extern "C" fn vs_free(ptr: u32, bytes: u32) {
    if ptr == 0 {
        return;
    }
    if let Some(layout) = block_layout(bytes) {
        // SAFETY: the caller returns a block of vs_alloc with its own size,
        // which gives the same layout.
        unsafe { dealloc(ptr as usize as *mut u8, layout) }
    }
}

/// `hashSeed` of `src/random.js` for a string given as `len` UTF-16 code
/// units at `ptr`. It cannot return an error code, so an invalid range traps.
#[no_mangle]
pub extern "C" fn vs_hash_seed_utf16(ptr: u32, len: u32) -> u32 {
    if check_range(ptr, len, 2).is_err() {
        trap();
    }
    if len == 0 {
        return hash_seed_utf16(&[]);
    }
    // SAFETY: the range is non-null, aligned to 2 and inside the memory.
    let units = unsafe { core::slice::from_raw_parts(ptr as usize as *const u16, len as usize) };
    hash_seed_utf16(units)
}

/// Writes `count` values of `createRandom(seed)` as `f64` at `out`.
/// Returns 0 or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_random_fill(seed: u32, out: u32, count: u32) -> i32 {
    match f64_slice(out, count) {
        Ok(slice) => {
            fill_uniform(seed, slice);
            error::OK
        }
        Err(code) => code,
    }
}

/// Writes `count` values of `randomNormal(createRandom(seed))` as `f64` at
/// `out`. Returns 0 or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_random_normal_fill(seed: u32, out: u32, count: u32) -> i32 {
    match f64_slice(out, count) {
        Ok(slice) => {
            fill_normal(seed, slice);
            error::OK
        }
        Err(code) => code,
    }
}

/// `reynolds(flow, area)` of `src/acoustics/aerodynamics.js`.
#[no_mangle]
pub extern "C" fn vs_aero_reynolds(flow: f64, area: f64) -> f64 {
    aerodynamics::reynolds(flow, area)
}

/// `sourceStrength(dp, area, flow, reCritical)` of
/// `src/acoustics/aerodynamics.js`.
#[no_mangle]
pub extern "C" fn vs_aero_source_strength(dp: f64, area: f64, flow: f64, re_critical: f64) -> f64 {
    aerodynamics::source_strength_at(dp, area, flow, re_critical)
}

/// `openTractStrength(lungPressure, glottalArea, reCritical)` of
/// `src/acoustics/aerodynamics.js`.
#[no_mangle]
pub extern "C" fn vs_aero_open_tract_strength(
    lung_pressure: f64,
    glottal_area: f64,
    re_critical: f64,
) -> f64 {
    aerodynamics::open_tract_strength_at(lung_pressure, glottal_area, re_critical)
}

/// `glottalArea({voicing, aspiration, closure}, breathiness, chink,
/// {glottisVoiced, glottisOpen, glottisBreathy})` of
/// `src/acoustics/aerodynamics.js`.
#[no_mangle]
#[allow(clippy::too_many_arguments)]
pub extern "C" fn vs_aero_glottal_area(
    voicing: f64,
    aspiration: f64,
    closure: f64,
    breathiness: f64,
    chink: f64,
    voiced: f64,
    open: f64,
    breathy: f64,
) -> f64 {
    aerodynamics::glottal_area_of(
        voicing,
        aspiration,
        closure,
        breathiness,
        chink,
        &aerodynamics::GlottalAreas {
            voiced,
            open,
            breathy,
        },
    )
}

/// `strouhalFrequency(flow, area, strouhal)` of `src/acoustics/voice.js`.
#[no_mangle]
pub extern "C" fn vs_aero_strouhal_frequency(flow: f64, area: f64, strouhal: f64) -> f64 {
    aerodynamics::strouhal_frequency_at(flow, area, strouhal)
}

/// `steadyFlow(lungPressure, glottalArea, constrictionArea)` of
/// `src/acoustics/aerodynamics.js`: writes `[oral pressure, flow]` at
/// `out`. Returns 0 or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_aero_steady_flow(
    lung_pressure: f64,
    glottal_area: f64,
    constriction_area: f64,
    out: u32,
) -> i32 {
    match f64_slice(out, 2) {
        Ok(slice) => {
            let (oral_pressure, flow) =
                aerodynamics::steady_flow(lung_pressure, glottal_area, constriction_area);
            slice.copy_from_slice(&[oral_pressure, flow]);
            error::OK
        }
        Err(code) => code,
    }
}

/// Runs `count` steps of a fresh `Aerodynamics` (see [`run_airflow`]) on
/// the `5 * count` values at `steps`. Returns 0 or a negative code of
/// [`error`].
#[no_mangle]
pub extern "C" fn vs_aero_run(dt: f64, compliance: f64, steps: u32, count: u32) -> i32 {
    let Some(values) = count.checked_mul(AIRFLOW_STRIDE as u32) else {
        return error::OUT_OF_BOUNDS;
    };
    match f64_slice(steps, values) {
        Ok(slice) => {
            run_airflow(dt, compliance, slice);
            error::OK
        }
        Err(code) => code,
    }
}

/// `Math.round(len * to_rate / from_rate)`: the output length of
/// [`vs_resample`], or [`error::BAD_ARGUMENT`] for a rate that is not
/// positive.
#[no_mangle]
pub extern "C" fn vs_resample_length(len: u32, from_rate: f64, to_rate: f64) -> i32 {
    if !positive(from_rate) || !positive(to_rate) {
        return error::BAD_ARGUMENT;
    }
    i32::try_from(output_length(len as usize, from_rate, to_rate)).unwrap_or(error::BAD_ARGUMENT)
}

/// `resample(input, fromRate, toRate, {zeroCrossings})` of
/// `src/audio/resample.js`: reads `len` `f32` samples at `input` and writes
/// the `out_len` `f32` samples of the result at `out` (`out_len` must be
/// [`vs_resample_length`]). Returns 0 or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_resample(
    input: u32,
    len: u32,
    from_rate: f64,
    to_rate: f64,
    zero_crossings: f64,
    out: u32,
    out_len: u32,
) -> i32 {
    let length = vs_resample_length(len, from_rate, to_rate);
    if length < 0 {
        return length;
    }
    if !positive(zero_crossings) || length as u32 != out_len {
        return error::BAD_ARGUMENT;
    }
    let samples = match f32_input(input, len) {
        Ok(samples) => samples,
        Err(code) => return code,
    };
    let Ok(result) = resample(&samples, from_rate, to_rate, zero_crossings) else {
        return error::BAD_ARGUMENT;
    };
    match f32_slice(out, out_len) {
        Ok(slice) => {
            slice.copy_from_slice(&result);
            error::OK
        }
        Err(code) => code,
    }
}

/// `createStreamResampler(fromRate, toRate, {zeroCrossings})`: returns a
/// handle (> 0) or [`error::BAD_ARGUMENT`]. Free it with
/// [`vs_resampler_free`].
#[no_mangle]
pub extern "C" fn vs_resampler_new(from_rate: f64, to_rate: f64, zero_crossings: f64) -> i32 {
    resampler_new(from_rate, to_rate, zero_crossings)
}

/// `push` of the stream resampler for the `len` `f32` samples at `input`.
/// Returns the number of outputs waiting for [`vs_resampler_read`], or a
/// negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_resampler_push(handle: i32, input: u32, len: u32) -> i32 {
    match f32_input(input, len) {
        Ok(samples) => resampler_push(handle, &samples),
        Err(code) => code,
    }
}

/// `flush` of the stream resampler. Returns the number of outputs waiting
/// for [`vs_resampler_read`], or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_resampler_flush(handle: i32) -> i32 {
    resampler_flush(handle)
}

/// Moves up to `count` waiting outputs as `f32` to `out`, oldest first.
/// Returns how many, or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_resampler_read(handle: i32, out: u32, count: u32) -> i32 {
    match f32_slice(out, count) {
        Ok(slice) => resampler_read(handle, slice),
        Err(code) => code,
    }
}

/// `held()` of the stream resampler: the input samples it keeps, or a
/// negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_resampler_held(handle: i32) -> i32 {
    resampler_held(handle)
}

/// Frees the resampler of `handle`. Returns 0 or [`error::BAD_HANDLE`].
#[no_mangle]
pub extern "C" fn vs_resampler_free(handle: i32) -> i32 {
    resampler_free(handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_version_is_five() {
        assert_eq!(vs_abi_version(), 5);
    }

    #[test]
    fn native_tests_are_not_simd() {
        assert_eq!(vs_simd(), 0);
    }

    #[test]
    fn fills_match_the_generator() {
        let mut uniform = [0.0; 3];
        fill_uniform(1, &mut uniform);
        // The first three values of createRandom(1), printed by Node.js.
        assert_eq!(
            uniform.map(f64::to_bits),
            [
                0x3fe4_10fd_5e60_0000,
                0x3f66_6939_2000_0000,
                0x3fe0_e0d8_9d60_0000
            ]
        );
        let mut normal = [0.0; 1];
        fill_normal(1, &mut normal);
        assert_eq!(normal[0].to_bits(), 0x3fce_a9c4_9fc9_a855);
    }

    #[test]
    fn ranges_are_checked() {
        assert_eq!(check_range(0, 0, 8), Ok(()));
        assert_eq!(check_range(0, 1, 8), Err(error::NULL));
        assert_eq!(check_range(4, 1, 8), Err(error::MISALIGNED));
        assert_eq!(check_range(0xffff_fff8, 2, 8), Err(error::OUT_OF_BOUNDS));
        assert_eq!(check_range(8, 1, 8), Ok(()));
    }

    #[test]
    fn empty_and_invalid_fills() {
        assert_eq!(vs_random_fill(1, 0, 0), error::OK);
        assert_eq!(vs_random_fill(1, 0, 4), error::NULL);
        assert_eq!(vs_random_normal_fill(1, 12, 4), error::MISALIGNED);
        assert_eq!(vs_hash_seed_utf16(0, 0), 0x811c_9dc5);
    }

    #[test]
    fn airflow_runs_in_place() {
        let mut steps = [8000.0, 0.25, 0.09, 0.0, 0.0, 8000.0, 0.25, 0.09, 0.0, 0.0];
        run_airflow(1.0 / 48000.0, 1e-3, &mut steps);
        let mut air = Aerodynamics::new(1e-3);
        let first = air.step(1.0 / 48000.0, 8000.0, 0.25, 0.09);
        let second = air.step(1.0 / 48000.0, 8000.0, 0.25, 0.09);
        assert_eq!(steps[0], first.flow);
        assert_eq!(steps[7], second.oral_pressure);
        assert_eq!(vs_aero_run(0.0, 1e-3, 0, 1), error::NULL);
        assert_eq!(vs_aero_run(0.0, 1e-3, 8, u32::MAX), error::OUT_OF_BOUNDS);
    }

    #[test]
    fn resamplers_live_behind_handles() {
        assert_eq!(resampler_new(0.0, 48_000.0, 8.0), error::BAD_ARGUMENT);
        assert_eq!(resampler_new(16_000.0, 48_000.0, 0.0), error::BAD_ARGUMENT);
        let first = resampler_new(16_000.0, 48_000.0, 8.0);
        let second = resampler_new(48_000.0, 48_000.0, 8.0);
        assert!(first > 0 && second > first);
        let input: Vec<f32> = (0..400).map(|index| (index % 7) as f32 / 7.0).collect();
        let mut joined = Vec::new();
        for chunk in input.chunks(37) {
            let ready = resampler_push(first, chunk);
            assert!(ready >= 0);
            let mut out = vec![0.0; ready as usize];
            assert_eq!(resampler_read(first, &mut out), ready);
            joined.extend(out);
        }
        assert!(resampler_held(first) > 0);
        let ready = resampler_flush(first);
        let mut out = vec![0.0; ready as usize + 5];
        assert_eq!(resampler_read(first, &mut out), ready);
        joined.extend(&out[..ready as usize]);
        let whole = resample(&input, 16_000.0, 48_000.0, 8.0).unwrap();
        assert_eq!(joined, whole);
        // Equal rates copy the chunk through.
        assert_eq!(resampler_push(second, &[0.5, 0.25]), 2);
        let mut copy = [0.0; 1];
        assert_eq!(resampler_read(second, &mut copy), 1);
        assert_eq!(copy, [0.5]);
        // A freed handle is dead and its slot is given out again.
        assert_eq!(resampler_free(first), error::OK);
        assert_eq!(resampler_free(first), error::BAD_HANDLE);
        assert_eq!(resampler_flush(first), error::BAD_HANDLE);
        assert_eq!(resampler_held(0), error::BAD_HANDLE);
        assert_eq!(resampler_held(-3), error::BAD_HANDLE);
        assert_eq!(resampler_new(8_000.0, 44_100.0, 8.0), first);
        assert_eq!(resampler_free(first), error::OK);
        assert_eq!(resampler_free(second), error::OK);
    }

    #[test]
    fn resample_checks_its_arguments() {
        assert_eq!(vs_resample_length(160, 16_000.0, 44_100.0), 441);
        assert_eq!(
            vs_resample_length(160, f64::NAN, 44_100.0),
            error::BAD_ARGUMENT
        );
        assert_eq!(vs_resample(0, 0, 16_000.0, 48_000.0, 16.0, 0, 0), error::OK);
        assert_eq!(
            vs_resample(0, 1, 16_000.0, 48_000.0, 16.0, 0, 3),
            error::NULL
        );
        assert_eq!(
            vs_resample(0, 1, 16_000.0, 48_000.0, 16.0, 0, 2),
            error::BAD_ARGUMENT
        );
        assert_eq!(
            vs_resample(0, 0, 16_000.0, 48_000.0, -1.0, 0, 0),
            error::BAD_ARGUMENT
        );
        assert_eq!(vs_resampler_push(1_000, 6, 1), error::MISALIGNED);
    }

    #[test]
    fn layouts_are_aligned_to_eight() {
        assert_eq!(block_layout(0).map(|layout| layout.size()), Some(1));
        assert_eq!(block_layout(13).map(|layout| layout.align()), Some(8));
    }
}
