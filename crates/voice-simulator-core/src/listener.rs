//! The listener: what happens to the radiated sound between the lips and
//! the output. The JavaScript side resolves the microphone and the room
//! (`createListener` of `src/acoustics/listener.js`) and serializes the
//! resolved numbers; this module runs them per sample.
//!
//! Layout: `[stage count, stages...]`; an empty array or a stage count of
//! 0 is the identity (no microphone, no room).

/// The per-sample listener.
#[derive(Clone, Debug, Default)]
pub struct Listener {}

impl Listener {
    /// The listener of the serialized `values`; `None` if they are
    /// malformed.
    pub fn new(values: &[f64]) -> Option<Self> {
        match values {
            [] => Some(Self::default()),
            [count] if *count == 0.0 => Some(Self::default()),
            _ => None,
        }
    }

    /// One sample through the listener.
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        input
    }
}
