//! Exports of the voice renderer (issues 22 and 23): a renderer is made
//! from the configuration array of `src/engine/layout.js` (and, for the 3D
//! solver, the voxel model of `src/engine/pack-model.js`) and rendered in
//! chunks with one frame per control block (`src/engine/rust-renderer.js`).

use std::cell::RefCell;

use voice_simulator_core::losses::ShelfCache;
use voice_simulator_core::renderer::{AnyRenderer, RenderError};
use voice_simulator_core::source_state;

use crate::{check_range, error, f32_slice, f64_slice, u8_slice};

thread_local! {
    /// The live renderers; handle `h` is slot `h - 1`.
    static RENDERERS: RefCell<Vec<Option<AnyRenderer>>> = const { RefCell::new(Vec::new()) };
    static LOSS_SHELVES: RefCell<ShelfCache> = const { RefCell::new(ShelfCache::new()) };
}

fn code(error: RenderError) -> i32 {
    match error {
        RenderError::Config
        | RenderError::TooFewFrames
        | RenderError::Frame
        | RenderError::Model => error::BAD_ARGUMENT,
    }
}

/// A new renderer for the configuration `values` and the packed voxel
/// model `model` (the 3D solver only); returns its handle (> 0) or
/// [`error::BAD_ARGUMENT`].
pub fn renderer_new(values: &[f64], model: &[u8]) -> i32 {
    let mut renderer = match AnyRenderer::new(values, model) {
        Ok(renderer) => renderer,
        Err(error) => return code(error),
    };
    if let AnyRenderer::Waveguide(waveguide) = &mut renderer {
        // Reuse filter designs across independent reference sounds.
        LOSS_SHELVES.with_borrow_mut(|shelves| {
            *waveguide.solver_mut().loss_shelves_mut() = core::mem::take(shelves);
        });
    }
    RENDERERS.with_borrow_mut(|slots| {
        let index = match slots.iter().position(Option::is_none) {
            Some(index) => {
                slots[index] = Some(renderer);
                index
            }
            None => {
                slots.push(Some(renderer));
                slots.len() - 1
            }
        };
        i32::try_from(index + 1).unwrap_or(error::NO_MEMORY)
    })
}

/// Runs `action` on the renderer of `handle`, or returns [`error::BAD_HANDLE`].
pub fn with_renderer(handle: i32, action: impl FnOnce(&mut AnyRenderer) -> i32) -> i32 {
    let Some(index) = usize::try_from(handle).ok().and_then(|h| h.checked_sub(1)) else {
        return error::BAD_HANDLE;
    };
    RENDERERS.with_borrow_mut(|slots| match slots.get_mut(index) {
        Some(Some(renderer)) => action(renderer),
        _ => error::BAD_HANDLE,
    })
}

/// [`AnyRenderer::render`]: the number of samples written or a negative code.
pub fn renderer_render(handle: i32, frames: &[f64], out: &mut [f32]) -> i32 {
    with_renderer(handle, |renderer| match renderer.render(frames, out) {
        Ok(written) => i32::try_from(written).unwrap_or(error::NO_MEMORY),
        Err(error) => code(error),
    })
}

/// Drops the renderer of `handle`.
pub fn renderer_free(handle: i32) -> i32 {
    let code = with_renderer(handle, |renderer| {
        if let AnyRenderer::Waveguide(waveguide) = renderer {
            LOSS_SHELVES.with_borrow_mut(|shelves| {
                *shelves = core::mem::take(waveguide.solver_mut().loss_shelves_mut());
            });
        }
        error::OK
    });
    if code == error::OK {
        RENDERERS.with_borrow_mut(|slots| slots[handle as usize - 1] = None);
    }
    code
}

/// A renderer for the `length` `f64` configuration values at `config`
/// (`RENDERER_CONFIG` of `src/engine/layout.js`) and, when its SOLVER is
/// the 3D solver, the `model_length` bytes of the packed voxel model at
/// `model` (`packVoxelModel` of `src/engine/pack-model.js`; 0 and 0 for
/// the waveguide). Returns its handle (> 0) or a negative code of
/// [`error`].
#[no_mangle]
pub extern "C" fn vs_renderer_new(config: u32, length: u32, model: u32, model_length: u32) -> i32 {
    match (f64_slice(config, length), u8_slice(model, model_length)) {
        (Ok(values), Ok(model)) => renderer_new(values, model),
        (Err(code), _) | (_, Err(code)) => code,
    }
}

/// Renders the next `samples` samples (fewer at the end) as `f32` into
/// `out`. `frames` holds `frame_count` frames (`FRAME` of
/// `src/engine/layout.js`); frame `k` is the shape of the `k`-th control
/// block that starts in this call. Returns the number of samples written,
/// or [`error::BAD_ARGUMENT`] for too few frames, a frame the solver
/// cannot take, or frames that overlap `out`.
#[no_mangle]
pub extern "C" fn vs_renderer_render(
    handle: i32,
    frames: u32,
    frame_count: u32,
    out: u32,
    samples: u32,
) -> i32 {
    with_renderer(handle, |renderer| {
        let Some(values) = u32::try_from(renderer.frame_stride())
            .ok()
            .and_then(|stride| stride.checked_mul(frame_count))
        else {
            return error::OUT_OF_BOUNDS;
        };
        if let Err(code) = check_range(frames, values, 8) {
            return code;
        }
        if let Err(code) = check_range(out, samples, 4) {
            return code;
        }
        let frames_end = u64::from(frames) + 8 * u64::from(values);
        let out_end = u64::from(out) + 4 * u64::from(samples);
        if values > 0 && samples > 0 && u64::from(frames) < out_end && u64::from(out) < frames_end {
            return error::BAD_ARGUMENT;
        }
        let (Ok(frames), Ok(out)) = (f64_slice(frames, values), f32_slice(out, samples)) else {
            return error::OUT_OF_BOUNDS;
        };
        match renderer.render(frames, out) {
            Ok(written) => i32::try_from(written).unwrap_or(error::NO_MEMORY),
            Err(error) => code(error),
        }
    })
}

/// Samples rendered so far, or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_renderer_position(handle: i32) -> i32 {
    with_renderer(handle, |renderer| {
        i32::try_from(renderer.position()).unwrap_or(error::NO_MEMORY)
    })
}

/// Starts the renderer of `handle` at `seconds` into the utterance (issue
/// 29, `startTime` of `src/engine/rust-renderer.js`): position
/// `Math.round(seconds * sampleRate)`, with the clocks at its time. Returns
/// 0, or [`error::BAD_ARGUMENT`] for a time that is negative, not finite
/// or past the end.
#[no_mangle]
pub extern "C" fn vs_renderer_seek(handle: i32, seconds: f64) -> i32 {
    with_renderer(handle, |renderer| match renderer.seek(seconds) {
        Ok(()) => error::OK,
        Err(error) => code(error),
    })
}

/// Writes the source state of the renderer of `handle` (`SOURCE_STATE` of
/// `src/engine/layout.js`, [`source_state::LENGTH`] `f64` values) at
/// `out`. Returns the number written or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_renderer_sources_save(handle: i32, out: u32) -> i32 {
    with_renderer(handle, |renderer| {
        match f64_slice(out, source_state::LENGTH as u32) {
            Ok(slice) => {
                slice.copy_from_slice(&renderer.sources_save());
                source_state::LENGTH as i32
            }
            Err(code) => code,
        }
    })
}

/// Sets the source state of the renderer of `handle` from the
/// [`source_state::LENGTH`] `f64` values at `pointer`, as
/// [`vs_renderer_sources_save`] wrote them. Returns 0 or a negative code.
#[no_mangle]
pub extern "C" fn vs_renderer_sources_restore(handle: i32, pointer: u32) -> i32 {
    with_renderer(handle, |renderer| {
        match f64_slice(pointer, source_state::LENGTH as u32) {
            Ok(slice) => {
                let mut state = [0.0; source_state::LENGTH];
                state.copy_from_slice(slice);
                renderer.sources_restore(&state);
                error::OK
            }
            Err(code) => code,
        }
    })
}

/// Writes the acoustic pressure of the solver (the waveguide: the oral
/// sections, then the nasal sections; the 3D solver: every cell of the
/// model) as `f64` into the `capacity` values at `out`. Returns
/// the number written, or a negative code of [`error`].
#[no_mangle]
pub extern "C" fn vs_renderer_field(handle: i32, out: u32, capacity: u32) -> i32 {
    with_renderer(handle, |renderer| match f64_slice(out, capacity) {
        Ok(slice) => i32::try_from(renderer.field(slice)).unwrap_or(error::NO_MEMORY),
        Err(code) => code,
    })
}

/// Frees the renderer of `handle`; 0 or [`error::BAD_HANDLE`].
#[no_mangle]
pub extern "C" fn vs_renderer_free(handle: i32) -> i32 {
    renderer_free(handle)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn handles_come_and_go() {
        assert_eq!(renderer_new(&[1.0], &[]), error::BAD_ARGUMENT);
        assert_eq!(renderer_free(1), error::BAD_HANDLE);
        assert_eq!(vs_renderer_position(0), error::BAD_HANDLE);
        assert_eq!(vs_renderer_new(0, 3, 0, 0), error::NULL);
        assert_eq!(vs_renderer_new(8, 0, 0, 5), error::NULL);
    }
}
