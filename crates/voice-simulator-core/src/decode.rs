//! Segmental IPA decoding from the shared recognition frame grid.
use crate::math;
use alloc::collections::{BTreeMap, BTreeSet};
use alloc::{vec, vec::Vec};

pub const CHANNELS: usize = 21;
const POINTS: [f64; 5] = [0.1, 0.3, 0.5, 0.7, 0.9];
const EPS: f64 = 1e-9;
const CLASSES: usize = 8;

fn square(value: f64) -> f64 {
    value * value
}

pub struct Template {
    /// Nominal duration after applying this voice's speech rate.
    pub duration: f64,
    pub classes: u8,
    /// Compared cells of the five-by-21 sample matrix, with their targets.
    pub compared: Vec<(usize, f64)>,
}

pub struct Observations<'a> {
    pub start: f64,
    pub hop: f64,
    pub speech: &'a [u8],
    pub classes: &'a [u8],
    pub landmarks: &'a [f64],
    /// Twelve tract channels followed by nine source channels.
    pub values: &'a [[f64; CHANNELS]],
    pub variance: &'a [[f64; CHANNELS]],
    pub ranges: [f64; CHANNELS],
}

pub struct Bounds {
    pub from: f64,
    pub to: f64,
    pub open: bool,
    pub locked: bool,
}

#[derive(Clone, Copy)]
struct Gap {
    start: f64,
    end: f64,
}

impl Gap {
    fn is_pause(self) -> bool {
        self.end - self.start >= 0.15 - EPS
    }
}

fn gaps(input: &Observations<'_>, first: usize, last: usize, bounds: &Bounds) -> Vec<Gap> {
    let mut gaps = Vec::new();
    let mut row = first;
    while row < last {
        if input.speech[row] != 0 {
            row += 1;
            continue;
        }
        let start = (input.start + row as f64 * input.hop).max(bounds.from);
        while row < last && input.speech[row] == 0 {
            row += 1;
        }
        let end = if row == last {
            bounds.to
        } else {
            input.start + row as f64 * input.hop
        };
        gaps.push(Gap { start, end });
    }
    gaps
}

fn speed_peaks(input: &Observations<'_>, first: usize, last: usize, add: &mut impl FnMut(f64, u8)) {
    let n = last - first;
    let mut speed = vec![0.0; n];
    for c in 0..12 {
        for (i, value) in speed
            .iter_mut()
            .enumerate()
            .skip(2)
            .take(n.saturating_sub(4))
        {
            let delta =
                (input.values[first + i + 2][c] - input.values[first + i - 2][c]) / input.ranges[c];
            *value += delta * delta;
        }
    }
    for i in 2..n.saturating_sub(2) {
        if speed[i] > 0.15 * 0.15 && speed[i] > speed[i - 1] && speed[i] >= speed[i + 1] {
            add(input.start + (first + i) as f64 * input.hop, 0);
        }
    }
}

fn boundaries(input: &Observations<'_>, bounds: &Bounds) -> (Vec<f64>, Vec<Gap>) {
    let first = (math::floor((bounds.from - input.start) / input.hop + EPS) as usize)
        .min(input.values.len());
    let last = frame_at(input, bounds.to);
    if first >= last || !input.speech[first..last].iter().any(|&flag| flag > 0) {
        let gap = Gap {
            start: bounds.from,
            end: bounds.to,
        };
        if bounds.locked && gap.is_pause() {
            return (vec![gap.start, gap.end], vec![gap]);
        }
        return (Vec::new(), Vec::new());
    }
    let gaps = gaps(input, first, last, bounds);
    let start = gaps
        .first()
        .filter(|gap| !bounds.locked && gap.start <= bounds.from && !gap.is_pause())
        .map_or(bounds.from, |gap| gap.end);
    let end = gaps
        .last()
        .filter(|gap| !bounds.open && gap.end == bounds.to && !gap.is_pause())
        .map_or(bounds.to, |gap| gap.start);
    let pauses: Vec<_> = gaps.iter().copied().filter(|gap| gap.is_pause()).collect();
    let mut candidates = Vec::new();
    let mut add = |time: f64, priority| {
        if time >= start && time <= end {
            candidates.push((time, priority));
        }
    };
    add(start, 4);
    add(end, 4);
    for gap in gaps {
        let priority = if gap.is_pause() { 4 } else { 3 };
        add(gap.start, priority);
        add(gap.end, priority);
    }
    for &time in input.landmarks {
        add(time, 2);
    }
    for i in first + 1..last {
        if input.classes[i] != input.classes[i - 1] {
            add(input.start + i as f64 * input.hop, 1);
        }
    }
    speed_peaks(input, first, last, &mut add);
    candidates.sort_by(|a, b| a.0.total_cmp(&b.0).then(b.1.cmp(&a.1)));
    let mut kept: Vec<(f64, u8)> = Vec::new();
    for (time, priority) in candidates {
        if let Some(previous) = kept.last_mut() {
            let delta = time - previous.0;
            if delta < 0.015 - EPS {
                if priority > previous.1 {
                    *previous = (time, priority);
                    continue;
                }
                if priority != 4 || previous.1 != 4 || delta <= EPS {
                    continue;
                }
            }
        }
        kept.push((time, priority));
    }
    let times = kept
        .into_iter()
        .map(|(time, _)| time)
        .filter(|&time| !pauses.iter().any(|gap| gap.start < time && time < gap.end))
        .collect();
    (times, pauses)
}

fn frame_at(input: &Observations<'_>, time: f64) -> usize {
    (math::ceil((time - input.start) / input.hop - EPS) as usize).min(input.classes.len())
}

fn acoustic_costs(
    input: &Observations<'_>,
    start: f64,
    end: f64,
    templates: &[Template],
) -> Vec<PhoneCost> {
    let duration = end - start;
    let mut class_counts = [0; CLASSES];
    let first = frame_at(input, start);
    let last = frame_at(input, end);
    for &class in &input.classes[first..last] {
        class_counts[usize::from(class)] += 1;
    }
    let n = (last - first).max(1) as f64;
    let mut means = [0.0; CHANNELS * POINTS.len()];
    let mut precision = means;
    for (k, relative) in POINTS.into_iter().enumerate() {
        let index = ((start + relative * duration - input.start) * (1.0 / input.hop))
            .clamp(0.0, (input.values.len() - 1) as f64);
        let lo = index as usize;
        let hi = (lo + 1).min(input.values.len() - 1);
        let ratio = index - lo as f64;
        for c in 0..CHANNELS {
            let cell = k * CHANNELS + c;
            means[cell] = (1.0 - ratio) * input.values[lo][c] + ratio * input.values[hi][c];
            let v = if ratio == 0.0 {
                input.variance[lo][c]
            } else {
                (1.0 - ratio) * input.variance[lo][c] + ratio * input.variance[hi][c]
            };
            precision[cell] = 1.0 / (v + square(0.15 * input.ranges[c]));
        }
    }
    templates
        .iter()
        .map(|unit| {
            let acoustic: f64 = unit
                .compared
                .iter()
                .map(|&(cell, target)| square(means[cell] - target) * precision[cell])
                .sum();
            let mismatch: usize = class_counts
                .iter()
                .enumerate()
                .filter(|(c, _)| unit.classes & (1 << c) == 0)
                .map(|(_, count)| count)
                .sum();
            PhoneCost {
                acoustic: acoustic / unit.compared.len() as f64,
                duration: 2.0 * square(math::ln(duration / unit.duration)),
                class: mismatch as f64 / n,
                long: duration > 1.6 * unit.duration,
            }
        })
        .collect()
}

#[derive(Clone, Copy)]
pub struct PhoneCost {
    pub acoustic: f64,
    pub duration: f64,
    pub class: f64,
    pub long: bool,
}

enum Span {
    Pause(usize),
    Phones(usize, Vec<PhoneCost>),
}

pub struct Graph {
    pub times: Vec<f64>,
    spans: Vec<Vec<Span>>,
}

/// Construct the legal semi-Markov spans and the three unweighted cost terms.
pub fn prepare(input: &Observations<'_>, templates: &[Template], bounds: &Bounds) -> Graph {
    let (times, pauses) = boundaries(input, bounds);
    let mut spans = Vec::with_capacity(times.len());
    let mut pause = 0;
    for (from, &start) in times.iter().enumerate() {
        let mut outgoing = Vec::new();
        while pause < pauses.len() && pauses[pause].end <= start + EPS {
            pause += 1;
        }
        let next_pause = pauses.get(pause).map_or(f64::INFINITY, |gap| gap.start);
        if (next_pause - start).abs() <= EPS {
            outgoing.push(Span::Pause(from + 1));
        } else {
            for (to, &end) in times.iter().enumerate().skip(from + 1).take(4) {
                if end - start > 0.4 + EPS || end > next_pause + EPS {
                    break;
                }
                if end - start >= 0.02 - EPS {
                    outgoing.push(Span::Phones(
                        to,
                        acoustic_costs(input, start, end, templates),
                    ));
                }
            }
        }
        spans.push(outgoing);
    }
    Graph { times, spans }
}

#[derive(Clone, Copy)]
pub struct Weights {
    pub duration: f64,
    pub class: f64,
    pub phonotactic: f64,
}

pub struct Policy<'a> {
    pub units: usize,
    pub beam: usize,
    pub nbest: usize,
    pub last_unit: usize,
    /// Row major: units plus the start/pause row, by units.
    pub transition: &'a [f64],
    pub weights: Weights,
}

/// Matrix of a single language, with the final row/column standing for '#'.
pub struct LanguageModel<'a> {
    pub counts: &'a [u16],
    /// For each union unit, its index in this language, if present.
    pub ids: &'a [Option<usize>],
    pub width: usize,
}

pub fn transition_costs(units: usize, models: &[LanguageModel<'_>]) -> Vec<f64> {
    let mut costs = vec![
        if models.is_empty() {
            0.0
        } else {
            f64::INFINITY
        };
        (units + 1) * units
    ];
    for model in models {
        let width = model.width;
        let boundary = width - 1;
        let totals: Vec<f64> = model
            .counts
            .chunks_exact(width)
            .map(|row| row.iter().map(|&n| f64::from(n)).sum::<f64>() + 0.5 * width as f64)
            .collect();
        let p = |a, b| (f64::from(model.counts[a * width + b]) + 0.5) / totals[a];
        for from in 0..=units {
            let row = if from == units {
                Some(boundary)
            } else {
                model.ids[from]
            };
            for (to, id) in model.ids.iter().enumerate() {
                if let Some(to_id) = id {
                    let q = row.map_or(p(boundary, *to_id), |a| {
                        p(a, *to_id).max(p(a, boundary) * p(boundary, *to_id))
                    });
                    let slot = &mut costs[from * units + to];
                    *slot = slot.min(-math::ln(q));
                }
            }
        }
    }
    costs
}

#[derive(Clone, Copy)]
pub struct Arc {
    pub from: usize,
    pub to: usize,
    /// The extra transition row represents a pause.
    pub unit: usize,
    pub cost: f64,
    pub confidence: f64,
    pub pause: bool,
    pub long: bool,
}

#[derive(Clone, Copy)]
struct Path {
    cost: f64,
    sequence: usize,
    previous: usize,
    arc: Option<Arc>,
}

#[derive(Default)]
struct State {
    paths: Vec<usize>,
    edges: Vec<Arc>,
}

pub struct Reading {
    pub cost: f64,
    pub arcs: Vec<Arc>,
}

pub struct Search {
    pub edges: Vec<Arc>,
    pub readings: Vec<Reading>,
    pub frontier: Vec<Reading>,
    pub provisional: Option<Reading>,
}

struct History {
    paths: Vec<Path>,
    sequences: BTreeMap<(usize, usize), usize>,
}

impl History {
    fn new() -> Self {
        Self {
            paths: vec![Path {
                cost: 0.0,
                sequence: 0,
                previous: 0,
                arc: None,
            }],
            sequences: BTreeMap::new(),
        }
    }

    fn offer(&mut self, paths: &mut Vec<usize>, previous: usize, arc: Arc, policy: &Policy<'_>) {
        let prefix = self.paths[previous];
        let cost = prefix.cost + arc.cost;
        if paths.len() == policy.nbest && cost >= self.paths[*paths.last().unwrap()].cost {
            return;
        }
        let sequence = if arc.unit == policy.units {
            prefix.sequence
        } else {
            let next = self.sequences.len() + 1;
            *self
                .sequences
                .entry((prefix.sequence, arc.unit))
                .or_insert(next)
        };
        if let Some(i) = paths
            .iter()
            .position(|&id| self.paths[id].sequence == sequence)
        {
            if self.paths[paths[i]].cost <= cost {
                return;
            }
            paths.remove(i);
        }
        let at = paths.partition_point(|&id| self.paths[id].cost <= cost);
        paths.insert(at, self.paths.len());
        paths.truncate(policy.nbest);
        self.paths.push(Path {
            cost,
            sequence,
            previous,
            arc: Some(arc),
        });
    }

    fn reading(&self, id: usize) -> Reading {
        let mut current = id;
        let mut arcs = Vec::new();
        while let Some(arc) = self.paths[current].arc {
            arcs.push(arc);
            current = self.paths[current].previous;
        }
        arcs.reverse();
        Reading {
            cost: self.paths[id].cost,
            arcs,
        }
    }
}

fn connect(
    states: &mut [State],
    parents: &[(usize, State)],
    from: usize,
    span: &Span,
    history: &mut History,
    policy: &Policy<'_>,
) {
    let width = policy.units;
    let (to, terms) = match span {
        Span::Pause(to) => {
            let arc = Arc {
                from,
                to: *to,
                unit: width,
                cost: 0.0,
                confidence: 1.0,
                pause: true,
                long: false,
            };
            let state = &mut states[width];
            for (_, parent) in parents {
                for &path in &parent.paths {
                    history.offer(&mut state.paths, path, arc, policy);
                }
            }
            state.edges.push(arc);
            return;
        }
        Span::Phones(to, terms) => (*to, terms),
    };
    let weights = policy.weights;
    let scores: Vec<f64> = terms
        .iter()
        .map(|t| t.acoustic + weights.duration * t.duration + weights.class * t.class)
        .collect();
    let best = scores.iter().copied().fold(f64::INFINITY, f64::min);
    let denominator: f64 = scores.iter().map(|score| math::exp(best - score)).sum();
    for (unit, &score) in scores.iter().enumerate() {
        let state = &mut states[unit];
        let mut cheapest = f64::INFINITY;
        let confidence = math::exp(best - score) / denominator;
        let long = terms[unit].long;
        for (last_unit, parent) in parents {
            let cost = score + weights.phonotactic * policy.transition[last_unit * width + unit];
            cheapest = cheapest.min(cost);
            let arc = Arc {
                from,
                to,
                unit,
                cost,
                confidence,
                pause: false,
                long,
            };
            for &path in &parent.paths {
                history.offer(&mut state.paths, path, arc, policy);
            }
        }
        state.edges.push(Arc {
            from,
            to,
            unit,
            cost: cheapest,
            confidence,
            pause: false,
            long,
        });
    }
}

/// Keep the best distinct sequences in each state and the beam at each boundary.
pub fn search(graph: &Graph, policy: &Policy<'_>) -> Search {
    let mut edges = Vec::new();
    let mut frontier = Vec::new();
    let mut terminal = Vec::new();
    let mut last_reachable = None;
    if graph.times.is_empty() {
        return Search {
            edges,
            frontier,
            readings: terminal,
            provisional: None,
        };
    }
    let mut history = History::new();
    let mut pending: Vec<Vec<State>> = (0..graph.times.len())
        .map(|_| (0..=policy.units).map(|_| State::default()).collect())
        .collect();
    pending[0][policy.last_unit].paths.push(0);
    let n = graph.times.len();
    for from in 0..n {
        let mut parents: Vec<_> = core::mem::take(&mut pending[from])
            .into_iter()
            .enumerate()
            .filter(|(_, state)| !state.paths.is_empty())
            .collect();
        parents.sort_by(|(_, a), (_, b)| {
            history.paths[a.paths[0]]
                .cost
                .total_cmp(&history.paths[b.paths[0]].cost)
        });
        parents.truncate(policy.beam);
        if parents.is_empty() {
            continue;
        }
        last_reachable = Some(parents[0].1.paths[0]);
        for (_, state) in &parents {
            edges.extend(&state.edges);
            if n - from <= 5 && graph.times[n - 1] - graph.times[from] <= 0.4 {
                frontier.push(history.reading(state.paths[0]));
            }
        }
        if from + 1 == n {
            let mut ids: Vec<usize> = parents
                .into_iter()
                .flat_map(|(_, state)| state.paths)
                .collect();
            ids.sort_by(|&a, &b| history.paths[a].cost.total_cmp(&history.paths[b].cost));
            let mut seen = BTreeSet::new();
            terminal = ids
                .into_iter()
                .filter(|&id| seen.insert(history.paths[id].sequence))
                .take(policy.nbest)
                .map(|id| history.reading(id))
                .collect();
            break;
        }
        for span in &graph.spans[from] {
            let (Span::Pause(to) | Span::Phones(to, _)) = span;
            connect(
                &mut pending[*to],
                &parents,
                from,
                span,
                &mut history,
                policy,
            );
        }
    }
    Search {
        edges,
        provisional: last_reachable
            .filter(|_| terminal.is_empty())
            .map(|id| history.reading(id)),
        readings: terminal,
        frontier,
    }
}

/// Stops at the first arc lacking consensus or the required lookback.
pub fn committed_prefix(
    path: &Reading,
    frontier: &[Reading],
    times: &[f64],
    clock: f64,
    final_input: bool,
) -> usize {
    path.arcs
        .iter()
        .enumerate()
        .take_while(|(i, arc)| {
            if final_input {
                return true;
            }
            if arc.pause && arc.to == times.len() - 1 {
                return false;
            }
            let age = clock - times[arc.to];
            let deadline = frontier.iter().any(|other| {
                other
                    .arcs
                    .get(*i)
                    .is_some_and(|other| clock - times[other.to] >= 0.52 - EPS)
            });
            let consensus = frontier.iter().all(|other| {
                other.arcs.get(*i).is_some_and(|other| {
                    (other.from, other.to, other.unit) == (arc.from, arc.to, arc.unit)
                })
            });
            age >= 0.5 - EPS || (age >= 0.3 - EPS && (deadline || consensus))
        })
        .count()
}
