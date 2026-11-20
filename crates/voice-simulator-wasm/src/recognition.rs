//! Float64 wire format for numerical recognition parity. Language-specific
//! text and IPA parsing stay in JavaScript; the Rust core receives features.
use crate::{error, f64_slice};
use std::collections::BTreeMap;
use voice_simulator_core::recognition::{self, Entry, Lexicon, Phone, UNKNOWN_WORD};

pub(crate) struct Reader<'a> {
    pub data: &'a [f64],
    pub at: usize,
}
impl Reader<'_> {
    pub fn number(&mut self) -> Option<f64> {
        let value = *self.data.get(self.at)?;
        self.at += 1;
        value.is_finite().then_some(value)
    }
    pub fn integer(&mut self) -> Option<usize> {
        let value = self.number()?;
        ((0.0..=1_000_000.0).contains(&value) && value == value as usize as f64)
            .then_some(value as usize)
    }
    fn phone(&mut self) -> Option<Phone> {
        Some(Phone {
            key: self.integer()? as u32,
            symbol: self.integer()? as u32,
            vowel: self.integer()? != 0,
            height: self.number()?,
            backness: self.number()?,
            rounded: self.integer()? != 0,
            long: self.integer()? != 0,
            nasal: self.integer()? != 0,
            manner: self.integer()? as u32,
            place: self.integer()? as u32,
            voiced: self.integer()? != 0,
            aspirated: self.integer()? != 0,
            palatalized: self.integer()? != 0,
            tone: self.integer()? as u32,
            stress: self.integer()? as u32,
            glide: self.integer()? as u32,
            reduced_gap: self.integer()? != 0,
            ..Phone::default()
        })
    }
}

/// Two feature records (17 numbers each); NaN on an invalid memory range.
#[no_mangle]
pub extern "C" fn vs_phone_distance(data: u32) -> f64 {
    let Ok(data) = f64_slice(data, 34) else {
        return f64::NAN;
    };
    let mut reader = Reader { data, at: 0 };
    match (reader.phone(), reader.phone()) {
        (Some(a), Some(b)) => recognition::phone_distance(&a, &b),
        _ => f64::NAN,
    }
}

pub(crate) struct Request {
    pub phones: Vec<Phone>,
    pub boundaries: Vec<bool>,
    pub lexicon: Lexicon,
    pub beam: usize,
    pub given: bool,
    pub nbest: usize,
}

pub(crate) fn parse(data: &[f64]) -> Option<Request> {
    let mut r = Reader { data, at: 0 };
    let beam = r.integer()?;
    let given = r.integer()? != 0;
    let nbest = r.integer()?;
    let input_count = r.integer()?;
    let entry_count = r.integer()?;
    let word_count = r.integer()?;
    let pair_count = r.integer()?;
    let unknown_count = r.integer()?;
    // Bound allocation by the supplied packet, including malformed counts.
    if beam == 0
        || nbest == 0
        || beam > 4096
        || nbest > 4096
        || input_count > data.len() / 17
        || entry_count > data.len() / 2
        || word_count > data.len()
        || pair_count > data.len() / 3
        || unknown_count > data.len() / 3
    {
        return None;
    }
    let mut phones: Vec<_> = (0..input_count).map(|_| r.phone()).collect::<Option<_>>()?;
    let boundaries: Vec<_> = (0..=input_count)
        .map(|_| r.integer().map(|v| v != 0))
        .collect::<Option<_>>()?;
    if !boundaries[0] || !boundaries[input_count] {
        return None;
    }
    let counts: Vec<_> = (0..word_count).map(|_| r.number()).collect::<Option<_>>()?;
    if counts.iter().any(|&n| n <= 0.0) || counts.is_empty() {
        return None;
    }
    let mut entries = Vec::new();
    for _ in 0..entry_count {
        let word = r.integer()?;
        let len = r.integer()?;
        let following = r.integer()? as u32;
        if word >= counts.len() || len == 0 || len > data.len() / 17 || following > 2 {
            return None;
        }
        let phones = (0..len).map(|_| r.phone()).collect::<Option<_>>()?;
        entries.push(Entry {
            word,
            phones,
            count: counts[word],
            following,
        });
    }
    let mut bigrams = BTreeMap::new();
    for _ in 0..pair_count {
        let a = r.integer()?;
        let b = r.integer()?;
        let count = r.number()?;
        if a >= counts.len() || b >= counts.len() || count <= 0.75 || count > counts[a] {
            return None;
        }
        bigrams.insert((a, b), count);
    }
    let mut unknown_words = BTreeMap::new();
    for _ in 0..unknown_count {
        let from = r.integer()?;
        let to = r.integer()?;
        let word = r.integer()?;
        if from >= to || to > phones.len() || to - from > 12 {
            return None;
        }
        unknown_words.insert((from, to), word);
    }
    if r.at != data.len() {
        for phone in &mut phones {
            let voicing = r.number()?;
            if voicing != -1.0 {
                if !(0.0..=1.0).contains(&voicing) {
                    return None;
                }
                phone.whisper_voicing = Some(voicing);
            }
            let tones = [
                r.number()?,
                r.number()?,
                r.number()?,
                r.number()?,
                r.number()?,
            ];
            if tones != [-1.0; 5] {
                if !tones.iter().all(|tone| (0.25..=0.75).contains(tone)) {
                    return None;
                }
                phone.whisper_tones = Some(tones);
            }
        }
    }
    if r.at != data.len() {
        return None;
    }
    let mut lexicon = Lexicon::new(entries, counts, bigrams);
    lexicon.unknown_words = unknown_words;
    Some(Request {
        phones,
        boundaries,
        lexicon,
        beam,
        given,
        nbest,
    })
}

fn run(data: &[f64]) -> Option<Vec<f64>> {
    let request = parse(data)?;
    let paths = recognition::recognize(
        &request.phones,
        &request.boundaries,
        &request.lexicon,
        request.beam,
        request.given,
        request.nbest,
    );
    let mut out = Vec::new();
    out.push(paths.len() as f64);
    for path in paths {
        out.push(path.cost);
        out.push(path.segments.len() as f64);
        for c in path.segments {
            out.extend_from_slice(&[
                c.from as f64,
                c.to as f64,
                if c.word == UNKNOWN_WORD {
                    -1.0
                } else {
                    c.word as f64
                },
                if c.entry == UNKNOWN_WORD {
                    -1.0
                } else {
                    c.entry as f64
                },
                c.cost,
            ]);
        }
    }
    Some(out)
}

/// Packet: beam/given/nbest, input/entry/word/pair/unknown counts, input features,
/// boundary flags, word counts, entries (word, length, following, features),
/// bigrams, unknown spelling IDs (from, to, word), then optional input cue rows.
/// A cue row has voicing, then costs for tones 1, 2, 3, 4 and neutral. Use -1
/// for absent voicing and five -1 values for absent tone evidence. IDs beyond word counts
/// have a backoff count of one without increasing the corpus total.
/// Output: path count; each path cost, segment count, then from/to/word/entry/cost.
/// Returns the number of written f64s, or BAD_ARGUMENT / memory-range errors.
#[no_mangle]
pub extern "C" fn vs_recognition_run(data: u32, count: u32, output: u32, capacity: u32) -> i32 {
    packet_run(data, count, output, capacity, run)
}

pub(crate) fn packet_run(
    data: u32,
    count: u32,
    output: u32,
    capacity: u32,
    run: fn(&[f64]) -> Option<Vec<f64>>,
) -> i32 {
    // Finish reading the packet before borrowing output; overlap is safe.
    let result = match f64_slice(data, count) {
        Ok(slice) => run(slice),
        Err(code) => return code,
    };
    let Some(result) = result else {
        return error::BAD_ARGUMENT;
    };
    if result.len() > capacity as usize {
        return error::BAD_ARGUMENT;
    }
    match f64_slice(output, capacity) {
        Ok(slice) => {
            slice[..result.len()].copy_from_slice(&result);
            result.len() as i32
        }
        Err(code) => code,
    }
}
