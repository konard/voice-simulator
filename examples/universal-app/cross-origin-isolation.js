// Cross-origin isolation of the example app, switched on by the build
// variable VITE_CROSS_ORIGIN_ISOLATION=1 (default off). Kept free of
// dependencies so the root test suite can import it without installing the
// app's packages.
//
// A cross-origin isolated page can share a SharedArrayBuffer: the audio
// player then shares a ring with its AudioWorklet ('worklet-shared',
// otherwise it posts the samples, 'worklet-port'), and the threads build
// of the Rust engine can run (see "Threads in the browser" in
// docs/RUST-ENGINE.md).

/** The script of public/ that adds the headers in a service worker. */
export const ISOLATION_WORKER = 'coi-serviceworker.js';

/** Whether `env` asks for a cross-origin isolated page. */
export function crossOriginIsolation(env = process.env) {
  return env.VITE_CROSS_ORIGIN_ISOLATION === '1';
}

/**
 * The headers that make a page cross-origin isolated, for the dev and
 * preview servers, or undefined when `enabled` is false.
 */
export function isolationHeaders(enabled) {
  return enabled
    ? {
        'Cross-Origin-Opener-Policy': 'same-origin',
        'Cross-Origin-Embedder-Policy': 'require-corp',
      }
    : undefined;
}

/**
 * A Vite plugin that, when `enabled`, makes the page load
 * public/coi-serviceworker.js (MIT), a service worker that adds the same
 * headers on hosts that cannot send them, such as GitHub Pages, at the
 * price of one reload on the first visit. Without it no page loads that
 * file, and the published app stays on one thread.
 */
export function isolationWorker(enabled) {
  return {
    name: 'cross-origin-isolation-worker',
    transformIndexHtml() {
      return enabled
        ? [
            {
              tag: 'script',
              attrs: { src: ISOLATION_WORKER },
              injectTo: 'head-prepend',
            },
          ]
        : [];
    },
  };
}
