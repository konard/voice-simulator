//! The Liljencrants-Fant (LF) vocal fold source: a port of
//! `src/acoustics/glottis.js`.
//!
//! Parity class B: the pulse uses `exp`, `sin`, `ln` and `pow` of
//! [`crate::math`], which may round differently from V8. The random draws
//! and the order of every other operation are those of the JavaScript code.

use core::f64::consts::PI;

use crate::aerodynamics::{glottal_area_of, open_tract_strength_at, GlottalAreas, RE_CRITICAL};
use crate::effort::{self, TILT_CORNER};
use crate::math::{self, max, min};
use crate::random::Random;

/// Breath noise per 10 mm² of glottal chink (`CHINK_NOISE`).
pub const CHINK_NOISE: f64 = 0.5;
/// Lung pressure (Pa) of a source that is given none.
pub const DEFAULT_LUNG_PRESSURE: f64 = 800.0;
/// Reflection of the tract at a closed glottis.
pub const GLOTTAL_REFLECTION: f64 = 0.75;
/// Change of the LF shape parameter Rd per unit of breathiness.
pub const BREATHINESS_RD: f64 = 1.5;
/// Breathiness at which the pulse depends on tenseness alone.
pub const BREATHINESS_REFERENCE: f64 = 0.2;
/// Gain of the breath noise against breathiness.
pub const BREATH_GAIN: f64 = 3.87;
/// Exponent of the breath noise against breathiness.
pub const BREATH_EXPONENT: f64 = 2.114;
/// Speed of sound (cm/s), `SPEED_OF_SOUND` of `transfer.js`.
pub const SPEED_OF_SOUND: f64 = 35_000.0;

/// Time constant (s) of the flow cutoff through a glottal chink of `chink`
/// mm² (`chinkTimeConstant`).
pub fn chink_time_constant(chink: f64) -> f64 {
    1.1e-3 * math::sqrt(max(0.0, chink) / 100.0)
}

/// Reflection of the tract at the glottis for a chink of `chink` mm² and a
/// tract of `length` cm (`glottalReflection`).
pub fn glottal_reflection(chink: f64, length: f64) -> f64 {
    let bandwidth = 15.5 * max(0.0, chink);
    GLOTTAL_REFLECTION * math::exp((-2.0 * PI * length * bandwidth) / SPEED_OF_SOUND)
}

/// The LF pulse parameters of `lfParameters`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct LfPulse {
    /// The Rd shape parameter.
    pub rd: f64,
    /// Growth of the open phase.
    pub alpha: f64,
    /// Scale of the open phase.
    pub e0: f64,
    /// Decay of the return phase.
    pub epsilon: f64,
    /// exp(-epsilon (1 - te)).
    pub shift: f64,
    /// 1 - shift.
    pub delta: f64,
    /// Phase of the main excitation.
    pub te: f64,
    /// Angular frequency of the open phase.
    pub omega: f64,
}

/// LF pulse parameters for a `tenseness` and a `breathiness` (`lfParameters`).
pub fn lf_parameters(tenseness: f64, breathiness: f64) -> LfPulse {
    lf_parameters_at(tenseness, breathiness, BREATHINESS_RD)
}

/// [`lf_parameters`] with the change of Rd per unit of breathiness
/// `rd_slope` (`head.breathinessRd`).
pub fn lf_parameters_at(tenseness: f64, breathiness: f64, rd_slope: f64) -> LfPulse {
    let rd = min(
        2.7,
        max(
            0.5,
            3.0 * (1.0 - tenseness) + rd_slope * (breathiness - BREATHINESS_REFERENCE),
        ),
    );
    let ra = -0.01 + 0.048 * rd;
    let rk = 0.224 + 0.118 * rd;
    let rg = ((rk / 4.0) * (0.5 + 1.2 * rk)) / (0.11 * rd - ra * (0.5 + 1.2 * rk));
    let ta = ra;
    let tp = 1.0 / (2.0 * rg);
    let te = tp + tp * rk;
    let epsilon = 1.0 / ta;
    let shift = math::exp(-epsilon * (1.0 - te));
    let delta = 1.0 - shift;
    let return_integral = ((1.0 / epsilon) * (shift - 1.0) + (1.0 - te) * shift) / delta;
    let upper_integral = (te - tp) / 2.0 - return_integral;
    let omega = PI / tp;
    let sine = math::sin(omega * te);
    let y = (-PI * sine * upper_integral) / (tp * 2.0);
    let alpha = math::ln(y) / (tp / 2.0 - te);
    let e0 = -1.0 / (sine * math::exp(alpha * te));
    LfPulse {
        rd,
        alpha,
        e0,
        epsilon,
        shift,
        delta,
        te,
        omega,
    }
}

/// Normalised LF flow derivative at phase `t` in [0, 1) (`lfWaveform`).
pub fn lf_waveform(p: &LfPulse, t: f64) -> f64 {
    if t > p.te {
        return (-math::exp(-p.epsilon * (t - p.te)) + p.shift) / p.delta;
    }
    p.e0 * math::exp(p.alpha * t) * math::sin(p.omega * t)
}

/// The control channels that `Glottis.step` reads.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlottalControl {
    /// Fundamental frequency (Hz).
    pub f0: f64,
    /// Voicing (0 to 1).
    pub voicing: f64,
    /// Aspiration (0 to 1).
    pub aspiration: f64,
    /// Closure (0 to 1).
    pub closure: f64,
    /// Loudness.
    pub loudness: f64,
    /// Lung pressure (Pa), `undefined` in JavaScript when `None`.
    pub lung_pressure: Option<f64>,
    /// Relative turbulence strength at the glottis from the air flow.
    pub aspiration_strength: Option<f64>,
    /// Vocal effort `E` (dB, 0 normal; issue 52): the gain of the voiced
    /// part and its tilt shelf ([`crate::effort`]).
    pub effort: f64,
    /// Offset on the tenseness (issue 52).
    pub tension: f64,
}

/// The options of `new Glottis(options)`, with the defaults of the
/// JavaScript constructor.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct GlottisOptions {
    /// `hashSeed(\`${seed}:glottis\`)`.
    pub seed: u32,
    /// Tenseness (0 lax to 1 pressed).
    pub tenseness: f64,
    /// Breathiness (0 to 1).
    pub breathiness: f64,
    /// Jitter, standard deviation in percent.
    pub jitter: f64,
    /// Shimmer, standard deviation in percent.
    pub shimmer: f64,
    /// Gain of the aspiration noise.
    pub aspiration_level: f64,
    /// Glottal chink (mm²).
    pub chink: f64,
    /// Lung pressure (Pa) when the control gives none.
    pub lung_pressure: f64,
    /// Change of Rd per unit of breathiness (`head.breathinessRd`).
    pub breathiness_rd: f64,
    /// Gain of the breath noise (`head.breathGain`).
    pub breath_gain: f64,
    /// Exponent of the breathiness in the breath noise
    /// (`head.breathExponent`).
    pub breath_exponent: f64,
    /// Noise of the glottal chink (`head.chinkNoise`).
    pub chink_noise: f64,
    /// Critical Reynolds number (`head.reCritical`).
    pub re_critical: f64,
    /// Glottal areas of the head.
    pub areas: GlottalAreas,
}

impl GlottisOptions {
    /// The defaults of the JavaScript constructor for a hashed seed.
    pub fn new(seed: u32) -> Self {
        Self {
            seed,
            tenseness: 0.6,
            breathiness: 0.2,
            jitter: 0.4,
            shimmer: 3.0,
            aspiration_level: 1.0,
            chink: 0.0,
            lung_pressure: DEFAULT_LUNG_PRESSURE,
            breathiness_rd: BREATHINESS_RD,
            breath_gain: BREATH_GAIN,
            breath_exponent: BREATH_EXPONENT,
            chink_noise: CHINK_NOISE,
            re_critical: RE_CRITICAL,
            areas: GlottalAreas::default(),
        }
    }
}

/// The LF glottis (`Glottis` of `glottis.js`).
#[derive(Clone, Debug)]
pub struct Glottis {
    random: Random,
    /// Tenseness of the head.
    pub tenseness: f64,
    /// Breathiness of the head.
    pub breathiness: f64,
    jitter_depth: f64,
    shimmer_depth: f64,
    /// Gain of the aspiration noise.
    pub aspiration_level: f64,
    /// Glottal chink (mm²).
    pub chink: f64,
    chink_time: f64,
    /// Lung pressure (Pa) when the control gives none.
    pub lung_pressure: f64,
    strength_key: [f64; 2],
    strength: f64,
    smoothed: f64,
    /// Time since the start of the period (s).
    pub phase: f64,
    /// Length of the period (s).
    pub period: f64,
    jitter: f64,
    shimmer: f64,
    /// Amplitude of the current pulse.
    pub intensity: f64,
    pulse: LfPulse,
    /// Modulation of the aspiration noise of the last step.
    pub noise_modulation: f64,
    // `breathiness ** breathExponent`, the same value on every step.
    breath_power: f64,
    rd_slope: f64,
    breath_gain: f64,
    chink_noise: f64,
    re_critical: f64,
    areas: GlottalAreas,
    // `1 - exp(-dt / chinkTime)` for the `dt` of the last step.
    chink_dt: f64,
    chink_factor: f64,
    // The voiced gain and the tilt shelf factor of `effort_key` dB.
    effort_key: f64,
    effort_gain: f64,
    tilt_gain: f64,
    // The second-order high-pass of the tilt shelf and its pole for the
    // `dt` of `tilt_step`.
    tilt_step: f64,
    tilt_pole: f64,
    tilt_input: f64,
    tilt_middle: f64,
    tilt_output: f64,
}

impl Glottis {
    /// `new Glottis(options)`.
    pub fn new(options: &GlottisOptions) -> Self {
        let chink = max(0.0, options.chink);
        Self {
            random: Random::new(options.seed),
            tenseness: options.tenseness,
            breathiness: options.breathiness,
            jitter_depth: 0.01 * options.jitter,
            shimmer_depth: 0.01 * options.shimmer,
            aspiration_level: options.aspiration_level,
            chink,
            chink_time: chink_time_constant(chink),
            lung_pressure: options.lung_pressure,
            strength_key: [f64::NAN, f64::NAN],
            strength: 0.0,
            smoothed: 0.0,
            phase: 0.0,
            period: 1.0 / 120.0,
            jitter: 1.0,
            shimmer: 1.0,
            intensity: 0.0,
            pulse: lf_parameters_at(
                options.tenseness,
                options.breathiness,
                options.breathiness_rd,
            ),
            noise_modulation: 0.0,
            breath_power: math::pow(options.breathiness, options.breath_exponent),
            rd_slope: options.breathiness_rd,
            breath_gain: options.breath_gain,
            chink_noise: options.chink_noise,
            re_critical: options.re_critical,
            areas: options.areas,
            chink_dt: f64::NAN,
            chink_factor: 0.0,
            effort_key: 0.0,
            effort_gain: 1.0,
            tilt_gain: 1.0,
            tilt_step: 0.0,
            tilt_pole: 0.0,
            tilt_input: 0.0,
            tilt_middle: 0.0,
            tilt_output: 0.0,
        }
    }

    /// `#effortGains`: the voiced gain and the tilt shelf factor of
    /// `effort` dB, cached.
    fn effort_gains(&mut self, effort: f64) {
        if effort != self.effort_key {
            self.effort_key = effort;
            self.effort_gain = effort::voiced_gain(effort);
            self.tilt_gain = effort::tilt_gain(effort);
        }
    }

    /// `#tilt`: the voiced sample plus `tilt_gain - 1` times its
    /// second-order high-pass at [`TILT_CORNER`]. The high-pass runs at
    /// normal effort too, so that a ramp starts without a step.
    fn tilt(&mut self, voiced: f64, dt: f64, effort: f64) -> f64 {
        if dt != self.tilt_step {
            self.tilt_step = dt;
            self.tilt_pole = 1.0 / (1.0 + 2.0 * PI * TILT_CORNER * dt);
        }
        let pole = self.tilt_pole;
        let middle = pole * (self.tilt_middle + voiced - self.tilt_input);
        self.tilt_output = pole * (self.tilt_output + middle - self.tilt_middle);
        self.tilt_input = voiced;
        self.tilt_middle = middle;
        if effort == 0.0 {
            voiced
        } else {
            voiced + (self.tilt_gain - 1.0) * self.tilt_output
        }
    }

    /// `#noiseGain`: the factor that brings the aspiration of an open
    /// tract to the noise rule of the effort.
    fn noise_gain(control: &GlottalControl) -> f64 {
        let effort = control.effort;
        if effort == 0.0 {
            return 1.0;
        }
        match control.lung_pressure {
            None => math::pow(10.0, effort / 40.0),
            Some(_) => effort::noise_gain(effort),
        }
    }

    fn start_period(&mut self, frequency: f64, tenseness: f64) {
        self.jitter = 1.0 + self.jitter_depth * self.random.normal();
        self.shimmer = 1.0 + self.shimmer_depth * self.random.normal();
        self.period = 1.0 / max(30.0, frequency * self.jitter);
        self.pulse = lf_parameters_at(tenseness, self.breathiness, self.rd_slope);
    }

    fn open_tract_strength(&mut self, control: &GlottalControl) -> f64 {
        let lung = 10.0
            * match control.lung_pressure {
                Some(pressure) => pressure,
                None => self.lung_pressure * math::pow(max(0.0, control.loudness), 2.0 / 3.0),
            };
        let area = glottal_area_of(
            control.voicing,
            control.aspiration,
            control.closure,
            self.breathiness,
            self.chink,
            &self.areas,
        );
        if lung != self.strength_key[0] || area != self.strength_key[1] {
            self.strength_key = [lung, area];
            self.strength = open_tract_strength_at(lung, area, self.re_critical);
        }
        self.strength
    }

    /// Advance by `dt` seconds and return the flow derivative sample;
    /// `noise` is a white noise sample in [-1, 1].
    pub fn step(&mut self, dt: f64, control: &GlottalControl, noise: f64) -> f64 {
        let voicing = max(0.0, control.voicing) * (1.0 - control.closure);
        let loudness = max(0.0, control.loudness);
        let tension = control.tension;
        let base = if tension == 0.0 {
            self.tenseness
        } else {
            min(1.0, max(0.0, self.tenseness + tension))
        };
        let tenseness = max(0.0, base - 0.5 * control.aspiration * voicing);
        self.phase += dt;
        if self.phase >= self.period {
            self.phase -= self.period;
            self.start_period(control.f0, tenseness);
        }
        let t = self.phase / self.period;
        self.intensity = voicing * loudness * self.shimmer;
        let effort = control.effort;
        if effort != 0.0 {
            self.effort_gains(effort);
            self.intensity *= self.effort_gain;
        }
        let mut voiced = lf_waveform(&self.pulse, t) * self.intensity * (0.7 + 0.3 * tenseness);
        if self.chink_time > 0.0 {
            if dt != self.chink_dt {
                self.chink_dt = dt;
                self.chink_factor = 1.0 - math::exp(-dt / self.chink_time);
            }
            self.smoothed += self.chink_factor * (voiced - self.smoothed);
            voiced = self.smoothed;
        }
        voiced = self.tilt(voiced, dt, effort);
        let opening = max(0.0, math::sin(2.0 * PI * t));
        let modulation = if voicing > 0.1 {
            0.3 + 0.7 * opening * min(1.0, voicing)
        } else {
            1.0
        };
        self.noise_modulation = modulation;
        let strength = match control.aspiration_strength {
            Some(strength) => strength,
            None => self.open_tract_strength(control) * Self::noise_gain(control),
        };
        let breath = ((control.aspiration + self.breath_gain * self.breath_power * voicing)
            * (1.0 - control.closure)
            + (self.chink_noise * self.chink) / 10.0)
            * strength;
        voiced + noise * breath * modulation * 0.45 * self.aspiration_level
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn control() -> GlottalControl {
        GlottalControl {
            f0: 120.0,
            voicing: 1.0,
            aspiration: 0.0,
            closure: 0.0,
            loudness: 1.0,
            lung_pressure: None,
            aspiration_strength: None,
            effort: 0.0,
            tension: 0.0,
        }
    }

    #[test]
    fn pulse_is_normalised() {
        let pulse = lf_parameters(0.6, 0.2);
        // The negative peak is at te and about -1.
        let peak = lf_waveform(&pulse, pulse.te);
        assert!((peak + 1.0).abs() < 1e-9, "peak {peak}");
        assert_eq!(lf_waveform(&pulse, 0.0), 0.0);
    }

    #[test]
    fn periods_follow_f0() {
        let mut glottis = Glottis::new(&GlottisOptions::new(1));
        let dt = 1.0 / 48_000.0;
        let mut periods = 0;
        let mut previous = 0.0;
        for _ in 0..48_000 {
            glottis.step(dt, &control(), 0.0);
            if glottis.phase < previous {
                periods += 1;
            }
            previous = glottis.phase;
        }
        assert!((115..=125).contains(&periods), "{periods} periods");
    }

    #[test]
    fn chink_smooths_and_reflection_drops() {
        assert_eq!(glottal_reflection(0.0, 16.5), GLOTTAL_REFLECTION);
        assert!(glottal_reflection(5.0, 16.5) < GLOTTAL_REFLECTION);
        let mut options = GlottisOptions::new(1);
        options.chink = 5.0;
        let mut glottis = Glottis::new(&options);
        let value = glottis.step(1.0 / 48_000.0, &control(), 0.0);
        assert!(value.is_finite());
    }

    #[test]
    fn effort_raises_the_level() {
        let dt = 1.0 / 48_000.0;
        let energy = |effort: f64| {
            let mut glottis = Glottis::new(&GlottisOptions::new(1));
            let mut loud = control();
            loud.effort = effort;
            loud.tension = 0.006 * effort;
            (0..24_000)
                .map(|_| {
                    let value = glottis.step(dt, &loud, 0.0);
                    value * value
                })
                .sum::<f64>()
        };
        let gain = 10.0 * math::ln(energy(10.0) / energy(0.0)) / math::ln(10.0);
        assert!(gain > 5.0 && gain < 15.0, "{gain} dB");
    }
}
