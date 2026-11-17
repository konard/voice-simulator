//! Count-weighted phone language models and pause-aware Viterbi (issue 69).
//! Parsing and corpus loading stay shared with the JavaScript implementation.
use crate::math;
use alloc::collections::BTreeMap;
use alloc::vec;
use alloc::vec::Vec;

#[derive(Default)]
pub struct Model {
    pub singles: BTreeMap<u32, f64>,
    pub pairs: BTreeMap<(u32, u32), f64>,
    pub triples: BTreeMap<(u32, u32, u32), f64>,
    pub total: f64,
}
impl Model {
    /// Symbol zero is the word boundary; stress and tones are not symbols.
    pub fn add(&mut self, symbols: &[u32], count: f64) {
        let sequence: Vec<_> = core::iter::once(0)
            .chain(symbols.iter().copied())
            .chain(core::iter::once(0))
            .collect();
        for (i, &c) in sequence.iter().enumerate() {
            *self.singles.entry(c).or_default() += count;
            self.total += count;
            if i >= 1 {
                *self.pairs.entry((sequence[i - 1], c)).or_default() += count;
            }
            if i >= 2 {
                *self
                    .triples
                    .entry((sequence[i - 2], sequence[i - 1], c))
                    .or_default() += count;
            }
        }
    }
    /// Final calibration: 0.6/0.3/0.1 interpolation, unigram floor 0.0001.
    pub fn probability(&self, a: u32, b: u32, c: u32) -> f64 {
        let pair = self.pairs.get(&(a, b)).copied().unwrap_or(f64::INFINITY);
        let single = self.singles.get(&b).copied().unwrap_or(f64::INFINITY);
        0.6 * self.triples.get(&(a, b, c)).copied().unwrap_or(0.0) / pair
            + 0.3 * self.pairs.get(&(b, c)).copied().unwrap_or(0.0) / single
            + 0.1 * (self.singles.get(&c).copied().unwrap_or(0.0) / self.total.max(1.0)).max(0.0001)
    }
}

pub struct Sound {
    pub symbol: u32,
    pub tone: bool,
    pub reset: bool,
    pub duration: f64,
}
pub struct Unit {
    pub from: usize,
    pub to: usize,
    pub pause: bool,
}

/// Scores retain word context across syllables, resetting only at spaces/pauses.
pub fn score(models: &[Model], sounds: &[Sound], units: &[Unit], zh: usize) -> Vec<Vec<f64>> {
    let mut a = 0;
    let mut b = 0;
    let mut scores = Vec::new();
    for unit in units {
        let mut row = vec![0.0; models.len()];
        let mut tone = false;
        for sound in &sounds[unit.from..unit.to] {
            if sound.reset {
                a = 0;
                b = 0;
            }
            for (l, model) in models.iter().enumerate() {
                row[l] += math::ln(model.probability(a, b, sound.symbol));
            }
            a = b;
            b = sound.symbol;
            tone |= sound.tone;
        }
        if tone && zh < models.len() {
            row[zh] += 3.0;
        }
        scores.push(row);
    }
    scores
}

pub fn path(scores: &[Vec<f64>], units: &[Unit], languages: usize, penalty: f64) -> Vec<usize> {
    let mut previous = vec![0.0; languages];
    let mut backs = Vec::new();
    for (u, row) in scores.iter().enumerate() {
        let mut back = vec![0; languages];
        let mut next = vec![0.0; languages];
        for l in 0..languages {
            let mut value = previous[l];
            back[l] = l;
            for (j, &score) in previous.iter().enumerate() {
                let change = score - penalty * if units[u].pause { 0.5 } else { 1.0 };
                if j != l && change > value {
                    value = change;
                    back[l] = j;
                }
            }
            next[l] = value + row[l];
        }
        previous = next;
        backs.push(back);
    }
    let mut at = 0;
    for l in 1..languages {
        if previous[l] > previous[at] {
            at = l;
        }
    }
    let mut result = vec![0; units.len()];
    for u in (0..units.len()).rev() {
        result[u] = at;
        at = backs[u][at];
    }
    let original = result.clone();
    for u in 1..units.len().saturating_sub(1) {
        if original[u - 1] == original[u + 1] && original[u] != original[u - 1] {
            result[u] = original[u - 1];
        }
    }
    result
}

pub fn confidence(scores: &[f64], sounds: usize, minimum: f64) -> f64 {
    let mut ranked = scores.to_vec();
    ranked.sort_by(|a, b| b.total_cmp(a));
    let gap = if ranked.len() > 1 {
        ranked[0] - ranked[1]
    } else {
        f64::INFINITY
    };
    (1.0 - math::exp(-gap / 4.0))
        * (sounds as f64 / if minimum == 0.0 { 1.0 } else { minimum }).min(1.0)
}

pub fn shares(weights: &[(usize, f64)], languages: usize) -> Vec<f64> {
    let mut totals = vec![0.0; languages];
    let mut total = 0.0;
    for &(language, weight) in weights {
        totals[language] += weight;
        total += weight;
    }
    if total > 0.0 {
        for share in &mut totals {
            *share /= total;
        }
    }
    totals
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn weighted_interpolation_and_uncertainty() {
        let mut model = Model::default();
        model.add(&[1, 2, 1], 2.0);
        assert_eq!(model.total, 10.0);
        assert!(math::abs(model.probability(0, 1, 2) - 0.77) < 1e-12);
        assert_eq!(model.probability(99, 99, 99), 0.00001);
        assert!(confidence(&[-3.0, -4.0], 3, 8.0) < 0.5);
        assert_eq!(shares(&[(0, 3.0), (1, 1.0)], 2), vec![0.75, 0.25]);
    }
}
