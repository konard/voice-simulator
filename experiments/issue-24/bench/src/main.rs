//! Times one grid of a render job: scatter `Grid::step`, gather
//! `Grid::step_gather`, the two passes alone, and a `Team` of 1 to 4.
#[path = "../../../../crates/voice-simulator-cli/src/render_job.rs"]
#[allow(dead_code)]
mod render_job;
#[path = "../../../../crates/voice-simulator-cli/src/sha256.rs"]
#[allow(dead_code)]
mod sha256;
mod owned;

use std::time::Instant;
use voice_simulator_core::fdtd::kernel::{cells_pass, links_pass, Grid};
use voice_simulator_core::fdtd::parallel::Team;
use voice_simulator_core::renderer::AnyRenderer;

fn time(label: &str, steps: usize, mut action: impl FnMut()) {
    let mut best = f64::MAX;
    for _ in 0..3 {
        let start = Instant::now();
        for _ in 0..steps {
            action();
        }
        best = best.min(start.elapsed().as_secs_f64());
    }
    println!("{label:<24} {:>10.1} steps/s  {:>8.1} us/step", steps as f64 / best, best / steps as f64 * 1e6);
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let job = render_job::parse(&std::fs::read(&args[1]).unwrap()).unwrap();
    let steps: usize = args.get(2).map_or(2000, |s| s.parse().unwrap());
    let mut renderer = AnyRenderer::new(&job.config, &job.model).unwrap();
    let mut start = vec![0.0f32; job.samples.min(480)];
    let frames = renderer.blocks(start.len()) * renderer.frame_stride();
    renderer.render(&job.frames[..frames.min(job.frames.len())], &mut start).unwrap();
    let AnyRenderer::Fdtd3d(r) = &renderer else { panic!("not 3D") };
    let base: Grid = r.solver().grid().clone();
    println!("links {} cells {} width {}", base.links(), base.cells(), base.incident_width);
    let mut degree = vec![0usize; base.cells()];
    for (&a, &b) in base.link_a.iter().zip(&base.link_b) { degree[a as usize] += 1; degree[b as usize] += 1; }
    let mut hist = std::collections::BTreeMap::new();
    for &d in &degree { *hist.entry(d).or_insert(0usize) += 1; }
    let top: Vec<_> = hist.iter().rev().take(5).collect();
    println!("degree histogram (top) {top:?}; self links {}", base.link_a.iter().zip(&base.link_b).filter(|(a,b)| a==b).count());
    let base = if std::env::var("PAD").is_ok() {
        // Drop the links of the cells with more than 8 links, so that the
        // lists pad: the timing of a padded grid of the same size.
        let keep: Vec<usize> = (0..base.links())
            .filter(|&l| degree[base.link_a[l] as usize] <= 8 && degree[base.link_b[l] as usize] <= 8)
            .collect();
        let mut g = base.clone();
        macro_rules! pick { ($($f:ident),*) => { $( g.$f = keep.iter().map(|&l| base.$f[l]).collect(); )* } }
        pick!(link_a, link_b, velocity, damping, conductance);
        g.flux = vec![0.0; keep.len() + 1];
        assert!(g.index());
        println!("padded: links {} width {}", g.links(), g.incident_width);
        g
    } else { base };
    let mut grid = base.clone();
    time("scatter step(0)", steps, || grid.step(0));
    let mut grid = base.clone();
    time("gather step_gather", steps, || grid.step_gather());
    let mut grid = base.clone();
    let (l, c) = (grid.links(), grid.cells());
    time("links_pass only", steps, || links_pass(&mut grid, 0, l));
    time("cells_pass only", steps, || cells_pass(&mut grid, 0, c));
    if grid.incident_width == 6 {
        // Lists of u32 with the sign in the top bit: 4 bytes per entry
        // instead of 12.
        let packed: Vec<u32> = grid.incident_link.iter().zip(&grid.incident_sign)
            .map(|(&l, &s)| if s < 0.0 { l | 1 << 31 } else { l }).collect();
        let mut g2 = grid.clone();
        let mut check = grid.clone();
        cells_pass(&mut check, 0, c);
        let packed_pass = |g: &mut Grid| {
            let flux = &g.flux;
            for (((p, &k), &gn), list) in g.pressure.iter_mut().zip(&g.keep).zip(&g.gain).zip(packed.as_chunks::<6>().0) {
                let mut d = 0.0f64;
                for &e in list {
                    let f = flux[(e & 0x7fff_ffff) as usize];
                    d += f64::from_bits(f.to_bits() ^ (u64::from(e >> 31) << 63));
                }
                *p = k * *p - gn * d;
            }
        };
        packed_pass(&mut g2);
        assert_eq!(g2.pressure.iter().map(|v| v.to_bits()).collect::<Vec<_>>(), check.pressure.iter().map(|v| v.to_bits()).collect::<Vec<_>>());
        time("cells packed", steps, || packed_pass(&mut g2));
    }
    // Prototype: threaded scatter.
    let mut reference = base.clone();
    for _ in 0..50 { reference.step(0); }
    for parts in 1..=4 {
        let plan = owned::plan(&base, parts);
        let mut grid = base.clone();
        owned::run(&mut grid, &plan, 50, 0);
        assert!(grid.pressure.iter().zip(&reference.pressure).all(|(a, b)| a.to_bits() == b.to_bits()), "owned {parts} differs");
        assert!(grid.velocity.iter().zip(&reference.velocity).all(|(a, b)| a.to_bits() == b.to_bits()));
        let mut best = f64::MAX;
        for _ in 0..3 {
            let start = Instant::now();
            owned::run(&mut grid, &plan, steps, 0);
            best = best.min(start.elapsed().as_secs_f64());
        }
        println!("{:<24} {:>10.1} steps/s  {:>8.1} us/step  shared {}", format!("owned scatter {parts}"), steps as f64 / best, best / steps as f64 * 1e6, plan.shared);
    }
    for threads in 1..=4 {
        let mut grid = base.clone();
        let team = Team::new(&grid, threads);
        std::thread::scope(|scope| {
            for index in 1..threads {
                let team = &team;
                scope.spawn(move || team.work(index));
            }
            time(&format!("team {threads}"), steps, || team.step(&mut grid, 0));
            team.finish();
        });
    }
    // Barrier cost alone: a team on an empty-ish grid is not possible, so
    // time rounds of a 2-link grid.
}
