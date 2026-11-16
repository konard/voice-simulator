//! Exports of the thread team of the 3D solver (issue 24): the
//! WebAssembly side of `src/engine/thread-pool.js`.
//!
//! Only the threads build (`node scripts/build-wasm.mjs --threads`,
//! `src/engine/voice-simulator-threads.wasm`) has more than one thread: it
//! is compiled with `+atomics`, its memory is imported and shared, and
//! every helper is a Web Worker (or a Node.js worker thread) with its own
//! instance of the same module on that memory. A helper instance first
//! gets its own stack and thread-local block ([`vs_thread_init`]), then
//! waits in JavaScript until the pool hands it a team, and calls
//! [`vs_team_work`], which returns when the leader ends the team.
//!
//! The leader is the thread that owns the renderer (the renderers are
//! thread-local, see `renderer.rs`): before a render call it starts a team
//! with [`vs_team_new`], wakes the helpers, renders and ends the team with
//! [`vs_team_free`]. A team lives for one render call, so the helpers wait
//! in `Atomics.wait` between calls instead of spinning.
//!
//! The teams themselves live in a process-wide table, because the helpers
//! look them up from other threads. Its lock is only ever taken with
//! `try_lock` in a spin loop: a blocking wait (`memory.atomic.wait32`)
//! traps on the main thread of a browser.
//!
//! Every other build has no helpers, so there [`vs_team_new`] never
//! starts a team (a leader would wait for helpers that never come) and
//! the solver steps on one thread.

use std::sync::{Arc, Mutex, MutexGuard, TryLockError};

use voice_simulator_core::fdtd::parallel::{Team, THREAD_MIN_LINKS};

use crate::error;
use crate::renderer::with_renderer;

/// Whether this build can run helpers: `+atomics` on WebAssembly (the
/// threads build), and every native build (the host tests).
pub const THREADS: bool = cfg!(any(target_feature = "atomics", not(target_arch = "wasm32")));

/// A live team and the renderer it steps.
struct Entry {
    renderer: i32,
    team: Arc<Team>,
}

/// The live teams; handle `h` is slot `h - 1`.
static TEAMS: Mutex<Vec<Option<Entry>>> = Mutex::new(Vec::new());

/// Runs `action` with the table of teams, spinning until the lock is free.
fn with_teams<R>(action: impl FnOnce(&mut Vec<Option<Entry>>) -> R) -> R {
    loop {
        let guard: MutexGuard<'_, _> = match TEAMS.try_lock() {
            Ok(guard) => guard,
            // A panic aborts (`panic = "abort"`), and no action of this file
            // leaves the table half changed.
            Err(TryLockError::Poisoned(poisoned)) => poisoned.into_inner(),
            Err(TryLockError::WouldBlock) => {
                core::hint::spin_loop();
                continue;
            }
        };
        let mut guard = guard;
        return action(&mut guard);
    }
}

/// The team of `handle`, or [`error::BAD_HANDLE`].
fn team_of(handle: i32) -> Result<(i32, Arc<Team>), i32> {
    if !THREADS {
        // No build without threads has a team, and the table then drops
        // out of it.
        return Err(error::BAD_HANDLE);
    }
    let index = usize::try_from(handle)
        .ok()
        .and_then(|h| h.checked_sub(1))
        .ok_or(error::BAD_HANDLE)?;
    with_teams(|slots| match slots.get(index) {
        Some(Some(entry)) => Ok((entry.renderer, Arc::clone(&entry.team))),
        _ => Err(error::BAD_HANDLE),
    })
}

/// Starts a team of `threads` for the renderer of `renderer` when its
/// grid has at least `min_links` links; returns the handle of the team
/// (> 0), 0 when the renderer steps on one thread (one thread, the
/// waveguide, a smaller grid, or a build without threads), or
/// [`error::BAD_HANDLE`].
pub fn team_new(renderer: i32, threads: u32, min_links: usize) -> i32 {
    let mut team = None;
    let code = with_renderer(renderer, |solver| {
        if THREADS {
            team = solver.start_team_from(threads as usize, min_links);
        }
        error::OK
    });
    if code != error::OK {
        return code;
    }
    let Some(team) = team else {
        return 0;
    };
    let entry = Entry { renderer, team };
    with_teams(|slots| {
        let index = match slots.iter().position(Option::is_none) {
            Some(index) => {
                slots[index] = Some(entry);
                index
            }
            None => {
                slots.push(Some(entry));
                slots.len() - 1
            }
        };
        i32::try_from(index + 1).unwrap_or(error::NO_MEMORY)
    })
}

/// [`Team::work`] of helper `index` (1 to threads - 1) of the team of
/// `handle`: returns 0 when the leader ends the team, or
/// [`error::BAD_HANDLE`] at once.
pub fn team_work(handle: i32, index: u32) -> i32 {
    match team_of(handle) {
        Ok((_, team)) => {
            team.work(index as usize);
            error::OK
        }
        Err(code) => code,
    }
}

/// Ends the team of `handle` ([`Team::finish`], which waits for every
/// helper to leave [`team_work`]), puts its renderer back on one thread
/// and frees the handle; 0 or [`error::BAD_HANDLE`].
pub fn team_free(handle: i32) -> i32 {
    let (renderer, team) = match team_of(handle) {
        Ok(found) => found,
        Err(code) => return code,
    };
    // Not under the lock: the helpers take it once on their way into
    // `team_work`, and `finish` waits for all of them.
    team.finish();
    // The renderer may be gone already; the team is ended either way.
    with_renderer(renderer, |solver| {
        solver.stop_team();
        error::OK
    });
    with_teams(|slots| slots[handle as usize - 1] = None);
    error::OK
}

/// 1 in the threads build, else 0.
#[no_mangle]
pub extern "C" fn vs_threads() -> u32 {
    u32::from(cfg!(target_feature = "atomics"))
}

/// Starts a team of `threads` (the leader included) for the renderer of
/// `renderer`, when its grid has at least `THREAD_MIN_LINKS` links of
/// `crates/voice-simulator-core/src/fdtd/parallel.rs`. Returns the handle
/// of the team (> 0), 0 when the renderer steps on one thread, or
/// [`error::BAD_HANDLE`]. With a team, helpers 1 to `threads - 1` must
/// call [`vs_team_work`] before the render, and [`vs_team_free`] must end
/// it after the render.
#[no_mangle]
pub extern "C" fn vs_team_new(renderer: i32, threads: u32) -> i32 {
    team_new(renderer, threads, THREAD_MIN_LINKS)
}

/// [`vs_team_new`] with `min_links` in place of `THREAD_MIN_LINKS`: 0
/// starts a team for any grid (the tests and the measurement of
/// `tests/heavy/performance-threads.test.js`).
#[no_mangle]
pub extern "C" fn vs_team_new_from(renderer: i32, threads: u32, min_links: u32) -> i32 {
    team_new(renderer, threads, min_links as usize)
}

/// The loop of helper `index` (1 to threads - 1) of the team of `team`;
/// returns 0 when the leader ends the team, or [`error::BAD_HANDLE`].
#[no_mangle]
pub extern "C" fn vs_team_work(team: i32, index: u32) -> i32 {
    team_work(team, index)
}

/// Ends the team of `team` and puts its renderer back on one thread;
/// 0 or [`error::BAD_HANDLE`].
#[no_mangle]
pub extern "C" fn vs_team_free(team: i32) -> i32 {
    team_free(team)
}

/// Threads that step the solver of the renderer of `renderer` now: the
/// team size during a render with a team, else 1; or a negative code.
#[no_mangle]
pub extern "C" fn vs_renderer_threads(renderer: i32) -> i32 {
    with_renderer(renderer, |solver| {
        i32::try_from(solver.threads()).unwrap_or(error::NO_MEMORY)
    })
}

/// `count` bare kernel steps of the 3D solver of `renderer` (no sources;
/// with its team, if any): the measurement of
/// `tests/heavy/performance-threads.test.js`. 0, or
/// [`error::BAD_ARGUMENT`] for the waveguide, or [`error::BAD_HANDLE`].
#[no_mangle]
pub extern "C" fn vs_renderer_kernel_steps(renderer: i32, count: u32) -> i32 {
    with_renderer(renderer, |solver| {
        if solver.kernel_steps(count as usize) {
            error::OK
        } else {
            error::BAD_ARGUMENT
        }
    })
}

/// Links of the grid of the 3D solver of `renderer` (0 for the
/// waveguide), or a negative code.
#[no_mangle]
pub extern "C" fn vs_renderer_links(renderer: i32) -> i32 {
    with_renderer(renderer, |solver| {
        i32::try_from(solver.grid_size().0).unwrap_or(error::NO_MEMORY)
    })
}

// `vs_thread_init(stack_top, tls)`, `vs_thread_tls_size()` and
// `vs_thread_tls_align()` of the threads build, in WebAssembly assembly:
// Rust cannot set the global `__stack_pointer` that its own code uses.
// `__wasm_init_tls` and `__tls_size` / `__tls_align` come from the linker
// (`wasm-ld --shared-memory`). `vs_thread_init` touches no stack, so it
// can run before the instance has one.
#[cfg(all(target_arch = "wasm32", target_feature = "atomics"))]
core::arch::global_asm!(
    ".globaltype __stack_pointer, i32",
    ".globaltype __tls_size, i32, immutable",
    ".globaltype __tls_align, i32, immutable",
    ".functype __wasm_init_tls (i32) -> ()",
    "",
    ".globl vs_thread_init",
    ".export_name vs_thread_init, vs_thread_init",
    ".type vs_thread_init,@function",
    "vs_thread_init:",
    ".functype vs_thread_init (i32, i32) -> ()",
    "local.get 0",
    "global.set __stack_pointer",
    "local.get 1",
    "call __wasm_init_tls",
    "end_function",
    "",
    ".globl vs_thread_tls_size",
    ".export_name vs_thread_tls_size, vs_thread_tls_size",
    ".type vs_thread_tls_size,@function",
    "vs_thread_tls_size:",
    ".functype vs_thread_tls_size () -> (i32)",
    "global.get __tls_size",
    "end_function",
    "",
    ".globl vs_thread_tls_align",
    ".export_name vs_thread_tls_align, vs_thread_tls_align",
    ".type vs_thread_tls_align,@function",
    "vs_thread_tls_align:",
    ".functype vs_thread_tls_align () -> (i32)",
    "global.get __tls_align",
    "end_function",
);

#[cfg(test)]
mod tests {
    use super::*;
    use crate::renderer::{renderer_free, renderer_new};

    #[test]
    fn bad_handles_are_refused() {
        assert_eq!(team_new(0, 4, 0), error::BAD_HANDLE);
        assert_eq!(team_work(0, 1), error::BAD_HANDLE);
        assert_eq!(team_work(77, 1), error::BAD_HANDLE);
        assert_eq!(team_free(-3), error::BAD_HANDLE);
        assert_eq!(vs_renderer_threads(0), error::BAD_HANDLE);
        assert_eq!(vs_renderer_kernel_steps(0, 1), error::BAD_HANDLE);
        assert_eq!(vs_threads(), 0);
        // A renderer handle that is not live.
        assert_eq!(renderer_free(9999), error::BAD_HANDLE);
        assert_eq!(renderer_new(&[1.0], &[]), error::BAD_ARGUMENT);
    }
}
