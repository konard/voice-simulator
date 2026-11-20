//! Bounded codebook search (Unlicense).
//! Tree rows contain [entry, split axis, left, right] with u32::MAX for a
//! missing branch. Entry keys are six f32s and envelopes 24 quantized u8s
//! per row. Each f64 query holds 24 bands (NaN for missing), then six keys.
//! The output has k consecutive (row, cost) pairs per query, with (-1, inf)
//! for empty slots. Both heap pruning and result ranking break ties by row.
use alloc::{collections::BinaryHeap, vec::Vec};
use core::cmp::Ordering;

const BANDS: usize = 24;
const KEY: usize = 6;
pub const QUERY_WIDTH: usize = BANDS + KEY;
const NEIGHBOURS: usize = 64;
const VISITS: usize = 192;

#[derive(Clone, Copy)]
struct Candidate {
    distance: f64,
    row: usize,
}

impl Ord for Candidate {
    fn cmp(&self, other: &Self) -> Ordering {
        // Squared distances are nonnegative, so their bit patterns sort in
        // numeric order. An invalid NaN sorts after every numeric distance.
        self.distance
            .to_bits()
            .cmp(&other.distance.to_bits())
            .then(self.row.cmp(&other.row))
    }
}

impl PartialOrd for Candidate {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

impl PartialEq for Candidate {
    fn eq(&self, other: &Self) -> bool {
        self.cmp(other).is_eq()
    }
}

impl Eq for Candidate {}

pub struct Codebook<'a> {
    tree: &'a [[u32; 4]],
    key: &'a [[f32; KEY]],
    envelope: &'a [[u8; BANDS]],
}

impl<'a> Codebook<'a> {
    pub fn new(tree: &'a [u32], key: &'a [f32], envelope: &'a [u8]) -> Option<Self> {
        let size = tree.len() / 4;
        if size == 0
            || !tree.len().is_multiple_of(4)
            || key.len() / KEY != size
            || envelope.len() / BANDS != size
            || !key.len().is_multiple_of(KEY)
            || !envelope.len().is_multiple_of(BANDS)
            || tree.as_chunks::<4>().0.iter().any(|node| {
                node[0] as usize >= size
                    || node[1] as usize >= KEY
                    || node[2..]
                        .iter()
                        .any(|&child| child != u32::MAX && child as usize >= size)
            })
        {
            return None;
        }
        Some(Self {
            tree: tree.as_chunks::<4>().0,
            key: key.as_chunks::<KEY>().0,
            envelope: envelope.as_chunks::<BANDS>().0,
        })
    }

    pub fn query(&self, queries: &[f64], k: usize) -> Vec<f64> {
        let mut out = Vec::with_capacity((queries.len() / QUERY_WIDTH) * k * 2);
        let mut shortlist = BinaryHeap::with_capacity(NEIGHBOURS);
        let mut ranked = Vec::with_capacity(NEIGHBOURS);
        for query in queries.as_chunks::<QUERY_WIDTH>().0 {
            let expected = out.len() + 2 * k;
            let mut bands = [0; BANDS];
            let mut levels = [0.0; BANDS];
            let mut count = 0;
            for (i, &value) in query[..BANDS].iter().enumerate() {
                if value.is_finite() {
                    bands[count] = i;
                    levels[count] = value * 2.0 + 128.0;
                    count += 1;
                }
            }
            if count > 0 {
                let contiguous = bands[count - 1] == count - 1;
                shortlist.clear();
                Search {
                    book: self,
                    key: query.last_chunk().unwrap(),
                    best: &mut shortlist,
                    axes: [0.0; KEY],
                    visits: 0,
                }
                .walk(0, 0.0);
                ranked.clear();
                ranked.extend(shortlist.iter().map(|candidate| {
                    let row = candidate.row;
                    let stored = &self.envelope[row];
                    let sum: f64 = if count == BANDS {
                        levels
                            .iter()
                            .zip(stored)
                            .map(|(level, stored)| difference(*level, *stored))
                            .sum()
                    } else if contiguous {
                        levels[..count]
                            .iter()
                            .zip(stored)
                            .map(|(level, stored)| difference(*level, *stored))
                            .sum()
                    } else {
                        levels[..count]
                            .iter()
                            .zip(&bands)
                            .map(|(level, band)| difference(*level, stored[*band]))
                            .sum()
                    };
                    let distance = sum * 0.25 / count as f64;
                    Candidate { distance, row }
                }));
                if k < ranked.len() {
                    ranked.select_nth_unstable(k);
                    ranked.truncate(k);
                }
                ranked.sort_unstable();
                out.extend(
                    ranked
                        .iter()
                        .flat_map(|item| [item.row as f64, item.distance]),
                );
            }
            while out.len() < expected {
                out.extend([-1.0, f64::INFINITY]);
            }
        }
        out
    }
}

#[inline]
fn difference(level: f64, stored: u8) -> f64 {
    let delta = level - f64::from(stored);
    delta * delta
}

struct Search<'a, 'table> {
    book: &'a Codebook<'table>,
    key: &'a [f64; KEY],
    best: &'a mut BinaryHeap<Candidate>,
    axes: [f64; KEY],
    visits: usize,
}

impl Search<'_, '_> {
    fn walk(&mut self, node: u32, bound: f64) {
        // The visit limit also bounds recursion if a malformed tree has a cycle.
        if node == u32::MAX
            || self.visits == VISITS
            || (self.best.len() == NEIGHBOURS && bound > self.best.peek().unwrap().distance)
        {
            return;
        }
        let entry = &self.book.tree[node as usize];
        let row = entry[0] as usize;
        let axis = entry[1] as usize;
        let stored = &self.book.key[row];
        let delta = self.key[axis] - f64::from(stored[axis]);
        let distance = self
            .key
            .iter()
            .zip(stored)
            .map(|(a, &b)| {
                let difference = a - f64::from(b);
                difference * difference
            })
            .sum();
        self.visits += 1;
        let candidate = Candidate { row, distance };
        if self.best.len() < NEIGHBOURS {
            self.best.push(candidate);
        } else if candidate < *self.best.peek().unwrap() {
            *self.best.peek_mut().unwrap() = candidate;
        }
        let near = if delta <= 0.0 { 2 } else { 3 };
        self.walk(entry[near], bound);
        let far = entry[5 - near];
        if far != u32::MAX {
            let old = self.axes[axis];
            let next = old.max(delta * delta);
            self.axes[axis] = next;
            self.walk(far, bound + next - old);
            self.axes[axis] = old;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec;

    #[test]
    fn ranks_envelopes_and_keeps_lower_entry_on_a_tie() {
        let book = Codebook::new(
            &[1, 0, 1, u32::MAX, 0, 0, u32::MAX, u32::MAX],
            &[0.0; 2 * KEY],
            &[128; 2 * BANDS],
        )
        .unwrap();
        let mut query = vec![0.0; 2 * QUERY_WIDTH];
        query[0] = 2.0;
        query[QUERY_WIDTH..].fill(f64::NAN);
        assert_eq!(
            book.query(&query, 2),
            vec![
                0.0,
                4.0 / 24.0,
                1.0,
                4.0 / 24.0,
                -1.0,
                f64::INFINITY,
                -1.0,
                f64::INFINITY
            ]
        );
    }
}
