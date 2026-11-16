//! WebAssembly SIMD forms of the two passes of [`Grid::step_gather`]
//! (`links_slab`, `cells_slab`, over any range of links or cells, so the
//! thread team of `parallel.rs` runs them too) and of [`Grid::step`],
//! compiled only into the `simd128` build of the engine
//! (`src/engine/voice-simulator-simd.wasm`, see `scripts/build-wasm.mjs`).
//!
//! Two links per `f64x2` vector in the link pass and two cells per vector
//! in the final pressure update, with only the element-wise `f64x2_sub`
//! and `f64x2_mul`: no relaxed SIMD, no fused multiply-add, so every lane
//! rounds exactly like the scalar code. The incident sums of the gather
//! form stay scalar and ordered (they are what keeps it bit-identical with
//! the scatter form), the scatter form adds the two fluxes of a vector to
//! `divergence` one link after the other, as the scalar loop does, and an
//! odd link or cell is done by the scalar tail. The `core::arch::wasm32`
//! functions used here are safe functions, so the file has no raw
//! pointers.

use super::kernel::{incident_sum, padded_sum, CellSlab, Grid, LinkSlab, COURANT};
use core::arch::wasm32::{f64x2, f64x2_extract_lane, f64x2_mul, f64x2_splat, f64x2_sub};

/// [`Grid::step`] with two lanes; bit-identical with the scalar loop.
/// The velocities of a pair depend only on `pressure`, which the link pass
/// does not change, so computing two at once changes no number, and the
/// fluxes go into `divergence` in link order. The links before `from` are
/// not stepped, as in [`Grid::step`].
pub(super) fn step_scatter(grid: &mut Grid, from: usize) {
    let from = from.min(grid.links());
    let pairs = (grid.links() - from) / 2;
    {
        let Grid {
            link_a,
            link_b,
            velocity,
            damping,
            conductance,
            pressure,
            divergence,
            ..
        } = &mut *grid;
        let cells = pressure.len();
        let divergence = &mut divergence[..cells];
        let courant = f64x2_splat(COURANT);
        let links = link_a[from..]
            .as_chunks::<2>()
            .0
            .iter()
            .zip(link_b[from..].as_chunks::<2>().0)
            .zip(velocity[from..].as_chunks_mut::<2>().0)
            .zip(damping[from..].as_chunks::<2>().0)
            .zip(conductance[from..].as_chunks::<2>().0);
        for ((((&[a0, a1], &[b0, b1]), v), &[k0, k1]), &[c0, c1]) in links {
            let (a0, a1, b0, b1) = (a0 as usize, a1 as usize, b0 as usize, b1 as usize);
            let pa = f64x2(pressure[a0], pressure[a1]);
            let pb = f64x2(pressure[b0], pressure[b1]);
            let u = f64x2_mul(
                f64x2(k0, k1),
                f64x2_sub(f64x2(v[0], v[1]), f64x2_mul(courant, f64x2_sub(pb, pa))),
            );
            let out = f64x2_mul(f64x2(c0, c1), u);
            *v = [f64x2_extract_lane::<0>(u), f64x2_extract_lane::<1>(u)];
            let first = f64x2_extract_lane::<0>(out);
            divergence[a0] += first;
            divergence[b0] -= first;
            let second = f64x2_extract_lane::<1>(out);
            divergence[a1] += second;
            divergence[b1] -= second;
        }
        for link in from + 2 * pairs..link_a.len() {
            let (a, b) = (link_a[link] as usize, link_b[link] as usize);
            let u = damping[link] * (velocity[link] - COURANT * (pressure[b] - pressure[a]));
            velocity[link] = u;
            let value = conductance[link] * u;
            divergence[a] += value;
            divergence[b] -= value;
        }
    }
    let Grid {
        pressure,
        divergence,
        keep,
        gain,
        ..
    } = grid;
    let cells = pressure
        .as_chunks_mut::<2>()
        .0
        .iter_mut()
        .zip(divergence.as_chunks_mut::<2>().0)
        .zip(keep.as_chunks::<2>().0)
        .zip(gain.as_chunks::<2>().0);
    for (((p, d), &[k0, k1]), &[g0, g1]) in cells {
        let next = f64x2_sub(
            f64x2_mul(f64x2(k0, k1), f64x2(p[0], p[1])),
            f64x2_mul(f64x2(g0, g1), f64x2(d[0], d[1])),
        );
        *p = [f64x2_extract_lane::<0>(next), f64x2_extract_lane::<1>(next)];
        *d = [0.0, 0.0];
    }
    let last = pressure.len();
    if last % 2 == 1 {
        let cell = last - 1;
        pressure[cell] = keep[cell] * pressure[cell] - gain[cell] * divergence[cell];
        divergence[cell] = 0.0;
    }
}

/// Pass 1 of [`Grid::step_gather_scalar`] with two lanes over one slab of
/// links; bit-identical with it. The pairs start at the first link of the
/// slab, which may be odd, and an odd last link is done by the scalar
/// tail.
pub(super) fn links_slab(slab: LinkSlab<'_>) {
    let LinkSlab {
        link_a,
        link_b,
        damping,
        conductance,
        pressure,
        velocity,
        flux,
    } = slab;
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
    let last = link_a.len();
    if last % 2 == 1 {
        let link = last - 1;
        let (a, b) = (link_a[link], link_b[link]);
        let u = damping[link] * (velocity[link] - COURANT * (p(b) - p(a)));
        velocity[link] = u;
        flux[link] = conductance[link] * u;
    }
}

/// Pass 2 of [`Grid::step_gather_scalar`] with two cells per vector over
/// one slab of cells; bit-identical with it.
pub(super) fn cells_slab(slab: CellSlab<'_>) {
    match slab.width {
        1 => cells(slab, padded::<1>),
        2 => cells(slab, padded::<2>),
        3 => cells(slab, padded::<3>),
        4 => cells(slab, padded::<4>),
        5 => cells(slab, padded::<5>),
        6 => cells(slab, padded::<6>),
        7 => cells(slab, padded::<7>),
        8 => cells(slab, padded::<8>),
        _ => cells(slab, listed),
    }
}

/// The incident sum of `cell` from padded lists of `W` links.
#[inline(always)]
fn padded<const W: usize>(slab: &CellSlab<'_>, cell: usize) -> f64 {
    let at = cell * W;
    let links = slab.incident_link[at..at + W].as_array::<W>();
    let signs = slab.incident_sign[at..at + W].as_array::<W>();
    padded_sum(slab.flux, links.unwrap(), signs.unwrap())
}

/// The incident sum of `cell` from lists of any length.
#[inline(always)]
fn listed(slab: &CellSlab<'_>, cell: usize) -> f64 {
    incident_sum(
        slab.flux,
        slab.incident_link,
        slab.incident_sign,
        slab.incident_start[cell] as usize,
        slab.incident_start[cell + 1] as usize,
    )
}

/// Pass 2, two cells per vector, with the incident sums of `sum`; `cell`
/// counts from the first cell of the slab, `sum` takes grid indices.
#[inline(always)]
fn cells(mut slab: CellSlab<'_>, sum: impl Fn(&CellSlab<'_>, usize) -> f64) {
    let (first, count) = (slab.first, slab.pressure.len());
    let mut cell = 0;
    while cell + 2 <= count {
        let d = f64x2(sum(&slab, first + cell), sum(&slab, first + cell + 1));
        let CellSlab {
            pressure,
            keep,
            gain,
            ..
        } = &mut slab;
        let p = f64x2(pressure[cell], pressure[cell + 1]);
        let next = f64x2_sub(
            f64x2_mul(f64x2(keep[cell], keep[cell + 1]), p),
            f64x2_mul(f64x2(gain[cell], gain[cell + 1]), d),
        );
        pressure[cell] = f64x2_extract_lane::<0>(next);
        pressure[cell + 1] = f64x2_extract_lane::<1>(next);
        cell += 2;
    }
    if cell < count {
        let d = sum(&slab, first + cell);
        let CellSlab {
            pressure,
            keep,
            gain,
            ..
        } = &mut slab;
        pressure[cell] = keep[cell] * pressure[cell] - gain[cell] * d;
    }
}
