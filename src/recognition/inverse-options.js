/** Input contracts for batch source analysis (Unlicense). */
export const INVERSE_FILTER_DEFAULTS = Object.freeze({
  pitch: null,
  tractOrder: null,
  glottisOrder: null,
  leak: 0.99,
  step: 0.01,
  minF0: 60,
  maxF0: 400,
  trace: null,
});
function range(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new RangeError(`invalid ${name}`);
  }
}
function integer(value, min, max, name) {
  range(value, min, max, name);
  if (!Number.isInteger(value)) {
    throw new RangeError(`invalid ${name}`);
  }
}
function checkFrames(f) {
  const { sampleCount } = f;
  integer(f.count, 0, Number.MAX_SAFE_INTEGER, 'frame count');
  integer(sampleCount, 0, Number.MAX_SAFE_INTEGER, 'sample count');
  integer(f.melBands, 1, Number.MAX_SAFE_INTEGER, 'mel bands');
  range(f.hop, Number.MIN_VALUE, 1, 'frame hop');
  range(f.window, Number.MIN_VALUE, 1, 'frame window');
  range(f.startTime, -Infinity, Infinity, 'frame start time');
  const widths = {
    samples: sampleCount,
    speech: f.count,
    periodicity: f.count,
    mel: f.count * f.melBands,
  };
  for (const [name, length] of Object.entries(widths)) {
    if (!(f[name]?.length >= length)) {
      throw new RangeError(`invalid frame ${name}`);
    }
  }
  if (f.count && (f.count - 1) * f.hop * f.rate >= sampleCount) {
    throw new RangeError('frames exceed sample count');
  }
  const { samples } = f;
  for (let n = 0; n < sampleCount; n++) {
    if (!Number.isFinite(samples[n])) {
      throw new RangeError('invalid sample');
    }
  }
}
export function suppliedPitch(value, rate) {
  if (!Number.isFinite(value) || value <= 0) {
    return 0;
  }
  range(value, 20, rate / 4, 'voiced pitch');
  return value;
}
export function settings(frames, options) {
  if (!frames) {
    throw new RangeError('invalid frame set');
  }
  range(frames.rate, 8000, 48000, 'working rate');
  checkFrames(frames);
  const o = { ...INVERSE_FILTER_DEFAULTS, ...options };
  const rate = frames.rate;
  o.tractOrder ??= 2 * Math.round(rate / 2000) + 4;
  o.glottisOrder ??= 2 * Math.round(rate / 4000);
  range(o.minF0, 20, rate / 4, 'minF0');
  range(o.maxF0, o.minF0, rate / 4, 'maxF0');
  if (
    o.maxF0 === o.minF0 ||
    o.maxF0 === rate / 4 ||
    Math.floor(rate / o.minF0) <= Math.ceil(0.001 * rate)
  ) {
    throw new RangeError('invalid pitch range');
  }
  integer(o.tractOrder, 1, 128, 'tract order');
  integer(o.glottisOrder, 1, 128, 'glottis order');
  range(o.leak, 0, 1, 'leak');
  if (o.leak === 1) {
    throw new RangeError('invalid leak');
  }
  range(o.step, 1 / rate, 0.032, 'step');
  if (o.trace !== null && typeof o.trace !== 'function') {
    throw new TypeError('trace must be a function or null');
  }
  checkPitch(frames, o.pitch);
  return o;
}

function checkPitch(frames, pitch) {
  if (
    pitch &&
    (pitch.count < frames.count ||
      pitch.hop !== frames.hop ||
      pitch.startTime !== frames.startTime ||
      (pitch.f0?.length ?? 0) < frames.count)
  ) {
    throw new RangeError('pitch track must cover and align with the frame set');
  }
}
