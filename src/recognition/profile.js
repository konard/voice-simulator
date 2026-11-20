/** An optional stage timer for the recognition profiler. Unlicense. */
export function measure(profile, stage, run) {
  if (!profile) {
    return run();
  }
  const start = globalThis.performance.now();
  try {
    return run();
  } finally {
    profile(stage, globalThis.performance.now() - start);
  }
}
