//! The listener: what happens to the radiated sound between the lips and
//! the output, the per-sample parts of `MicrophoneStage` of
//! `src/acoustics/microphone.js` and of `Room` and `DelayNetwork` of
//! `src/acoustics/room.js`. The JavaScript side resolves the microphone and
//! the room (`createListener`, the image sources, the delay network and
//! its calibration) and serializes the resolved numbers
//! (`src/engine/listener-layout.js`); this module runs them per sample in
//! the same order of operations, so the output is bit-identical.
//!
//! Layout: `[stage count, stages...]`; an empty array or a stage count of
//! 0 is the identity (no microphone, no room). Each stage starts with its
//! kind:
//!
//! - [`MICROPHONE`]: `[1, gain, delay, fraction, size, directional,
//!   lowGain, highGain, smoothing]` ([`MICROPHONE_VALUES`] values);
//! - [`ROOM`]: `[2, size, tailDelay, tailGain, tapCount, delays[8],
//!   scales[8], poles[8], tapDelays[tapCount], tapGains[tapCount]]`
//!   ([`ROOM_VALUES`] values before the taps).
//!
//! The constants are the `LISTENER` object of `src/engine/layout.js`;
//! `tests/engine-layout.test.js` compares the two files as text.

use alloc::boxed::Box;
use alloc::vec;
use alloc::vec::Vec;

use crate::math;

/// Kind of a microphone stage.
pub const MICROPHONE: usize = 1;
/// Kind of a room stage.
pub const ROOM: usize = 2;
/// Values of a microphone stage, kind included.
pub const MICROPHONE_VALUES: usize = 9;
/// Values of a room stage before its taps, kind included.
pub const ROOM_VALUES: usize = 29;
/// Delay lines of the feedback delay network (`LINES` of room.js).
pub const LINES: usize = 8;

/// Longest history (samples) a stage may ask for: 2^24, over 87 s at
/// 192 kHz, far beyond the longest room of room.js.
const MAX_HISTORY: usize = 1 << 24;
/// Most taps of a room (`MAX_TAPS` of room.js).
const MAX_TAPS: usize = 160;

/// `value` as a whole number in `0..=max`, or `None`.
fn whole(value: f64, max: usize) -> Option<usize> {
    if value.is_finite() && value >= 0.0 && value == math::floor(value) && value <= max as f64 {
        Some(value as usize)
    } else {
        None
    }
}

/// `value` if it is finite.
fn finite(value: f64) -> Option<f64> {
    value.is_finite().then_some(value)
}

/// A history size: a power of two up to [`MAX_HISTORY`].
fn history_size(value: f64) -> Option<usize> {
    whole(value, MAX_HISTORY).filter(|size| size.is_power_of_two())
}

/// Distance gain, propagation delay and directivity (`MicrophoneStage`).
#[derive(Clone, Debug)]
pub struct Microphone {
    gain: f64,
    delay: usize,
    fraction: f64,
    directional: bool,
    low_gain: f64,
    high_gain: f64,
    smoothing: f64,
    low: f64,
    history: Vec<f64>,
    position: usize,
}

impl Microphone {
    /// The stage of the [`MICROPHONE_VALUES`] `values`, kind included.
    fn parse(values: &[f64]) -> Option<Self> {
        let delay = whole(values[2], MAX_HISTORY)?;
        let fraction = finite(values[3]).filter(|value| (0.0..1.0).contains(value))?;
        let size = history_size(values[4])?;
        if size < delay + 2 {
            return None;
        }
        Some(Self {
            gain: finite(values[1])?,
            delay,
            fraction,
            directional: values[5] != 0.0,
            low_gain: finite(values[6])?,
            high_gain: finite(values[7])?,
            smoothing: finite(values[8])?,
            low: 0.0,
            history: vec![0.0; size],
            position: 0,
        })
    }

    /// `MicrophoneStage.process`.
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let mut value = input * self.gain;
        if self.directional {
            self.low = value + self.smoothing * (self.low - value);
            value = self.low * self.low_gain + (value - self.low) * self.high_gain;
        }
        if self.delay == 0 && self.fraction == 0.0 {
            return value;
        }
        let mask = self.history.len() - 1;
        self.history[self.position] = value;
        let newer = self.history[self.position.wrapping_sub(self.delay) & mask];
        let older = self.history[self.position.wrapping_sub(self.delay + 1) & mask];
        self.position = (self.position + 1) & mask;
        newer + (older - newer) * self.fraction
    }
}

/// Feedback delay network with a Hadamard mixing matrix (`DelayNetwork`).
#[derive(Clone, Debug)]
pub struct DelayNetwork {
    lines: [Vec<f64>; LINES],
    positions: [usize; LINES],
    state: [f64; LINES],
    mix: [f64; LINES],
    scales: [f64; LINES],
    poles: [f64; LINES],
    scale: f64,
}

impl DelayNetwork {
    /// The network of the line `delays`, `scales` and `poles`.
    fn parse(delays: &[f64], scales: &[f64], poles: &[f64]) -> Option<Self> {
        let mut lines: [Vec<f64>; LINES] = Default::default();
        for (line, delay) in lines.iter_mut().zip(delays) {
            let delay = whole(*delay, MAX_HISTORY).filter(|delay| *delay > 0)?;
            *line = vec![0.0; delay];
        }
        let mut network = Self {
            lines,
            positions: [0; LINES],
            state: [0.0; LINES],
            mix: [0.0; LINES],
            scales: [0.0; LINES],
            poles: [0.0; LINES],
            scale: 1.0 / math::sqrt(LINES as f64),
        };
        for index in 0..LINES {
            network.scales[index] = finite(scales[index])?;
            network.poles[index] = finite(poles[index])?;
        }
        Some(network)
    }

    /// `DelayNetwork.process`.
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let mut output = 0.0;
        for index in 0..LINES {
            let value = self.lines[index][self.positions[index]];
            output += if index % 2 == 0 { value } else { -value };
            self.state[index] = self.scales[index] * value + self.poles[index] * self.state[index];
            self.mix[index] = self.state[index];
        }
        // Fast Walsh-Hadamard transform (orthogonal after scaling by
        // 1/sqrt(8)).
        let mix = &mut self.mix;
        let mut width = 1;
        while width < LINES {
            let mut start = 0;
            while start < LINES {
                for index in start..start + width {
                    let a = mix[index];
                    let b = mix[index + width];
                    mix[index] = a + b;
                    mix[index + width] = a - b;
                }
                start += 2 * width;
            }
            width *= 2;
        }
        for index in 0..LINES {
            let sign = if index % 3 == 0 { -1.0 } else { 1.0 };
            let line = &mut self.lines[index];
            line[self.positions[index]] = self.mix[index] * self.scale + sign * input;
            self.positions[index] = (self.positions[index] + 1) % line.len();
        }
        output
    }
}

/// Early reflections and reverberation of a room (`Room`).
#[derive(Clone, Debug)]
pub struct Room {
    tail_delay: usize,
    tail_gain: f64,
    tap_delays: Vec<usize>,
    tap_gains: Vec<f64>,
    network: DelayNetwork,
    history: Vec<f64>,
    position: usize,
}

impl Room {
    /// The stage at the start of `values` (kind included) and the number
    /// of values it takes.
    fn parse(values: &[f64]) -> Option<(Self, usize)> {
        let size = history_size(values[1])?;
        let tail_delay = whole(values[2], size - 1)?;
        let tail_gain = finite(values[3])?;
        let taps = whole(values[4], MAX_TAPS)?;
        let length = ROOM_VALUES + 2 * taps;
        let values = values.get(..length)?;
        let network = DelayNetwork::parse(
            &values[5..5 + LINES],
            &values[5 + LINES..5 + 2 * LINES],
            &values[5 + 2 * LINES..ROOM_VALUES],
        )?;
        let (delays, gains) = values[ROOM_VALUES..].split_at(taps);
        let tap_delays = delays
            .iter()
            .map(|delay| whole(*delay, size - 1).filter(|delay| *delay > 0))
            .collect::<Option<Vec<_>>>()?;
        let tap_gains = gains
            .iter()
            .map(|gain| finite(*gain))
            .collect::<Option<Vec<_>>>()?;
        let room = Self {
            tail_delay,
            tail_gain,
            tap_delays,
            tap_gains,
            network,
            history: vec![0.0; size],
            position: 0,
        };
        Some((room, length))
    }

    /// `Room.process`.
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let mask = self.history.len() - 1;
        self.history[self.position] = input;
        let mut output = input;
        for (delay, gain) in self.tap_delays.iter().zip(&self.tap_gains) {
            output += gain * self.history[self.position.wrapping_sub(*delay) & mask];
        }
        let late = self.history[self.position.wrapping_sub(self.tail_delay) & mask];
        output += self.tail_gain * self.network.process(late);
        self.position = (self.position + 1) & mask;
        output
    }
}

/// One stage of the listener.
#[derive(Clone, Debug)]
pub enum Stage {
    /// A microphone away from the reference point.
    Microphone(Microphone),
    /// A room or the enclosure around the head.
    Room(Box<Room>),
}

impl Stage {
    #[inline]
    fn process(&mut self, input: f64) -> f64 {
        match self {
            Self::Microphone(stage) => stage.process(input),
            Self::Room(stage) => stage.process(input),
        }
    }
}

/// The per-sample listener: its stages in order.
#[derive(Clone, Debug, Default)]
pub struct Listener {
    stages: Vec<Stage>,
}

impl Listener {
    /// The listener of the serialized `values`; `None` if they are
    /// malformed.
    pub fn new(values: &[f64]) -> Option<Self> {
        let Some((count, mut rest)) = values.split_first() else {
            return Some(Self::default());
        };
        let count = whole(*count, 16)?;
        let mut stages = Vec::with_capacity(count);
        for _ in 0..count {
            let kind = whole(*rest.first()?, ROOM)?;
            let (stage, length) = match kind {
                MICROPHONE => {
                    let values = rest.get(..MICROPHONE_VALUES)?;
                    (
                        Stage::Microphone(Microphone::parse(values)?),
                        MICROPHONE_VALUES,
                    )
                }
                ROOM => {
                    if rest.len() < ROOM_VALUES {
                        return None;
                    }
                    let (room, length) = Room::parse(rest)?;
                    (Stage::Room(Box::new(room)), length)
                }
                _ => return None,
            };
            stages.push(stage);
            rest = &rest[length..];
        }
        rest.is_empty().then_some(Self { stages })
    }

    /// The stages, in order.
    pub fn stages(&self) -> &[Stage] {
        &self.stages
    }

    /// One sample through the listener.
    #[inline]
    pub fn process(&mut self, input: f64) -> f64 {
        let mut result = input;
        for stage in &mut self.stages {
            result = stage.process(result);
        }
        result
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn microphone(delay: f64, fraction: f64) -> Vec<f64> {
        vec![1.0, 1.0, 0.5, delay, fraction, 8.0, 0.0, 1.0, 1.0, 0.0]
    }

    #[test]
    fn identity_without_stages() {
        let mut listener = Listener::new(&[]).unwrap();
        assert_eq!(listener.process(0.25), 0.25);
        let mut listener = Listener::new(&[0.0]).unwrap();
        assert_eq!(listener.process(-3.0), -3.0);
        assert!(Listener::new(&[0.0, 1.0]).is_none());
    }

    #[test]
    fn microphone_delays_and_scales() {
        let mut listener = Listener::new(&microphone(2.0, 0.5)).unwrap();
        let output: Vec<f64> = [1.0, 0.0, 0.0, 0.0, 0.0]
            .iter()
            .map(|value| listener.process(*value))
            .collect();
        // gain 0.5, then half of sample 2 and half of sample 3.
        assert_eq!(output, [0.0, 0.0, 0.25, 0.25, 0.0]);
        assert!(Listener::new(&microphone(7.0, 0.0)).is_none());
        assert!(Listener::new(&microphone(1.5, 0.0)).is_none());
        assert!(Listener::new(&microphone(1.0, 1.0)).is_none());
    }

    #[test]
    fn room_adds_taps_and_tail() {
        let mut values = vec![1.0, ROOM as f64, 8.0, 0.0, 0.0, 1.0];
        values.extend([1.0; LINES]);
        values.extend([0.0; 2 * LINES]);
        values.extend([3.0, 0.5]);
        let mut listener = Listener::new(&values).unwrap();
        let output: Vec<f64> = (0..5)
            .map(|index| listener.process(if index == 0 { 1.0 } else { 0.0 }))
            .collect();
        assert_eq!(output, [1.0, 0.0, 0.0, 0.5, 0.0]);
        values[5] = 2.0;
        assert!(Listener::new(&values).is_none());
        values[5] = 1.0;
        values[29 + 1] = 8.0;
        assert!(Listener::new(&values).is_none());
    }
}
