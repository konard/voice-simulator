//! Exports that run one part of the voice renderer on its own, for the
//! parity tests of `tests/rust-waveguide.test.js`: the biquad, the LF
//! glottis, the radiation filter and the waveguide (`docs/RUST-ENGINE.md`).

use voice_simulator_core::filters::Biquad;
use voice_simulator_core::glottis::{GlottalControl, Glottis, GlottisOptions};
use voice_simulator_core::radiation::Radiation;

use crate::{error, f64_slice};

/// Filters `data` in place with a new biquad of the given `kind`
/// (0 low-pass, 1 high-pass, 2 band-pass). `false` for an unknown kind.
pub fn run_biquad(kind: u32, frequency: f64, q: f64, rate: f64, data: &mut [f64]) -> bool {
    let mut filter = Biquad::new();
    match kind {
        0 => filter.lowpass(frequency, q, rate),
        1 => filter.highpass(frequency, q, rate),
        2 => filter.bandpass(frequency, q, rate),
        _ => return false,
    };
    for value in data {
        *value = filter.process(*value);
    }
    true
}

/// `new Biquad().lowpass(frequency, q, rate)` (`kind` 0), `.highpass`
/// (1) or `.bandpass` (2) of `filters.js` run over the `count` `f64`
/// values at `data`, in place. Returns 0 or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_biquad_run(
    kind: u32,
    frequency: f64,
    q: f64,
    rate: f64,
    data: u32,
    count: u32,
) -> i32 {
    match f64_slice(data, count) {
        Ok(slice) => {
            if run_biquad(kind, frequency, q, rate, slice) {
                error::OK
            } else {
                error::BAD_ARGUMENT
            }
        }
        Err(code) => code,
    }
}

/// Number of `f64` parameters of [`vs_glottis_run`].
pub const GLOTTIS_PARAMETERS: usize = 13;

/// Runs a glottis seeded with `seed` (`hashSeed` of `'<seed>:glottis'`)
/// over `data`, which holds the white noise on entry and the flow
/// derivative on return. `parameters` are tenseness, breathiness, jitter,
/// shimmer, aspirationLevel, chink, lungPressure, dt, f0, voicing,
/// aspiration, closure and loudness; the control has no lung pressure and
/// no aspiration strength, so the glottis assumes an open tract. Returns
/// the number of periods started.
pub fn run_glottis(seed: u32, parameters: &[f64], data: &mut [f64]) -> usize {
    let mut options = GlottisOptions::new(seed);
    options.tenseness = parameters[0];
    options.breathiness = parameters[1];
    options.jitter = parameters[2];
    options.shimmer = parameters[3];
    options.aspiration_level = parameters[4];
    options.chink = parameters[5];
    options.lung_pressure = parameters[6];
    let dt = parameters[7];
    let control = GlottalControl {
        f0: parameters[8],
        voicing: parameters[9],
        aspiration: parameters[10],
        closure: parameters[11],
        loudness: parameters[12],
        lung_pressure: None,
        aspiration_strength: None,
    };
    let mut glottis = Glottis::new(&options);
    let mut periods = 0;
    for value in data {
        let previous = glottis.phase;
        *value = glottis.step(dt, &control, *value);
        if glottis.phase < previous {
            periods += 1;
        }
    }
    periods
}

/// [`run_glottis`] over the `count` `f64` values at `data` with the 13
/// `f64` parameters at `parameters`. Returns the number of periods or a
/// negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_glottis_run(seed: u32, parameters: u32, data: u32, count: u32) -> i32 {
    // A copy, so the parameters may overlap the data.
    let mut values = [0.0; GLOTTIS_PARAMETERS];
    match f64_slice(parameters, GLOTTIS_PARAMETERS as u32) {
        Ok(slice) => values.copy_from_slice(slice),
        Err(code) => return code,
    }
    match f64_slice(data, count) {
        Ok(slice) => i32::try_from(run_glottis(seed, &values, slice)).unwrap_or(i32::MAX),
        Err(code) => code,
    }
}

/// `new Radiation()` of `radiation.js`, configured for `area` (cm²) at
/// `rate` steps per second, run over the `count` `f64` incident waves at
/// `data`; each is replaced by the reflected wave. Returns 0 or a negative
/// code of [`error`].
#[no_mangle]
pub extern "C" fn vs_radiation_run(area: f64, rate: f64, data: u32, count: u32) -> i32 {
    match f64_slice(data, count) {
        Ok(slice) => {
            let mut radiation = Radiation::new();
            radiation.configure(area, rate);
            for value in slice {
                *value = radiation.process(*value);
            }
            error::OK
        }
        Err(code) => code,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn biquad_runs_in_place() {
        let mut data = [1.0, 0.0, 0.0, 0.0];
        assert!(run_biquad(0, 1000.0, 0.7, 48_000.0, &mut data));
        let mut filter = Biquad::new();
        filter.lowpass(1000.0, 0.7, 48_000.0);
        assert_eq!(data[0], filter.process(1.0));
        assert_eq!(data[1], filter.process(0.0));
        assert!(!run_biquad(3, 1000.0, 0.7, 48_000.0, &mut data));
        assert_eq!(vs_biquad_run(9, 1.0, 1.0, 1.0, 0, 0), error::BAD_ARGUMENT);
        assert_eq!(vs_biquad_run(0, 1.0, 1.0, 1.0, 0, 3), error::NULL);
    }

    #[test]
    fn glottis_counts_periods() {
        let parameters = [
            0.6,
            0.2,
            0.4,
            3.0,
            1.0,
            0.0,
            800.0,
            1.0 / 48_000.0,
            100.0,
            1.0,
            0.0,
            0.0,
            1.0,
        ];
        let mut data = [0.0; 4800];
        let periods = run_glottis(1, &parameters, &mut data);
        assert!((9..=11).contains(&periods), "{periods}");
        assert!(data.iter().any(|value| *value != 0.0));
    }
}
