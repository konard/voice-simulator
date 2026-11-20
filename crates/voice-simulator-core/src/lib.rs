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
pub mod decode;
pub mod effort;
pub mod fdtd;
pub mod fdtd2d;
pub mod features;
pub mod filters;
pub mod folds;
pub mod formants;
pub mod frame;
pub mod glottis;
pub mod inverse_whisper;
pub mod landmarks;

mod inverse_dsp;
pub mod inverse_filter;
mod inverse_refinement;
pub mod inversion;
pub mod inversion_refine;
pub mod inversion_source;
pub mod language_id;
pub mod listener;
pub mod losses;
pub mod math;
pub mod mixed_recognition;
pub mod modes;
pub mod nose_line;
pub mod prosody;
pub mod radiation;
pub mod random;
pub mod recognition;
pub mod recognizer;
pub mod renderer;
pub mod resample;
pub mod rescoring;
pub mod sheet;
pub mod solver;
pub mod source_state;
pub mod stages;
pub mod subglottal;
pub mod voice_fit;
pub mod waveguide;
pub mod whisper;
