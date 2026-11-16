//! The voice renderer, with the 1D waveguide or the 3D FDTD solver: a port of `#step`, `#record` and
//! `#finish` of `VoiceRenderer` (`src/acoustics/voice.js`).
//!
//! The JavaScript side samples the plan and computes the tract shape of
//! every control block; it hands the renderer one frame per block (see
//! [`crate::frame`]). The renderer runs the sources, the air flow, the
//! solver, the output filter, the listener and the limiter. It filters
//! every solver output as soon as it is computed, at the rate of the block
//! that computed it, which is what `#finish` does with its list of rates;
//! so the samples do not depend on how the render is split into calls.

use alloc::boxed::Box;
use alloc::sync::Arc;
use alloc::vec::Vec;

use crate::aerodynamics::{
    aspiration_reference, frication_reference, glottal_area_of, source_strength_at,
    strouhal_frequency_at, Aerodynamics, GlottalAreas,
};
use crate::config;
use crate::effort;
use crate::fdtd::model::Model;
use crate::fdtd::parallel::Team;
use crate::fdtd::solver::{Fdtd3d, FdtdOptions, Output};
use crate::frame;
use crate::glottis::{noise_breathiness, GlottalControl, Glottis, GlottisOptions};
use crate::listener::Listener;
use crate::math::{self, max};
use crate::solver::Solver;
use crate::source_state;
use crate::stages::{NoiseSources, OutputStage};
use crate::waveguide::{PiriformBranch, Waveguide, WaveguideOptions};

/// Amplitude of the frication noise of a default voiceless fricative.
pub const FRICATION_GAIN: f64 = 0.592;
/// Amplitude of the wall source against the obstacle source (-15 dB).
pub const WALL_SOURCE: f64 = 0.18;
/// Gain of the burst transient.
pub const TRANSIENT_GAIN: f64 = 5e-6;
/// Most sections the renderer accepts.
pub const MAX_SECTIONS: usize = 4096;

/// Why a configuration or a render call was refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum RenderError {
    /// The configuration array is malformed.
    Config,
    /// Fewer frames than control blocks start in the call.
    TooFewFrames,
    /// A frame holds a value the solver cannot take (not finite, or a
    /// tract length that is not positive).
    Frame,
    /// The voxel model of the 3D solver is malformed or has no free-air
    /// cell for the receiver.
    Model,
}

/// What the renderer reads from the configuration besides the solver.
#[derive(Clone, Copy, Debug, PartialEq)]
struct Settings {
    sample_rate: f64,
    sections: usize,
    block_size: usize,
    total_samples: usize,
    breathiness: f64,
    glottal_chink: f64,
    frication_level: f64,
    // The advanced source values of the head (issue 41).
    oral_compliance: f64,
    re_critical: f64,
    areas: GlottalAreas,
    wall_source: f64,
    strouhal: f64,
    frication_gain: f64,
    transient_gain: f64,
}

/// `value` as a whole number in `low..=high` (`low` is never negative, so
/// `floor` tests for a whole number).
fn count(value: f64, low: usize, high: usize) -> Result<usize, RenderError> {
    if value.is_finite()
        && value >= low as f64
        && value <= high as f64
        && value == math::floor(value)
    {
        Ok(value as usize)
    } else {
        Err(RenderError::Config)
    }
}

fn finite(value: f64) -> Result<f64, RenderError> {
    if value.is_finite() {
        Ok(value)
    } else {
        Err(RenderError::Config)
    }
}

/// The voice renderer with the solver `S`.
#[derive(Clone, Debug)]
pub struct Renderer<S: Solver = Waveguide> {
    solver: S,
    glottis: Glottis,
    noise: NoiseSources,
    aerodynamics: Aerodynamics,
    output: OutputStage,
    listener: Listener,
    settings: Settings,
    aspiration_reference: f64,
    frication_reference: f64,
    control: GlottalControl,
    frication_position: f64,
    frication_amplitude: f64,
    transient: f64,
    transient_step: f64,
    step_duration: f64,
    has_shape: bool,
    time: f64,
    position: usize,
    solver_time: f64,
    previous: f64,
    current: f64,
}

/// The parts of a renderer every solver shares, read from the
/// configuration header.
struct Common<'a> {
    header: &'a [f64],
    nose: &'a [f64],
    settings: Settings,
    vocal_tract_length: f64,
    glottis: Glottis,
    noise: NoiseSources,
    output: OutputStage,
    listener: Listener,
}

impl<'a> Common<'a> {
    fn parse(values: &'a [f64]) -> Result<Self, RenderError> {
        let header = values.get(..config::HEADER).ok_or(RenderError::Config)?;
        let sections = count(header[config::SECTIONS], 3, MAX_SECTIONS)?;
        count(header[config::NOSE_SECTIONS], 1, MAX_SECTIONS)?;
        let nose_count = count(header[config::NOSE_AREA_COUNT], 0, MAX_SECTIONS)?;
        let listener_length = count(header[config::LISTENER_LENGTH], 0, usize::MAX >> 8)?;
        if values.len() != config::HEADER + nose_count + listener_length {
            return Err(RenderError::Config);
        }
        let nose = &values[config::HEADER..config::HEADER + nose_count];
        let listener_values = &values[config::HEADER + nose_count..];
        let sample_rate = finite(header[config::SAMPLE_RATE])?;
        if sample_rate <= 0.0 {
            return Err(RenderError::Config);
        }
        let settings = Settings {
            sample_rate,
            sections,
            block_size: count(header[config::BLOCK_SIZE], 1, 1 << 20)?,
            total_samples: count(header[config::TOTAL_SAMPLES], 0, u32::MAX as usize)?,
            breathiness: finite(header[config::BREATHINESS])?,
            glottal_chink: finite(header[config::GLOTTAL_CHINK])?,
            frication_level: finite(header[config::FRICATION_LEVEL])?,
            oral_compliance: finite(header[config::ORAL_COMPLIANCE])?,
            re_critical: finite(header[config::RE_CRITICAL])?,
            areas: GlottalAreas {
                voiced: finite(header[config::GLOTTIS_VOICED])?,
                open: finite(header[config::GLOTTIS_OPEN])?,
                breathy: finite(header[config::GLOTTIS_BREATHY])?,
            },
            wall_source: finite(header[config::WALL_SOURCE])?,
            strouhal: finite(header[config::STROUHAL])?,
            frication_gain: finite(header[config::FRICATION_GAIN])?,
            transient_gain: finite(header[config::TRANSIENT_GAIN])?,
        };
        let vocal_tract_length = finite(header[config::VOCAL_TRACT_LENGTH])?;
        if vocal_tract_length <= 0.0 {
            return Err(RenderError::Config);
        }
        let mut glottis_options = GlottisOptions::new(seed(header[config::GLOTTIS_SEED])?);
        glottis_options.tenseness = finite(header[config::TENSENESS])?;
        glottis_options.breathiness = settings.breathiness;
        glottis_options.jitter = finite(header[config::JITTER])?;
        glottis_options.shimmer = finite(header[config::SHIMMER])?;
        glottis_options.aspiration_level = finite(header[config::ASPIRATION_LEVEL])?;
        glottis_options.chink = settings.glottal_chink;
        glottis_options.lung_pressure = finite(header[config::LUNG_PRESSURE])?;
        glottis_options.breathiness_rd = finite(header[config::BREATHINESS_RD])?;
        glottis_options.breath_gain = finite(header[config::BREATH_GAIN])?;
        glottis_options.breath_exponent = finite(header[config::BREATH_EXPONENT])?;
        glottis_options.chink_noise = finite(header[config::CHINK_NOISE])?;
        glottis_options.re_critical = settings.re_critical;
        glottis_options.areas = settings.areas;
        let band_limit = finite(header[config::BAND_LIMIT])?;
        let output = OutputStage::new(
            sample_rate,
            finite(header[config::OUTPUT_GAIN])?,
            if band_limit > 0.0 {
                Some(band_limit)
            } else {
                None
            },
        );
        Ok(Self {
            header,
            nose,
            settings,
            vocal_tract_length,
            glottis: Glottis::new(&glottis_options),
            noise: NoiseSources::new(seed(header[config::NOISE_SEED])?),
            output,
            listener: Listener::new(listener_values).ok_or(RenderError::Config)?,
        })
    }

    fn renderer<S: Solver>(self, solver: S) -> Renderer<S> {
        Renderer::with_solver(
            solver,
            self.glottis,
            self.noise,
            self.output,
            self.listener,
            self.settings,
        )
    }
}

impl Renderer<Waveguide> {
    /// A renderer for the configuration `values` (see [`crate::config`]).
    pub fn new(values: &[f64]) -> Result<Self, RenderError> {
        let common = Common::parse(values)?;
        let header = common.header;
        let sections = common.settings.sections;
        let piriform_sections = count(header[config::PIRIFORM_SECTIONS], 0, MAX_SECTIONS)?;
        let piriform_index = count(header[config::PIRIFORM_INDEX], 0, sections - 1)?;
        if piriform_sections > 0 && piriform_index == 0 {
            return Err(RenderError::Config);
        }
        let mut solver = Waveguide::new(&WaveguideOptions {
            sections,
            nose_sections: count(header[config::NOSE_SECTIONS], 1, MAX_SECTIONS)?,
            wall_loss: finite(header[config::WALL_LOSS])?,
            nasal_loss: finite(header[config::NASAL_LOSS])?,
            wall_mass: finite(header[config::WALL_MASS])?,
            wall_resistance: finite(header[config::WALL_RESISTANCE])?,
            wall_stiffness: finite(header[config::WALL_STIFFNESS])?,
            glottal_chink: common.settings.glottal_chink,
            vocal_tract_length: common.vocal_tract_length,
            loss_shape: finite(header[config::LOSS_SHAPE])?,
            baffle: finite(header[config::RADIATION_BAFFLE])?,
            piriform: PiriformBranch {
                index: piriform_index,
                area: finite(header[config::PIRIFORM_AREA])?,
                sections: piriform_sections,
            },
        });
        if !common.nose.is_empty() {
            solver.set_nose(common.nose);
        }
        Ok(common.renderer(solver))
    }
}

impl Renderer<Fdtd3d> {
    /// A renderer with the 3D solver for the configuration `values` and
    /// the voxel model `model` (`packVoxelModel` of
    /// `src/engine/pack-model.js`).
    pub fn new_fdtd(values: &[f64], model: &[u8]) -> Result<Self, RenderError> {
        let common = Common::parse(values)?;
        let header = common.header;
        let flag = |value: f64| match value {
            0.0 => Ok(false),
            1.0 => Ok(true),
            _ => Err(RenderError::Config),
        };
        let options = FdtdOptions {
            output: if flag(header[config::FDTD_OUTPUT])? {
                Output::Microphone
            } else {
                Output::Flow
            },
            spherical: flag(header[config::FDTD_SPHERICAL])?,
            target: [
                finite(header[config::MICROPHONE_X])?,
                finite(header[config::MICROPHONE_Y])?,
                finite(header[config::MICROPHONE_Z])?,
            ],
            wall_loss: finite(header[config::WALL_LOSS])?,
            nasal_loss: finite(header[config::NASAL_LOSS])?,
            glottal_chink: common.settings.glottal_chink,
            vocal_tract_length: common.vocal_tract_length,
            length_scale: finite(header[config::LENGTH_SCALE])?,
        };
        let model = Model::unpack(model).map_err(|_| RenderError::Model)?;
        let mut solver = Fdtd3d::new(model, &options).ok_or(RenderError::Model)?;
        if !common.nose.is_empty() {
            solver.set_nose(common.nose);
        }
        Ok(common.renderer(solver))
    }
}

/// A renderer with the solver `config::SOLVER` names.
#[derive(Clone, Debug)]
pub enum AnyRenderer {
    /// The 1D waveguide.
    Waveguide(Box<Renderer<Waveguide>>),
    /// The 3D FDTD solver.
    Fdtd3d(Box<Renderer<Fdtd3d>>),
}

/// Runs `$body` with `$renderer` bound to the renderer inside `$any`.
macro_rules! dispatch {
    ($any:expr, $renderer:ident => $body:expr) => {
        match $any {
            AnyRenderer::Waveguide($renderer) => $body,
            AnyRenderer::Fdtd3d($renderer) => $body,
        }
    };
}

impl AnyRenderer {
    /// A renderer for the configuration `values`; `model` is the packed
    /// voxel model of the 3D solver and is ignored by the waveguide.
    pub fn new(values: &[f64], model: &[u8]) -> Result<Self, RenderError> {
        let solver = values
            .get(config::SOLVER)
            .copied()
            .ok_or(RenderError::Config)?;
        if solver == config::SOLVER_WAVEGUIDE {
            Renderer::new(values).map(|renderer| Self::Waveguide(Box::new(renderer)))
        } else if solver == config::SOLVER_FDTD3D {
            Renderer::new_fdtd(values, model).map(|renderer| Self::Fdtd3d(Box::new(renderer)))
        } else {
            Err(RenderError::Config)
        }
    }

    /// [`Renderer::position`].
    pub fn position(&self) -> usize {
        dispatch!(self, renderer => renderer.position())
    }

    /// [`Renderer::total_samples`].
    pub fn total_samples(&self) -> usize {
        dispatch!(self, renderer => renderer.total_samples())
    }

    /// [`Renderer::seek`].
    pub fn seek(&mut self, seconds: f64) -> Result<(), RenderError> {
        dispatch!(self, renderer => renderer.seek(seconds))
    }

    /// [`Renderer::sources_save`].
    pub fn sources_save(&self) -> [f64; source_state::LENGTH] {
        dispatch!(self, renderer => renderer.sources_save())
    }

    /// [`Renderer::sources_restore`].
    pub fn sources_restore(&mut self, state: &[f64; source_state::LENGTH]) {
        dispatch!(self, renderer => renderer.sources_restore(state));
    }

    /// [`Renderer::frame_stride`].
    pub fn frame_stride(&self) -> usize {
        dispatch!(self, renderer => renderer.frame_stride())
    }

    /// [`Renderer::blocks`].
    pub fn blocks(&self, samples: usize) -> usize {
        dispatch!(self, renderer => renderer.blocks(samples))
    }

    /// [`Renderer::render`].
    pub fn render(&mut self, frames: &[f64], out: &mut [f32]) -> Result<usize, RenderError> {
        dispatch!(self, renderer => renderer.render(frames, out))
    }

    /// [`Renderer::field`].
    pub fn field(&self, out: &mut [f64]) -> usize {
        dispatch!(self, renderer => renderer.field(out))
    }

    /// Steps the 3D solver with a new thread team of `threads` and returns
    /// it, or returns `None` and leaves the renderer on one thread: the
    /// waveguide, one thread, or a grid below
    /// [`crate::fdtd::parallel::THREAD_MIN_LINKS`] links (see
    /// [`Fdtd3d::new_team`]). The caller runs the helpers of the team and
    /// calls [`Team::finish`] after the last render with it.
    pub fn start_team(&mut self, threads: usize) -> Option<Arc<Team>> {
        self.start_team_from(threads, crate::fdtd::parallel::THREAD_MIN_LINKS)
    }

    /// [`AnyRenderer::start_team`] with `min_links` in place of
    /// [`crate::fdtd::parallel::THREAD_MIN_LINKS`] (see
    /// [`Fdtd3d::new_team_from`]).
    pub fn start_team_from(&mut self, threads: usize, min_links: usize) -> Option<Arc<Team>> {
        let Self::Fdtd3d(renderer) = self else {
            return None;
        };
        let team = renderer.solver().new_team_from(threads, min_links)?;
        renderer.solver_mut().set_team(Some(Arc::clone(&team)));
        Some(team)
    }

    /// Back to one thread (after [`Team::finish`] of the team, if any).
    pub fn stop_team(&mut self) {
        if let Self::Fdtd3d(renderer) = self {
            renderer.solver_mut().set_team(None);
        }
    }

    /// [`Fdtd3d::kernel_steps`] of the 3D solver; `false` for the
    /// waveguide, which has no grid.
    pub fn kernel_steps(&mut self, count: usize) -> bool {
        match self {
            Self::Waveguide(_) => false,
            Self::Fdtd3d(renderer) => {
                renderer.solver_mut().kernel_steps(count);
                true
            }
        }
    }

    /// Links and cells of the grid of the 3D solver, `(0, 0)` for the
    /// waveguide.
    pub fn grid_size(&self) -> (usize, usize) {
        match self {
            Self::Waveguide(_) => (0, 0),
            Self::Fdtd3d(renderer) => {
                let grid = renderer.solver().grid();
                (grid.links(), grid.cells())
            }
        }
    }

    /// Threads that step the solver: 1 but with a team.
    pub fn threads(&self) -> usize {
        match self {
            Self::Waveguide(_) => 1,
            Self::Fdtd3d(renderer) => renderer.solver().threads(),
        }
    }
}

fn seed(value: f64) -> Result<u32, RenderError> {
    count(value, 0, u32::MAX as usize).map(|seed| seed as u32)
}

impl<S: Solver> Renderer<S> {
    fn with_solver(
        solver: S,
        glottis: Glottis,
        noise: NoiseSources,
        output: OutputStage,
        listener: Listener,
        settings: Settings,
    ) -> Self {
        Self {
            solver,
            glottis,
            noise,
            aerodynamics: Aerodynamics::new(settings.oral_compliance),
            output,
            listener,
            settings,
            aspiration_reference: aspiration_reference(),
            frication_reference: frication_reference(),
            control: GlottalControl {
                f0: 0.0,
                voicing: 0.0,
                aspiration: 0.0,
                closure: 0.0,
                loudness: 0.0,
                lung_pressure: None,
                aspiration_strength: Some(0.0),
                effort: 0.0,
                tension: 0.0,
                breath: 0.0,
                creak: 0.0,
                falsetto: 0.0,
                harsh: 0.0,
            },
            frication_position: 1.0,
            frication_amplitude: 0.0,
            transient: 0.0,
            transient_step: 0.0,
            step_duration: 0.0,
            has_shape: false,
            time: 0.0,
            position: 0,
            solver_time: 0.0,
            previous: 0.0,
            current: 0.0,
        }
    }

    /// Samples rendered so far.
    pub fn position(&self) -> usize {
        self.position
    }

    /// Samples of the whole render.
    pub fn total_samples(&self) -> usize {
        self.settings.total_samples
    }

    /// Start at `seconds` into the utterance (`startTime` of the
    /// JavaScript renderers, issue 29): the position becomes the nearest
    /// sample (`Math.round`), the clock and the solver clock its time, and
    /// the next render takes a frame for the block it starts in. The
    /// solver and the listener keep their state, which is silence for a
    /// renderer that has not rendered yet. [`RenderError::Config`] for a
    /// time that is negative, not finite or past the end.
    #[allow(
        clippy::cast_possible_truncation,
        clippy::cast_sign_loss,
        clippy::cast_precision_loss
    )]
    pub fn seek(&mut self, seconds: f64) -> Result<(), RenderError> {
        let rate = self.settings.sample_rate;
        let position = math::round_half_up(seconds * rate);
        if !position.is_finite() || position < 0.0 || position > self.settings.total_samples as f64
        {
            return Err(RenderError::Config);
        }
        self.position = position as usize;
        self.time = position / rate;
        self.solver_time = self.time;
        self.has_shape = false;
        Ok(())
    }

    /// `saveSources()`: the glottis state in the order of
    /// [`crate::source_state`]. The noise sources are not part of it.
    pub fn sources_save(&self) -> [f64; source_state::LENGTH] {
        self.glottis.save_state()
    }

    /// `restoreSources(state)`: take over the glottis state that
    /// [`Renderer::sources_save`] of another renderer returned.
    pub fn sources_restore(&mut self, state: &[f64; source_state::LENGTH]) {
        self.glottis.restore_state(state);
    }

    /// Values of one frame.
    pub fn frame_stride(&self) -> usize {
        frame::stride(self.settings.sections)
    }

    /// The solver.
    pub fn solver(&self) -> &S {
        &self.solver
    }

    /// The solver, to change how it runs (its thread team), not what it
    /// computes.
    pub fn solver_mut(&mut self) -> &mut S {
        &mut self.solver
    }

    /// Control blocks that start within the next `samples` samples (at
    /// most up to the end): the number of frames `render` needs.
    pub fn blocks(&self, samples: usize) -> usize {
        let block = self.settings.block_size;
        let count = samples.min(self.settings.total_samples - self.position);
        if count == 0 {
            return 0;
        }
        let start = self.position;
        let first = start.div_ceil(block) * block;
        let end = start + count;
        let aligned = if first < end {
            (end - 1 - first) / block + 1
        } else {
            0
        };
        aligned + usize::from(!self.has_shape && !start.is_multiple_of(block))
    }

    /// Render the next `out.len()` samples (fewer at the end) with one
    /// frame per control block that starts in the call; returns the
    /// number of samples written.
    pub fn render(&mut self, frames: &[f64], out: &mut [f32]) -> Result<usize, RenderError> {
        let stride = self.frame_stride();
        let needed = self.blocks(out.len());
        if frames.len() < needed * stride {
            return Err(RenderError::TooFewFrames);
        }
        for frame in frames[..needed * stride].chunks_exact(stride) {
            check_frame(frame)?;
        }
        let count = out.len().min(self.settings.total_samples - self.position);
        let block = self.settings.block_size;
        let output_step = 1.0 / self.settings.sample_rate;
        let mut frames = frames.chunks_exact(stride);
        let mut written = 0;
        while written < count {
            let offset = self.position % block;
            if offset == 0 || !self.has_shape {
                let frame = frames.next().ok_or(RenderError::TooFewFrames)?;
                self.update_shape(frame);
            }
            let block_end = count.min(written + block - offset);
            for sample in &mut out[written..block_end] {
                while self.solver_time <= self.time {
                    self.previous = self.current;
                    self.current = self.step();
                    self.solver_time += self.step_duration;
                }
                let fraction = 1.0 - (self.solver_time - self.time) / self.step_duration;
                let value = self.previous + (self.current - self.previous) * fraction;
                let heard = self.listener.process(value);
                *sample = self.output.finish(heard) as f32;
                self.time += output_step;
            }
            self.position += block_end - written;
            written = block_end;
        }
        Ok(written)
    }

    /// Acoustic pressure of the solver into `out` (see [`Solver::field`]).
    pub fn field(&self, out: &mut [f64]) -> usize {
        self.solver.field(out)
    }

    fn update_shape(&mut self, frame: &[f64]) {
        self.has_shape = true;
        self.solver.set_shape(frame);
        self.step_duration = self.solver.step_duration();
        let rate = 1.0 / self.step_duration;
        self.noise.configure(rate);
        self.control.f0 = frame[frame::F0];
        self.control.voicing = frame[frame::VOICING];
        self.control.aspiration = frame[frame::ASPIRATION];
        self.control.closure = frame[frame::CLOSURE];
        self.control.loudness = frame[frame::LOUDNESS];
        self.control.effort = frame[frame::EFFORT];
        self.control.tension = frame[frame::TENSION];
        self.control.breath = frame[frame::BREATH];
        self.control.creak = frame[frame::CREAK];
        self.control.falsetto = frame[frame::FALSETTO];
        self.control.harsh = frame[frame::HARSH];
        self.frication_position = frame[frame::FRICATION_POSITION];
        self.update_airflow(frame, rate);
        self.output.configure(rate);
    }

    /// `#updateAirflow`: mouth pressure, flow, the source strengths and
    /// the burst transient of this control block.
    fn update_airflow(&mut self, frame: &[f64], rate: f64) {
        let settings = self.settings;
        let block_duration = settings.block_size as f64 / settings.sample_rate;
        let control = &self.control;
        let opening = glottal_area_of(
            control.voicing,
            control.aspiration,
            control.closure,
            noise_breathiness(settings.breathiness, control.breath, 0.0),
            settings.glottal_chink,
            &settings.areas,
        );
        let frication_area = frame[frame::FRICATION_AREA];
        let constriction = frication_area + frame[frame::VELUM_AREA];
        let air = self.aerodynamics.step(
            block_duration,
            10.0 * frame[frame::LUNG_PRESSURE],
            opening,
            constriction,
        );
        let re_critical = settings.re_critical;
        // The effort raises the lung pressure; the noise follows its own rule.
        let effort = frame[frame::EFFORT];
        let noise_gain = effort::noise_gain(effort);
        self.control.aspiration_strength = Some(
            (source_strength_at(air.glottal_drop, opening, air.flow, re_critical)
                / self.aspiration_reference)
                * noise_gain,
        );
        let strength =
            source_strength_at(air.constriction_drop, frication_area, air.flow, re_critical)
                / self.frication_reference;
        self.frication_amplitude = frame[frame::FRICATION_GAIN]
            * settings.frication_level
            * strength
            * settings.frication_gain
            * noise_gain;
        if self.frication_amplitude > 1e-6 {
            self.noise.tune(strouhal_frequency_at(
                air.flow,
                constriction,
                settings.strouhal,
            ));
            let obstacle = frame[frame::FRICATION_OBSTACLE];
            self.frication_amplitude *= obstacle + settings.wall_source * (1.0 - obstacle);
        }
        let target = air.flow_derivative * settings.transient_gain * effort::transient_gain(effort);
        let steps = max(1.0, block_duration * rate);
        self.transient_step = (target - self.transient) / steps;
    }

    /// `#step`: one solver step with the sources of this instant, through
    /// the output low-pass.
    #[inline]
    fn step(&mut self) -> f64 {
        let white = self.noise.white.white();
        let aspiration = self.noise.aspiration.process(white);
        let source = self
            .glottis
            .step(self.step_duration, &self.control, aspiration);
        let white = self.noise.white.white();
        let amplitude = self.frication_amplitude;
        let noise = if amplitude <= 1e-6 {
            0.0
        } else {
            self.noise.frication.process(white) * amplitude
        };
        let mut flow = 0.0;
        if self.transient_step != 0.0 || self.transient != 0.0 {
            self.transient += self.transient_step;
            flow = self.transient;
        }
        let output = self
            .solver
            .step(source, self.frication_position, noise, flow);
        self.output.filter(output)
    }
}

/// Refuses frames the solver cannot take: fields that are not finite and
/// tract lengths that are not positive (they would stop the step clock).
fn check_frame(frame: &[f64]) -> Result<(), RenderError> {
    let finite = frame.iter().all(|value| value.is_finite());
    if finite && frame[frame::LENGTH] > 0.0 && frame[frame::EXTRA] == frame::EXTRA_VALUES as f64 {
        Ok(())
    } else {
        Err(RenderError::Frame)
    }
}

/// The frames of `blocks` control blocks of a still tract: for tests and
/// benchmarks of the renderer itself.
pub fn steady_frames(sections: usize, blocks: usize, frame_values: &[f64]) -> Vec<f64> {
    let stride = frame::stride(sections);
    let mut frames = Vec::with_capacity(stride * blocks);
    for _ in 0..blocks {
        frames.extend_from_slice(&frame_values[..stride]);
    }
    frames
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    fn configuration(total: usize) -> Vec<f64> {
        let mut values = vec![0.0; config::HEADER];
        values[config::SAMPLE_RATE] = 22_050.0;
        values[config::SECTIONS] = 22.0;
        values[config::NOSE_SECTIONS] = 14.0;
        values[config::BLOCK_SIZE] = 32.0;
        values[config::TOTAL_SAMPLES] = total as f64;
        values[config::GLOTTIS_SEED] = 7.0;
        values[config::NOISE_SEED] = 8.0;
        values[config::TENSENESS] = 0.6;
        values[config::BREATHINESS] = 0.2;
        values[config::JITTER] = 0.4;
        values[config::SHIMMER] = 3.0;
        values[config::ASPIRATION_LEVEL] = 1.0;
        values[config::LUNG_PRESSURE] = 800.0;
        values[config::VOCAL_TRACT_LENGTH] = 16.5;
        values[config::FRICATION_LEVEL] = 1.0;
        values[config::OUTPUT_GAIN] = 1.0;
        values[config::WALL_LOSS] = 1.0;
        values[config::NASAL_LOSS] = 3.0;
        values[config::PHARYNX_WIDTH] = 1.0;
        values[config::PIRIFORM] = 1.0;
        values[config::TEETH] = 1.0;
        values[config::PIRIFORM_INDEX] = 3.0;
        values[config::PIRIFORM_AREA] = 0.5;
        values[config::PIRIFORM_SECTIONS] = 3.0;
        values[config::WALL_MASS] = crate::losses::WALL_MASS;
        values[config::WALL_RESISTANCE] = crate::losses::WALL_RESISTANCE;
        values[config::WALL_STIFFNESS] = crate::losses::WALL_STIFFNESS;
        values[config::BREATH_GAIN] = crate::glottis::BREATH_GAIN;
        values[config::BREATH_EXPONENT] = crate::glottis::BREATH_EXPONENT;
        values[config::BREATHINESS_RD] = crate::glottis::BREATHINESS_RD;
        values[config::CHINK_NOISE] = crate::glottis::CHINK_NOISE;
        values[config::ORAL_COMPLIANCE] = crate::aerodynamics::ORAL_COMPLIANCE;
        values[config::RE_CRITICAL] = crate::aerodynamics::RE_CRITICAL;
        values[config::GLOTTIS_VOICED] = crate::aerodynamics::GLOTTIS_VOICED;
        values[config::GLOTTIS_OPEN] = crate::aerodynamics::GLOTTIS_OPEN;
        values[config::GLOTTIS_BREATHY] = crate::aerodynamics::GLOTTIS_BREATHY;
        values[config::WALL_SOURCE] = WALL_SOURCE;
        values[config::STROUHAL] = crate::aerodynamics::STROUHAL;
        values[config::FRICATION_GAIN] = FRICATION_GAIN;
        values[config::TRANSIENT_GAIN] = TRANSIENT_GAIN;
        values[config::LOSS_SHAPE] = crate::losses::LOSS_SHAPE;
        values[config::RADIATION_BAFFLE] = crate::radiation::RADIATION_BAFFLE;
        values[config::LENGTH_SCALE] = 1.0;
        values
    }

    fn vowel() -> Vec<f64> {
        let mut frame = vec![3.0; frame::stride(22)];
        frame[..frame::STRIDE].fill(0.0);
        frame[frame::LENGTH] = 16.5;
        frame[frame::VELUM_INDEX] = 10.0;
        frame[frame::FRICATION_INDEX] = 14.0;
        frame[frame::FRICATION_POSITION] = 15.0;
        frame[frame::FRICATION_AREA] = 3.0;
        frame[frame::F0] = 120.0;
        frame[frame::VOICING] = 1.0;
        frame[frame::LOUDNESS] = 1.0;
        frame[frame::LUNG_PRESSURE] = 800.0;
        frame[frame::EXTRA] = frame::EXTRA_VALUES as f64;
        frame
    }

    #[test]
    fn renders_a_vowel_in_any_chunks() {
        let total = 3000;
        let frames = steady_frames(22, 100, &vowel());
        let mut whole = Renderer::new(&configuration(total)).unwrap();
        let mut expected = vec![0.0f32; total + 10];
        assert_eq!(whole.render(&frames, &mut expected), Ok(total));
        assert!(expected.iter().any(|value| value.abs() > 1e-3));
        let mut chunked = Renderer::new(&configuration(total)).unwrap();
        let mut actual = vec![0.0f32; total];
        let mut start = 0;
        while start < total {
            let end = (start + 37).min(total);
            let blocks = chunked.blocks(end - start);
            let stride = chunked.frame_stride();
            let written = chunked
                .render(&frames[..blocks * stride], &mut actual[start..end])
                .unwrap();
            start += written;
        }
        assert_eq!(&actual[..], &expected[..total]);
        assert_eq!(chunked.position(), total);
        assert_eq!(chunked.blocks(10), 0);
    }

    #[test]
    fn seek_starts_mid_utterance_with_the_saved_source() {
        let total = 3000;
        let frames = steady_frames(22, 100, &vowel());
        let mut first = Renderer::new(&configuration(total)).unwrap();
        let mut head = vec![0.0f32; 1000];
        let blocks = first.blocks(1000);
        first
            .render(&frames[..blocks * first.frame_stride()], &mut head)
            .unwrap();
        let state = first.sources_save();
        let mut second = Renderer::new(&configuration(total)).unwrap();
        assert_eq!(second.seek(-1.0), Err(RenderError::Config));
        second.seek(1000.0 / 22_050.0).unwrap();
        assert_eq!(second.position(), 1000);
        second.sources_restore(&state);
        assert_eq!(second.sources_save(), state);
        // A start inside a block takes one frame for it.
        let mut odd = Renderer::new(&configuration(total)).unwrap();
        odd.seek(1001.0 / 22_050.0).unwrap();
        assert_eq!(odd.blocks(23), 1);
        assert_eq!(odd.blocks(24), 2);
        let mut rest = vec![0.0f32; total - 1000];
        let blocks = second.blocks(rest.len());
        let written = second
            .render(&frames[..blocks * second.frame_stride()], &mut rest)
            .unwrap();
        assert_eq!(written, total - 1000);
        assert!(rest.iter().all(|value| value.is_finite()));
        assert!(rest[1000..].iter().any(|value| value.abs() > 1e-3));
    }

    #[test]
    fn refuses_bad_input() {
        assert_eq!(Renderer::new(&[1.0]).err(), Some(RenderError::Config));
        let mut values = configuration(100);
        values[config::SECTIONS] = 2.0;
        assert_eq!(Renderer::new(&values).err(), Some(RenderError::Config));
        let mut renderer = Renderer::new(&configuration(100)).unwrap();
        let mut out = [0.0f32; 64];
        assert_eq!(
            renderer.render(&vowel(), &mut out),
            Err(RenderError::TooFewFrames)
        );
        let mut frames = steady_frames(22, 2, &vowel());
        frames[frame::LENGTH] = 0.0;
        assert_eq!(renderer.render(&frames, &mut out), Err(RenderError::Frame));
        assert_eq!(renderer.blocks(64), 2);
    }
}
