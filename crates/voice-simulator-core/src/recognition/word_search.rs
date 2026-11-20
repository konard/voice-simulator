//! Approximate pronunciation-trie traversal (Unlicense).
//! Nodes are numbered in insertion order. child_offsets contains N+1
//! offsets into children, whose entries are node IDs. feature indexes the
//! substitution matrix column of each node. gaps contains insertion costs
//! per node. Each input row contains deletion cost followed by substitution
//! costs in feature order. The result is (end, node, cost) for each frontier.

use alloc::{vec, vec::Vec};

#[derive(Clone, Copy)]
struct State {
    node: usize,
    cost: f64,
}

pub struct Trie<'a> {
    pub child_offsets: &'a [u32],
    pub children: &'a [u32],
    pub feature: &'a [u32],
    pub gaps: &'a [f64],
    pub terminal: &'a [u32],
}

struct Scratch {
    slots: Vec<usize>,
    old: Vec<f64>,
}

impl Scratch {
    fn keep(&mut self, mut states: Vec<State>, beam: usize) -> Vec<State> {
        self.slots.fill(usize::MAX);
        let mut count = 0;
        for i in 0..states.len() {
            let state = states[i];
            let slot = &mut self.slots[state.node];
            if *slot == usize::MAX {
                states[count] = state;
                *slot = count;
                count += 1;
            } else if state.cost < states[*slot].cost {
                states[*slot] = state;
            }
        }
        states.truncate(count);
        // Stable sorting retains the lower candidate index for equal costs.
        states.sort_by(|a, b| a.cost.total_cmp(&b.cost));
        states.truncate(beam);
        states
    }

    fn insertions(
        &mut self,
        mut all: Vec<State>,
        limit: f64,
        beam: usize,
        trie: &Trie,
    ) -> Vec<State> {
        let mut frontier = all.clone();
        while !frontier.is_empty() {
            for state in &all {
                self.old[state.node] = state.cost;
            }
            let mut next = all.clone();
            for state in frontier {
                for node in trie.children(state.node) {
                    let cost = state.cost + trie.gaps[node];
                    if cost <= limit && cost < self.old[node] {
                        next.push(State { node, cost });
                    }
                }
            }
            let kept = self.keep(next, beam);
            frontier = kept
                .iter()
                .copied()
                .filter(|s| s.cost < self.old[s.node])
                .collect();
            for state in all {
                self.old[state.node] = f64::INFINITY;
            }
            all = kept;
        }
        all
    }
}

impl Trie<'_> {
    fn children(&self, node: usize) -> impl Iterator<Item = usize> + '_ {
        self.children[self.child_offsets[node] as usize..self.child_offsets[node + 1] as usize]
            .iter()
            .map(|&id| id as usize)
    }

    pub fn search(&self, input: &[f64], stride: usize, beam: usize) -> Vec<f64> {
        let mut scratch = Scratch {
            slots: vec![usize::MAX; self.feature.len()],
            old: vec![f64::INFINITY; self.feature.len()],
        };
        let mut states = scratch.insertions(vec![State { node: 0, cost: 0.0 }], 0.6, beam, self);
        let mut result = Vec::new();
        for (index, row) in input.chunks_exact(stride).enumerate() {
            if states.is_empty() {
                break;
            }
            let limit = 0.6 * (index + 2) as f64;
            let mut next = Vec::new();
            for state in states {
                let deletion = state.cost + row[0];
                if deletion <= limit {
                    next.push(State {
                        cost: deletion,
                        ..state
                    });
                }
                for node in self.children(state.node) {
                    let cost = state.cost + row[1 + self.feature[node] as usize];
                    if cost <= limit {
                        next.push(State { node, cost });
                    }
                }
            }
            let kept = scratch.keep(next, beam);
            states = scratch.insertions(kept, limit, beam, self);
            for state in &states {
                if self.terminal[state.node] != 0 {
                    result.extend([(index + 1) as f64, state.node as f64, state.cost]);
                }
            }
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn lower_candidate_index_wins_tie() {
        let trie = Trie {
            child_offsets: &[0, 2, 2, 2],
            children: &[1, 2],
            feature: &[0, 0, 1],
            gaps: &[0.0, 1.0, 1.0],
            terminal: &[0, 1, 1],
        };
        assert_eq!(trie.search(&[0.9, 0.2, 0.2], 3, 1), [1.0, 1.0, 0.2]);
    }
}
