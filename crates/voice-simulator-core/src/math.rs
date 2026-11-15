//! The only door to transcendental functions.
//!
//! Every other file calls `math::…`, never `libm` or the `f64` methods of
//! `std`, so that one place decides which implementation the engine uses on
//! every target. `libm` is a pure Rust port of musl's maths library: it
//! gives the same bits on `wasm32` and on the host, which the `f64` methods
//! of `std` (backed by the platform's C library) do not promise.

/// Square root; correctly rounded (IEEE 754), so it is allowed in class A code.
#[inline]
pub fn sqrt(x: f64) -> f64 {
    libm::sqrt(x)
}

/// Largest integer not above `x`; exact, so it is allowed in class A code.
#[inline]
pub fn floor(x: f64) -> f64 {
    libm::floor(x)
}

/// Smallest integer not below `x`; exact, so it is allowed in class A code.
#[inline]
pub fn ceil(x: f64) -> f64 {
    libm::ceil(x)
}

/// `Math.round` of JavaScript: the nearest integer, halves towards +∞.
#[inline]
pub fn round_half_up(x: f64) -> f64 {
    let floor = floor(x);
    if x - floor >= 0.5 {
        floor + 1.0
    } else {
        floor
    }
}

/// `Math.min(a, b)` of JavaScript for numbers that are not NaN; exact, so
/// it is allowed in class A code.
#[inline]
pub fn min(a: f64, b: f64) -> f64 {
    if a < b {
        a
    } else {
        b
    }
}

/// `Math.max(a, b)` of JavaScript for numbers that are not NaN; exact.
#[inline]
pub fn max(a: f64, b: f64) -> f64 {
    if a > b {
        a
    } else {
        b
    }
}

/// Sine of `x` radians.
#[inline]
pub fn sin(x: f64) -> f64 {
    libm::sin(x)
}

/// Cosine of `x` radians.
#[inline]
pub fn cos(x: f64) -> f64 {
    libm::cos(x)
}

/// `e` raised to `x`.
#[inline]
pub fn exp(x: f64) -> f64 {
    libm::exp(x)
}

/// Natural logarithm.
#[inline]
pub fn ln(x: f64) -> f64 {
    libm::log(x)
}

/// `x` raised to `y`.
#[inline]
pub fn pow(x: f64, y: f64) -> f64 {
    libm::pow(x, y)
}

/// Hyperbolic tangent.
#[inline]
pub fn tanh(x: f64) -> f64 {
    libm::tanh(x)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sqrt_is_correctly_rounded() {
        // Math.sqrt(3) in JavaScript.
        assert_eq!(sqrt(3.0).to_bits(), 1.732_050_807_568_877_2_f64.to_bits());
        assert_eq!(sqrt(4.0), 2.0);
    }

    #[test]
    fn rounding_follows_javascript() {
        assert_eq!(floor(-0.5), -1.0);
        assert_eq!(ceil(1.25), 2.0);
        // Math.round(2.5) = 3, Math.round(-2.5) = -2, Math.round(0.49999999999999994) = 0.
        assert_eq!(round_half_up(2.5), 3.0);
        assert_eq!(round_half_up(-2.5), -2.0);
        assert_eq!(round_half_up(0.499_999_999_999_999_94), 0.0);
    }

    #[test]
    fn functions_agree_with_their_identities() {
        assert_eq!(sin(0.0), 0.0);
        assert_eq!(cos(0.0), 1.0);
        assert_eq!(exp(0.0), 1.0);
        assert_eq!(ln(1.0), 0.0);
        assert_eq!(pow(2.0, 10.0), 1024.0);
        assert_eq!(tanh(0.0), 0.0);
    }
}
