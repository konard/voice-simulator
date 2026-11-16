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
//! [`Grid::step_scatter`] is that loop as written, and [`Grid::step`],
//! the step of the solver, the same loop without storing the flux.
//! [`Grid::step_gather`]
//! computes the same numbers without writing to two cells per link: it
//! stores the flux of every link, then sums, for every cell, the fluxes of
//! its incident links in increasing link order, starting from `0.0`.
//! Every cell sees the same additions in the same order as in the scatter
//! form, so the two forms are bit-identical (parity class A); the gather
//! form vectorises (see `kernel_simd.rs`) because no two lanes write the
//! same cell.
//!
//! When no cell has more than [`MAX_WIDTH`] links (a voxel grid has at
//! most 6), [`Grid::index`] pads every list to the length of the longest
//! one with the extra link `links`, whose `flux` slot is always `+0.0`.
//! The sum of a cell then runs a fixed number of additions, with no
//! branch that depends on the cell. Adding `+0.0` changes no sum: a sum
//! that starts from `+0.0` is never `-0.0` (an exact cancellation rounds
//! to `+0.0`), and `x + 0.0 == x` for every other `x`.

use alloc::vec;
use alloc::vec::Vec;

/// Courant number of the grid, `COURANT` of `src/acoustics/fdtd3d.js`.
pub const COURANT: f64 = 0.5;

/// Longest incident list that is padded (see the module comment); grids
/// with a longer list keep lists of their own lengths.
pub const MAX_WIDTH: usize = 8;

/// The arrays of one grid. Links point from cell `link_a` to cell
/// `link_b`; `flux` holds the flux of every link after a step, and one
/// more value, `+0.0`, for the padding of the incident lists. The
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
    /// where the cell is `a` and -1 where it is `b`, then (when
    /// `incident_width` is not 0) the padding link `links` with sign +1.
    pub incident_start: Vec<u32>,
    pub incident_link: Vec<u32>,
    pub incident_sign: Vec<f64>,
    /// Length of every padded list, or 0 when the lists are not padded.
    pub incident_width: usize,
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
            flux: vec![0.0; links + 1],
            pressure: vec![0.0; cells],
            divergence: vec![0.0; cells],
            keep: vec![1.0; cells],
            gain: vec![COURANT; cells],
            incident_start: Vec::new(),
            incident_link: Vec::new(),
            incident_sign: Vec::new(),
            incident_width: 0,
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

    /// Build the incident lists from `link_a` and `link_b`, padded when no
    /// list is longer than [`MAX_WIDTH`]. Returns false (and leaves the
    /// lists empty) when a link names a cell that does not exist; the step
    /// functions must not run then.
    pub fn index(&mut self) -> bool {
        let cells = self.cells();
        let links = self.links();
        self.incident_start.clear();
        self.incident_link.clear();
        self.incident_sign.clear();
        self.incident_width = 0;
        let valid = self
            .link_a
            .iter()
            .chain(self.link_b.iter())
            .all(|&cell| (cell as usize) < cells);
        if !valid {
            return false;
        }
        let mut degree = vec![0u32; cells];
        for (&a, &b) in self.link_a.iter().zip(&self.link_b) {
            degree[a as usize] += 1;
            degree[b as usize] += 1;
        }
        let widest = degree.iter().max().map_or(0, |&value| value as usize);
        let width = if (1..=MAX_WIDTH).contains(&widest) {
            widest
        } else {
            0
        };
        let mut start = vec![0u32; cells + 1];
        for cell in 0..cells {
            let length = if width > 0 {
                width as u32
            } else {
                degree[cell]
            };
            start[cell + 1] = start[cell] + length;
        }
        let total = start[cells] as usize;
        let mut next = start.clone();
        // Padding first: every slot links to the zero flux slot `links`
        // with sign +1 until a real link takes it.
        self.incident_link = vec![links as u32; total];
        self.incident_sign = vec![1.0; total];
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
        self.incident_width = width;
        self.flux.resize(links + 1, 0.0);
        self.flux[links] = 0.0;
        true
    }

    /// Whether the incident lists match the arrays, so a step may run.
    pub fn indexed(&self) -> bool {
        self.incident_start.len() == self.cells() + 1
            && self.incident_link.len() == self.incident_start[self.cells()] as usize
            && self.flux.len() == self.links() + 1
    }

    /// One step in the scatter form of `#stepJs`, storing the flux of
    /// every link in `flux` as the gather form does.
    pub fn step_scatter(&mut self) {
        self.scatter::<true>(0);
    }

    /// The step of the solver: the scatter form of `#stepJs` without
    /// storing `flux` (no code reads it after a step), bit-identical with
    /// [`Grid::step_scatter`] in `velocity`, `pressure` and `divergence`.
    /// The `simd128` build runs the same loop with two links and two cells
    /// per vector (`kernel_simd.rs`). The solver uses it rather than
    /// [`Grid::step_gather`], which takes more time (see "Kernel" in
    /// `docs/RUST-ENGINE.md`). The links before `from` are not stepped
    /// (`kernel.step(from)` of `src/acoustics/fdtd-kernel.js`): the solver
    /// passes the run of closed links at the start, which carry no flow.
    pub fn step(&mut self, from: usize) {
        #[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
        {
            super::kernel_simd::step_scatter(self, from);
        }
        #[cfg(not(all(target_arch = "wasm32", target_feature = "simd128")))]
        {
            self.scatter::<false>(from);
        }
    }

    /// The scatter loop from link `from` on; `FLUX` stores the flux of
    /// every link.
    fn scatter<const FLUX: bool>(&mut self, from: usize) {
        let Self {
            link_a,
            link_b,
            velocity,
            damping,
            conductance,
            flux,
            pressure,
            divergence,
            ..
        } = self;
        // Iterators instead of indices: the compiler then checks only the
        // two cell indices of a link, as `#stepJs` reads them.
        let cells = pressure.len();
        let divergence = &mut divergence[..cells];
        let from = from.min(link_a.len());
        let links = link_a[from..]
            .iter()
            .zip(link_b[from..].iter())
            .zip(velocity[from..].iter_mut())
            .zip(damping[from..].iter())
            .zip(conductance[from..].iter())
            .enumerate();
        for (offset, ((((&a, &b), v), &k), &c)) in links {
            let link = from + offset;
            let a = a as usize;
            let b = b as usize;
            let u = k * (*v - COURANT * (pressure[b] - pressure[a]));
            *v = u;
            let value = c * u;
            if FLUX {
                flux[link] = value;
            }
            divergence[a] += value;
            divergence[b] -= value;
        }
        self.pressure_pass();
    }

    /// The pressure update of the scatter form, which also zeroes
    /// `divergence`.
    #[inline]
    fn pressure_pass(&mut self) {
        let Self {
            pressure,
            divergence,
            keep,
            gain,
            ..
        } = self;
        let cells = pressure
            .iter_mut()
            .zip(divergence.iter_mut())
            .zip(keep.iter())
            .zip(gain.iter());
        for (((p, d), &k), &g) in cells {
            *p = k * *p - g * *d;
            *d = 0.0;
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
        match self.incident_width {
            1 => self.cells_padded::<1>(),
            2 => self.cells_padded::<2>(),
            3 => self.cells_padded::<3>(),
            4 => self.cells_padded::<4>(),
            5 => self.cells_padded::<5>(),
            6 => self.cells_padded::<6>(),
            7 => self.cells_padded::<7>(),
            8 => self.cells_padded::<8>(),
            _ => self.cells_listed(),
        }
    }

    /// Pass 2 of the gather form with lists of `W` links each.
    fn cells_padded<const W: usize>(&mut self) {
        let Self {
            pressure,
            keep,
            gain,
            flux,
            incident_link,
            incident_sign,
            ..
        } = self;
        let lists = incident_link
            .as_chunks::<W>()
            .0
            .iter()
            .zip(incident_sign.as_chunks::<W>().0);
        let cells = pressure
            .iter_mut()
            .zip(keep.iter())
            .zip(gain.iter())
            .zip(lists);
        for (((p, &k), &g), (links, signs)) in cells {
            let d = padded_sum(flux, links, signs);
            *p = k * *p - g * d;
        }
    }

    /// Pass 2 of the gather form with lists of any length.
    fn cells_listed(&mut self) {
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
        let cells = pressure
            .iter_mut()
            .zip(keep.iter())
            .zip(gain.iter())
            .zip(incident_start.windows(2));
        for (((p, &k), &g), range) in cells {
            let d = incident_sum(
                flux,
                incident_link,
                incident_sign,
                range[0] as usize,
                range[1] as usize,
            );
            *p = k * *p - g * d;
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
        let links = link_a[from..]
            .iter()
            .zip(&link_b[from..])
            .zip(&mut velocity[from..])
            .zip(&damping[from..])
            .zip(&conductance[from..])
            .zip(&mut flux[from..]);
        for (((((&a, &b), v), &k), &c), f) in links {
            let u = k * (*v - COURANT * (pressure[b as usize] - pressure[a as usize]));
            *v = u;
            *f = c * u;
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

/// [`incident_sum`] of one padded list of `W` links.
#[inline(always)]
pub(super) fn padded_sum<const W: usize>(flux: &[f64], links: &[u32; W], signs: &[f64; W]) -> f64 {
    let mut d = 0.0;
    for (&link, &sign) in links.iter().zip(signs) {
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

    /// A random grid whose cells have at most 6 links, like a voxel grid,
    /// so [`Grid::index`] pads its lists.
    fn random_lattice(seed: u32, cells: usize, links: usize) -> Grid {
        let mut random = Random::new(seed);
        let mut grid = random_grid(seed, cells, links);
        let mut degree = vec![0; cells];
        let pick = |random: &mut Random| (random.next() * cells as f64) as usize;
        for link in 0..links {
            let (mut a, mut b) = (pick(&mut random), pick(&mut random));
            while a == b || degree[a] == 6 || degree[b] == 6 {
                a = pick(&mut random);
                b = pick(&mut random);
            }
            degree[a] += 1;
            degree[b] += 1;
            grid.link_a[link] = a as u32;
            grid.link_b[link] = b as u32;
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
    fn padded_gather_equals_scatter() {
        let mut scatter = random_lattice(3, 500, 1400);
        assert_eq!(scatter.incident_width, 6);
        assert!(scatter.incident_link.contains(&1400));
        let mut gather = scatter.clone();
        for _ in 0..200 {
            scatter.step_scatter();
            gather.step_gather();
        }
        assert!(scatter.pressure.iter().any(|&value| value != 0.0));
        assert_bit_equal(&scatter, &gather);
    }

    #[test]
    fn step_equals_scatter() {
        // The step of the solver leaves `flux` alone; everything else
        // matches the scatter form bit for bit, on an odd number of links
        // and cells (the scalar tails of the SIMD form).
        for (seed, cells, links) in [(1, 500, 1400), (4, 499, 1399)] {
            let mut scatter = random_grid(seed, cells, links);
            let mut step = scatter.clone();
            for _ in 0..200 {
                scatter.step_scatter();
                step.step(0);
            }
            assert!(scatter.pressure.iter().any(|&value| value != 0.0));
            assert!(step.flux.iter().all(|&value| value == 0.0));
            step.flux.clone_from(&scatter.flux);
            assert_bit_equal(&scatter, &step);
        }
    }

    #[test]
    fn long_lists_are_not_padded() {
        let grid = random_grid(1, 500, 1400);
        assert_eq!(grid.incident_width, 0);
        assert_eq!(grid.incident_link.len(), 2 * 1400);
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
        assert_eq!(grid.incident_width, 2);
        grid.link_b[2] = 1;
        assert!(grid.index());
        // Cell 1 has three links, cell 0 one and cell 2 two: padded to 3
        // with the zero-flux link 3.
        assert_eq!(grid.incident_start, [0, 3, 6, 9]);
        assert_eq!(grid.incident_link, [0, 3, 3, 0, 1, 2, 1, 2, 3]);
        assert_eq!(
            grid.incident_sign,
            [1.0, 1.0, 1.0, -1.0, 1.0, -1.0, -1.0, 1.0, 1.0]
        );
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
