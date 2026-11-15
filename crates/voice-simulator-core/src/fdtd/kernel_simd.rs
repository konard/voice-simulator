//! WebAssembly SIMD form of [`Grid::step_gather`], compiled only into the
//! `simd128` build of the engine (`src/engine/voice-simulator-simd.wasm`,
//! see `scripts/build-wasm.mjs`).
//!
//! Two links per `f64x2` vector in pass 1 and two cells per vector in the
//! final pressure update, with only the element-wise `f64x2_sub` and
//! `f64x2_mul`: no relaxed SIMD, no fused multiply-add,
//! so every lane rounds exactly like the scalar code. The incident sums
//! stay scalar and ordered (they are what keeps the gather form
//! bit-identical with the scatter form), and an odd link or cell is done
//! by the scalar tail. The `core::arch::wasm32` functions used here are
//! safe, so the file needs no `unsafe` and the crate keeps
//! `#![forbid(unsafe_code)]`.

use super::kernel::{incident_sum, padded_sum, Grid, COURANT};
use core::arch::wasm32::{f64x2, f64x2_extract_lane, f64x2_mul, f64x2_splat, f64x2_sub};

/// [`Grid::step_gather_scalar`] with two lanes; bit-identical with it.
pub(super) fn step_gather(grid: &mut Grid) {
    let pairs = grid.links() / 2;
    {
        let Grid {
            link_a,
            link_b,
            velocity,
            damping,
            conductance,
            flux,
            pressure,
            ..
        } = &mut *grid;
        let courant = f64x2_splat(COURANT);
        let p = |cell: u32| pressure[cell as usize];
        let links = link_a
            .as_chunks::<2>()
            .0
            .iter()
            .zip(link_b.as_chunks::<2>().0)
            .zip(velocity.as_chunks_mut::<2>().0)
            .zip(damping.as_chunks::<2>().0)
            .zip(conductance.as_chunks::<2>().0)
            .zip(flux.as_chunks_mut::<2>().0);
        for (((((&[a0, a1], &[b0, b1]), v), &[k0, k1]), &[c0, c1]), f) in links {
            let pa = f64x2(p(a0), p(a1));
            let pb = f64x2(p(b0), p(b1));
            let u = f64x2_mul(
                f64x2(k0, k1),
                f64x2_sub(f64x2(v[0], v[1]), f64x2_mul(courant, f64x2_sub(pb, pa))),
            );
            let out = f64x2_mul(f64x2(c0, c1), u);
            *v = [f64x2_extract_lane::<0>(u), f64x2_extract_lane::<1>(u)];
            *f = [f64x2_extract_lane::<0>(out), f64x2_extract_lane::<1>(out)];
        }
    }
    grid.links_pass(2 * pairs);
    match grid.incident_width {
        1 => cells_pass(grid, padded::<1>),
        2 => cells_pass(grid, padded::<2>),
        3 => cells_pass(grid, padded::<3>),
        4 => cells_pass(grid, padded::<4>),
        5 => cells_pass(grid, padded::<5>),
        6 => cells_pass(grid, padded::<6>),
        7 => cells_pass(grid, padded::<7>),
        8 => cells_pass(grid, padded::<8>),
        _ => cells_pass(grid, listed),
    }
}

/// The incident sum of `cell` from padded lists of `W` links.
#[inline(always)]
fn padded<const W: usize>(grid: &Grid, cell: usize) -> f64 {
    let at = cell * W;
    let links = grid.incident_link[at..at + W].as_array::<W>();
    let signs = grid.incident_sign[at..at + W].as_array::<W>();
    padded_sum(&grid.flux, links.unwrap(), signs.unwrap())
}

/// The incident sum of `cell` from lists of any length.
#[inline(always)]
fn listed(grid: &Grid, cell: usize) -> f64 {
    incident_sum(
        &grid.flux,
        &grid.incident_link,
        &grid.incident_sign,
        grid.incident_start[cell] as usize,
        grid.incident_start[cell + 1] as usize,
    )
}

/// Pass 2, two cells per vector, with the incident sums of `sum`.
#[inline(always)]
fn cells_pass(grid: &mut Grid, sum: impl Fn(&Grid, usize) -> f64) {
    let cells = grid.cells();
    let mut cell = 0;
    while cell + 2 <= cells {
        let d = f64x2(sum(grid, cell), sum(grid, cell + 1));
        let Grid {
            pressure,
            keep,
            gain,
            ..
        } = &mut *grid;
        let p = f64x2(pressure[cell], pressure[cell + 1]);
        let next = f64x2_sub(
            f64x2_mul(f64x2(keep[cell], keep[cell + 1]), p),
            f64x2_mul(f64x2(gain[cell], gain[cell + 1]), d),
        );
        pressure[cell] = f64x2_extract_lane::<0>(next);
        pressure[cell + 1] = f64x2_extract_lane::<1>(next);
        cell += 2;
    }
    if cell < cells {
        let d = sum(grid, cell);
        let Grid {
            pressure,
            keep,
            gain,
            ..
        } = grid;
        pressure[cell] = keep[cell] * pressure[cell] - gain[cell] * d;
    }
}
