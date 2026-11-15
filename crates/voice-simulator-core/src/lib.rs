//! Numerical core of the voice simulator.
//!
//! The JavaScript code in `src/` is the reference implementation; every
//! module here ports one JavaScript module and must give the same numbers
//! under the parity class stated in `docs/RUST-ENGINE.md`.
//!
//! The crate has no I/O, no threads and no clock, so the same code runs in
//! the WebAssembly engine, the command line tool and the unit tests.

#![no_std]
#![forbid(unsafe_code)]

extern crate alloc;

pub mod aerodynamics;
pub mod filters;
pub mod frame;
pub mod glottis;
pub mod math;
pub mod nose_line;
pub mod radiation;
pub mod random;
pub mod resample;
pub mod solver;
pub mod waveguide;
