//! Exports that run one part of the voice renderer on its own, for the
//! parity tests of `tests/rust-waveguide.test.js`: the biquad, the LF
//! glottis, the radiation filter and the waveguide (`docs/RUST-ENGINE.md`).

use voice_simulator_core::aerodynamics::GlottalAreas;
use voice_simulator_core::filters::Biquad;
use voice_simulator_core::glottis::{GlottalControl, Glottis, GlottisOptions};
use voice_simulator_core::radiation::Radiation;
use voice_simulator_core::stages::{NoiseSources, OutputStage};
use voice_simulator_core::waveguide::{PiriformBranch, Waveguide, WaveguideOptions};

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
pub const GLOTTIS_PARAMETERS: usize = 21;

/// Runs a glottis seeded with `seed` (`hashSeed` of `'<seed>:glottis'`)
/// over `data`, which holds the white noise on entry and the flow
/// derivative on return. `parameters` are tenseness, breathiness, jitter,
/// shimmer, aspirationLevel, chink, lungPressure, dt, f0, voicing,
/// aspiration, closure and loudness, then the head's breathinessRd,
/// breathGain, breathExponent, chinkNoise, reCritical, glottisVoiced,
/// glottisOpen and glottisBreathy; the control has no lung pressure and
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
    options.breathiness_rd = parameters[13];
    options.breath_gain = parameters[14];
    options.breath_exponent = parameters[15];
    options.chink_noise = parameters[16];
    options.re_critical = parameters[17];
    options.areas = GlottalAreas {
        voiced: parameters[18],
        open: parameters[19],
        breathy: parameters[20],
    };
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

/// [`run_glottis`] over the `count` `f64` values at `data` with the 21
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
/// `rate` steps per second and `baffle` (0 free pipe end, 1 infinite
/// baffle), run over the `count` `f64` incident waves at
/// `data`; each is replaced by the reflected wave. Returns 0 or a negative
/// code of [`error`].
#[no_mangle]
pub extern "C" fn vs_radiation_run(
    area: f64,
    rate: f64,
    baffle: f64,
    data: u32,
    count: u32,
) -> i32 {
    match f64_slice(data, count) {
        Ok(slice) => {
            let mut radiation = Radiation::new();
            radiation.configure(area, rate, baffle);
            for value in slice {
                *value = radiation.process(*value);
            }
            error::OK
        }
        Err(code) => code,
    }
}

/// Fixed `f64` parameters of [`vs_waveguide_run`] before the areas.
pub const WAVEGUIDE_PARAMETERS: usize = 16;

/// Runs a waveguide over `data`, which holds the glottal flow derivative
/// on entry and the radiated output on return. `parameters` are sections,
/// noseSections, wallLoss, nasalLoss, glottalChink, vocalTractLength, the
/// piriform index, area and sections, velumArea, velumIndex, wallMass,
/// wallResistance, wallStiffness, lossShape and radiationBaffle, then the
/// `sections` oral areas and the nose profile (`setNose`; may be empty).
/// Returns false if the parameters do not fit.
pub fn run_waveguide(parameters: &[f64], data: &mut [f64]) -> bool {
    let Some(header) = parameters.get(..WAVEGUIDE_PARAMETERS) else {
        return false;
    };
    let sections = header[0] as usize;
    let nose_sections = header[1] as usize;
    let piriform_index = header[6] as usize;
    let velum_index = header[10];
    if sections < 3
        || parameters.len() < WAVEGUIDE_PARAMETERS + sections
        || piriform_index == 0
        || piriform_index >= sections
    {
        return false;
    }
    let options = WaveguideOptions {
        sections,
        nose_sections,
        wall_loss: header[2],
        nasal_loss: header[3],
        wall_mass: header[11],
        wall_resistance: header[12],
        wall_stiffness: header[13],
        glottal_chink: header[4],
        vocal_tract_length: header[5],
        piriform: PiriformBranch {
            index: piriform_index,
            area: header[7],
            sections: header[8] as usize,
        },
        loss_shape: header[14],
        baffle: header[15],
    };
    let mut waveguide = Waveguide::new(&options);
    let (areas, nose) = parameters[WAVEGUIDE_PARAMETERS..].split_at(sections);
    if !nose.is_empty() {
        waveguide.set_nose(nose);
    }
    waveguide.set_areas(areas, header[9], velum_index);
    for value in data {
        *value = waveguide.advance(*value, 1.0, 0.0, 0.0);
    }
    true
}

/// [`run_waveguide`] with the `parameter_count` `f64` parameters at
/// `parameters` over the `count` `f64` values at `data`. Returns 0 or a
/// negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_waveguide_run(
    parameters: u32,
    parameter_count: u32,
    data: u32,
    count: u32,
) -> i32 {
    let values = match f64_slice(parameters, parameter_count) {
        Ok(slice) => slice.to_vec(),
        Err(code) => return code,
    };
    match f64_slice(data, count) {
        Ok(slice) => {
            if run_waveguide(&values, slice) {
                error::OK
            } else {
                error::BAD_ARGUMENT
            }
        }
        Err(code) => code,
    }
}

/// Runs the noise sources and the output stage of the renderer over
/// `data`: for each value, `white` → aspiration band-pass and a second
/// `white` → frication band-pass (tuned to `frequency`) are added to it,
/// the sum goes through `filter` and `finish`. `seed` is
/// `hashSeed('<seed>:noise')`, `band_limit` 0 for none; both stages are
/// configured for the step `rate`.
pub fn run_stages(
    seed: u32,
    sample_rate: f64,
    gain: f64,
    band_limit: f64,
    rate: f64,
    frequency: f64,
    data: &mut [f64],
) {
    let mut noise = NoiseSources::new(seed);
    let limit = if band_limit > 0.0 {
        Some(band_limit)
    } else {
        None
    };
    let mut output = OutputStage::new(sample_rate, gain, limit);
    noise.configure(rate);
    noise.tune(frequency);
    output.configure(rate);
    for value in data {
        let white = noise.white.white();
        let aspiration = noise.aspiration.process(white);
        let white = noise.white.white();
        let frication = noise.frication.process(white);
        let filtered = output.filter(*value + aspiration + frication);
        *value = output.finish(filtered);
    }
}

/// [`run_stages`] over the `count` `f64` values at `data`. Returns 0 or a
/// negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_stages_run(
    seed: u32,
    sample_rate: f64,
    gain: f64,
    band_limit: f64,
    rate: f64,
    frequency: f64,
    data: u32,
    count: u32,
) -> i32 {
    match f64_slice(data, count) {
        Ok(slice) => {
            run_stages(seed, sample_rate, gain, band_limit, rate, frequency, slice);
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
            1.5,
            3.87,
            2.114,
            0.5,
            1800.0,
            0.05,
            0.25,
            0.1,
        ];
        let mut data = [0.0; 4800];
        let periods = run_glottis(1, &parameters, &mut data);
        assert!((9..=11).contains(&periods), "{periods}");
        assert!(data.iter().any(|value| *value != 0.0));
    }
}
