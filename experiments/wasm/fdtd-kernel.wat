;; FDTD step kernel for src/acoustics/fdtd3d.js. It performs the same f64
;; operations in the same order as the JavaScript loops, so results are
;; bit-identical. linkA/linkB hold cell *byte* offsets (index * 8).
;; Build: experiments/wasm/build.mjs (wabt) -> src/acoustics/fdtd-kernel.js
(module
  (memory (export "memory") 1)
  (func (export "step")
    (param $links i32) (param $cells i32)
    (param $linkA i32) (param $linkB i32)
    (param $velocity i32) (param $damping i32) (param $conductance i32)
    (param $pressure i32) (param $divergence i32)
    (param $keep i32) (param $gain i32)
    (local $end i32) (local $a i32) (local $b i32) (local $u f64)
    (local $flux f64)
    ;; Link pass: momentum update and flux divergence.
    (local.set $end (i32.add (local.get $linkA) (i32.shl (local.get $links) (i32.const 2))))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $linkA) (local.get $end)))
        (local.set $a (i32.load (local.get $linkA)))
        (local.set $b (i32.load (local.get $linkB)))
        (local.set $u
          (f64.mul
            (f64.load (local.get $damping))
            (f64.sub
              (f64.load (local.get $velocity))
              (f64.mul (f64.const 0.5)
                (f64.sub
                  (f64.load (i32.add (local.get $pressure) (local.get $b)))
                  (f64.load (i32.add (local.get $pressure) (local.get $a))))))))
        (f64.store (local.get $velocity) (local.get $u))
        (local.set $flux (f64.mul (f64.load (local.get $conductance)) (local.get $u)))
        (local.set $a (i32.add (local.get $divergence) (local.get $a)))
        (local.set $b (i32.add (local.get $divergence) (local.get $b)))
        (f64.store (local.get $a) (f64.add (f64.load (local.get $a)) (local.get $flux)))
        (f64.store (local.get $b) (f64.sub (f64.load (local.get $b)) (local.get $flux)))
        (local.set $linkA (i32.add (local.get $linkA) (i32.const 4)))
        (local.set $linkB (i32.add (local.get $linkB) (i32.const 4)))
        (local.set $velocity (i32.add (local.get $velocity) (i32.const 8)))
        (local.set $damping (i32.add (local.get $damping) (i32.const 8)))
        (local.set $conductance (i32.add (local.get $conductance) (i32.const 8)))
        (br $next)))
    ;; Cell pass: pressure update.
    (local.set $end (i32.add (local.get $pressure) (i32.shl (local.get $cells) (i32.const 3))))
    (block $done
      (loop $next
        (br_if $done (i32.ge_u (local.get $pressure) (local.get $end)))
        (f64.store (local.get $pressure)
          (f64.sub
            (f64.mul (f64.load (local.get $keep)) (f64.load (local.get $pressure)))
            (f64.mul (f64.load (local.get $gain)) (f64.load (local.get $divergence)))))
        (f64.store (local.get $divergence) (f64.const 0))
        (local.set $pressure (i32.add (local.get $pressure) (i32.const 8)))
        (local.set $divergence (i32.add (local.get $divergence) (i32.const 8)))
        (local.set $keep (i32.add (local.get $keep) (i32.const 8)))
        (local.set $gain (i32.add (local.get $gain) (i32.const 8)))
        (br $next)))))
