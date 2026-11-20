//! Numerical IPA recognition (issue 68). The caller supplies pronunciations
//! and integer sound keys from the shared language rules. No I/O or text
//! database is duplicated here. Costs and beam ordering mirror src/recognition.
use crate::math;
use alloc::collections::BTreeMap;
use alloc::vec;
use alloc::vec::Vec;

pub const INSERT_COST: f64 = 1.0;
pub const DELETE_COST: f64 = 1.0;
pub const ACOUSTIC_WEIGHT: f64 = 10.0;
pub const UNKNOWN_SOUND_COST: f64 = 2.0;
pub const UNKNOWN_WORD: usize = usize::MAX;

/// Features of a parsed segment. Places 0..11 follow phone-distance.js;
/// 12/13 mean labial-velar/labial-palatal. Manners are caller-interned.
#[derive(Clone, Copy, Debug, Default)]
pub struct Phone {
    pub key: u32,
    /// Interned token.symbol, without the tone suffix in key.
    pub symbol: u32,
    pub vowel: bool,
    pub height: f64,
    pub backness: f64,
    pub rounded: bool,
    pub long: bool,
    pub nasal: bool,
    pub manner: u32,
    pub place: u32,
    pub voiced: bool,
    pub aspirated: bool,
    pub palatalized: bool,
    pub tone: u32,
    pub stress: u32,
    /// 1=i, 2=j, 3=u, 4=w; 0 for other segments.
    pub glide: u32,
    pub reduced_gap: bool,
    pub whisper_voicing: Option<f64>,
    /// Whispered tone costs in the order 1, 2, 3, 4, neutral.
    pub whisper_tones: Option<[f64; 5]>,
}

impl Phone {
    fn has_weak_cues(&self) -> bool {
        self.whisper_voicing.is_some() || self.whisper_tones.is_some()
    }
}

fn flag(a: bool, b: bool) -> f64 {
    if a != b {
        1.0
    } else {
        0.0
    }
}
fn places(place: u32) -> (u32, u32) {
    match place {
        12 => (0, 8),
        13 => (0, 7),
        p => (p, p),
    }
}
pub fn tone_distance(a: u32, b: u32) -> f64 {
    if a == b || (a == 214 && b == 21) || (a == 21 && b == 214) {
        0.0
    } else if (a == 214 && b == 35) || (a == 35 && b == 214) {
        0.15
    } else {
        0.5
    }
}

fn tone_evidence(a: &Phone, b: &Phone) -> f64 {
    let Some(costs) = a.whisper_tones else {
        return tone_distance(a.tone, b.tone);
    };
    let cost = match b.tone {
        5 => costs[0],
        35 => costs[1],
        21 | 214 => costs[2],
        51 => costs[3],
        0 => costs[4],
        _ => 0.5,
    };
    0.5 * (cost - 0.25)
}

fn voicing_distance(a: &Phone, b: &Phone) -> f64 {
    if let Some(probability) = a.whisper_voicing {
        (f64::from(u8::from(b.voiced)) - probability).abs()
    } else if let Some(probability) = b.whisper_voicing {
        (f64::from(u8::from(a.voiced)) - probability).abs()
    } else {
        flag(a.voiced, b.voiced)
    }
}
pub fn phone_distance(a: &Phone, b: &Phone) -> f64 {
    let segment = if a.vowel && b.vowel {
        2.0 * math::abs(a.height - b.height)
            + 1.5 * math::abs(a.backness - b.backness)
            + 0.5 * flag(a.rounded, b.rounded)
            + 0.3 * flag(a.long, b.long)
            + 0.3 * flag(a.nasal, b.nasal)
    } else if !a.vowel && !b.vowel {
        let (a0, a1) = places(a.place);
        let (b0, b1) = places(b.place);
        let place = a0
            .abs_diff(b0)
            .min(a0.abs_diff(b1))
            .min(a1.abs_diff(b0))
            .min(a1.abs_diff(b1)) as f64
            / 11.0;
        0.5 * if a.manner != b.manner { 1.0 } else { 0.0 }
            + 0.35 * place
            + 0.25 * voicing_distance(a, b)
            + 0.2 * flag(a.aspirated, b.aspirated)
            + 0.2 * flag(a.palatalized, b.palatalized)
    } else if matches!((a.glide, b.glide), (1, 2) | (2, 1) | (3, 4) | (4, 3)) {
        0.6
    } else {
        1.0
    };
    (segment + tone_evidence(a, b) + 0.2 * if a.stress != b.stress { 1.0 } else { 0.0 }).min(1.0)
}
pub fn gap_cost(phone: &Phone) -> f64 {
    if phone.reduced_gap {
        0.5
    } else {
        INSERT_COST
    }
}
pub fn confidence(cost: f64, sounds: usize, mean: f64, unknown: bool) -> f64 {
    (math::exp(-cost / sounds.max(1) as f64) * mean).min(if unknown { 0.3 } else { 1.0 })
}

#[derive(Clone, Debug)]
pub struct Entry {
    pub word: usize,
    pub phones: Vec<Phone>,
    pub count: f64,
    /// 0=unconditional, 1=before fourth tone, 2=before a non-fourth tone.
    pub following: u32,
}
#[derive(Clone, Debug, Default)]
pub struct Node {
    pub children: Vec<usize>,
    pub entries: Vec<usize>,
    pub phone: Phone,
}
#[derive(Clone, Debug)]
pub struct Lexicon {
    pub nodes: Vec<Node>,
    pub entries: Vec<Entry>,
    pub counts: Vec<f64>,
    pub total: f64,
    pub bigrams: BTreeMap<(usize, usize), f64>,
    /// Spelling is shared with JS. Equal spellings receive equal word IDs,
    /// including when a rule spelling coincides with a dictionary word.
    pub unknown_words: BTreeMap<(usize, usize), usize>,
}
impl Lexicon {
    pub fn new(
        entries: Vec<Entry>,
        counts: Vec<f64>,
        bigrams: BTreeMap<(usize, usize), f64>,
    ) -> Self {
        let mut nodes = vec![Node::default()];
        for (index, entry) in entries.iter().enumerate() {
            let mut current = 0;
            for phone in &entry.phones {
                let next = nodes[current]
                    .children
                    .iter()
                    .copied()
                    .find(|&child| nodes[child].phone.key == phone.key);
                let next = next.unwrap_or_else(|| {
                    let id = nodes.len();
                    nodes.push(Node {
                        phone: *phone,
                        ..Node::default()
                    });
                    nodes[current].children.push(id);
                    id
                });
                current = next;
            }
            if current != 0 {
                nodes[current].entries.push(index);
            }
        }
        let total = counts.iter().sum();
        Self {
            nodes,
            entries,
            counts,
            total,
            bigrams,
            unknown_words: BTreeMap::new(),
        }
    }
    pub fn word_cost(&self, previous: usize, word: usize) -> f64 {
        let probability = if let Some(count) = self.bigrams.get(&(previous, word)) {
            (count - 0.75) / self.counts[previous]
        } else {
            0.4 * self.counts.get(word).copied().unwrap_or(1.0) / self.total
        };
        -0.3 * math::ln(probability) + 0.5
    }
}

#[derive(Clone, Debug)]
pub struct Candidate {
    pub from: usize,
    pub to: usize,
    pub entry: usize,
    pub word: usize,
    pub cost: f64,
}
#[derive(Clone, Copy)]
struct State {
    node: usize,
    cost: f64,
}
fn cheapest(states: Vec<State>, beam: usize) -> Vec<State> {
    let mut unique: Vec<State> = Vec::new();
    for state in states {
        if let Some(old) = unique.iter_mut().find(|s| s.node == state.node) {
            if state.cost < old.cost {
                *old = state;
            }
        } else {
            unique.push(state);
        }
    }
    unique.sort_by(|a, b| a.cost.total_cmp(&b.cost));
    unique.truncate(beam);
    unique
}
fn insertions(states: Vec<State>, limit: f64, beam: usize, lexicon: &Lexicon) -> Vec<State> {
    let mut all = cheapest(states, beam);
    let mut frontier = all.clone();
    while !frontier.is_empty() {
        let old = all.clone();
        let mut next = all.clone();
        for state in frontier {
            for &child in &lexicon.nodes[state.node].children {
                let cost = state.cost + gap_cost(&lexicon.nodes[child].phone);
                if cost <= limit
                    && cost
                        < all
                            .iter()
                            .find(|s| s.node == child)
                            .map_or(f64::INFINITY, |s| s.cost)
                {
                    next.push(State { node: child, cost });
                }
            }
        }
        all = cheapest(next, beam);
        frontier = all
            .iter()
            .copied()
            .filter(|s| {
                s.cost
                    < old
                        .iter()
                        .find(|p| p.node == s.node)
                        .map_or(f64::INFINITY, |p| p.cost)
            })
            .collect();
    }
    all
}
fn terminals(
    found: &mut Vec<Candidate>,
    lexicon: &Lexicon,
    from: usize,
    to: usize,
    state: State,
    phones: &[Phone],
    exact: bool,
) {
    for &entry in &lexicon.nodes[state.node].entries {
        let item = &lexicon.entries[entry];
        let next_tone = phones[to..]
            .iter()
            .find(|p| p.tone != 0)
            .map_or(0, |p| p.tone);
        if (item.following == 1 && next_tone != 51)
            || (item.following == 2 && (next_tone == 0 || next_tone == 51))
        {
            continue;
        }
        let mut cost = state.cost;
        if !exact && item.phones.len() == to - from {
            for (a, b) in phones[from..to].iter().zip(&item.phones) {
                cost += 0.2 * if a.stress != b.stress { 1.0 } else { 0.0 };
            }
        }
        found.push(Candidate {
            from,
            to,
            entry,
            word: item.word,
            cost,
        });
    }
}
pub fn candidates(
    phones: &[Phone],
    from: usize,
    end: usize,
    lexicon: &Lexicon,
    beam: usize,
    exact: bool,
) -> Vec<Candidate> {
    let mut found = Vec::new();
    let mut nodes = vec![State { node: 0, cost: 0.0 }];
    for to in from..end {
        let next_tone = phones[to + 1..end]
            .iter()
            .find(|p| p.tone != 0)
            .map_or(0, |p| p.tone);
        let mut next = Vec::new();
        for state in nodes {
            // Preserve literal keys first, then the contextual third-tone
            // forms, matching the JavaScript trie traversal order.
            for tone in [phones[to].tone, 214, 21] {
                if tone != phones[to].tone
                    && !(phones[to].tone == 35 && matches!(next_tone, 21 | 214))
                {
                    continue;
                }
                for &child in &lexicon.nodes[state.node].children {
                    let mut p = lexicon.nodes[child].phone;
                    let matches = if tone == phones[to].tone {
                        p.key == phones[to].key
                    } else {
                        p.symbol == phones[to].symbol && p.tone == tone
                    };
                    if matches && !next.iter().any(|candidate: &State| candidate.node == child) {
                        let mut heard = phones[to];
                        heard.stress = 0;
                        p.stress = 0;
                        let cost = state.cost
                            + if heard.has_weak_cues() {
                                phone_distance(&heard, &p)
                            } else {
                                0.0
                            };
                        let next_state = State { node: child, cost };
                        next.push(next_state);
                        terminals(
                            &mut found,
                            lexicon,
                            from,
                            to + 1,
                            next_state,
                            &phones[..end],
                            true,
                        );
                    }
                }
            }
        }
        nodes = next;
        if nodes.is_empty() {
            break;
        }
    }
    if !exact {
        let mut states = insertions(vec![State { node: 0, cost: 0.0 }], 0.6, beam, lexicon);
        for index in from..end {
            let limit = 0.6 * (index - from + 2) as f64;
            let mut next = Vec::new();
            for state in states {
                let deletion = state.cost + gap_cost(&phones[index]);
                if deletion <= limit {
                    next.push(State {
                        node: state.node,
                        cost: deletion,
                    });
                }
                for &child in &lexicon.nodes[state.node].children {
                    let mut a = phones[index];
                    a.stress = 0;
                    let mut b = lexicon.nodes[child].phone;
                    b.stress = 0;
                    let cost = state.cost + phone_distance(&a, &b);
                    if cost <= limit {
                        next.push(State { node: child, cost });
                    }
                }
            }
            states = insertions(cheapest(next, beam), limit, beam, lexicon);
            for &state in &states {
                terminals(
                    &mut found,
                    lexicon,
                    from,
                    index + 1,
                    state,
                    &phones[..end],
                    false,
                );
            }
            if states.is_empty() {
                break;
            }
        }
    }
    let mut unique: Vec<Candidate> = Vec::new();
    for item in found {
        if let Some(old) = unique
            .iter_mut()
            .find(|c| c.to == item.to && c.entry == item.entry)
        {
            if item.cost < old.cost {
                *old = item;
            }
        } else {
            unique.push(item);
        }
    }
    unique
}

#[derive(Clone, Debug)]
pub struct Path {
    pub cost: f64,
    pub segments: Vec<Candidate>,
}
fn prune(mut paths: Vec<Path>, beam: usize) -> Vec<Path> {
    paths.sort_by(|a, b| a.cost.total_cmp(&b.cost));
    let mut kept: Vec<Path> = Vec::new();
    for path in paths {
        if !kept.iter().any(|p| {
            p.segments
                .iter()
                .map(|c| (c.word, if c.word == UNKNOWN_WORD { c.from } else { 0 }))
                .eq(path
                    .segments
                    .iter()
                    .map(|c| (c.word, if c.word == UNKNOWN_WORD { c.from } else { 0 })))
        }) {
            kept.push(path);
        }
        if kept.len() == beam {
            break;
        }
    }
    kept
}
pub fn decode(
    phones: &[Phone],
    boundaries: &[bool],
    lexicon: &Lexicon,
    beam: usize,
    given: bool,
    exact: bool,
) -> Vec<Path> {
    let mut best = vec![Vec::<Path>::new(); phones.len() + 1];
    let mut suffixes = BTreeMap::<usize, Vec<bool>>::new();
    best[0].push(Path {
        cost: 0.0,
        segments: Vec::new(),
    });
    for from in 0..phones.len() {
        if best[from].is_empty() || (given && !boundaries[from]) {
            continue;
        }
        let end = (from + 1..=phones.len())
            .find(|&i| boundaries[i])
            .unwrap_or(phones.len());
        let mut arcs = candidates(phones, from, end, lexicon, beam, exact);
        if given {
            arcs.retain(|c| c.to == end);
        }
        if !exact {
            for arc in &mut arcs {
                arc.cost *= ACOUSTIC_WEIGHT;
            }
        }
        if !exact || (given && arcs.is_empty()) {
            let to = end.min(from + 12);
            if !given || to == end {
                let mut ends = vec![to];
                if !given {
                    let suffix = suffixes.entry(end).or_insert_with(|| {
                        let mut reachable = vec![false; end + 1];
                        reachable[end] = true;
                        for start in (0..end).rev() {
                            reachable[start] = candidates(phones, start, end, lexicon, beam, true)
                                .iter()
                                .any(|c| reachable[c.to]);
                        }
                        reachable
                    });
                    if let Some(j) = (from + 1..to).find(|&j| suffix[j]) {
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
        let partials = prune(core::mem::take(&mut best[from]), beam);
        for arc in arcs {
            for partial in &partials {
                let previous = partial.segments.last().map_or(UNKNOWN_WORD, |c| c.word);
                let cost = partial.cost + arc.cost + lexicon.word_cost(previous, arc.word);
                let mut segments = partial.segments.clone();
                segments.push(arc.clone());
                best[arc.to].push(Path { cost, segments });
            }
            if best[arc.to].len() > beam * 4 {
                best[arc.to] = prune(core::mem::take(&mut best[arc.to]), beam);
            }
        }
    }
    prune(core::mem::take(&mut best[phones.len()]), beam)
}
pub fn recognize(
    phones: &[Phone],
    boundaries: &[bool],
    lexicon: &Lexicon,
    beam: usize,
    given: bool,
    nbest: usize,
) -> Vec<Path> {
    let beam = beam.max(nbest).max(1);
    let mut paths = if phones.iter().any(Phone::has_weak_cues) {
        Vec::new()
    } else {
        decode(phones, boundaries, lexicon, beam, given, true)
    };
    if paths.len() < nbest {
        let approximate = decode(phones, boundaries, lexicon, beam, given, false);
        for path in approximate {
            if !paths.iter().any(|p| {
                p.segments
                    .iter()
                    .map(|c| (c.word, if c.word == UNKNOWN_WORD { c.from } else { 0 }))
                    .eq(path
                        .segments
                        .iter()
                        .map(|c| (c.word, if c.word == UNKNOWN_WORD { c.from } else { 0 })))
            }) {
                paths.push(path);
            }
        }
    }
    paths.truncate(nbest);
    paths
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identity_tones_and_feature_costs() {
        let a = Phone {
            vowel: true,
            ..Phone::default()
        };
        assert_eq!(phone_distance(&a, &a), 0.0);
        assert_eq!(tone_distance(214, 21), 0.0);
        assert_eq!(tone_distance(214, 35), 0.15);
        assert_eq!(
            gap_cost(&Phone {
                reduced_gap: true,
                ..a
            }),
            0.5
        );
    }
    #[test]
    fn trie_recovers_words_and_boundaries() {
        let a = Phone {
            key: 1,
            vowel: true,
            ..Phone::default()
        };
        let b = Phone {
            key: 2,
            ..Phone::default()
        };
        let lexicon = Lexicon::new(
            vec![Entry {
                word: 0,
                phones: vec![a, b],
                count: 9.0,
                following: 0,
            }],
            vec![9.0],
            BTreeMap::new(),
        );
        let paths = recognize(
            &[a, b, a, b],
            &[true, false, false, false, true],
            &lexicon,
            8,
            false,
            1,
        );
        assert_eq!(paths[0].segments.len(), 2);
        assert_eq!(paths[0].segments[0].word, 0);
    }
}
