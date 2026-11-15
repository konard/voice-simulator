//! Exports of the 3D FDTD solver (issue 23), used by the parity tests of
//! `tests/rust-fdtd.test.js` and by anyone who wants the parts without the
//! renderer:
//!
//! - the bare step loop (`vs_fdtd_kernel_*`);
//! - the solver alone, stepped with given sources (`vs_fdtd_solver_*`);
//! - a round trip of the packed voxel model (`vs_fdtd_model_repack`).

use std::cell::RefCell;

use voice_simulator_core::fdtd::kernel::Grid;
use voice_simulator_core::fdtd::model::Model;
use voice_simulator_core::fdtd::solver::{Fdtd3d, FdtdOptions, Output};
use voice_simulator_core::frame;
use voice_simulator_core::solver::Solver;

use crate::{error, f64_slice, u8_slice};

/// A kernel of [`vs_fdtd_kernel_new`]: the grid and whether its incident
/// lists must be built again before the next step, because JavaScript
/// may have written `link_a`/`link_b` since.
struct Kernel {
    grid: Grid,
    stale: bool,
}

thread_local! {
    /// The live kernels; handle `h` is slot `h - 1`.
    static KERNELS: RefCell<Vec<Option<Kernel>>> = const { RefCell::new(Vec::new()) };
}

/// Puts `value` into the first free slot; returns its handle (> 0).
pub(crate) fn insert<T>(slots: &mut Vec<Option<T>>, value: T) -> i32 {
    let index = match slots.iter().position(Option::is_none) {
        Some(index) => {
            slots[index] = Some(value);
            index
        }
        None => {
            slots.push(Some(value));
            slots.len() - 1
        }
    };
    i32::try_from(index + 1).unwrap_or(error::NO_MEMORY)
}

/// The slot index of `handle`, if it can name one.
pub(crate) fn slot(handle: i32) -> Option<usize> {
    usize::try_from(handle).ok().and_then(|h| h.checked_sub(1))
}

/// Runs `action` on the kernel of `handle`, or returns `fallback`.
fn with_kernel<R>(handle: i32, fallback: R, action: impl FnOnce(&mut Kernel) -> R) -> R {
    let Some(index) = slot(handle) else {
        return fallback;
    };
    KERNELS.with_borrow_mut(|slots| match slots.get_mut(index) {
        Some(Some(kernel)) => action(kernel),
        _ => fallback,
    })
}

/// A kernel of `links` links and `cells` cells with the starting values of
/// [`Grid::new`]; returns its handle (> 0) or a negative code of [`error`].
pub fn kernel_new(links: u32, cells: u32) -> i32 {
    if links > 1 << 28 || cells > 1 << 28 {
        return error::BAD_ARGUMENT;
    }
    let kernel = Kernel {
        grid: Grid::new(links as usize, cells as usize),
        stale: true,
    };
    KERNELS.with_borrow_mut(|slots| insert(slots, kernel))
}

/// Offset of array `which` of the kernel, numbered in the order of the
/// fields of [`Grid`]: 0 `link_a`, 1 `link_b` (`u32` cell indices), 2
/// `velocity`, 3 `damping`, 4 `conductance`, 5 `flux` (per link), 6
/// `pressure`, 7 `divergence`, 8 `keep`, 9 `gain` (per cell, all `f64`).
/// Returns 0 for a bad handle or number. Asking for array 0 or 1 makes
/// the next step build the incident lists again.
pub fn kernel_array(handle: i32, which: u32) -> u32 {
    with_kernel(handle, 0, |kernel| {
        let grid = &mut kernel.grid;
        if which < 2 {
            kernel.stale = true;
        }
        let pointer = match which {
            0 => grid.link_a.as_mut_ptr() as usize,
            1 => grid.link_b.as_mut_ptr() as usize,
            2 => grid.velocity.as_mut_ptr() as usize,
            3 => grid.damping.as_mut_ptr() as usize,
            4 => grid.conductance.as_mut_ptr() as usize,
            5 => grid.flux.as_mut_ptr() as usize,
            6 => grid.pressure.as_mut_ptr() as usize,
            7 => grid.divergence.as_mut_ptr() as usize,
            8 => grid.keep.as_mut_ptr() as usize,
            9 => grid.gain.as_mut_ptr() as usize,
            _ => 0,
        };
        u32::try_from(pointer).unwrap_or(0)
    })
}

/// Runs `count` steps, in the gather form when `gather` is not 0, else in
/// the scatter form. Returns 0, [`error::BAD_HANDLE`], or
/// [`error::BAD_ARGUMENT`] when a link names a missing cell.
pub fn kernel_steps(handle: i32, count: u32, gather: u32) -> i32 {
    with_kernel(handle, error::BAD_HANDLE, |kernel| {
        if kernel.stale {
            if !kernel.grid.index() {
                return error::BAD_ARGUMENT;
            }
            kernel.stale = false;
        }
        for _ in 0..count {
            if gather != 0 {
                kernel.grid.step_gather();
            } else {
                kernel.grid.step_scatter();
            }
        }
        error::OK
    })
}

/// Drops the kernel of `handle`.
pub fn kernel_free(handle: i32) -> i32 {
    let Some(index) = slot(handle) else {
        return error::BAD_HANDLE;
    };
    KERNELS.with_borrow_mut(|slots| match slots.get_mut(index) {
        Some(entry @ Some(_)) => {
            *entry = None;
            error::OK
        }
        _ => error::BAD_HANDLE,
    })
}

/// A kernel of `links` links and `cells` cells; returns its handle (> 0)
/// or a negative code of [`error`]. Free it with [`vs_fdtd_kernel_free`].
#[no_mangle]
pub extern "C" fn vs_fdtd_kernel_new(links: u32, cells: u32) -> i32 {
    kernel_new(links, cells)
}

/// Offset of array `which` (see [`kernel_array`]), or 0. The arrays move
/// when the memory grows, so JavaScript makes its views again after any
/// call that may allocate.
#[no_mangle]
pub extern "C" fn vs_fdtd_kernel_array(handle: i32, which: u32) -> u32 {
    kernel_array(handle, which)
}

/// Runs `count` steps (see [`kernel_steps`]).
#[no_mangle]
pub extern "C" fn vs_fdtd_kernel_steps(handle: i32, count: u32, gather: u32) -> i32 {
    kernel_steps(handle, count, gather)
}

/// Frees the kernel of `handle`; 0 or [`error::BAD_HANDLE`].
#[no_mangle]
pub extern "C" fn vs_fdtd_kernel_free(handle: i32) -> i32 {
    kernel_free(handle)
}

thread_local! {
    /// The live solvers; handle `h` is slot `h - 1`.
    static SOLVERS: RefCell<Vec<Option<Fdtd3d>>> = const { RefCell::new(Vec::new()) };
}

/// Values of the options array of [`vs_fdtd_solver_new`]: output (0 flow,
/// 1 microphone), spherical boundary (0 or 1), the receiver target x, y
/// and z (cm), `wallLoss`, `nasalLoss`, `glottalChink` (mm²) and
/// `vocalTractLength` (cm).
pub const SOLVER_OPTIONS: usize = 9;

/// Values per step of [`solver_steps`]: the arguments of [`Solver::step`].
pub const SOLVER_STEP_INPUTS: usize = 4;

/// A solver for the options `values` ([`SOLVER_OPTIONS`]) and the packed
/// model `model`; returns its handle (> 0) or [`error::BAD_ARGUMENT`].
pub fn solver_new(values: &[f64], model: &[u8]) -> i32 {
    let Ok(values) = <&[f64; SOLVER_OPTIONS]>::try_from(values) else {
        return error::BAD_ARGUMENT;
    };
    if values.iter().any(|value| !value.is_finite()) {
        return error::BAD_ARGUMENT;
    }
    let options = FdtdOptions {
        output: if values[0] != 0.0 {
            Output::Microphone
        } else {
            Output::Flow
        },
        spherical: values[1] != 0.0,
        target: [values[2], values[3], values[4]],
        wall_loss: values[5],
        nasal_loss: values[6],
        glottal_chink: values[7],
        vocal_tract_length: values[8],
    };
    let Ok(model) = Model::unpack(model) else {
        return error::BAD_ARGUMENT;
    };
    match Fdtd3d::new(model, &options) {
        Some(solver) => SOLVERS.with_borrow_mut(|slots| insert(slots, solver)),
        None => error::BAD_ARGUMENT,
    }
}

/// Runs `action` on the solver of `handle`, or returns `fallback`.
fn with_solver<R>(handle: i32, fallback: R, action: impl FnOnce(&mut Fdtd3d) -> R) -> R {
    let Some(index) = slot(handle) else {
        return fallback;
    };
    SOLVERS.with_borrow_mut(|slots| match slots.get_mut(index) {
        Some(Some(solver)) => action(solver),
        _ => fallback,
    })
}

/// `setNose(areas)`; 0 or [`error::BAD_HANDLE`].
pub fn solver_set_nose(handle: i32, areas: &[f64]) -> i32 {
    with_solver(handle, error::BAD_HANDLE, |solver| {
        solver.set_nose(areas);
        error::OK
    })
}

/// `setShape` from one frame (`FRAME` of `src/engine/layout.js`); 0,
/// [`error::BAD_HANDLE`] or [`error::BAD_ARGUMENT`] for a frame that is
/// too short or not finite.
pub fn solver_set_shape(handle: i32, values: &[f64]) -> i32 {
    if values.len() < frame::stride(1)
        || values.iter().any(|value| !value.is_finite())
        || values[frame::EXTRA] != frame::EXTRA_VALUES as f64
    {
        return error::BAD_ARGUMENT;
    }
    with_solver(handle, error::BAD_HANDLE, |solver| {
        solver.set_shape(values);
        error::OK
    })
}

/// [`Solver::step_duration`] (s), or NaN for a bad handle.
pub fn solver_step_duration(handle: i32) -> f64 {
    with_solver(handle, f64::NAN, |solver| solver.step_duration())
}

/// Runs one step per [`SOLVER_STEP_INPUTS`] values of `inputs` and
/// writes the outputs to `out`; 0, [`error::BAD_HANDLE`] or
/// [`error::BAD_ARGUMENT`] when the lengths disagree.
pub fn solver_steps(handle: i32, inputs: &[f64], out: &mut [f64]) -> i32 {
    let (steps, rest) = inputs.as_chunks::<SOLVER_STEP_INPUTS>();
    if !rest.is_empty() || steps.len() != out.len() {
        return error::BAD_ARGUMENT;
    }
    with_solver(handle, error::BAD_HANDLE, |solver| {
        for ([flow, noise_at, noise, transient], value) in steps.iter().zip(out) {
            *value = solver.step(*flow, *noise_at, *noise, *transient);
        }
        error::OK
    })
}

/// [`Solver::field`]: the number of values written or [`error::BAD_HANDLE`].
pub fn solver_field(handle: i32, out: &mut [f64]) -> i32 {
    with_solver(handle, error::BAD_HANDLE, |solver| {
        i32::try_from(solver.field(out)).unwrap_or(error::NO_MEMORY)
    })
}

/// Drops the solver of `handle`.
pub fn solver_free(handle: i32) -> i32 {
    let Some(index) = slot(handle) else {
        return error::BAD_HANDLE;
    };
    SOLVERS.with_borrow_mut(|slots| match slots.get_mut(index) {
        Some(entry @ Some(_)) => {
            *entry = None;
            error::OK
        }
        _ => error::BAD_HANDLE,
    })
}

/// Unpacks `model` and packs it again into `out`. Returns the length of
/// the repacked model (written only when it fits), or
/// [`error::BAD_ARGUMENT`] when `model` is not a packed model.
pub fn model_repack(model: &[u8], out: &mut [f64]) -> i32 {
    let Ok(model) = Model::unpack(model) else {
        return error::BAD_ARGUMENT;
    };
    let bytes = model.pack();
    if bytes.len() <= 8 * out.len() {
        for (value, chunk) in out.iter_mut().zip(bytes.as_chunks::<8>().0) {
            *value = f64::from_le_bytes(*chunk);
        }
    }
    i32::try_from(bytes.len()).unwrap_or(error::NO_MEMORY)
}

/// A solver for the [`SOLVER_OPTIONS`] `f64` values at `options` and the
/// `model_length` bytes of the packed voxel model at `model`; returns its
/// handle (> 0) or a negative code of [`error`]. Free it with
/// [`vs_fdtd_solver_free`].
#[no_mangle]
pub extern "C" fn vs_fdtd_solver_new(options: u32, model: u32, model_length: u32) -> i32 {
    match (
        f64_slice(options, SOLVER_OPTIONS as u32),
        u8_slice(model, model_length),
    ) {
        (Ok(values), Ok(model)) => solver_new(values, model),
        (Err(code), _) | (_, Err(code)) => code,
    }
}

/// `setNose` with the `count` `f64` areas at `areas` (see [`solver_set_nose`]).
#[no_mangle]
pub extern "C" fn vs_fdtd_solver_set_nose(handle: i32, areas: u32, count: u32) -> i32 {
    match f64_slice(areas, count) {
        Ok(areas) => solver_set_nose(handle, areas),
        Err(code) => code,
    }
}

/// `setShape` with the frame of `length` `f64` values at `values` (see
/// [`solver_set_shape`]).
#[no_mangle]
pub extern "C" fn vs_fdtd_solver_set_shape(handle: i32, values: u32, length: u32) -> i32 {
    match f64_slice(values, length) {
        Ok(values) => solver_set_shape(handle, values),
        Err(code) => code,
    }
}

/// Seconds per step for the last shape, or NaN for a bad handle.
#[no_mangle]
pub extern "C" fn vs_fdtd_solver_step_duration(handle: i32) -> f64 {
    solver_step_duration(handle)
}

/// Runs `count` steps with the `4 * count` inputs at `inputs` and writes
/// the `count` outputs to `out` (see [`solver_steps`]).
#[no_mangle]
pub extern "C" fn vs_fdtd_solver_steps(handle: i32, inputs: u32, count: u32, out: u32) -> i32 {
    let Some(values) = count.checked_mul(SOLVER_STEP_INPUTS as u32) else {
        return error::OUT_OF_BOUNDS;
    };
    match (f64_slice(inputs, values), f64_slice(out, count)) {
        (Ok(inputs), Ok(out)) => {
            // Copied, so the inputs may overlap the outputs.
            let inputs = inputs.to_vec();
            solver_steps(handle, &inputs, out)
        }
        (Err(code), _) | (_, Err(code)) => code,
    }
}

/// The pressure of every cell into the `capacity` values at `out` (see
/// [`solver_field`]).
#[no_mangle]
pub extern "C" fn vs_fdtd_solver_field(handle: i32, out: u32, capacity: u32) -> i32 {
    match f64_slice(out, capacity) {
        Ok(out) => solver_field(handle, out),
        Err(code) => code,
    }
}

/// Frees the solver of `handle`; 0 or [`error::BAD_HANDLE`].
#[no_mangle]
pub extern "C" fn vs_fdtd_solver_free(handle: i32) -> i32 {
    solver_free(handle)
}

/// Unpacks the `model_length` bytes at `model` and packs them again into
/// the `capacity` `f64` values (8 bytes each) at `out` (see
/// [`model_repack`]).
#[no_mangle]
pub extern "C" fn vs_fdtd_model_repack(
    model: u32,
    model_length: u32,
    out: u32,
    capacity: u32,
) -> i32 {
    match (u8_slice(model, model_length), f64_slice(out, capacity)) {
        (Ok(model), Ok(out)) => {
            let model = model.to_vec();
            model_repack(&model, out)
        }
        (Err(code), _) | (_, Err(code)) => code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn kernels_live_behind_handles() {
        let handle = kernel_new(2, 3);
        assert!(handle > 0);
        assert_eq!(kernel_array(handle, 10), 0);
        assert_eq!(kernel_array(handle + 1, 0), 0);
        KERNELS.with_borrow_mut(|slots| {
            let grid = &mut slots[handle as usize - 1].as_mut().unwrap().grid;
            grid.link_b[1] = 3;
        });
        assert_eq!(kernel_steps(handle, 1, 1), error::BAD_ARGUMENT);
        KERNELS.with_borrow_mut(|slots| {
            let grid = &mut slots[handle as usize - 1].as_mut().unwrap().grid;
            grid.link_b.copy_from_slice(&[1, 2]);
            grid.pressure[0] = 1.0;
        });
        kernel_array(handle, 1);
        assert_eq!(kernel_steps(handle, 3, 1), error::OK);
        assert_eq!(kernel_free(handle), error::OK);
        assert_eq!(kernel_free(handle), error::BAD_HANDLE);
        assert_eq!(kernel_steps(handle, 1, 0), error::BAD_HANDLE);
        assert_eq!(kernel_new(1 << 29, 1), error::BAD_ARGUMENT);
    }

    #[test]
    fn solvers_live_behind_handles() {
        assert_eq!(solver_new(&[0.0; 3], &[]), error::BAD_ARGUMENT);
        assert_eq!(
            solver_new(&[0.0; SOLVER_OPTIONS], &[1, 2]),
            error::BAD_ARGUMENT
        );
        assert_eq!(solver_set_nose(1, &[1.0]), error::BAD_HANDLE);
        assert_eq!(solver_set_shape(1, &[0.0; 4]), error::BAD_ARGUMENT);
        assert!(solver_step_duration(1).is_nan());
        assert_eq!(
            solver_steps(1, &[0.0; 4], &mut [0.0; 2]),
            error::BAD_ARGUMENT
        );
        assert_eq!(solver_field(1, &mut []), error::BAD_HANDLE);
        assert_eq!(solver_free(1), error::BAD_HANDLE);
        assert_eq!(model_repack(&[0; 16], &mut []), error::BAD_ARGUMENT);
    }
}
