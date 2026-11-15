//! The acoustic solver of the Rust renderer: the 1D waveguide now, the 3D
//! FDTD solver of issue 23 later.

/// What the renderer needs from a solver.
pub trait Solver {
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
