//! The step of the gather form on several threads (issue 24).
//!
//! A [`Team`] splits the links and the cells of one grid into
//! `threads` contiguous parts of about equal work ([`partition`]). Every
//! step runs two rounds: in round 1 every thread computes the velocity
//! and flux of the links of its part (pass 1 of [`Grid::step_gather`]),
//! in round 2 the pressure of the cells of its part (pass 2). Pass 1 reads
//! only `pressure` and pass 2 reads only `flux`, so the threads of a round
//! never write what another one reads or writes, and the rounds of every
//! part compute the same bits as one pass over the whole grid: a threaded
//! step is bit-identical with [`Grid::step`] (parity class A).
//!
//! The leader, the thread that owns the grid, is part 0 and calls
//! [`Team::step`]; helper `k` (1 to `threads - 1`) calls
//! [`Team::work`] once and stays in it until [`Team::finish`]. The crate
//! starts no thread: the command line tool spawns its helpers with
//! `std::thread::scope`, the WebAssembly engine runs them in Web Workers
//! (`src/engine/thread-pool.js`). The rounds meet at a spin barrier of
//! three atomics, all `SeqCst`:
//!
//! - the leader stores the `phase` (1 links, 2 cells, 3 exit), stores
//!   `pending = threads - 1`, then adds 1 to `generation`, does its own
//!   part and spins until `pending` is 0;
//! - a helper spins until `generation` changes, loads the `phase`,
//!   returns on 3, else does its part and takes 1 from `pending`.
//!
//! The helpers write the grid through raw pointers that the leader takes
//! from its `&mut Grid` at the start of a step, so this is the only file
//! of the crate with `unsafe` code; every block of it rests on one fact,
//! that a part writes only its own index range.
//!
//! [`Grid::step`] skips the links before its `from` argument (the links
//! that the glottis closes, see `skip_closed` of `solver.rs`): they keep
//! their velocity and add nothing to any cell. A team does the same: its
//! parts store a flux of `+0.0` for those links, which changes no
//! incident sum (see the module comment of `kernel.rs`).

#![allow(unsafe_code)]

use alloc::vec::Vec;
use core::cell::UnsafeCell;
use core::fmt;
use core::hint::spin_loop;
use core::slice;
use core::sync::atomic::{AtomicBool, AtomicU32, Ordering::SeqCst};

use super::kernel::{cells_slab, links_slab, CellSlab, Grid, LinkSlab};
use super::partition;

/// Whether this build can have helper threads: every native build, and
/// WebAssembly only with `+atomics` (the threads build of the engine).
/// Elsewhere a solver never starts a team, so the compiler drops the code
/// of [`Team`] from the build.
pub const THREADS_AVAILABLE: bool =
    cfg!(any(not(target_arch = "wasm32"), target_feature = "atomics"));

/// Fewest links for which a solver steps on more than one thread: below
/// it the barrier costs more than the threads gain. The rule of issue 24
/// sets it to the links of the smallest grid where 2 threads are at least
/// 1.3 times faster than 1, natively and in WebAssembly, measured by
/// `tests/heavy/performance-threads.test.js`. No grid of that measurement
/// paid (`docs/reports/performance-threads.md`), so it is `usize::MAX`:
/// a team starts only with an explicit smaller minimum (`threadMinLinks`
/// of the loader, `--thread-min-links` of the CLI). The code stays, so
/// that a new measurement can lower it (see `docs/RUST-ENGINE.md`).
pub const THREAD_MIN_LINKS: usize = usize::MAX;

/// The phases of a round.
const LINKS: u32 = 1;
const CELLS: u32 = 2;
const EXIT: u32 = 3;

/// A team of `threads` threads that steps one grid (see the module
/// comment).
pub struct Team {
    threads: usize,
    links: usize,
    cells: usize,
    link_bounds: Vec<usize>,
    cell_bounds: Vec<usize>,
    generation: AtomicU32,
    phase: AtomicU32,
    pending: AtomicU32,
    /// Set while a leader is in [`Team::step`] or [`Team::finish`]: a
    /// second leader (a clone of the solver) steps on its own instead.
    leading: AtomicBool,
    /// Set by [`Team::finish`].
    finished: AtomicBool,
    /// The arrays of the grid of the current step, written by the leader
    /// before it starts a round, read by the helpers in a round.
    arrays: UnsafeCell<Arrays>,
}

// SAFETY: the raw pointers of `arrays` are written only by the leader
// between rounds (under `leading`) and read by the helpers only in a
// round, after the `SeqCst` change of `generation` that orders the write
// before the read; in a round a part writes only its own index range.
unsafe impl Sync for Team {}
// SAFETY: as for `Sync`; the pointers point into a grid that the leader
// borrows mutably for the whole of every round.
unsafe impl Send for Team {}

impl fmt::Debug for Team {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("Team")
            .field("threads", &self.threads)
            .field("link_bounds", &self.link_bounds)
            .field("cell_bounds", &self.cell_bounds)
            .finish_non_exhaustive()
    }
}

impl Team {
    /// A team of `threads` (at least 1) for `grid`, which must be indexed
    /// ([`Grid::index`]); the parts are fixed here, so the team only steps
    /// grids of the same size.
    pub fn new(grid: &Grid, threads: usize) -> Self {
        let threads = threads.max(1);
        Self {
            threads,
            links: grid.links(),
            cells: grid.cells(),
            link_bounds: partition::bounds(&partition::link_weights(grid), threads),
            cell_bounds: partition::bounds(&partition::cell_weights(grid), threads),
            generation: AtomicU32::new(0),
            phase: AtomicU32::new(0),
            pending: AtomicU32::new(0),
            leading: AtomicBool::new(false),
            finished: AtomicBool::new(false),
            arrays: UnsafeCell::new(Arrays::default()),
        }
    }

    /// Number of threads, the leader included.
    pub fn threads(&self) -> usize {
        self.threads
    }

    /// The link and the cell bounds of the parts.
    pub fn bounds(&self) -> (&[usize], &[usize]) {
        (&self.link_bounds, &self.cell_bounds)
    }

    /// One step of `grid`, bit-identical with `grid.step(from)`; the
    /// leader runs part 0. Steps on this thread alone when the grid is
    /// not the size of the team, when another leader is in the team or
    /// after [`Team::finish`].
    pub fn step(&self, grid: &mut Grid, from: usize) {
        if grid.links() != self.links
            || grid.cells() != self.cells
            || grid.incident_start.len() != self.cells + 1
            || self.finished.load(SeqCst)
            || self.leading.swap(true, SeqCst)
        {
            grid.step(from);
            return;
        }
        let arrays = Arrays::of(grid, from.min(self.links));
        // SAFETY: only the leader (`leading` is set) writes `arrays`, and
        // no helper reads it now: they read it only in a round, and the
        // last round ended when `pending` reached 0. A part writes only
        // its own index range, so no round is running.
        unsafe { *self.arrays.get() = arrays };
        for phase in [LINKS, CELLS] {
            self.round(phase);
        }
        self.leading.store(false, SeqCst);
    }

    /// The loop of helper `index` (1 to `threads - 1`): one part of every
    /// round until [`Team::finish`]. Call it once per team and helper.
    pub fn work(&self, index: usize) {
        if index == 0 || index >= self.threads {
            return;
        }
        // The team starts at generation 0, and the leader cannot start a
        // second round before this helper has done the first one, so 0 is
        // the generation this helper has seen even when it starts late.
        let mut seen = 0;
        loop {
            let mut generation = self.generation.load(SeqCst);
            while generation == seen {
                spin_loop();
                generation = self.generation.load(SeqCst);
            }
            seen = generation;
            let phase = self.phase.load(SeqCst);
            if phase == EXIT {
                self.pending.fetch_sub(1, SeqCst);
                return;
            }
            self.part(phase, index);
            self.pending.fetch_sub(1, SeqCst);
        }
    }

    /// Ends the [`Team::work`] of every helper and waits until they have
    /// left it; later steps run on the leader alone. Once only: later
    /// calls return at once. Like every round it waits for all
    /// `threads - 1` helpers, so each of them must be in, or on its way
    /// to, [`Team::work`].
    pub fn finish(&self) {
        while self.leading.swap(true, SeqCst) {
            spin_loop();
        }
        if !self.finished.swap(true, SeqCst) {
            self.round(EXIT);
        }
        self.leading.store(false, SeqCst);
    }

    /// One round: start it, run part 0 on this thread, wait for the
    /// helpers.
    fn round(&self, phase: u32) {
        self.phase.store(phase, SeqCst);
        self.pending.store((self.threads - 1) as u32, SeqCst);
        self.generation.fetch_add(1, SeqCst);
        if phase != EXIT {
            self.part(phase, 0);
        }
        while self.pending.load(SeqCst) != 0 {
            spin_loop();
        }
    }

    /// Part `index` of the round of `phase`.
    fn part(&self, phase: u32, index: usize) {
        // SAFETY: the leader wrote `arrays` before it started this round
        // and does not write it again before every part of the round is
        // done; reading a copy of it is a read of plain values.
        let arrays = unsafe { *self.arrays.get() };
        if phase == LINKS {
            let (lo, hi) = (self.link_bounds[index], self.link_bounds[index + 1]);
            let start = arrays.from.clamp(lo, hi);
            // SAFETY: a part writes only its own index range: `lo..hi` of
            // `flux` and `velocity` belong to this part alone in round 1,
            // and `lo <= start <= hi <= links`.
            let closed = unsafe { slice::from_raw_parts_mut(arrays.flux.add(lo), start - lo) };
            closed.fill(0.0);
            // SAFETY: as above, for `start..hi`; round 1 writes no cell,
            // so the shared `pressure` is not written while it is read.
            links_slab(unsafe { arrays.link_slab(start, hi) });
        } else {
            let (lo, hi) = (self.cell_bounds[index], self.cell_bounds[index + 1]);
            // SAFETY: a part writes only its own index range: `lo..hi` of
            // `pressure` belong to this part alone in round 2, and round 2
            // writes no link, so the shared `flux` is not written.
            cells_slab(unsafe { arrays.cell_slab(lo, hi) });
        }
    }
}

/// Raw pointers to the arrays of a grid, and its sizes.
#[derive(Clone, Copy)]
struct Arrays {
    from: usize,
    links: usize,
    cells: usize,
    width: usize,
    incident: usize,
    link_a: *const u32,
    link_b: *const u32,
    damping: *const f64,
    conductance: *const f64,
    velocity: *mut f64,
    flux: *mut f64,
    pressure: *mut f64,
    keep: *const f64,
    gain: *const f64,
    incident_start: *const u32,
    incident_link: *const u32,
    incident_sign: *const f64,
}

impl Default for Arrays {
    fn default() -> Self {
        Self {
            from: 0,
            links: 0,
            cells: 0,
            width: 0,
            incident: 0,
            link_a: core::ptr::null(),
            link_b: core::ptr::null(),
            damping: core::ptr::null(),
            conductance: core::ptr::null(),
            velocity: core::ptr::null_mut(),
            flux: core::ptr::null_mut(),
            pressure: core::ptr::null_mut(),
            keep: core::ptr::null(),
            gain: core::ptr::null(),
            incident_start: core::ptr::null(),
            incident_link: core::ptr::null(),
            incident_sign: core::ptr::null(),
        }
    }
}

impl Arrays {
    /// The arrays of `grid`; [`Team::step`] checked its sizes.
    fn of(grid: &mut Grid, from: usize) -> Self {
        Self {
            from,
            links: grid.links(),
            cells: grid.cells(),
            width: grid.incident_width,
            incident: grid.incident_link.len(),
            link_a: grid.link_a.as_ptr(),
            link_b: grid.link_b.as_ptr(),
            damping: grid.damping.as_ptr(),
            conductance: grid.conductance.as_ptr(),
            velocity: grid.velocity.as_mut_ptr(),
            flux: grid.flux.as_mut_ptr(),
            pressure: grid.pressure.as_mut_ptr(),
            keep: grid.keep.as_ptr(),
            gain: grid.gain.as_ptr(),
            incident_start: grid.incident_start.as_ptr(),
            incident_link: grid.incident_link.as_ptr(),
            incident_sign: grid.incident_sign.as_ptr(),
        }
    }

    /// The slab of pass 1 for the links `from..to`.
    ///
    /// # Safety
    ///
    /// `from <= to <= links`, the grid outlives the slab, and in the
    /// round of the call a part writes only its own index range: no other
    /// thread writes or reads `velocity` and `flux` at `from..to`, and none
    /// writes `pressure`.
    unsafe fn link_slab<'a>(&self, from: usize, to: usize) -> LinkSlab<'a> {
        let count = to - from;
        // SAFETY: the pointers are those of the vectors of a grid of
        // `links` links and `cells` cells, alive for the round, and a part
        // writes only its own index range (the contract above).
        unsafe {
            LinkSlab {
                link_a: slice::from_raw_parts(self.link_a.add(from), count),
                link_b: slice::from_raw_parts(self.link_b.add(from), count),
                damping: slice::from_raw_parts(self.damping.add(from), count),
                conductance: slice::from_raw_parts(self.conductance.add(from), count),
                pressure: slice::from_raw_parts(self.pressure, self.cells),
                velocity: slice::from_raw_parts_mut(self.velocity.add(from), count),
                flux: slice::from_raw_parts_mut(self.flux.add(from), count),
            }
        }
    }

    /// The slab of pass 2 for the cells `from..to`.
    ///
    /// # Safety
    ///
    /// `from <= to <= cells`, the grid outlives the slab, and in the round
    /// of the call a part writes only its own index range: no other thread
    /// writes or reads `pressure` at `from..to`, and none writes `flux`.
    unsafe fn cell_slab<'a>(&self, from: usize, to: usize) -> CellSlab<'a> {
        let count = to - from;
        // SAFETY: as for `link_slab`; `flux` has `links + 1` values and
        // `incident_start` has `cells + 1`.
        unsafe {
            CellSlab {
                first: from,
                pressure: slice::from_raw_parts_mut(self.pressure.add(from), count),
                keep: slice::from_raw_parts(self.keep.add(from), count),
                gain: slice::from_raw_parts(self.gain.add(from), count),
                flux: slice::from_raw_parts(self.flux, self.links + 1),
                incident_start: slice::from_raw_parts(self.incident_start, self.cells + 1),
                incident_link: slice::from_raw_parts(self.incident_link, self.incident),
                incident_sign: slice::from_raw_parts(self.incident_sign, self.incident),
                width: self.width,
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fdtd::kernel::tests::random_grid;
    use alloc::sync::Arc;
    use alloc::vec;

    fn bits(values: &[f64]) -> Vec<u64> {
        values.iter().map(|value| value.to_bits()).collect()
    }

    /// `steps` steps of `grid` by a team of `threads`, helpers on scoped
    /// threads.
    fn team_steps(grid: &mut Grid, threads: usize, steps: usize, from: usize) {
        let team = Arc::new(Team::new(grid, threads));
        std::thread::scope(|scope| {
            for index in 1..threads {
                let team = Arc::clone(&team);
                scope.spawn(move || team.work(index));
            }
            for _ in 0..steps {
                team.step(grid, from);
            }
            team.finish();
        });
    }

    #[test]
    fn threads_do_not_change_the_result() {
        let reference = random_grid(1, 500, 1400);
        let mut single = reference.clone();
        for _ in 0..200 {
            single.step_gather();
        }
        for threads in 1..=4 {
            let mut grid = reference.clone();
            team_steps(&mut grid, threads, 200, 0);
            assert_eq!(
                bits(&grid.pressure),
                bits(&single.pressure),
                "{threads} threads"
            );
            assert_eq!(
                bits(&grid.velocity),
                bits(&single.velocity),
                "{threads} threads"
            );
        }
    }

    #[test]
    fn threads_skip_closed_links_like_step() {
        let mut reference = random_grid(3, 300, 900);
        for link in 0..50 {
            reference.damping[link] = 0.0;
            reference.conductance[link] = 0.0;
            reference.velocity[link] = 0.25;
        }
        let mut single = reference.clone();
        for _ in 0..100 {
            single.step(50);
        }
        for threads in [2, 3] {
            let mut grid = reference.clone();
            team_steps(&mut grid, threads, 100, 50);
            assert_eq!(
                bits(&grid.pressure),
                bits(&single.pressure),
                "{threads} threads"
            );
            assert_eq!(
                bits(&grid.velocity),
                bits(&single.velocity),
                "{threads} threads"
            );
        }
    }

    #[test]
    fn a_finished_team_steps_alone() {
        let mut grid = random_grid(2, 50, 120);
        let mut single = grid.clone();
        let team = Arc::new(Team::new(&grid, 3));
        std::thread::scope(|scope| {
            for index in 1..3 {
                let team = Arc::clone(&team);
                scope.spawn(move || team.work(index));
            }
            team.finish();
        });
        team.finish();
        team.step(&mut grid, 0);
        single.step(0);
        assert_eq!(bits(&grid.pressure), bits(&single.pressure));
        let mut other = Grid::new(3, 2);
        other.link_b = vec![1, 1, 1];
        assert!(other.index());
        team.step(&mut other, 0);
    }
}
