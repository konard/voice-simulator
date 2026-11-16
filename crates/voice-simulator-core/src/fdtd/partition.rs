//! Split of the links and cells of a grid into the parts of a thread team
//! (issue 24, `parallel.rs`): contiguous ranges of about equal work.

use alloc::vec;
use alloc::vec::Vec;

use super::kernel::Grid;

/// `parts + 1` rising indices into `weights`: part `k` is
/// `bounds[k]..bounds[k + 1]`. Bound `k` is the smallest index whose
/// running sum (the sum of the weights before it) is at least
/// `k * total / parts` (integer division), so the first bound is 0 and
/// the last is `weights.len()`. A part may be empty (more parts than
/// weights, or one heavy weight). `parts` of 0 counts as 1.
pub fn bounds(weights: &[u32], parts: usize) -> Vec<usize> {
    let parts = parts.max(1);
    let total: u64 = weights.iter().map(|&weight| u64::from(weight)).sum();
    let mut bounds = vec![0; parts + 1];
    let mut index = 0;
    let mut sum = 0u64;
    for (k, bound) in bounds.iter_mut().enumerate().take(parts).skip(1) {
        let goal = k as u64 * total / parts as u64;
        while index < weights.len() && sum < goal {
            sum += u64::from(weights[index]);
            index += 1;
        }
        *bound = index;
    }
    bounds[parts] = weights.len();
    bounds
}

/// Work of every link in pass 1: 1 each.
pub fn link_weights(grid: &Grid) -> Vec<u32> {
    vec![1; grid.links()]
}

/// Work of every cell in pass 2: 1 for the update and 1 per touching
/// link (the length of its incident list without padding).
pub fn cell_weights(grid: &Grid) -> Vec<u32> {
    let mut weights = vec![1u32; grid.cells()];
    for (&a, &b) in grid.link_a.iter().zip(&grid.link_b) {
        for cell in [a, b] {
            if let Some(weight) = weights.get_mut(cell as usize) {
                *weight = weight.saturating_add(1);
            }
        }
    }
    weights
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::random::Random;

    #[test]
    fn bounds_cover_the_range() {
        let mut random = Random::new(1);
        for length in [0usize, 1, 2, 7, 100, 1000] {
            let weights: Vec<u32> = (0..length)
                .map(|_| 1 + (random.next() * 13.0) as u32)
                .collect();
            let total: u64 = weights.iter().map(|&w| u64::from(w)).sum();
            for parts in 1..=8 {
                let bounds = bounds(&weights, parts);
                assert_eq!(bounds.len(), parts + 1);
                assert_eq!(bounds[0], 0);
                assert_eq!(bounds[parts], length);
                assert!(bounds.windows(2).all(|pair| pair[0] <= pair[1]));
                for k in 1..parts {
                    let goal = k as u64 * total / parts as u64;
                    let before: u64 = weights[..bounds[k]].iter().map(|&w| u64::from(w)).sum();
                    assert!(before >= goal, "bound {k} of {parts} below its goal");
                    if bounds[k] > 0 {
                        let short = before - u64::from(weights[bounds[k] - 1]);
                        assert!(short < goal, "bound {k} of {parts} not the smallest");
                    }
                }
            }
        }
    }

    #[test]
    fn parts_may_be_empty() {
        assert_eq!(bounds(&[1, 1], 4), vec![0, 0, 1, 1, 2]);
        assert_eq!(bounds(&[], 3), vec![0, 0, 0, 0]);
        assert_eq!(bounds(&[100, 1, 1], 2), vec![0, 1, 3]);
    }
}
