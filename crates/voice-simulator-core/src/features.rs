//! Numerical features implemented by this core. Keep one quoted id per line.
pub const FEATURES: &[&str] = &[
    // features:start
    "solver.waveguide",
    "solver.fdtd3d",
    "source.lf",
    "noise.turbulence",
    "losses.frequency",
    "filters.output",
    "radiation",
    "listener.microphone",
    "listener.room",
    "mode.phonation",
    "mode.effort",
    "articulators",
    "tier.narrowband",
    // features:end
];

/// The same feature ids exposed by the WebAssembly and native interfaces.
pub fn features() -> &'static [&'static str] {
    FEATURES
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn feature_ids_are_unique() {
        for (index, id) in FEATURES.iter().enumerate() {
            assert!(!FEATURES[..index].contains(id), "duplicate feature: {id}");
        }
    }
}
