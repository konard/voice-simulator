//! Step loop of the 3D FDTD solver: port of `#stepJs` in
//! `src/acoustics/fdtd3d.js` (and of the wasm kernel in
//! `src/acoustics/fdtd-kernel.js`, which mirrors it).
//!
//! One step updates every link (face between two cells) from the pressure
//! difference across it, then every cell from the net flux out of it:
//!
//! ```text
//! u = damping * (velocity - COURANT * (pressure[b] - pressure[a]))
//! flux = conductance * u;  divergence[a] += flux;  divergence[b] -= flux
//! pressure = keep * pressure - gain * divergence;  divergence = 0
//! ```
//!
//! [`Grid::step_scatter`] is that loop as written. [`Grid::step_gather`]
//! computes the same numbers without writing to two cells per link: it
//! stores the flux of every link, then sums, for every cell, the fluxes of
//! its incident links in increasing link order, starting from `0.0`.
//! Every cell sees the same additions in the same order as in the scatter
//! form, so the two forms are bit-identical (parity class A); the gather
//! form vectorises (see `kernel_simd.rs`) because no two lanes write the
//! same cell.

use alloc::vec;
use alloc::vec::Vec;

/// Courant number of the grid, `COURANT` of `src/acoustics/fdtd3d.js`.
pub const COURANT: f64 = 0.5;

/// The arrays of one grid. Links point from cell `link_a` to cell
/// `link_b`; `flux` holds the flux of every link after a step. The
/// incident lists are built from `link_a`/`link_b` by [`Grid::index`].
#[derive(Clone, Debug, PartialEq)]
pub struct Grid {
    pub link_a: Vec<u32>,
    pub link_b: Vec<u32>,
    pub velocity: Vec<f64>,
    pub damping: Vec<f64>,
    pub conductance: Vec<f64>,
    pub flux: Vec<f64>,
    pub pressure: Vec<f64>,
    pub divergence: Vec<f64>,
    pub keep: Vec<f64>,
    pub gain: Vec<f64>,
    /// `incident_link[incident_start[cell]..incident_start[cell + 1]]` are
    /// the links of `cell` in increasing order, with `incident_sign` +1
    /// where the cell is `a` and -1 where it is `b`.
    pub incident_start: Vec<u32>,
    pub incident_link: Vec<u32>,
    pub incident_sign: Vec<f64>,
}

impl Grid {
    /// A grid of `links` links and `cells` cells with the starting values
    /// of `Fdtd3d`: no velocity or pressure, damping, conductance and keep
    /// 1, gain [`COURANT`]. All links join cell 0 to itself until
    /// `link_a`/`link_b` are set and [`Grid::index`] is called.
    pub fn new(links: usize, cells: usize) -> Self {
        let mut grid = Self {
            link_a: vec![0; links],
            link_b: vec![0; links],
            velocity: vec![0.0; links],
            damping: vec![1.0; links],
            conductance: vec![1.0; links],
            flux: vec![0.0; links],
            pressure: vec![0.0; cells],
            divergence: vec![0.0; cells],
            keep: vec![1.0; cells],
            gain: vec![COURANT; cells],
            incident_start: Vec::new(),
            incident_link: Vec::new(),
            incident_sign: Vec::new(),
        };
        if cells > 0 {
            grid.index();
        }
        grid
    }

    /// Number of links.
    pub fn links(&self) -> usize {
        self.link_a.len()
    }

    /// Number of cells.
    pub fn cells(&self) -> usize {
        self.pressure.len()
    }

    /// Build the incident lists from `link_a` and `link_b`. Returns false
    /// (and leaves the lists empty) when a link names a cell that does not
    /// exist; the step functions must not run then.
    pub fn index(&mut self) -> bool {
        let cells = self.cells();
        self.incident_start.clear();
        self.incident_link.clear();
        self.incident_sign.clear();
        let valid = self
            .link_a
            .iter()
            .chain(self.link_b.iter())
            .all(|&cell| (cell as usize) < cells);
        if !valid {
            return false;
        }
        let mut start = vec![0u32; cells + 1];
        for (&a, &b) in self.link_a.iter().zip(&self.link_b) {
            start[a as usize + 1] += 1;
            start[b as usize + 1] += 1;
        }
        for cell in 0..cells {
            start[cell + 1] += start[cell];
        }
        let total = start[cells] as usize;
        let mut next = start.clone();
        self.incident_link = vec![0; total];
        self.incident_sign = vec![0.0; total];
        // Links in increasing order, so every cell's list is sorted; a
        // link from a cell to itself adds +flux, then -flux, as the
        // scatter form does.
        for (link, (&a, &b)) in self.link_a.iter().zip(&self.link_b).enumerate() {
            for (cell, sign) in [(a, 1.0), (b, -1.0)] {
                let slot = next[cell as usize] as usize;
                self.incident_link[slot] = link as u32;
                self.incident_sign[slot] = sign;
                next[cell as usize] += 1;
            }
        }
        self.incident_start = start;
        true
    }

    /// Whether the incident lists match the arrays, so a step may run.
    pub fn indexed(&self) -> bool {
        self.incident_start.len() == self.cells() + 1
            && self.incident_link.len() == 2 * self.links()
    }

    /// One step in the scatter form of `#stepJs`.
    pub fn step_scatter(&mut self) {
        let Self {
            link_a,
            link_b,
            velocity,
            damping,
            conductance,
            flux,
            pressure,
            divergence,
            keep,
            gain,
            ..
        } = self;
        for link in 0..link_a.len() {
            let a = link_a[link] as usize;
            let b = link_b[link] as usize;
            let u = damping[link] * (velocity[link] - COURANT * (pressure[b] - pressure[a]));
            velocity[link] = u;
            let value = conductance[link] * u;
            flux[link] = value;
            divergence[a] += value;
            divergence[b] -= value;
        }
        for cell in 0..pressure.len() {
            pressure[cell] = keep[cell] * pressure[cell] - gain[cell] * divergence[cell];
            divergence[cell] = 0.0;
        }
    }

    /// One step in the gather form; bit-identical with
    /// [`Grid::step_scatter`] (`divergence` stays 0). Needs
    /// [`Grid::index`] after the last change of `link_a`/`link_b`.
    pub fn step_gather(&mut self) {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            super::kernel_simd::step_gather(self);
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            self.step_gather_scalar();
        }
    }

    /// The scalar gather form, also the reference of `kernel_simd.rs`.
    pub fn step_gather_scalar(&mut self) {
        self.links_pass(0);
        let Self {
            pressure,
            keep,
            gain,
            flux,
            incident_start,
            incident_link,
            incident_sign,
            ..
        } = self;
        for cell in 0..pressure.len() {
            let d = incident_sum(
                flux,
                incident_link,
                incident_sign,
                incident_start[cell] as usize,
                incident_start[cell + 1] as usize,
            );
            pressure[cell] = keep[cell] * pressure[cell] - gain[cell] * d;
        }
    }

    /// Pass 1 of the gather form for the links from `from` on: new velocity
    /// and flux of every link.
    #[inline]
    pub(super) fn links_pass(&mut self, from: usize) {
        let Self {
            link_a,
            link_b,
            velocity,
            damping,
            conductance,
            flux,
            pressure,
            ..
        } = self;
        for link in from..link_a.len() {
            let a = link_a[link] as usize;
            let b = link_b[link] as usize;
            let u = damping[link] * (velocity[link] - COURANT * (pressure[b] - pressure[a]));
            velocity[link] = u;
            flux[link] = conductance[link] * u;
        }
    }
}

/// Net flux out of one cell: the signed fluxes of its incident links
/// `from..to`, added in order to `0.0` like the scatter form adds them to
/// a zeroed divergence. `sign * flux` with a sign of ±1 is exact, and
/// `d + -flux` equals `d - flux`.
#[inline]
pub(super) fn incident_sum(
    flux: &[f64],
    links: &[u32],
    signs: &[f64],
    from: usize,
    to: usize,
) -> f64 {
    let mut d = 0.0;
    for (&link, &sign) in links[from..to].iter().zip(&signs[from..to]) {
        d += sign * flux[link as usize];
    }
    d
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::Random;

    /// A random grid: links between random cells (some cells without
    /// links), random coefficients in the ranges `Fdtd3d` uses.
    pub(crate) fn random_grid(seed: u32, cells: usize, links: usize) -> Grid {
        let mut random = Random::new(seed);
        let mut grid = Grid::new(links, cells);
        let pick = |random: &mut Random| (random.next() * cells as f64) as u32;
        for link in 0..links {
            let a = pick(&mut random);
            let mut b = pick(&mut random);
            if b == a {
                b = (a + 1) % cells as u32;
            }
            grid.link_a[link] = a;
            grid.link_b[link] = b;
            grid.damping[link] = 0.98 + 0.02 * random.next();
            grid.conductance[link] = random.next();
        }
        for cell in 0..cells {
            grid.keep[cell] = 0.9 + 0.1 * random.next();
            grid.gain[cell] = COURANT / (0.05 + random.next());
            grid.pressure[cell] = random.normal();
        }
        assert!(grid.index());
        grid
    }

    fn bits(values: &[f64]) -> Vec<u64> {
        values.iter().map(|value| value.to_bits()).collect()
    }

    fn assert_bit_equal(left: &Grid, right: &Grid) {
        assert_eq!(left.link_a, right.link_a);
        assert_eq!(left.link_b, right.link_b);
        for (name, x, y) in [
            ("velocity", &left.velocity, &right.velocity),
            ("damping", &left.damping, &right.damping),
            ("conductance", &left.conductance, &right.conductance),
            ("flux", &left.flux, &right.flux),
            ("pressure", &left.pressure, &right.pressure),
            ("divergence", &left.divergence, &right.divergence),
            ("keep", &left.keep, &right.keep),
            ("gain", &left.gain, &right.gain),
        ] {
            assert_eq!(bits(x), bits(y), "{name} differs");
        }
    }

    #[test]
    fn gather_equals_scatter() {
        let mut scatter = random_grid(1, 500, 1400);
        let mut gather = scatter.clone();
        for _ in 0..200 {
            scatter.step_scatter();
            gather.step_gather();
        }
        assert!(scatter.pressure.iter().all(|value| value.is_finite()));
        assert!(scatter.pressure.iter().any(|&value| value != 0.0));
        assert_bit_equal(&scatter, &gather);
    }

    #[test]
    fn incident_lists_are_sorted_and_signed() {
        let mut grid = Grid::new(3, 3);
        grid.link_a.copy_from_slice(&[0, 1, 2]);
        grid.link_b.copy_from_slice(&[1, 2, 0]);
        assert!(grid.index());
        assert_eq!(grid.incident_start, [0, 2, 4, 6]);
        assert_eq!(grid.incident_link, [0, 2, 0, 1, 1, 2]);
        assert_eq!(grid.incident_sign, [1.0, -1.0, -1.0, 1.0, -1.0, 1.0]);
    }

    #[test]
    fn rejects_links_to_missing_cells() {
        let mut grid = Grid::new(1, 2);
        grid.link_b[0] = 2;
        assert!(!grid.index());
        assert!(!grid.indexed());
    }

    #[test]
    fn a_closed_grid_keeps_its_volume() {
        // Lossless links and cells: the pressure sum stays put up to
        // rounding, as the scheme conserves mass.
        let mut grid = random_grid(2, 50, 120);
        grid.damping.fill(1.0);
        grid.keep.fill(1.0);
        grid.gain.fill(COURANT);
        let before: f64 = grid.pressure.iter().sum();
        for _ in 0..100 {
            grid.step_gather();
        }
        let after: f64 = grid.pressure.iter().sum();
        assert!((after - before).abs() < 1e-9, "{before} {after}");
    }
}
