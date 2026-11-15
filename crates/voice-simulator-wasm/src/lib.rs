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
//! ([`fill_uniform`], [`fill_normal`]) are what the host tests exercise.

use std::alloc::{alloc, dealloc, Layout};

use voice_simulator_core::aerodynamics::{self, Aerodynamics};
use voice_simulator_core::random::{hash_seed_utf16, Random};

/// Version of the interface; raise it on any breaking change of a `vs_`
/// export (a removed or renamed function, a changed signature or meaning).
pub const ABI_VERSION: u32 = 1;

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
fn check_range(offset: u32, count: u32, size: u32) -> Result<(), i32> {
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
fn f64_slice<'a>(offset: u32, count: u32) -> Result<&'a mut [f64], i32> {
    check_range(offset, count, 8)?;
    if count == 0 {
        return Ok(&mut []);
    }
    // SAFETY: the range is non-null, aligned to 8 and inside the linear
    // memory (checked above); JavaScript owns the block and does not run
    // while the export holds the slice.
    Ok(unsafe { core::slice::from_raw_parts_mut(offset as usize as *mut f64, count as usize) })
}

/// Version of this interface; the loader refuses any other value.
#[no_mangle]
pub extern "C" fn vs_abi_version() -> u32 {
    ABI_VERSION
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

/// `sourceStrength(dp, area, flow)` of `src/acoustics/aerodynamics.js`.
#[no_mangle]
pub extern "C" fn vs_aero_source_strength(dp: f64, area: f64, flow: f64) -> f64 {
    aerodynamics::source_strength(dp, area, flow)
}

/// `openTractStrength(lungPressure, glottalArea)` of
/// `src/acoustics/aerodynamics.js`.
#[no_mangle]
pub extern "C" fn vs_aero_open_tract_strength(lung_pressure: f64, glottal_area: f64) -> f64 {
    aerodynamics::open_tract_strength(lung_pressure, glottal_area)
}

/// `glottalArea({voicing, aspiration, closure}, breathiness, chink)` of
/// `src/acoustics/aerodynamics.js`.
#[no_mangle]
pub extern "C" fn vs_aero_glottal_area(
    voicing: f64,
    aspiration: f64,
    closure: f64,
    breathiness: f64,
    chink: f64,
) -> f64 {
    aerodynamics::glottal_area(voicing, aspiration, closure, breathiness, chink)
}

/// `strouhalFrequency(flow, area)` of `src/acoustics/voice.js`.
#[no_mangle]
pub extern "C" fn vs_aero_strouhal_frequency(flow: f64, area: f64) -> f64 {
    aerodynamics::strouhal_frequency(flow, area)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn abi_version_is_one() {
        assert_eq!(vs_abi_version(), 1);
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
    fn layouts_are_aligned_to_eight() {
        assert_eq!(block_layout(0).map(|layout| layout.size()), Some(1));
        assert_eq!(block_layout(13).map(|layout| layout.align()), Some(8));
    }
}
