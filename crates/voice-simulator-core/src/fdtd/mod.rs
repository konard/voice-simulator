//! The 3D finite-difference time-domain solver of
//! `src/acoustics/fdtd3d.js` (issue 23): the step loop ([`kernel`]), its
//! WebAssembly SIMD form (`kernel_simd`, only in a `simd128` build), the
//! voxel model packed by `src/engine/pack-model.js` ([`model`]), the
//! solver itself ([`solver`]) and the step on several threads of issue 24
//! ([`parallel`], with the split into parts of [`partition`]).

pub mod kernel;
#[cfg(all(target_arch = "wasm32", target_feature = "simd128"))]
mod kernel_simd;
pub mod model;
pub mod parallel;
pub mod partition;
pub mod solver;
