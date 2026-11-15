//! Deterministic pseudo-random numbers: a port of `src/random.js`.
//!
//! Parity class A (bit-identical): only integer arithmetic, one division by
//! a power of two, additions and a correctly rounded square root.

use crate::math;

/// FNV-1a offset basis.
const FNV_OFFSET: u32 = 0x811c_9dc5;
/// FNV-1a prime.
const FNV_PRIME: u32 = 0x0100_0193;
/// The state a zero seed is replaced with (`hashSeed(seed) || 0x9e3779b9`).
const ZERO_SEED_STATE: u32 = 0x9e37_79b9;
/// 2^32: turns a `u32` into a float in [0, 1).
const TWO_POW_32: f64 = 4_294_967_296.0;

/// FNV-1a over the UTF-16 code units of a string, as `hashSeed` of
/// `src/random.js` does for a seed that is not a finite number.
pub fn hash_seed_utf16(units: &[u16]) -> u32 {
    let mut hash = FNV_OFFSET;
    for &unit in units {
        hash ^= u32::from(unit);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

/// The mulberry32 generator of `createRandom` in `src/random.js`.
#[derive(Clone, Debug)]
pub struct Random {
    state: u32,
}

impl Random {
    /// A generator seeded like `createRandom(seed)` for a seed that
    /// `hashSeed` has already turned into a `u32`; 0 becomes `0x9e3779b9`.
    pub fn new(seed: u32) -> Self {
        let state = if seed == 0 { ZERO_SEED_STATE } else { seed };
        Self { state }
    }

    /// The next value in [0, 1).
    #[allow(clippy::should_implement_trait)]
    pub fn next(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x6d2b_79f5);
        let mut value = self.state;
        value = (value ^ (value >> 15)).wrapping_mul(value | 1);
        value ^= value.wrapping_add((value ^ (value >> 7)).wrapping_mul(value | 61));
        f64::from(value ^ (value >> 14)) / TWO_POW_32
    }

    /// `randomNormal` of `src/random.js`: four values added left to right
    /// (Irwin-Hall), centred and scaled to unit standard deviation.
    pub fn normal(&mut self) -> f64 {
        let sum = self.next() + self.next() + self.next() + self.next();
        (sum - 2.0) * math::sqrt(3.0)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use alloc::vec::Vec;

    fn utf16(text: &str) -> Vec<u16> {
        text.encode_utf16().collect()
    }

    // Printed by Node.js:
    //   const r = createRandom(1); r(); r(); r();
    // with each value's bits read through a DataView.
    #[test]
    fn first_values_for_seed_one_match_javascript() {
        let mut random = Random::new(1);
        assert_eq!(random.next().to_bits(), 0x3fe4_10fd_5e60_0000);
        assert_eq!(random.next().to_bits(), 0x3f66_6939_2000_0000);
        assert_eq!(random.next().to_bits(), 0x3fe0_e0d8_9d60_0000);
    }

    // Printed by Node.js: const r = createRandom(1); randomNormal(r) twice.
    #[test]
    fn first_normal_values_for_seed_one_match_javascript() {
        let mut random = Random::new(1);
        assert_eq!(random.normal().to_bits(), 0x3fce_a9c4_9fc9_a855);
        assert_eq!(random.normal().to_bits(), 0x3ff0_2888_1e60_fac1);
    }

    // Printed by Node.js: hashSeed(''), hashSeed('voice'), hashSeed('héllo').
    #[test]
    fn hashes_strings_like_javascript() {
        assert_eq!(hash_seed_utf16(&utf16("")), 2_166_136_261);
        assert_eq!(hash_seed_utf16(&utf16("voice")), 2_140_916_217);
        assert_eq!(hash_seed_utf16(&utf16("héllo")), 0xf1e5_b55f);
    }

    #[test]
    fn zero_seed_is_replaced() {
        let mut zero = Random::new(0);
        let mut replaced = Random::new(ZERO_SEED_STATE);
        assert_eq!(zero.next().to_bits(), replaced.next().to_bits());
    }

    #[test]
    fn values_stay_in_the_unit_interval() {
        let mut random = Random::new(0xffff_ffff);
        for _ in 0..10_000 {
            let value = random.next();
            assert!((0.0..1.0).contains(&value));
        }
    }
}
