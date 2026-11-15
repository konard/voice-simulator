/**
 * Dynamic time warping (Sakoe & Chiba 1978) between two sequences of
 * feature vectors, with an optional Sakoe-Chiba band.
 */

/** Largest number of cells (n * m) that `dtw` accepts. */
export const DTW_MAX_CELLS = 25e6;

/** Euclidean distance between two vectors (or two numbers). */
export function euclideanDistance(a, b) {
  if (typeof a === 'number') {
    return Math.abs(a - b);
  }
  let sum = 0;
  for (let index = 0; index < a.length; index++) {
    const delta = a[index] - b[index];
    sum += delta * delta;
  }
  return Math.sqrt(sum);
}

const DIAGONAL = 1;
const UP = 2;
const LEFT = 3;

function position(index, length) {
  return length > 1 ? index / (length - 1) : 0;
}

/** Cheapest predecessor of cell (i, j): DIAGONAL, UP, LEFT or 0 for none. */
function bestStep(previous, current, i, j) {
  let best = Infinity;
  let step = 0;
  if (i > 0 && j > 0 && previous[j - 1] < best) {
    best = previous[j - 1];
    step = DIAGONAL;
  }
  if (i > 0 && previous[j] < best) {
    best = previous[j];
    step = UP;
  }
  if (j > 0 && current[j - 1] < best) {
    step = LEFT;
  }
  return step;
}

function predecessorCost(previous, current, j, step) {
  if (step === DIAGONAL) {
    return previous[j - 1];
  }
  return step === UP ? previous[j] : current[j - 1];
}

function traceBack(steps, n, m) {
  let i = n - 1;
  let j = m - 1;
  const path = [[i, j]];
  while (i > 0 || j > 0) {
    const step = steps[i * m + j];
    if (step !== LEFT) {
      i--;
    }
    if (step !== UP) {
      j--;
    }
    path.push([i, j]);
  }
  return path.reverse();
}

function checkSizes(n, m) {
  if (n === 0 || m === 0) {
    throw new RangeError('dtw: both sequences must be non-empty');
  }
  if (n * m > DTW_MAX_CELLS) {
    throw new RangeError(
      `dtw: ${n} x ${m} cells exceed the limit of ${DTW_MAX_CELLS}`
    );
  }
}

/**
 * Align two sequences: D(i, j) = d(i, j) + min(D(i-1, j), D(i, j-1),
 * D(i-1, j-1)) with D(0, 0) = d(0, 0). On equal costs the diagonal wins,
 * then (i-1, j), then (i, j-1).
 * @param {ArrayLike<ArrayLike<number>|number>} a
 * @param {ArrayLike<ArrayLike<number>|number>} b
 * @param {{distance?: (x: any, y: any) => number, band?: number}} [options]
 *   band (0 to 1, default 1 = no limit) allows a cell when
 *   |i / (n - 1) - j / (m - 1)| <= band.
 * @returns {{cost: number, normalizedCost: number, path: [number, number][]}}
 */
export function dtw(a, b, options = {}) {
  const n = a.length;
  const m = b.length;
  checkSizes(n, m);
  const distance = options.distance ?? euclideanDistance;
  const band = options.band ?? 1;
  const steps = new Uint8Array(n * m);
  let previous = new Float64Array(m).fill(Infinity);
  let current = new Float64Array(m);
  for (let i = 0; i < n; i++) {
    const row = position(i, n);
    for (let j = 0; j < m; j++) {
      current[j] = Infinity;
      if (Math.abs(row - position(j, m)) > band) {
        continue;
      }
      const local = distance(a[i], b[j]);
      const step = bestStep(previous, current, i, j);
      if (i === 0 && j === 0) {
        current[j] = local;
      } else if (step) {
        current[j] = local + predecessorCost(previous, current, j, step);
        steps[i * m + j] = step;
      }
    }
    [previous, current] = [current, previous];
  }
  const cost = previous[m - 1];
  if (!Number.isFinite(cost)) {
    throw new RangeError(`dtw: band ${band} leaves no path from start to end`);
  }
  const path = traceBack(steps, n, m);
  return { cost, normalizedCost: cost / path.length, path };
}
