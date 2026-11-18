//! Oral-tract objective and bounded simplex for acoustic inversion. Unlicense.
use crate::codebook::tract_response;
use crate::inversion::WIDTH;
use crate::voice_fit::simplex_with_step;

pub const BANDS: usize = 24;
pub const ORAL_SECTIONS: usize = 44;
const REFINED: [usize; 6] = [0, 1, 2, 7, 9, 8];

pub struct OralObservation<'a> {
    pub grid: &'a [f64; BANDS],
    pub envelope: &'a [f64; BANDS],
    pub minimum: &'a [f64; WIDTH],
    pub range: &'a [f64; WIDTH],
    pub step: &'a [f64; WIDTH],
}

/// Compare a proposed tract to a level-normalized LPC observation. The
/// caller supplies the forward geometry used to render its plans.
impl OralObservation<'_> {
    pub fn cost(&self, areas: &[f64], length: f64, delta: &[f64; WIDTH]) -> f64 {
        let mut response = [0.0; BANDS];
        if !tract_response(areas, length, self.grid, &mut response) {
            return f64::INFINITY;
        }
        let mean = response[..16].iter().sum::<f64>() / 16.0;
        let mut sum = 0.0;
        let mut count = 0;
        for (&model, &observed) in response.iter().zip(self.envelope) {
            if observed.is_finite() {
                let error = model - mean - observed;
                sum += error * error;
                count += 1;
            }
        }
        if count == 0 {
            return f64::INFINITY;
        }
        let penalty = REFINED.iter().fold(0.0, |sum, &c| {
            let distance = delta[c] / (2.0 * self.step[c]);
            sum + distance * distance
        });
        sum / count as f64 / 16.0 + penalty
    }

    /// Find a measurement for the RTS pass with at most 60 calls to geometry.
    pub fn refine(
        &self,
        baseline: &[f64; WIDTH],
        mut geometry: impl FnMut(&[f64; WIDTH], &mut [f64; ORAL_SECTIONS]) -> f64,
    ) -> [f64; WIDTH] {
        let normalized = REFINED.map(|c| (baseline[c] - self.minimum[c]) / self.range[c]);
        let mut areas = [0.0; ORAL_SECTIONS];
        let vertices = simplex_with_step(&normalized, 60, 0.05, |point| {
            let state = self.position(baseline, point);
            let length = geometry(&state, &mut areas);
            let delta = core::array::from_fn(|c| state[c] - baseline[c]);
            self.cost(&areas, length, &delta)
        });
        self.position(baseline, &vertices[0].x)
    }

    fn position(&self, baseline: &[f64; WIDTH], point: &[f64]) -> [f64; WIDTH] {
        let mut state = *baseline;
        for (j, c) in REFINED.into_iter().enumerate() {
            state[c] = self.minimum[c] + point[j] * self.range[c];
        }
        state
    }
}
