//! Native analysis-by-synthesis for timed IPA readings (Unlicense).
use crate::recognition_model::Model;
use voice_simulator_core::{config, decode::Reading, renderer::AnyRenderer, resample, rescoring};

pub struct Rescoring<'a> {
    model: &'a Model,
    times: &'a [f64],
    rate: u32,
    sample_count: usize,
    stride: usize,
    recording: Vec<f64>,
    base: Vec<f64>,
    bias: Vec<f64>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use voice_simulator_core::decode::Arc;

    #[test]
    fn timed_phone_controls_render_distinct_cepstra() {
        let model = Model::load();
        let make_reading = |symbol| Reading {
            cost: 0.0,
            arcs: vec![Arc {
                from: 0,
                to: 1,
                unit: model
                    .symbols
                    .iter()
                    .position(|&(ipa, _)| ipa == symbol)
                    .unwrap(),
                cost: 0.0,
                confidence: 1.0,
                pause: false,
                long: false,
            }],
        };
        let primary = make_reading("ə");
        let alternative = make_reading("s");
        for rate in [8000, 11025, 16000] {
            let recording = vec![0.0; rate as usize / 5];
            let scoring = Rescoring::new(&model, &[0.0, 0.2], &recording, rate, &primary).unwrap();
            let base = scoring.distance(&primary, true).unwrap();
            let other = scoring.distance(&alternative, false).unwrap();
            assert!(base.is_finite() && other.is_finite());
            assert_ne!(base, other);
            assert_eq!(other, scoring.distance(&alternative, false).unwrap());
        }
    }
}

fn cepstra(samples: &[f32], rate: u32, stride: usize) -> Vec<f64> {
    let input: Vec<_> = samples.iter().map(|&value| f64::from(value)).collect();
    rescoring::mfcc(&input, rate)
        .chunks_exact(stride + 1)
        .flat_map(|row| row[1..].iter().copied())
        .collect()
}

impl<'a> Rescoring<'a> {
    pub fn new(
        model: &'a Model,
        times: &'a [f64],
        samples: &[f32],
        rate: u32,
        primary: &Reading,
    ) -> Result<Self, String> {
        let (width, _, shift) = rescoring::mfcc_settings(rate);
        let stride = width - 1;
        let recording = cepstra(samples, rate, stride);
        let mut scoring = Self {
            model,
            times,
            rate,
            sample_count: samples.len(),
            stride,
            recording,
            base: Vec::new(),
            bias: Vec::new(),
        };
        scoring.base = scoring.reference(primary)?;
        let hop = shift as f64 / f64::from(rate);
        let mut speech = vec![false; scoring.recording.len() / stride];
        let count = speech.len();
        for arc in primary.arcs.iter().filter(|arc| !arc.pause) {
            let from = (times[arc.from] / hop).round() as usize;
            let to = (times[arc.to] / hop).round() as usize;
            speech[from.min(count)..to.min(count)].fill(true);
        }
        scoring.bias = rescoring::bias(&scoring.recording, &scoring.base, &speech, stride);
        Ok(scoring)
    }

    fn reference(&self, reading: &Reading) -> Result<Vec<f64>, String> {
        let mut configuration = self.model.render_config.clone();
        let rate = configuration[config::SAMPLE_RATE];
        let count = (self.sample_count as f64 * rate / f64::from(self.rate)).ceil() as usize;
        configuration[config::TOTAL_SAMPLES] = count as f64;
        let interval = configuration[config::BLOCK_SIZE] / rate;
        let chunk = configuration[config::BLOCK_SIZE] as usize * 128;
        let mut renderer = AnyRenderer::new(&configuration, &[])
            .map_err(|error| format!("invalid recognition render configuration: {error:?}"))?;
        let mut frames = Vec::with_capacity(128 * renderer.frame_stride());
        let mut arcs = reading.arcs.iter().peekable();
        let mut block = 0;
        let mut samples = vec![0.0; count];
        for output in samples.chunks_mut(chunk) {
            frames.clear();
            for _ in 0..renderer.blocks(output.len()) {
                let time = block as f64 * interval;
                block += 1;
                while arcs.peek().is_some_and(|arc| self.times[arc.to] <= time) {
                    arcs.next();
                }
                let control = arcs
                    .peek()
                    .filter(|arc| !arc.pause && self.times[arc.from] <= time)
                    .map_or(&self.model.pause_frame, |arc| {
                        let start = self.times[arc.from];
                        let duration = self.times[arc.to] - start;
                        let phase = (((time - start) / duration) * 3.0) as usize;
                        &self.model.phone_frames[arc.unit][phase.min(2)]
                    });
                frames.extend_from_slice(control);
            }
            renderer
                .render(&frames, output)
                .map_err(|error| format!("invalid recognition render frames: {error:?}"))?;
        }
        let mut samples = resample::resample(&samples, rate, f64::from(self.rate), 16.0)
            .map_err(|_| "invalid recognition render rate")?;
        samples.truncate(self.sample_count);
        Ok(cepstra(&samples, self.rate, self.stride))
    }

    pub fn distance(&self, reading: &Reading, primary: bool) -> Result<f64, String> {
        let render;
        let reference = if primary {
            &self.base
        } else {
            render = self.reference(reading)?;
            &render
        };
        let row_count = self.recording.len() / self.stride;
        // At 10 ms per row, two-second windows keep the DTW matrix bounded
        // independently of duration. Include context on both sides of a cut.
        let mut total = 0.0;
        for start in (0..row_count).step_by(200) {
            let end = (start + 200).min(row_count);
            let from = start.saturating_sub(15);
            let to = (end + 15).min(row_count);
            let window = from * self.stride..to * self.stride;
            total += (end - start) as f64
                * rescoring::score(
                    &self.recording[window.clone()],
                    &reference[window],
                    &self.bias,
                    start - from..end - from,
                );
        }
        Ok(total / row_count.max(1) as f64)
    }
}
