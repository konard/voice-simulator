//! Joint multilingual beam search using the existing per-language trie search.
use crate::recognition::{
    candidates, Candidate, Lexicon, Phone, ACOUSTIC_WEIGHT, UNKNOWN_SOUND_COST, UNKNOWN_WORD,
};
use alloc::collections::BTreeMap;
use alloc::vec;
use alloc::vec::Vec;

#[derive(Clone, Debug)]
pub struct Segment {
    pub language: usize,
    pub candidate: Candidate,
}
#[derive(Clone, Debug)]
pub struct Path {
    pub cost: f64,
    pub segments: Vec<Segment>,
}
pub struct Search<'a> {
    pub inputs: &'a [Vec<Phone>],
    pub lexicons: &'a [Lexicon],
    pub boundaries: &'a [bool],
    pub pauses: &'a [bool],
    pub spans: &'a [usize],
    pub beam: usize,
    pub given: bool,
}
fn same_text(a: &Path, b: &Path) -> bool {
    a.segments
        .iter()
        .map(|s| (s.language, s.candidate.word))
        .eq(b.segments.iter().map(|s| (s.language, s.candidate.word)))
}
fn prune(mut paths: Vec<Path>, beam: usize) -> Vec<Path> {
    paths.sort_by(|a, b| a.cost.total_cmp(&b.cost));
    let mut result = Vec::new();
    for path in paths {
        if !result.iter().any(|p| same_text(p, &path)) {
            result.push(path);
        }
        if result.len() == beam {
            break;
        }
    }
    result
}
impl Search<'_> {
    pub fn decode(&self, exact: bool) -> Vec<Path> {
        let length = self.inputs[0].len();
        let mut best = vec![Vec::<Path>::new(); length + 1];
        let mut suffixes = BTreeMap::<(usize, usize), Vec<bool>>::new();
        best[0].push(Path {
            cost: 0.0,
            segments: Vec::new(),
        });
        for from in 0..length {
            if best[from].is_empty() || (self.given && !self.boundaries[from]) {
                continue;
            }
            let end = (from + 1..=length)
                .find(|&i| self.boundaries[i])
                .unwrap_or(length);
            let partials = prune(core::mem::take(&mut best[from]), self.beam);
            for (language, lexicon) in self.lexicons.iter().enumerate() {
                let phones = &self.inputs[language];
                let mut arcs = candidates(phones, from, end, lexicon, self.beam, exact);
                if self.given {
                    arcs.retain(|c| c.to == end);
                }
                if !exact {
                    for arc in &mut arcs {
                        arc.cost *= ACOUSTIC_WEIGHT;
                    }
                }
                if !exact || (self.given && arcs.is_empty()) {
                    let to = end.min(from + 12);
                    if !self.given || to == end {
                        let mut ends = vec![to];
                        if !self.given {
                            let reachable = suffixes.entry((end, language)).or_insert_with(|| {
                                let mut reachable = vec![false; end + 1];
                                reachable[end] = true;
                                for start in (0..end).rev() {
                                    reachable[start] =
                                        candidates(phones, start, end, lexicon, self.beam, true)
                                            .iter()
                                            .any(|c| reachable[c.to]);
                                }
                                reachable
                            });
                            if let Some(j) = (from + 1..to).find(|&j| reachable[j]) {
                                ends.push(j);
                            }
                        }
                        for to in ends {
                            arcs.push(Candidate {
                                from,
                                to,
                                word: lexicon
                                    .unknown_words
                                    .get(&(from, to))
                                    .copied()
                                    .unwrap_or(UNKNOWN_WORD),
                                entry: UNKNOWN_WORD,
                                cost: 3.0 + UNKNOWN_SOUND_COST * (to - from) as f64,
                            });
                        }
                    }
                }
                for arc in arcs {
                    for partial in &partials {
                        let last = partial.segments.last();
                        let changed = last.is_some_and(|s| s.language != language);
                        let previous = if changed {
                            UNKNOWN_WORD
                        } else {
                            last.map_or(UNKNOWN_WORD, |s| s.candidate.word)
                        };
                        // Final costs: span mismatch 2; switch 1, waived at pauses.
                        let extra = if self.spans[from] != language {
                            2.0
                        } else {
                            0.0
                        } + if changed && !self.pauses[from] {
                            1.0
                        } else {
                            0.0
                        };
                        let cost =
                            partial.cost + arc.cost + lexicon.word_cost(previous, arc.word) + extra;
                        let mut segments = partial.segments.clone();
                        segments.push(Segment {
                            language,
                            candidate: arc.clone(),
                        });
                        best[arc.to].push(Path { cost, segments });
                    }
                    if best[arc.to].len() > self.beam * 4 {
                        best[arc.to] = prune(core::mem::take(&mut best[arc.to]), self.beam);
                    }
                }
            }
        }
        prune(core::mem::take(&mut best[length]), self.beam)
    }
    pub fn recognize(&self, nbest: usize) -> Vec<Path> {
        let mut paths = self.decode(true);
        if paths.len() < nbest {
            for path in self.decode(false) {
                if !paths.iter().any(|p| same_text(p, &path)) {
                    paths.push(path);
                }
            }
        }
        paths.truncate(nbest);
        paths
    }
}
