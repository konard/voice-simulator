//! Reset must forget the glottal load added by tract interaction (issue 82).

use voice_simulator_core::fdtd::model::{Model, CELL_AIR, CELL_TRACT, LINK_LIPS};
use voice_simulator_core::fdtd::solver::{Fdtd3d, FdtdOptions, Output};
use voice_simulator_core::solver::Solver;

fn model() -> Model {
    Model {
        dx: 1.0,
        opening: None,
        kind: vec![CELL_TRACT, CELL_AIR],
        tube: vec![0, -1],
        arc: vec![0.0, 0.0],
        point: vec![[0.0, 0.0, 0.0], [1.0, 0.0, 0.0]],
        link_a: vec![0],
        link_b: vec![1],
        link_kind: vec![LINK_LIPS],
        open_faces: vec![0.0, 1.0],
        boundary_admittance: 1.0,
        enclosure: false,
        lengths: [1.0, 1.0],
        larynx_travel: 0.0,
        sinuses: vec![],
        places: 0,
        pouch_counts: vec![],
        pouch_links: vec![],
        lips: [0.0; 3],
        nostrils: [0.0; 3],
        teeth: None,
        open_masks: vec![0, 1],
    }
}

#[test]
fn reset_forgets_glottal_load_in_both_output_modes() {
    for output in [Output::Flow, Output::Microphone] {
        let options = FdtdOptions {
            output,
            spherical: false,
            target: [1.0, 0.0, 0.0],
            wall_loss: 1.0,
            nasal_loss: 1.0,
            glottal_chink: 0.0,
            vocal_tract_length: 1.0,
            length_scale: 1.0,
        };
        let mut solver = Fdtd3d::new(model(), &options).unwrap();
        solver.set_areas(&[1.0], 0.0, None, 1.0);
        for _ in 0..8 {
            solver.step(1.0, 0.0, 0.0, 0.0);
        }
        let (incident, admittance) = solver.glottal_load();
        assert!(incident.is_finite() && incident != 0.0);
        assert!(admittance.is_finite() && admittance > 0.0);
        solver.reset();
        assert_eq!(solver.glottal_load(), (0.0, admittance));
        solver.step(0.0, 0.0, 0.0, 0.0);
        assert_eq!(solver.glottal_load(), (0.0, admittance));
    }
}
