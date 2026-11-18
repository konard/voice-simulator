//! Acoustic inversion over a host-provided candidate lattice. Unlicense.
use crate::math::{exp, expm1};
use alloc::{vec, vec::Vec};

pub const WIDTH: usize = 12;
pub const ROW: usize = WIDTH * 2 + 1;

pub struct Lattice<'a> {
    /// Quantized codebook rows (12 byte-valued cells per row).
    pub shape: &'a [f64],
    /// Row numbers and local costs (row-major; -1 marks unused cells).
    pub index: &'a [f64],
    pub cost: &'a [f64],
    pub stride: usize,
    pub min: [f64; WIDTH],
    pub range: [f64; WIDTH],
    pub defaults: [f64; WIDTH],
    pub step: [f64; WIDTH],
    pub smoothness: f64,
}

impl Lattice<'_> {
    fn transition_weights(&self, smoothness: f64) -> [f64; WIDTH] {
        core::array::from_fn(|c| {
            let scale = self.range[c] / (255.0 * self.step[c]);
            smoothness * (scale * scale)
        })
    }

    fn distance(&self, a: usize, b: usize, weight: &[f64; WIDTH]) -> f64 {
        let mut sum = 0.0;
        for (c, w) in weight.iter().enumerate() {
            let d = self.shape[a * WIDTH + c] - self.shape[b * WIDTH + c];
            sum += d * d * w;
        }
        sum
    }

    fn counts(&self) -> Vec<usize> {
        self.index
            .chunks_exact(self.stride)
            .map(|row| row.iter().take_while(|&&entry| entry >= 0.0).count())
            .collect()
    }

    /// Return the nearest 32 full closures among the host's seed rows.
    pub fn closure_candidates(&self, previous: usize, seeds: usize) -> Vec<usize> {
        let weights = self.transition_weights(1.0);
        let mut rows = Vec::new();
        for (i, row) in self
            .shape
            .as_chunks::<WIDTH>()
            .0
            .iter()
            .take(seeds)
            .enumerate()
        {
            let lip = row[5] > 127.0 && row[6] * 2.0 / 255.0 < 0.05;
            let tongue = row[7] > 127.0 && row[8] * 2.0 / 255.0 < 0.05;
            if lip || tongue {
                rows.push((i, self.distance(i, previous, &weights)));
            }
        }
        rows.sort_by(|a, b| a.1.total_cmp(&b.1).then(a.0.cmp(&b.0)));
        rows.into_iter().take(32).map(|(row, _)| row).collect()
    }

    fn search(&self, counts: &[usize], lag: usize, mut commit: impl FnMut(usize, usize, &[i8])) {
        let weight = self.transition_weights(self.smoothness);
        let history = counts.len().min(lag.saturating_add(1));
        let mut back = vec![-1; history * self.stride];
        let mut winner = vec![-1; history];
        let mut path = vec![-1; history];
        let mut committed = 0;
        let mut previous = [0.0; 64];
        let mut current = [0.0; 64];
        for (t, &count) in counts.iter().enumerate() {
            let start = t * self.stride;
            let slot = t % history;
            let older = t.checked_sub(1).map_or(0, |p| counts[p]);
            let mut best = 0;
            for j in 0..count {
                let mut lowest = f64::INFINITY;
                let to = self.index[start + j] as usize;
                let pointer = &mut back[slot * self.stride + j];
                *pointer = -1;
                for (i, &previous) in previous.iter().enumerate().take(older) {
                    let from = self.index[start - self.stride + i] as usize;
                    let total = previous + self.distance(from, to, &weight);
                    if total < lowest {
                        lowest = total;
                        *pointer = i as i8;
                    }
                }
                current[j] = self.cost[start + j] + if older == 0 { 0.0 } else { lowest };
                if current[j] < current[best] {
                    best = j;
                }
            }
            winner[slot] = if count > 0 { best as i8 } else { -1 };
            if count > 0 {
                let baseline = current[best];
                for value in &mut current[..count] {
                    *value -= baseline;
                }
            }
            core::mem::swap(&mut previous, &mut current);
            let end = t + 1;
            if end > lag {
                let choices = &mut path[..end - committed];
                trace(committed, choices, &winner, &back, self.stride);
                commit(committed, committed + 1, choices);
                committed += 1;
            }
        }
        if committed < counts.len() {
            let choices = &mut path[..counts.len() - committed];
            trace(committed, choices, &winner, &back, self.stride);
            commit(committed, counts.len(), choices);
        }
    }

    fn measurement(&self, t: usize, choice: usize, count: usize) -> ([f64; WIDTH], [f64; WIDTH]) {
        let start = t * self.stride;
        let local = &self.cost[start..start + count];
        let min = local.iter().fold(f64::INFINITY, |a, &b| a.min(b));
        let mut weights = [0.0; 64];
        let mut total = 0.0;
        for (w, &cost) in weights.iter_mut().zip(local) {
            *w = exp((min - cost) * 0.5);
            total += *w;
        }
        let chosen = self.index[start + choice] as usize * WIDTH;
        let mut mean = [0.0; WIDTH];
        let mut variance = [0.0; WIDTH];
        for c in 0..WIDTH {
            let scale = self.range[c] / 255.0;
            let value = self.shape[chosen + c];
            mean[c] = self.min[c] + value * scale;
            let mut r = 0.0;
            for (j, w) in weights.iter().enumerate().take(count) {
                let row = self.index[start + j] as usize;
                let d = self.shape[row * WIDTH + c] - value;
                r += (w / total) * d * d;
            }
            variance[c] = r.max(5.1 * 5.1) * scale * scale;
        }
        (mean, variance)
    }

    fn forward(
        &self,
        t: usize,
        pick: i8,
        count: usize,
        prior: Option<[f64; ROW]>,
        adjusted: Option<[f64; WIDTH]>,
    ) -> [f64; ROW] {
        let mut row = [0.0; ROW];
        if pick < 0 {
            row[..WIDTH].copy_from_slice(&self.defaults);
            row[WIDTH..2 * WIDTH].fill(f64::INFINITY);
            return row;
        }
        let (mut z, mut r) = self.measurement(t, pick as usize, count);
        if let Some(state) = adjusted {
            z = state;
        }
        if let Some(previous) = prior {
            for c in 0..WIDTH {
                let predicted = previous[c + WIDTH] + self.step[c] * self.step[c];
                let gain = predicted / (predicted + r[c]);
                z[c] = previous[c] + gain * (z[c] - previous[c]);
                r[c] = (1.0 - gain) * predicted;
            }
        }
        row[..WIDTH].copy_from_slice(&z);
        row[WIDTH..2 * WIDTH].copy_from_slice(&r);
        row[2 * WIDTH] = exp(-self.cost[t * self.stride + pick as usize] / 8.0);
        row
    }

    fn backward(&self, path: &[i8], rows: &mut [[f64; ROW]], to_gap: &mut [usize]) {
        let mut remaining = to_gap.len() + 1;
        for j in (0..rows.len()).rev() {
            remaining = if path[j] < 0 { 0 } else { remaining + 1 };
            to_gap[j] = remaining;
            if path[j] >= 0 && j + 1 < path.len() && path[j + 1] >= 0 {
                for c in 0..WIDTH {
                    let variance = rows[j][WIDTH + c];
                    let predicted = variance + self.step[c] * self.step[c];
                    let gain = variance / predicted;
                    rows[j][c] += gain * (rows[j + 1][c] - rows[j][c]);
                    rows[j][WIDTH + c] += gain * gain * (rows[j + 1][WIDTH + c] - predicted);
                }
            }
        }
    }

    fn limit_movement(&self, row: &mut [f64; ROW], to_gap: usize, previous: Option<[f64; WIDTH]>) {
        for (c, mean) in row[..WIDTH].iter_mut().enumerate() {
            let delta = (3.0 - 1e-5) * self.step[c];
            let bound = to_gap as f64 * delta;
            let target =
                f64::from(*mean as f32).clamp(self.defaults[c] - bound, self.defaults[c] + bound);
            let value = if let Some(previous) = previous {
                target.clamp(previous[c] - delta, previous[c] + delta)
            } else {
                target
            };
            *mean = f64::from(value as f32);
        }
    }

    /// Batch Viterbi search and RTS smoothing. A missing row cuts the path.
    pub fn solve(&self, out: &mut [f64]) {
        self.solve_fixed_lag(usize::MAX, out);
    }

    /// Commit each frame after scoring `lag` successors and flush the tail.
    /// Output rows contain 12 means, 12 variances and the confidence.
    pub fn solve_fixed_lag(&self, lag: usize, out: &mut [f64]) {
        self.solve_pass(lag, &[], out);
    }

    /// Fit each fourth periodic frame with a closed velum and rerun batch
    /// smoothing. The host supplies forward geometry and observed LPC for
    /// each selected frame via `refine_frame`.
    pub fn refine(
        &self,
        periodic: &[bool],
        mut refine_frame: impl FnMut(usize, &[f64; WIDTH]) -> [f64; WIDTH],
        out: &mut [f64],
    ) {
        self.solve(out);
        let rows = out.as_chunks::<ROW>().0;
        let mut adjusted = vec![None; rows.len()];
        let selected = periodic.iter().enumerate().filter(|(_, flag)| **flag);
        for (t, _) in selected.step_by(4) {
            if rows[t][11] < 0.1 {
                adjusted[t] = Some(refine_frame(t, rows[t][..WIDTH].try_into().unwrap()));
            }
        }
        self.solve_pass(usize::MAX, &adjusted, out);
    }

    fn solve_pass(&self, lag: usize, adjusted: &[Option<[f64; WIDTH]>], out: &mut [f64]) {
        let counts = self.counts();
        let window = counts.len().min(lag.saturating_add(1));
        let mut rows = vec![[0.0; ROW]; window];
        let mut to_gap = vec![0; window];
        let mut prior = None;
        let mut previous = None;
        let out = out.as_chunks_mut::<ROW>().0;
        self.search(&counts, lag, |first, last, path| {
            let rows = &mut rows[..path.len()];
            let mut filtered = prior;
            for (j, (&pick, row)) in path.iter().zip(rows.iter_mut()).enumerate() {
                let t = first + j;
                let measurement = adjusted.get(t).copied().flatten();
                *row = self.forward(t, pick, counts[t], filtered, measurement);
                filtered = (pick >= 0).then_some(*row);
                if first + j + 1 == last {
                    prior = filtered;
                }
            }
            self.backward(path, rows, &mut to_gap);
            for (j, result) in out[first..last].iter_mut().enumerate() {
                let mut row = rows[j];
                let preceding = previous.filter(|_| path[j] >= 0);
                self.limit_movement(&mut row, to_gap[j], preceding);
                previous = Some(row[..WIDTH].try_into().unwrap());
                *result = row;
            }
        });
    }
}

fn trace(first: usize, path: &mut [i8], winner: &[i8], back: &[i8], stride: usize) {
    let mut next = -1;
    for (j, choice) in path.iter_mut().enumerate().rev() {
        let slot = (first + j) % winner.len();
        *choice = if next < 0 { winner[slot] } else { next };
        next = if *choice >= 0 {
            back[slot * stride + *choice as usize]
        } else {
            -1
        };
    }
}

/// Source noise regressions on [1, energy - ref, gravity / 1000, zcr,
/// periodicity, tilt]. Coefficients come from the host's calibrated table.
pub fn noise_channels(features: &[f64; 6], maps: &[[f64; 6]; 3]) -> [f64; 3] {
    maps.map(|map| {
        features
            .iter()
            .zip(map)
            .fold(0.0, |sum, (x, m)| sum + x * m)
            .clamp(0.0, 1.0)
    })
}

/// The weighted local cost after the host's codebook query.
pub fn local_cost(distance: f64, scale: f64, periodicity: f64, formants: &[[f64; 3]; 3]) -> f64 {
    let mut cost = distance / 16.0;
    for &[frequency, variance, reference] in formants {
        if frequency > 0.0 && reference > 0.0 {
            let delta = scale * frequency - reference;
            let floor = 0.03 * reference;
            cost += delta * delta / (scale * scale * variance + floor * floor);
        }
    }
    cost * if periodicity >= 0.45 { 1.0 } else { 0.25 }
}

pub fn planner_step(range: f64, time_constant: f64, frame_rate: f64, speed: f64) -> f64 {
    -0.5 * range * expm1(-speed / (time_constant * frame_rate))
}
