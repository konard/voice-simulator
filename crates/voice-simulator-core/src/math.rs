//! The only door to transcendental functions.
//!
//! Every other file calls `math::…`, never `libm` or the `f64` methods of
//! `std`, so that one place decides which implementation the engine uses on
//! every target. `libm` is a pure Rust port of musl's maths library: it
//! gives the same bits on `wasm32` and on the host, which the `f64` methods
//! of `std` (backed by the platform's C library) do not promise.
//!
//! The one exception: with the feature `std` on `wasm32`, `sqrt`, `floor`
//! and `ceil` are the `f64` methods of `std`, which compile to the
//! WebAssembly instructions `f64.sqrt`, `f64.floor` and `f64.ceil`, not to
//! a C library. IEEE 754 defines one result for each, so they give the
//! bits of `libm`, which on stable Rust computes them in software on
//! `wasm32` (its `wasm32` intrinsics need a nightly feature). `abs` is the
//! `f64::abs` of `core`, a sign-bit clear on every target.

/// Square root; correctly rounded (IEEE 754), so it is allowed in class A code.
#[inline]
pub fn sqrt(x: f64) -> f64 {
    #[cfg(all(feature = "std", target_arch = "wasm32"))]
    {
        x.sqrt()
    }
    #[cfg(not(all(feature = "std", target_arch = "wasm32")))]
    {
        libm::sqrt(x)
    }
}

/// Absolute value; exact, so it is allowed in class A code.
#[inline]
pub fn abs(x: f64) -> f64 {
    x.abs()
}

/// Largest integer not above `x`; exact, so it is allowed in class A code.
#[inline]
pub fn floor(x: f64) -> f64 {
    #[cfg(all(feature = "std", target_arch = "wasm32"))]
    {
        x.floor()
    }
    #[cfg(not(all(feature = "std", target_arch = "wasm32")))]
    {
        libm::floor(x)
    }
}

/// Smallest integer not below `x`; exact, so it is allowed in class A code.
#[inline]
pub fn ceil(x: f64) -> f64 {
    #[cfg(all(feature = "std", target_arch = "wasm32"))]
    {
        x.ceil()
    }
    #[cfg(not(all(feature = "std", target_arch = "wasm32")))]
    {
        libm::ceil(x)
    }
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

/// e^x - 1, exact for small x (`Math.expm1`).
#[inline]
pub fn expm1(x: f64) -> f64 {
    libm::expm1(x)
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

/// Angle of the point (x, y) in radians (`Math.atan2(y, x)`).
#[inline]
pub fn atan2(y: f64, x: f64) -> f64 {
    libm::atan2(y, x)
}

/// Hyperbolic tangent.
#[inline]
pub fn tanh(x: f64) -> f64 {
    libm::tanh(x)
}

/// `Math.hypot` of V8 (`MathHypot` in `src/builtins/math.tq`): the
/// largest magnitude scales the values, whose squares are summed with
/// Kahan compensation. Not correctly rounded, so `sqrt` of the plain sum
/// of squares can differ in the last bit, which flips the nearest cell
/// when two cells are equally far.
pub fn js_hypot(values: &[f64]) -> f64 {
    let mut largest = 0.0;
    let mut nan = false;
    for &value in values {
        if value.is_nan() {
            nan = true;
        } else if abs(value) > largest {
            largest = abs(value);
        }
    }
    if largest == f64::INFINITY {
        return f64::INFINITY;
    }
    if nan {
        return f64::NAN;
    }
    if largest == 0.0 {
        return 0.0;
    }
    let mut sum = 0.0;
    let mut compensation = 0.0;
    for &value in values {
        let scaled = abs(value) / largest;
        let summand = scaled * scaled - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sqrt(sum) * largest
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

    #[test]
    fn hypot_follows_v8() {
        assert_eq!(js_hypot(&[3.0, 4.0]), 5.0);
        assert_eq!(js_hypot(&[0.0, -0.0]), 0.0);
        assert_eq!(js_hypot(&[f64::NAN, f64::INFINITY]), f64::INFINITY);
        assert!(js_hypot(&[f64::NAN, 1.0]).is_nan());
        // Math.hypot(1, 1, 1) in node is 1.7320508075688772.
        assert_eq!(js_hypot(&[1.0, 1.0, 1.0]), 1.732_050_807_568_877_2);
    }
}
