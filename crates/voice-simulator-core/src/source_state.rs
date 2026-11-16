//! The source state that a renderer started mid-utterance takes over from
//! the one it replaces (issue 29): `Glottis::save_state` writes these
//! [`LENGTH`] values, `Glottis::restore_state` reads them.
//!
//! The constants are the `SOURCE_STATE` object of `src/engine/layout.js`;
//! `tests/engine-layout.test.js` compares the two files as text.

/// Time since the start of the glottal period (s).
pub const PHASE: usize = 0;
/// Length of the period (s).
pub const PERIOD: usize = 1;
/// Jitter factor of the period.
pub const JITTER: usize = 2;
/// Shimmer factor of the period.
pub const SHIMMER: usize = 3;
/// Output of the chink low-pass.
pub const SMOOTHED: usize = 4;
/// Amplitude of the current pulse.
pub const INTENSITY: usize = 5;
/// Modulation of the aspiration noise.
pub const NOISE_MODULATION: usize = 6;
/// Tenseness the pulse of the period was shaped with.
pub const PULSE_TENSENESS: usize = 7;
/// State of the glottis random generator (a `u32` as a float).
pub const RANDOM: usize = 8;
/// Parity of the period: every second period of a creak is the long one.
pub const PARITY: usize = 9;
/// Gain of the current pulse (below 1 in the long period of a creak).
pub const PULSE_GAIN: usize = 10;
/// Output of the falsetto low-pass.
pub const FALSETTO_SMOOTHED: usize = 11;
/// Number of values.
pub const LENGTH: usize = 12;
