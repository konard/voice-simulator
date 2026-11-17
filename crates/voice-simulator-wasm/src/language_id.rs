//! Bounded packets for issue 69. Symbols, syllables and corpora come from JS.
use crate::recognition::{packet_run, parse, Reader};
use voice_simulator_core::language_id::{self, Model, Sound, Unit};
use voice_simulator_core::mixed_recognition::Search;

fn run(data: &[f64]) -> Option<Vec<f64>> {
    let mut r = Reader { data, at: 0 };
    let languages = r.integer()?;
    let zh = r.integer()?;
    let entries = r.integer()?;
    let sounds = r.integer()?;
    let units = r.integer()?;
    let penalty = r.number()?;
    let min_sounds = r.number()?;
    if !(1..=4).contains(&languages)
        || zh > languages
        || entries > data.len() / 3
        || sounds > data.len() / 4
        || units > sounds
        || penalty < 0.0
        || min_sounds < 0.0
    {
        return None;
    }
    let mut models: Vec<_> = (0..languages).map(|_| Model::default()).collect();
    for _ in 0..entries {
        let language = r.integer()?;
        let length = r.integer()?;
        let count = r.number()?;
        if language >= languages || length > data.len() || count <= 0.0 {
            return None;
        }
        let symbols = (0..length)
            .map(|_| r.integer().map(|v| v as u32))
            .collect::<Option<Vec<_>>>()?;
        if symbols.contains(&0) {
            return None;
        }
        models[language].add(&symbols, count);
    }
    let sounds = (0..sounds)
        .map(|_| {
            Some(Sound {
                symbol: r.integer()? as u32,
                tone: r.integer()? != 0,
                reset: r.integer()? != 0,
                duration: r.number()?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    if sounds.iter().any(|s| s.duration < 0.0) {
        return None;
    }
    let units = (0..units)
        .map(|_| {
            Some(Unit {
                from: r.integer()?,
                to: r.integer()?,
                pause: r.integer()? != 0,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    let mut from = 0;
    for unit in &units {
        if unit.from != from || unit.to <= from || unit.to > sounds.len() {
            return None;
        }
        from = unit.to;
    }
    if from != sounds.len() || r.at != data.len() {
        return None;
    }
    let scores = language_id::score(&models, &sounds, &units, zh);
    let path = language_id::path(&scores, &units, languages, penalty);
    let mut confidence = vec![0.0; units.len()];
    let mut weights = Vec::new();
    let mut u = 0;
    while u < units.len() {
        let start = u;
        let language = path[u];
        let mut sums = vec![0.0; languages];
        while u < units.len() && path[u] == language {
            for (l, value) in sums.iter_mut().enumerate() {
                *value += scores[u][l];
            }
            for sound in &sounds[units[u].from..units[u].to] {
                weights.push((language, sound.duration));
            }
            u += 1;
        }
        let count = units[u - 1].to - units[start].from;
        let value = language_id::confidence(&sums, count, min_sounds);
        confidence[start..u].fill(value);
    }
    let mut result = Vec::new();
    for l in 0..languages {
        result.push(scores.iter().map(|row| row[l]).sum::<f64>() / sounds.len().max(1) as f64);
    }
    result.extend(scores.iter().flatten());
    result.extend(path.iter().map(|&p| p as f64));
    result.extend(confidence);
    result.extend(language_id::shares(&weights, languages));
    Some(result)
}

/// Header: languages, zh index (languages for none), entry/sound/unit counts,
/// penalty, minSounds. Entries: language, length, count, symbols (0 reserved).
/// Sounds: symbol, tone flag, word-reset flag, duration (1 for untimed).
/// Units: from, to, pause flag. Output: whole-input means, unit scores,
/// smoothed path, confidence per unit, shares (all in caller language order).
#[no_mangle]
pub extern "C" fn vs_language_run(data: u32, count: u32, out: u32, capacity: u32) -> i32 {
    packet_run(data, count, out, capacity, run)
}

fn mixed(data: &[f64]) -> Option<Vec<f64>> {
    let mut r = Reader { data, at: 0 };
    let languages = r.integer()?;
    let sounds = r.integer()?;
    if !(2..=4).contains(&languages) || sounds > data.len() {
        return None;
    }
    let spans = (0..sounds)
        .map(|_| r.integer())
        .collect::<Option<Vec<_>>>()?;
    if spans.iter().any(|&l| l >= languages) {
        return None;
    }
    let pauses = (0..=sounds)
        .map(|_| r.integer().map(|v| v != 0))
        .collect::<Option<Vec<_>>>()?;
    let mut requests = Vec::new();
    for _ in 0..languages {
        let length = r.integer()?;
        let end = r.at.checked_add(length)?;
        let request = parse(data.get(r.at..end)?)?;
        r.at = end;
        if request.phones.len() != sounds {
            return None;
        }
        requests.push(request);
    }
    if r.at != data.len() {
        return None;
    }
    let first = &requests[0];
    if requests.iter().any(|r| {
        r.boundaries != first.boundaries
            || r.beam != first.beam
            || r.given != first.given
            || r.nbest != first.nbest
    }) {
        return None;
    }
    let boundaries = first.boundaries.clone();
    let beam = first.beam.max(first.nbest);
    let given = first.given;
    let nbest = first.nbest;
    let mut inputs = Vec::new();
    let mut lexicons = Vec::new();
    for request in requests {
        inputs.push(request.phones);
        lexicons.push(request.lexicon);
    }
    let paths = Search {
        inputs: &inputs,
        lexicons: &lexicons,
        boundaries: &boundaries,
        pauses: &pauses,
        spans: &spans,
        beam,
        given,
    }
    .recognize(nbest);
    let mut output = vec![paths.len() as f64];
    for path in paths {
        output.extend([path.cost, path.segments.len() as f64]);
        for segment in path.segments {
            let c = segment.candidate;
            output.extend([
                segment.language as f64,
                c.from as f64,
                c.to as f64,
                c.word as f64,
                c.cost,
            ]);
        }
    }
    Some(output)
}

/// Languages, sound count, span-language per sound, pause flags (n+1),
/// then one length-prefixed vs_recognition_run packet per language.
/// Output: path count; each cost, segment count, then language/from/to/word/cost.
#[no_mangle]
pub extern "C" fn vs_recognition_mixed(data: u32, count: u32, out: u32, capacity: u32) -> i32 {
    packet_run(data, count, out, capacity, mixed)
}
