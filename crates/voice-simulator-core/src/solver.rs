//! The acoustic solver of the Rust renderer: the 1D waveguide
//! ([`crate::waveguide`]) or the 3D FDTD solver ([`crate::fdtd::solver`]).

/// What the renderer needs from a solver.
pub trait Solver {
    /// Incident wave (source units) and effective glottal tube area (cm²).
    fn glottal_load(&self) -> (f64, f64);
    /// Reflection of the glottal termination; one for an interactive source.
    fn set_glottal_reflection(&mut self, reflection: f64);
    /// Set the tract of one control block from a frame (see
    /// [`crate::frame`]).
    fn set_shape(&mut self, frame: &[f64]);
    /// Seconds of physical time per step for the last frame.
    fn step_duration(&self) -> f64;
    /// Advance one step with the glottal flow derivative `flow`, the
    /// turbulence source `noise` at junction `noise_at` and the burst
    /// `transient` (flow derivative) at the same junction. Returns the
    /// radiated output.
    fn step(&mut self, flow: f64, noise_at: f64, noise: f64, transient: f64) -> f64;
    /// Acoustic pressure for visualisation into `out`; returns the number
    /// of values written.
    fn field(&self, out: &mut [f64]) -> usize;
}
