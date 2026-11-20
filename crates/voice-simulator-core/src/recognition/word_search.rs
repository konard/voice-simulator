//! Approximate pronunciation-trie traversal (Unlicense).
//! Nodes are numbered in insertion order. child_offsets contains N+1
//! offsets into children, whose entries are node IDs. feature indexes the
//! substitution matrix column of each node. gaps contains insertion costs
//! per node. Each input row contains deletion cost followed by substitution
//! costs in feature order. The result is (end, node, cost) for each frontier.

use alloc::vec::Vec;

#[derive(Clone, Copy)]
struct State {
    node: usize,
    cost: f64,
    order: usize,
}

impl State {
    fn new(node: usize, cost: f64) -> Self {
        Self {
            node,
            cost,
            order: 0,
        }
    }
}

pub struct Trie<'a> {
    pub child_offsets: &'a [u32],
    pub children: &'a [u32],
    pub feature: &'a [u32],
    pub gaps: &'a [f64],
    pub terminal: &'a [u32],
}

#[derive(Default)]
pub struct SearchScratch {
    slots: Vec<usize>,
    old: Vec<f64>,
    states: Vec<State>,
    next: Vec<State>,
    frontier: Vec<State>,
}

impl SearchScratch {
    fn keep(slots: &mut [usize], states: &mut Vec<State>, beam: usize) {
        let mut count = 0;
        for i in 0..states.len() {
            let state = states[i];
            let slot = &mut slots[state.node];
            if *slot == usize::MAX {
                states[count] = State {
                    order: count,
                    ..state
                };
                *slot = count;
                count += 1;
            } else if state.cost < states[*slot].cost {
                states[*slot].cost = state.cost;
            }
        }
        states.truncate(count);
        for state in states.iter() {
            slots[state.node] = usize::MAX;
        }
        let compare = |a: &State, b: &State| a.cost.total_cmp(&b.cost).then(a.order.cmp(&b.order));
        if states.len() > beam {
            states.select_nth_unstable_by(beam, compare);
            states.truncate(beam);
        }
        states.sort_unstable_by(compare);
    }

    fn insertions(&mut self, limit: f64, beam: usize, trie: &Trie) -> Option<()> {
        self.frontier.clear();
        self.frontier.extend_from_slice(&self.states);
        while !self.frontier.is_empty() {
            self.next.clear();
            self.next.extend_from_slice(&self.states);
            for state in &self.states {
                self.old[state.node] = state.cost;
            }
            for state in &self.frontier {
                for node in trie.children(state.node)? {
                    let cost = state.cost + trie.gaps.get(node)?;
                    if cost <= limit && cost < self.old[node] {
                        self.next.push(State::new(node, cost));
                    }
                }
            }
            if self.next.len() == self.states.len() {
                for state in &self.states {
                    self.old[state.node] = f64::INFINITY;
                }
                break;
            }
            Self::keep(&mut self.slots, &mut self.next, beam);
            self.frontier.clear();
            self.frontier.extend(
                self.next
                    .iter()
                    .copied()
                    .filter(|s| s.cost < self.old[s.node]),
            );
            for state in &self.states {
                self.old[state.node] = f64::INFINITY;
            }
            core::mem::swap(&mut self.states, &mut self.next);
        }
        Some(())
    }
}

impl Trie<'_> {
    fn children(&self, node: usize) -> Option<impl Iterator<Item = usize> + '_> {
        let offsets = self.child_offsets.get(node..node + 2)?;
        Some(
            self.children
                .get(offsets[0] as usize..offsets[1] as usize)?
                .iter()
                .map(|&id| id as usize),
        )
    }

    pub fn search(
        &self,
        input: &[f64],
        stride: usize,
        beam: usize,
        scratch: &mut SearchScratch,
    ) -> Option<Vec<f64>> {
        let nodes = self.feature.len();
        if stride < 2
            || beam == 0
            || nodes == 0
            || self.gaps.len() != nodes
            || self.terminal.len() != nodes
        {
            return None;
        }
        if scratch.slots.len() < nodes {
            scratch.slots.resize(nodes, usize::MAX);
            scratch.old.resize(nodes, f64::INFINITY);
        }
        let result = self.search_rows(input, stride, beam, scratch);
        if result.is_none() {
            scratch.old.fill(f64::INFINITY);
        }
        result
    }

    fn search_rows(
        &self,
        input: &[f64],
        stride: usize,
        beam: usize,
        scratch: &mut SearchScratch,
    ) -> Option<Vec<f64>> {
        scratch.states.clear();
        scratch.states.push(State::new(0, 0.0));
        scratch.insertions(0.6, beam, self)?;
        let mut result = Vec::new();
        for (index, row) in input.chunks_exact(stride).enumerate() {
            if scratch.states.is_empty() {
                break;
            }
            let limit = 0.6 * (index + 2) as f64;
            scratch.next.clear();
            for &state in &scratch.states {
                let deletion = state.cost + row[0];
                if deletion <= limit {
                    scratch.next.push(State {
                        cost: deletion,
                        ..state
                    });
                }
                for node in self.children(state.node)? {
                    let column = *self.feature.get(node)? as usize;
                    let cost = state.cost + row[1..].get(column)?;
                    if cost <= limit {
                        scratch.next.push(State::new(node, cost));
                    }
                }
            }
            SearchScratch::keep(&mut scratch.slots, &mut scratch.next, beam);
            core::mem::swap(&mut scratch.states, &mut scratch.next);
            scratch.insertions(limit, beam, self)?;
            for state in &scratch.states {
                if self.terminal[state.node] != 0 {
                    result.extend([(index + 1) as f64, state.node as f64, state.cost]);
                }
            }
        }
        Some(result)
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
        let mut scratch = SearchScratch::default();
        let input = [0.9, 0.2, 0.2];
        assert_eq!(
            trie.search(&input, 3, 1, &mut scratch).unwrap(),
            [1.0, 1.0, 0.2]
        );
        let invalid = Trie {
            children: &[1, 3],
            ..trie
        };
        assert!(invalid.search(&input, 3, 1, &mut scratch).is_none());
        assert_eq!(
            trie.search(&input, 3, 1, &mut scratch).unwrap(),
            [1.0, 1.0, 0.2]
        );
    }
}
