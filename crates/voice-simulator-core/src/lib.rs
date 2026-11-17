//! Numerical core of the voice simulator.
//!
//! The JavaScript code in `src/` is the reference implementation; every
//! module here ports one JavaScript module and must give the same numbers
//! under the parity class stated in `docs/RUST-ENGINE.md`.
//!
//! The crate has no I/O, no clock and starts no thread, so the same code
//! runs in the WebAssembly engine, the command line tool and the unit
//! tests. The thread team of `fdtd::parallel` (issue 24) runs on threads
//! that its caller starts; that file is the only one that writes through
//! raw pointers, and the lints of `Cargo.toml` deny it everywhere else.

#![no_std]

extern crate alloc;
#[cfg(any(test, feature = "std"))]
extern crate std;

pub mod aerodynamics;
pub mod codebook;
pub mod config;
pub mod effort;
pub mod fdtd;
pub mod filters;
pub mod frame;
pub mod glottis;
mod inverse_dsp;
pub mod inverse_filter;
mod inverse_refinement;
pub mod listener;
pub mod losses;
pub mod math;
pub mod radiation;
pub mod random;
pub mod renderer;
pub mod resample;
pub mod solver;
pub mod source_state;
pub mod stages;
pub mod waveguide;
