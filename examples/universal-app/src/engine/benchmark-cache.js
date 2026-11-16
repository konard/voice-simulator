/**
 * The cached device benchmark of the app and the stored quality setting
 * (issue 28): a benchmark result stays valid for its procedure version,
 * device and engine for 30 days, so a later visit measures nothing.
 */

import { AUDIO_TIERS, BENCHMARK_VERSION } from '../../../../src/index.js';

export const BENCHMARK_KEY = 'voice-simulator:benchmark';
/** Overloads in a row at the cached level (see VoiceEngine). */
export const OVERLOADS_KEY = 'voice-simulator:benchmark-overloads';
/** The quality setting: 'auto' or the name of a tier. */
export const TIER_KEY = 'voice-simulator:tier';
/** How long a cached benchmark is valid, in ms. */
export const BENCHMARK_MAX_AGE = 30 * 24 * 60 * 60 * 1000;
/** Overloads in a row at the cached level that drop the cache. */
export const OVERLOADS_TO_MEASURE = 3;

function storage() {
  return globalThis.localStorage ?? null;
}

function read(key) {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    if (value === null) {
      storage()?.removeItem?.(key);
    } else {
      storage()?.setItem(key, value);
    }
  } catch {
    // Storage may be unavailable (private mode); it is optional.
  }
}

/**
 * Identifies the device, build and backends (whether WebGPU may be used)
 * a cached benchmark belongs to.
 */
export function deviceKey(allowGpu, engine) {
  const navigator = globalThis.navigator ?? {};
  return [
    navigator.userAgent ?? '',
    navigator.hardwareConcurrency ?? 0,
    AUDIO_TIERS.map((tier) => `${tier.name}:${tier.cost}`).join(','),
    allowGpu ? 'gpu' : 'cpu',
    engine,
  ].join('|');
}

/**
 * The cached benchmark when it is valid for this procedure version, device
 * and engine setting and younger than 30 days, else null. Whether its
 * engine is the one the worker renders with is checked by sameEngine.
 */
export function readCachedBenchmark(allowGpu, engine, now = Date.now()) {
  let cached;
  try {
    cached = JSON.parse(read(BENCHMARK_KEY) ?? 'null');
  } catch {
    return null;
  }
  const valid =
    cached?.version === BENCHMARK_VERSION &&
    cached.device === deviceKey(allowGpu, engine) &&
    typeof cached.time === 'number' &&
    now - cached.time < BENCHMARK_MAX_AGE &&
    Number.isInteger(cached.level);
  return valid ? cached : null;
}

/**
 * Whether the cached `engine` ({name, simd, threads}) is the one of the
 * worker's answer to {type: 'engine'}.
 */
export function sameEngine(cached, answer) {
  return (
    Boolean(cached && answer) &&
    cached.name === answer.name &&
    cached.simd === answer.simd &&
    cached.threads === answer.threads
  );
}

/** Store a complete benchmark answer of the worker; returns the value. */
export function writeCachedBenchmark(message, allowGpu, engine) {
  const value = {
    version: message.version,
    device: deviceKey(allowGpu, engine),
    engine: message.engine,
    level: message.level,
    loads: message.loads,
    measured: message.measured,
    gpu: Boolean(message.gpu),
    time: Date.now(),
  };
  write(BENCHMARK_KEY, JSON.stringify(value));
  write(OVERLOADS_KEY, null);
  return value;
}

/** Forget the cached benchmark: the next idle moment measures again. */
export function clearCachedBenchmark() {
  write(BENCHMARK_KEY, null);
  write(OVERLOADS_KEY, null);
}

/** Overloads in a row at the cached level so far. */
export function readOverloads() {
  return Number(read(OVERLOADS_KEY)) || 0;
}

export function writeOverloads(count) {
  write(OVERLOADS_KEY, count > 0 ? String(count) : null);
}

/** The stored quality setting: 'auto' or the name of a tier. */
export function readTierSetting() {
  const value = read(TIER_KEY);
  return AUDIO_TIERS.some((tier) => tier.name === value) ? value : 'auto';
}

/** Store the quality setting: 'auto' or the name of a tier. */
export function writeTierSetting(value) {
  write(TIER_KEY, value);
}

/**
 * Run `run` at the next idle moment of a visible page:
 * requestIdleCallback (at most 2 s later) or setTimeout 200 ms, then, when
 * the page is hidden, the moment it becomes visible.
 * @returns {() => void} cancels the run
 */
export function whenIdle(run) {
  let cancelled = false;
  let stopWatching = () => {};
  const visible = () => {
    if (cancelled) {
      return;
    }
    const document = globalThis.document;
    if (!document || document.visibilityState === 'visible') {
      run();
      return;
    }
    const watch = () => {
      if (document.visibilityState === 'visible') {
        stopWatching();
        visible();
      }
    };
    document.addEventListener('visibilitychange', watch);
    stopWatching = () =>
      document.removeEventListener('visibilitychange', watch);
  };
  let cancelIdle;
  if (typeof globalThis.requestIdleCallback === 'function') {
    const handle = globalThis.requestIdleCallback(visible, { timeout: 2000 });
    cancelIdle = () => globalThis.cancelIdleCallback?.(handle);
  } else {
    const handle = globalThis.setTimeout(visible, 200);
    cancelIdle = () => globalThis.clearTimeout(handle);
  }
  return () => {
    cancelled = true;
    cancelIdle();
    stopWatching();
  };
}
