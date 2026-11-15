//! Exports that run one part of the voice renderer on its own, for the
//! parity tests of `tests/rust-waveguide.test.js`: the biquad, the LF
//! glottis and the waveguide (`docs/RUST-ENGINE.md`).

use voice_simulator_core::filters::Biquad;

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
}
