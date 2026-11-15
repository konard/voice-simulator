//! Exports of the 3D FDTD solver (issue 23): the bare step loop
//! (`vs_fdtd_kernel_*`), used by the parity tests of
//! `tests/rust-fdtd.test.js` and by anyone who wants the kernel without
//! the solver, and a probe of the packed voxel model
//! (`vs_fdtd_model_summary`).

use std::cell::RefCell;

use voice_simulator_core::fdtd::kernel::Grid;

use crate::error;

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
}
