//! Numerical policies for the public speech recognizer. Unlicense.

#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Level {
    pub rate: u32,
    pub hop: f64,
    pub beam: u32,
}

pub const LEVELS: [Level; 3] = [
    Level {
        rate: 8000,
        hop: 0.01,
        beam: 8,
    },
    Level {
        rate: 16000,
        hop: 0.005,
        beam: 32,
    },
    Level {
        rate: 16000,
        hop: 0.005,
        beam: 128,
    },
];

/// Compare the mean energy of the loudest and quietest fifths of the frames.
pub fn noisy_frames(energy: &[f64], seconds: f64) -> bool {
    if energy.is_empty() || seconds <= 1.0 {
        return false;
    }
    let mut sorted = energy.to_vec();
    sorted.sort_unstable_by(f64::total_cmp);
    let size = (energy.len() / 5).max(1);
    let loud: f64 = sorted.iter().rev().take(size).sum();
    let quiet: f64 = sorted.iter().take(size).sum();
    loud / size as f64 > -99.0 && (loud - quiet) / (size as f64) < 5.0
}

/// The loads are wall-clock seconds per audio second over 2 and 10 seconds.
pub fn adaptive_level(level: usize, recent: f64, sustained: f64) -> usize {
    if level > 0 && recent > 0.8 {
        level - 1
    } else if level < LEVELS.len() - 1 && sustained < 0.3 {
        level + 1
    } else {
        level
    }
}
