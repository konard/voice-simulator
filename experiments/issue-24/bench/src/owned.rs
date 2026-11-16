//! Prototype: a threaded scatter step. Part k scatters its links into a
//! private divergence window; a cell whose links all lie in one part takes
//! that window's sum, any other cell gathers sign * conductance * velocity
//! of its links in link order. Both orders equal the sequential scatter.
use std::sync::atomic::{AtomicUsize, Ordering::SeqCst};

/// A spin barrier for `parts` threads.
struct Barrier { parts: usize, count: AtomicUsize, generation: AtomicUsize }
impl Barrier {
    fn new(parts: usize) -> Self { Self { parts, count: AtomicUsize::new(0), generation: AtomicUsize::new(0) } }
    fn wait(&self) {
        let generation = self.generation.load(SeqCst);
        if self.count.fetch_add(1, SeqCst) + 1 == self.parts {
            self.count.store(0, SeqCst);
            self.generation.fetch_add(1, SeqCst);
        } else {
            while self.generation.load(SeqCst) == generation { std::hint::spin_loop(); }
        }
    }
}
use voice_simulator_core::fdtd::kernel::{Grid, COURANT};

const NONE: u32 = u32::MAX;
const SHARED: u32 = u32::MAX - 1;

pub struct Plan {
    pub link_bounds: Vec<usize>,
    pub cell_bounds: Vec<usize>,
    pub window: Vec<(usize, usize)>,
    pub owner: Vec<u32>,
    pub shared: usize,
}

pub fn plan(grid: &Grid, parts: usize) -> Plan {
    let links = grid.links();
    let cells = grid.cells();
    let link_bounds: Vec<usize> = (0..=parts).map(|k| k * links / parts).collect();
    let cell_bounds: Vec<usize> = (0..=parts).map(|k| k * cells / parts).collect();
    let mut owner = vec![NONE; cells];
    let mut window = vec![(usize::MAX, 0usize); parts];
    for k in 0..parts {
        for l in link_bounds[k]..link_bounds[k + 1] {
            for c in [grid.link_a[l] as usize, grid.link_b[l] as usize] {
                owner[c] = match owner[c] {
                    NONE => k as u32,
                    o if o == k as u32 => o,
                    _ => SHARED,
                };
                window[k].0 = window[k].0.min(c);
                window[k].1 = window[k].1.max(c + 1);
            }
        }
        if window[k].0 == usize::MAX { window[k] = (0, 0); }
    }
    let shared = owner.iter().filter(|&&o| o == SHARED).count();
    Plan { link_bounds, cell_bounds, window, owner, shared }
}

struct P<T>(*mut T);
impl<T> Clone for P<T> { fn clone(&self) -> Self { *self } }
impl<T> Copy for P<T> {}
unsafe impl<T> Send for P<T> {}
unsafe impl<T> Sync for P<T> {}
impl<T> P<T> { fn get(self) -> *mut T { self.0 } }

/// Links `lo..hi` into the window that starts at cell `base`.
#[inline(never)]
fn links(link_a: &[u32], link_b: &[u32], damping: &[f64], conductance: &[f64], velocity: &mut [f64], pressure: &[f64], window: &mut [f64], base: usize) {
    for ((((&a, &b), &k), &c), v) in link_a.iter().zip(link_b).zip(damping).zip(conductance).zip(velocity) {
        let (a, b) = (a as usize, b as usize);
        let u = k * (*v - COURANT * (pressure[b] - pressure[a]));
        *v = u;
        let value = c * u;
        window[a - base] += value;
        window[b - base] -= value;
    }
}

/// Cells of one run of one owner window.
#[inline(never)]
fn cells_owned(pressure: &mut [f64], keep: &[f64], gain: &[f64], window: &mut [f64]) {
    for (((p, &k), &g), d) in pressure.iter_mut().zip(keep).zip(gain).zip(window) {
        *p = k * *p - g * *d;
        *d = 0.0;
    }
}

pub fn segments(plan: &Plan, lo: usize, hi: usize) -> Vec<(usize, usize, u32)> {
    let mut out = Vec::new();
    let mut c = lo;
    while c < hi {
        let o = plan.owner[c];
        let mut e = c + 1;
        while e < hi && plan.owner[e] == o { e += 1; }
        out.push((c, e, o));
        c = e;
    }
    out
}

pub fn run(grid: &mut Grid, plan: &Plan, steps: usize, from: usize) {
    let parts = plan.link_bounds.len() - 1;
    let mut windows: Vec<Vec<f64>> = plan.window.iter().map(|&(a, b)| vec![0.0; b - a]).collect();
    let wins: Vec<P<f64>> = windows.iter_mut().map(|w| P(w.as_mut_ptr())).collect();
    let segs: Vec<Vec<(usize, usize, u32)>> = (0..parts).map(|k| segments(plan, plan.cell_bounds[k], plan.cell_bounds[k + 1])).collect();
    let barrier = Barrier::new(parts);
    let g = P(grid as *mut Grid);
    let body = |k: usize| {
        let g = unsafe { &mut *g.get() };
        let links_n = g.links();
        let cells_n = g.cells();
        let (pa, va) = (g.pressure.as_mut_ptr(), g.velocity.as_mut_ptr());
        for _ in 0..steps {
            let (lo, hi) = (plan.link_bounds[k].max(from), plan.link_bounds[k + 1]);
            let hi = hi.max(lo);
            let (base, end) = plan.window[k];
            unsafe {
                links(&g.link_a[lo..hi], &g.link_b[lo..hi], &g.damping[lo..hi], &g.conductance[lo..hi],
                    std::slice::from_raw_parts_mut(va.add(lo), hi - lo),
                    std::slice::from_raw_parts(pa, cells_n),
                    std::slice::from_raw_parts_mut(wins[k].get(), end - base), base);
            }
            barrier.wait();
            for &(c0, c1, o) in &segs[k] {
                if o == NONE || o == SHARED {
                    let velocity = unsafe { std::slice::from_raw_parts(va, links_n) };
                    for c in c0..c1 {
                        let (s, e) = (g.incident_start[c] as usize, g.incident_start[c + 1] as usize);
                        let mut d = 0.0;
                        for i in s..e {
                            let l = g.incident_link[i] as usize;
                            if l < links_n && l >= from {
                                d += g.incident_sign[i] * (g.conductance[l] * velocity[l]);
                            }
                        }
                        unsafe { *pa.add(c) = g.keep[c] * *pa.add(c) - g.gain[c] * d; }
                    }
                } else {
                    let o = o as usize;
                    let base = plan.window[o].0;
                    unsafe {
                        cells_owned(std::slice::from_raw_parts_mut(pa.add(c0), c1 - c0), &g.keep[c0..c1], &g.gain[c0..c1],
                            std::slice::from_raw_parts_mut(wins[o].get().add(c0 - base), c1 - c0));
                    }
                }
            }
            barrier.wait();
        }
    };
    std::thread::scope(|scope| {
        for k in 1..parts {
            let body = &body;
            scope.spawn(move || body(k));
        }
        body(0);
    });
}
