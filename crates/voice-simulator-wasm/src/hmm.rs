//! Gaussian HMM exports of the word decoder (issue 75, Unlicense).
use crate::{check_range, error, f32_slice, f64_slice};
use voice_simulator_core::recognition::hmm::{state_scores, Lda, Mixtures};

fn read<'a, T>(offset: u32, count: u32) -> Result<&'a [T], i32> {
    check_range(offset, count, core::mem::size_of::<T>() as u32)?;
    if count == 0 {
        return Ok(&[]);
    }
    // SAFETY: the range is non-null, aligned and in memory (checked above),
    // and only read while the export runs.
    Ok(unsafe { core::slice::from_raw_parts(offset as usize as *const T, count as usize) })
}

fn size(a: u32, b: u32) -> Result<u32, i32> {
    a.checked_mul(b).ok_or(error::BAD_ARGUMENT)
}

/// Writes the log likelihoods of `chosen` states for `frames` frames of
/// `feats` (f32, `dims` per frame) to `out` (f64, frame-major). The model
/// is `first` (i32, states + 1), `mu` and `inv` (f32, mixtures × dims) and
/// `norm` (f64, mixtures), as `unpackHmmModel` of hmm-model.js lays it out.
/// Returns 0 or a negative error code.
#[no_mangle]
pub extern "C" fn rec_hmm_scores(
    first: u32,
    states: u32,
    mu: u32,
    inv: u32,
    norm: u32,
    mixtures: u32,
    dims: u32,
    feats: u32,
    frames: u32,
    chosen: u32,
    count: u32,
    out: u32,
) -> i32 {
    let run = || {
        let values = size(mixtures, dims)?;
        let model = Mixtures {
            first: read::<i32>(first, states.checked_add(1).ok_or(error::BAD_ARGUMENT)?)?,
            mu: read::<f32>(mu, values)?,
            inv: read::<f32>(inv, values)?,
            norm: read::<f64>(norm, mixtures)?,
            dims: dims as usize,
        };
        if !model.valid() {
            return Err(error::BAD_ARGUMENT);
        }
        let feats = read::<f32>(feats, size(frames, dims)?)?;
        let chosen = read::<u32>(chosen, count)?;
        let out = f64_slice(out, size(frames, count)?)?;
        if state_scores(&model, feats, chosen, out) {
            Ok(0)
        } else {
            Err(error::BAD_ARGUMENT)
        }
    };
    run().unwrap_or_else(core::convert::identity)
}

/// Projects `frames` frames of statics (f64, `stat` per frame) with the LDA
/// `rows` (f32, dims × (2 ctx + 1) stat) and `mean` (f32) to `out` (f32,
/// frames × dims), as `applyLda` of hmm-features.js. Returns 0 or a
/// negative error code.
#[no_mangle]
pub extern "C" fn rec_hmm_lda(
    statics: u32,
    frames: u32,
    stat: u32,
    ctx: u32,
    rows: u32,
    mean: u32,
    dims: u32,
    out: u32,
) -> i32 {
    let run = || {
        let width = size(size(ctx, 2)? + 1, stat)?;
        let lda = Lda {
            ctx: ctx as usize,
            stat: stat as usize,
            rows: read::<f32>(rows, size(dims, width)?)?,
            mean: read::<f32>(mean, width)?,
            dims: dims as usize,
        };
        let statics = read::<f64>(statics, size(frames, stat)?)?;
        let out = f32_slice(out, size(frames, dims)?)?;
        if lda.apply(statics, out) {
            Ok(0)
        } else {
            Err(error::BAD_ARGUMENT)
        }
    };
    run().unwrap_or_else(core::convert::identity)
}
