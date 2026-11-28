//! Approximate pronunciation-trie traversal (Unlicense).
//! child_offsets contains N+1 offsets. An explicit layout gives the node
//! IDs, features, terminal flags and gaps separately. The packed layout
//! uses breadth-first node IDs, combines each feature and terminal flag,
//! and stores gaps by feature. Each input row contains deletion cost followed
//! by substitution costs in feature order. The result is (end, node, cost)
//! for each frontier.
//! The first index in the generated candidate list wins on equal cost.

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
            // Each current state is retained in `next` before insertions. A
            // full beam already has enough earlier states to win a tie.
            let cutoff = if self.states.len() == beam {
                self.states[beam - 1].cost
            } else {
                f64::INFINITY
            };
            for state in &self.frontier {
                for node in trie.children(state.node)? {
                    let cost = state.cost + trie.gap(node)?;
                    if cost <= limit && cost < cutoff && cost < self.old[node] {
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
        let range = offsets[0] as usize..offsets[1] as usize;
        let ids = if self.packed() {
            if range.start > range.end || range.end >= self.feature.len() {
                return None;
            }
            None
        } else {
            Some(self.children.get(range.clone())?)
        };
        Some(range.enumerate().map(move |(i, slot)| match ids {
            Some(ids) => ids[i] as usize,
            None => slot + 1,
        }))
    }

    fn packed(&self) -> bool {
        self.terminal.is_empty()
    }

    fn column(&self, node: usize) -> Option<usize> {
        let feature = *self.feature.get(node)?;
        Some((if self.packed() { feature >> 1 } else { feature }) as usize)
    }

    fn gap(&self, node: usize) -> Option<f64> {
        self.gaps
            .get(if self.packed() {
                self.column(node)?
            } else {
                node
            })
            .copied()
    }

    fn terminal(&self, node: usize) -> bool {
        if self.packed() {
            self.feature[node] & 1 != 0
        } else {
            self.terminal[node] != 0
        }
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
            || (self.packed() && (!self.children.is_empty() || self.gaps.len() != stride - 1))
            || (!self.packed() && (self.gaps.len() != nodes || self.terminal.len() != nodes))
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
                    let column = self.column(node)?;
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
                if self.terminal(state.node) {
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
        let packed = Trie {
            children: &[],
            feature: &[0, 1, 3],
            gaps: &[1.0, 1.0],
            terminal: &[],
            ..trie
        };
        assert_eq!(
            packed.search(&input, 3, 1, &mut scratch),
            trie.search(&input, 3, 1, &mut scratch)
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
