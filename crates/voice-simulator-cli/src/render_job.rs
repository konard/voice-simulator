//! `render-job <file>`: renders a job of `scripts/write-render-job.mjs`
//! natively, so the native speed can be compared with WebAssembly and the
//! native samples with the WebAssembly ones (issue 22).
//!
//! A job is a sequence of little-endian `f64` values: `[config length,
//! config..., model length, model..., frame count, frames..., sample
//! count]`, where the config is `RENDERER_CONFIG` of `src/engine/layout.js`,
//! the model is the packed voxel model of the 3D solver
//! (`packVoxelModel` of `src/engine/pack-model.js`; its length is in bytes,
//! a multiple of 8, and 0 for the waveguide) and the frames are the
//! `FRAME`s of every control block of the render (`renderJob` of
//! `src/engine/rust-renderer.js`). The samples are rendered in one call
//! and fingerprinted as the SHA-256 of their `f32` little-endian bytes,
//! the bytes of the `Float32Array` the WebAssembly renderer returns.

use voice_simulator_core::renderer::{AnyRenderer, RenderError};

use crate::sha256::{hex, sha256};

/// A parsed job.
#[derive(Debug, PartialEq)]
pub struct Job {
    pub config: Vec<f64>,
    pub model: Vec<u8>,
    pub frame_count: usize,
    pub frames: Vec<f64>,
    pub samples: usize,
}

/// A count stored as an `f64` of a job.
fn count(value: f64, what: &str) -> Result<usize, String> {
    if value.is_finite() && value >= 0.0 && value.fract() == 0.0 && value < 2f64.powi(40) {
        Ok(value as usize)
    } else {
        Err(format!("the {what} of the job is not a count: {value}"))
    }
}

/// Parses the bytes of a job.
pub fn parse(bytes: &[u8]) -> Result<Job, String> {
    if !bytes.len().is_multiple_of(8) {
        return Err(format!(
            "a job is a sequence of f64 values, but it has {} bytes",
            bytes.len()
        ));
    }
    let values: Vec<f64> = bytes
        .as_chunks::<8>()
        .0
        .iter()
        .map(|word| f64::from_le_bytes(*word))
        .collect();
    let truncated = || "the job is truncated".to_string();
    let (&config_length, rest) = values.split_first().ok_or_else(truncated)?;
    let config_length = count(config_length, "config length")?;
    let config = rest.get(..config_length).ok_or_else(truncated)?;
    let rest = &rest[config_length..];
    let (&model_length, rest) = rest.split_first().ok_or_else(truncated)?;
    let model_length = count(model_length, "model length")?;
    if !model_length.is_multiple_of(8) {
        return Err(format!(
            "the model length of the job is not a multiple of 8: {model_length}"
        ));
    }
    let model = rest.get(..model_length / 8).ok_or_else(truncated)?;
    let rest = &rest[model_length / 8..];
    let (&frame_count, rest) = rest.split_first().ok_or_else(truncated)?;
    let frame_count = count(frame_count, "frame count")?;
    let (&samples, frames) = rest.split_last().ok_or_else(truncated)?;
    Ok(Job {
        config: config.to_vec(),
        model: model.iter().flat_map(|word| word.to_le_bytes()).collect(),
        frame_count,
        frames: frames.to_vec(),
        samples: count(samples, "sample count")?,
    })
}

/// Renders a job: the samples, or a message.
pub fn render(job: &Job) -> Result<Vec<f32>, String> {
    let describe = |error: RenderError| format!("the renderer refused the job: {error:?}");
    let mut renderer = AnyRenderer::new(&job.config, &job.model).map_err(describe)?;
    if job.frames.len() != job.frame_count * renderer.frame_stride() {
        return Err(format!(
            "{} frames of {} values do not make {} values",
            job.frame_count,
            renderer.frame_stride(),
            job.frames.len()
        ));
    }
    let mut out = vec![0.0f32; job.samples];
    let written = renderer.render(&job.frames, &mut out).map_err(describe)?;
    out.truncate(written);
    Ok(out)
}

/// The SHA-256 of the little-endian bytes of `samples`, in hexadecimal.
pub fn fingerprint(samples: &[f32]) -> String {
    let bytes: Vec<u8> = samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    hex(&sha256(&bytes))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bytes(values: &[f64]) -> Vec<u8> {
        values
            .iter()
            .flat_map(|value| value.to_le_bytes())
            .collect()
    }

    #[test]
    fn parses_the_layout() {
        let job = parse(&bytes(&[2.0, 7.0, 8.0, 0.0, 1.0, 5.0, 6.0, 30.0])).unwrap();
        assert_eq!(
            job,
            Job {
                config: vec![7.0, 8.0],
                model: Vec::new(),
                frame_count: 1,
                frames: vec![5.0, 6.0],
                samples: 30,
            }
        );
        assert!(parse(&[0; 7]).is_err());
        assert!(parse(&bytes(&[5.0, 1.0])).is_err());
        assert!(parse(&bytes(&[0.5, 1.0, 1.0])).is_err());
        assert!(parse(&bytes(&[0.0, 0.0])).is_err());
        let job = parse(&bytes(&[0.0, 8.0, 1.5, 0.0, 2.0])).unwrap();
        assert_eq!(job.model, 1.5f64.to_le_bytes());
        assert!(parse(&bytes(&[0.0, 4.0, 1.5, 0.0, 2.0])).is_err());
        assert!(parse(&bytes(&[0.0, 16.0, 1.5])).is_err());
    }

    #[test]
    fn refuses_a_bad_config() {
        let job = Job {
            config: vec![1.0; 3],
            model: Vec::new(),
            frame_count: 0,
            frames: Vec::new(),
            samples: 4,
        };
        assert!(render(&job).is_err());
    }

    #[test]
    fn fingerprints_little_endian_bytes() {
        // The SHA-256 of the 8 zero bytes of two 0.0 samples.
        assert_eq!(
            fingerprint(&[0.0, 0.0]),
            "af5570f5a1810b7af78caf4bc70a660f0df51e42baf91d4de5b2328de0e83dfc"
        );
    }
}
