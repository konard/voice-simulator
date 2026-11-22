//! Native WAV-to-IPA orchestration (Unlicense).
use crate::recognition_model::Model;
use crate::recognition_rescoring::Rescoring;
use std::time::Instant;
use voice_simulator_core::{
    decode::{self, Bounds, Observations, Policy, Reading, Weights, CHANNELS},
    inverse_filter::{self, Options},
    inversion::{self, Lattice},
    inversion_source, landmarks,
    recognition::{
        codebook::Codebook,
        native_frontend::{self, AcousticFrames, MEL, ROW},
    },
    recognizer::Level,
    resample,
};

#[cfg(feature = "parallel")]
use rayon::prelude::*;

const CANDIDATES: usize = 16;

pub struct Result {
    pub ipa: String,
    pub stages: Vec<(&'static str, f64)>,
}

impl Result {
    fn measure<T>(&mut self, stage: &'static str, run: impl FnOnce() -> T) -> T {
        let started = Instant::now();
        let value = run();
        self.stages
            .push((stage, 1000.0 * started.elapsed().as_secs_f64()));
        value
    }
}

struct Jobs {
    #[cfg(feature = "parallel")]
    pool: Option<rayon::ThreadPool>,
}

impl Jobs {
    fn new(threads: usize) -> std::result::Result<Self, String> {
        #[cfg(feature = "parallel")]
        {
            let pool = (threads > 1)
                .then(|| rayon::ThreadPoolBuilder::new().num_threads(threads).build())
                .transpose()
                .map_err(|error| error.to_string())?;
            Ok(Self { pool })
        }
        #[cfg(not(feature = "parallel"))]
        {
            if threads > 1 {
                return Err(
                    "recognition on multiple threads needs the Cargo feature parallel".into(),
                );
            }
            Ok(Self {})
        }
    }

    fn codebook(&self, book: &Codebook<'_>, rows: &[f64]) -> Vec<f64> {
        #[cfg(feature = "parallel")]
        if let Some(pool) = &self.pool {
            use voice_simulator_core::recognition::codebook::QUERY_WIDTH;
            let block =
                (rows.len() / QUERY_WIDTH).div_ceil(pool.current_num_threads()) * QUERY_WIDTH;
            if block > 0 {
                let ordered: Vec<_> = pool.install(|| {
                    rows.par_chunks(block)
                        .map(|rows| book.query(rows, CANDIDATES))
                        .collect()
                });
                return ordered.into_iter().flatten().collect();
            }
        }
        book.query(rows, CANDIDATES)
    }

    fn rescoring(
        &self,
        readings: &[Reading],
        job: impl Fn(usize, &Reading) -> std::result::Result<f64, String> + Sync,
    ) -> std::result::Result<Vec<f64>, String> {
        #[cfg(feature = "parallel")]
        if let Some(pool) = &self.pool {
            return pool.install(|| {
                readings
                    .par_iter()
                    .enumerate()
                    .map(|(index, reading)| job(index, reading))
                    .collect()
            });
        }
        readings
            .iter()
            .enumerate()
            .map(|(index, reading)| job(index, reading))
            .collect()
    }
}

fn source(
    samples: &[f32],
    rate: f64,
    hop: f64,
    frames: &AcousticFrames,
    pitch: &[f32],
    model: &Model,
) -> std::result::Result<Vec<f64>, &'static str> {
    let periodicity: Vec<_> = frames
        .rows
        .as_chunks::<ROW>()
        .0
        .iter()
        .map(|row| row[3] as f32)
        .collect();
    let mel: Vec<_> = frames
        .rows
        .as_chunks::<ROW>()
        .0
        .iter()
        .flat_map(|row| row[13..].iter().map(|&v| v as f32))
        .collect();
    let inverse = inverse_filter::inverse_filter(
        &inverse_filter::Frames {
            rate,
            hop,
            window: 0.032,
            start_time: 0.0,
            count: pitch.len(),
            sample_count: samples.len(),
            mel_bands: MEL,
            samples,
            speech: &frames.speech,
            periodicity: &periodicity,
            mel: &mel,
        },
        Options {
            pitch: Some(pitch),
            ..Options::default()
        },
    )?;
    let measurements: Vec<_> = frames
        .rows
        .as_chunks::<ROW>()
        .0
        .iter()
        .zip(&inverse.measures[0])
        .flat_map(|(row, &pitch)| {
            [
                row[0],
                row[5],
                row[4],
                row[3],
                row[6],
                row[2],
                f64::from(pitch),
            ]
        })
        .collect();
    let mut estimates = vec![0.0; pitch.len() * inversion_source::CHANNELS];
    inversion_source::estimate_source(
        &measurements,
        hop,
        model.voicing_time,
        model.fallback_pitch,
        &model.noise[usize::from(rate >= 16000.0)],
        &mut estimates,
    );
    Ok(estimates)
}

fn invert(pairs: &[f64], model: &Model, hop: f64, frames: usize) -> Vec<f64> {
    let (index, cost): (Vec<_>, Vec<_>) = pairs
        .as_chunks::<2>()
        .0
        .iter()
        .map(|pair| (pair[0], pair[1] / 100.0))
        .unzip();
    let lattice = Lattice {
        shape: &model.shape,
        index: &index,
        cost: &cost,
        stride: CANDIDATES,
        min: model.tract.map(|x| x[0]),
        range: model.tract.map(|x| x[1]),
        defaults: model.defaults,
        step: model
            .tract
            .map(|x| inversion::planner_step(x[1], x[2], 1.0 / hop, x[3])),
        smoothness: 1.0,
    };
    let mut track = vec![0.0; frames * inversion::ROW];
    lattice.solve(&mut track);
    track
}

struct Track<'a> {
    frames: &'a AcousticFrames,
    landmarks: &'a landmarks::Output,
    tract: &'a [f64],
    source: &'a [f64],
}

fn decode(
    track: Track<'_>,
    level: Level,
    seconds: f64,
    nbest: usize,
    model: &Model,
) -> (Vec<Reading>, Vec<f64>) {
    let mut ranges = [1.0; CHANNELS];
    ranges[..inversion::WIDTH].copy_from_slice(&model.tract.map(|x| x[1]));
    let mut values = Vec::with_capacity(track.frames.speech.len());
    let mut variance = Vec::with_capacity(values.capacity());
    for (row, source) in track.tract.as_chunks::<{ inversion::ROW }>().0.iter().zip(
        track
            .source
            .as_chunks::<{ inversion_source::CHANNELS }>()
            .0
            .iter(),
    ) {
        let mut value = [0.0; CHANNELS];
        let mut spread = [0.0; CHANNELS];
        value[..inversion::WIDTH].copy_from_slice(&row[..inversion::WIDTH]);
        spread[..inversion::WIDTH].copy_from_slice(&row[inversion::WIDTH..2 * inversion::WIDTH]);
        value[inversion::WIDTH..].copy_from_slice(source);
        values.push(value);
        variance.push(spread);
    }
    let landmarks: Vec<_> = track
        .landmarks
        .landmarks
        .iter()
        .map(|x| x.frame as f64 * level.hop)
        .collect();
    let graph = decode::prepare(
        &Observations {
            start: 0.0,
            hop: level.hop,
            speech: &track.frames.speech,
            classes: &track.landmarks.classes,
            landmarks: &landmarks,
            values: &values,
            variance: &variance,
            ranges,
        },
        &model.templates,
        &Bounds {
            from: 0.0,
            to: seconds,
            open: false,
            locked: false,
        },
    );
    let units = model.templates.len();
    let contrastive_length: Vec<_> = model.symbols.iter().map(|&(_, long)| long).collect();
    let readings = decode::search(
        &graph,
        &Policy {
            units,
            beam: level.beam as usize,
            nbest,
            last_unit: units,
            contrastive_length: &contrastive_length,
            transition: &model.transitions,
            weights: Weights {
                duration: 1.0,
                class: 4.0,
                phonotactic: 2.0,
            },
        },
    )
    .readings;
    (readings, graph.times)
}

fn rescore(
    samples: &[f32],
    rate: u32,
    readings: &[Reading],
    times: &[f64],
    jobs: &Jobs,
    model: &Model,
) -> std::result::Result<usize, String> {
    let scoring = Rescoring::new(model, times, samples, rate, &readings[0])?;
    let distances = jobs.rescoring(readings, |index, reading| {
        scoring.distance(reading, index == 0)
    })?;
    Ok(readings
        .iter()
        .zip(distances)
        .enumerate()
        .map(|(i, (reading, distance))| (i, reading.cost + 0.1 * distance))
        .min_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)))
        .map_or(0, |(i, _)| i))
}

fn ipa(reading: Option<&Reading>, model: &Model) -> String {
    let mut ipa = String::new();
    if let Some(reading) = reading {
        for arc in &reading.arcs {
            if arc.pause {
                if !ipa.ends_with(' ') {
                    ipa.push(' ');
                }
            } else {
                let (symbol, long) = model.symbols[arc.unit];
                ipa.push_str(symbol);
                if arc.long && long {
                    ipa.push('ː');
                }
            }
        }
    }
    ipa.trim().to_string()
}

pub fn recognize(
    samples: &[f32],
    sample_rate: u32,
    level: Level,
    threads: usize,
    rescoring: bool,
) -> std::result::Result<Result, String> {
    let seconds = samples.len() as f64 / f64::from(sample_rate);
    if seconds < 0.05 {
        return Err("recognition needs at least 50 ms of audio".into());
    }
    let jobs = Jobs::new(threads)?;
    let mut result = Result {
        ipa: String::new(),
        stages: Vec::new(),
    };
    let model = result.measure("model", Model::load);
    let rate = [16000, 11025, 8000]
        .into_iter()
        .find(|&rate| rate <= level.rate && rate <= sample_rate)
        .map(f64::from)
        .ok_or("recognition needs at least 8000 Hz audio")?;
    let hop = level.hop;
    let samples = result
        .measure("resample", || {
            resample::resample(samples, f64::from(sample_rate), rate, 16.0)
        })
        .map_err(|_| "invalid sample rate")?;
    let mut frames = result.measure("front_end", || {
        native_frontend::analyze(&samples, rate, hop)
    });
    let pitch = result.measure("pitch", || {
        native_frontend::track_pitch(&samples, rate, hop, &mut frames)
    });
    let source = result.measure("inverse_filter", || {
        source(&samples, rate, hop, &frames, &pitch, &model)
    })?;
    let landmarks = result.measure("landmarks", || {
        landmarks::find_landmarks(
            &landmarks::Frames {
                rows: &frames.rows,
                count: pitch.len(),
                mel_bands: MEL,
                rate,
                hop,
            },
            &landmarks::Thresholds(model.thresholds),
        )
    });
    let queries = result.measure("spectral_envelope", || {
        native_frontend::envelope_queries(&samples, rate, hop, &frames.speech, &model.grid)
    });
    let pairs = result.measure("codebook_search", || {
        jobs.codebook(&model.codebook(), &queries)
    });
    let tract = result.measure("inversion", || invert(&pairs, &model, hop, pitch.len()));
    let track = Track {
        frames: &frames,
        landmarks: &landmarks,
        tract: &tract,
        source: &source,
    };
    let (readings, times) = result.measure("audio_to_ipa", || {
        decode(
            track,
            level,
            seconds,
            if rescoring { 10 } else { 1 },
            &model,
        )
    });
    let best = if rescoring && readings.len() > 1 {
        result.measure("rescoring", || {
            rescore(&samples, rate as u32, &readings, &times, &jobs, &model)
        })?
    } else {
        0
    };
    result.ipa = ipa(readings.get(best), &model);
    Ok(result)
}
