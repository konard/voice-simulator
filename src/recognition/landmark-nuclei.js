/** Causal nucleus confirmation shared by batch and streaming calls. */
export function createNucleusScanner(frames, output, T) {
  let scanned = 0;
  let pending = -1;
  let pendingLeft = 0;
  let lastPeak = -1;
  let valley = 0;
  const radius = Math.round(0.04 / frames.hop);
  const separation = Math.ceil(0.08 / frames.hop);
  const time = (t) => output.startTime + t * frames.hop;
  const s = output.sonority;

  function minimum(first, end) {
    let at = first;
    for (let t = first + 1; t <= end; t++) {
      if (s[t] < s[at]) {
        at = t;
      }
    }
    return at;
  }

  function emit(right, emitted) {
    if (pending < 0) {
      return;
    }
    const left = pendingLeft;
    const nucleus = {
      time: time(pending),
      start: time(left),
      end: right === null ? null : time(right),
      strength:
        s[pending] - Math.min(s[left], right === null ? s[pending] : s[right]),
    };
    output.nuclei.push(nucleus);
    emitted.push(nucleus);
    lastPeak = pending;
    pending = -1;
  }

  function eligiblePeak(t) {
    let isPeak =
      s[t] >= frames.noise[t] + T.nucleusAboveNoise &&
      frames.periodicity[t] >= 0.45;
    for (
      let j = Math.max(0, t - radius);
      isPeak && j <= Math.min(frames.count - 1, t + radius);
      j++
    ) {
      if (s[j] > s[t] || (j < t && s[j] === s[t])) {
        isPeak = false;
      }
    }
    if (isPeak && lastPeak >= 0) {
      const between = minimum(lastPeak, t);
      isPeak = s[between] <= Math.min(s[lastPeak], s[t]) - T.nucleusDip;
    }
    return isPeak;
  }

  function updateBoundary(t, last) {
    const prev = output.nuclei.at(-1);
    if (
      prev?.end === null &&
      (!frames.speech[t] ||
        (t > 0 && t + 1 < last && s[t] <= s[t - 1] && s[t] < s[t + 1]))
    ) {
      prev.end = time(t);
      prev.strength =
        s[lastPeak] -
        Math.min(
          s[Math.round((prev.start - output.startTime) / frames.hop)],
          s[t]
        );
    }
  }

  function consider(t, isPeak, prev, emitted) {
    if (!isPeak || (lastPeak >= 0 && t - lastPeak < separation)) {
      return;
    }
    {
      if (pending >= 0) {
        const between = minimum(pending, t);
        const separate =
          t - pending >= separation &&
          s[between] <= Math.min(s[pending], s[t]) - T.nucleusDip;
        if (separate) {
          emit(between, emitted);
          pending = t;
          pendingLeft = between;
        } else if (s[t] > s[pending]) {
          pending = t;
        }
      } else {
        pending = t;
        pendingLeft = valley;
        if (prev) {
          const between = minimum(lastPeak, t);
          pendingLeft = between;
          prev.end = time(between);
        }
      }
      valley = t;
    }
  }

  function scanNuclei(last, emitted, final) {
    for (; scanned < last; scanned++) {
      const t = scanned;
      if (s[t] <= s[valley]) {
        valley = t;
      }
      updateBoundary(t, last);
      const prev = output.nuclei.at(-1);
      const isPeak = eligiblePeak(t);
      consider(t, isPeak, prev, emitted);
      const available = Math.min(frames.count - 1, t + radius);
      const right = pending < 0 ? 0 : minimum(pending, available);
      if (
        pending >= 0 &&
        (s[right] <= s[pending] - T.nucleusDip ||
          (available - pending) * frames.hop >= 0.1)
      ) {
        emit(!frames.speech[right] ? right : null, emitted);
      }
    }
    if (final) {
      emit(null, emitted);
      const prev = output.nuclei.at(-1);
      if (prev?.end === null) {
        for (let t = lastPeak + 1; t < frames.count; t++) {
          if (!frames.speech[t]) {
            prev.end = time(t);
            break;
          }
        }
      }
    }
  }

  return scanNuclei;
}
