/** Cooperative background work with a rolling two-second load meter. Unlicense. */
const WINDOW = 2000;
const SLICE = 10;
const now = () => globalThis.performance.now();
const runtime = globalThis.process;
const cpuUsage = runtime?.threadCpuUsage ?? runtime?.cpuUsage;

export function cpuTime() {
  if (cpuUsage) {
    const { user, system } = cpuUsage.call(runtime);
    return (user + system) / 1000;
  }
  return now();
}

export function createSessionScheduler({ realtime, schedule }, done) {
  let running = null;
  let ticket = null;
  let wake;
  let share;
  let foreground = [];
  let background = [];
  let audioBackground = [];
  let audio = 0;

  function prune(at) {
    while (background[0]?.end <= at - WINDOW) {
      background.shift();
    }
  }

  function elapsed(entries, at) {
    return entries.reduce(
      (sum, span) =>
        sum +
        Math.min(span.ms, at - WINDOW < span.end ? span.end - at + WINDOW : 0),
      0
    );
  }

  function recognitionTime() {
    return foreground.reduce(
      (sum, packet) =>
        sum +
        packet.ms * Math.min(1, (packet.end - audio + WINDOW) / packet.audio),
      0
    );
  }

  function budget(at) {
    const load = recognitionTime() / Math.min(audio, WINDOW);
    const cap = load > 0.8 ? Math.min(0.05, share) : share;
    return WINDOW * cap - elapsed(background, at);
  }

  function charge(start) {
    const ms = cpuTime() - start;
    const packet = audioBackground.at(-1);
    if (packet?.end === audio) {
      packet.ms += ms;
    } else {
      audioBackground.push({ end: audio, ms });
    }
    return ms;
  }

  function step() {
    const work = running;
    const result = work.next();
    if (result.done && work === running) {
      running = null;
      done(result.value);
    }
  }

  function slice() {
    if (!running || !share) {
      return;
    }
    const start = now();
    prune(start);
    const remaining = budget(start);
    if (remaining > 0) {
      const until = start + Math.min(SLICE, remaining);
      const cpuStart = cpuTime();
      do {
        step();
      } while (running && share > 0 && now() < until);
      background.push({ end: now(), ms: charge(cpuStart) });
    }
    request();
  }

  function request() {
    if (!realtime || !running || !share || ticket) {
      return;
    }
    const token = {};
    ticket = token;
    const at = now();
    prune(at);
    const enqueue = () =>
      schedule(() => {
        if (ticket === token) {
          ticket = null;
          slice();
        }
      });
    if (budget(at) <= 0) {
      const next = background[0].end;
      wake = globalThis.setTimeout(enqueue, Math.max(1, next + WINDOW - at));
    } else {
      enqueue();
    }
  }

  return {
    get busy() {
      return running !== null;
    },
    set share(value) {
      share = value;
      if (wake !== undefined) {
        globalThis.clearTimeout(wake);
        wake = undefined;
        ticket = null;
      }
      request();
    },
    get load() {
      if (!audio) {
        return 0;
      }
      const work = audioBackground.reduce((sum, span) => sum + span.ms, 0);
      return (recognitionTime() + work) / Math.min(audio, WINDOW);
    },
    foreground(ms, duration) {
      audio += duration;
      foreground.push({ end: audio, ms, audio: duration });
      while (foreground[0]?.end <= audio - WINDOW) {
        foreground.shift();
      }
      while (audioBackground[0]?.end <= audio - WINDOW) {
        audioBackground.shift();
      }
    },
    replace(generator) {
      running = generator;
      request();
    },
    drain(finish = false) {
      while (running && (finish || share > 0)) {
        const start = cpuTime();
        step();
        charge(start);
      }
    },
    cancel() {
      running = null;
      ticket = null;
      globalThis.clearTimeout(wake);
      wake = undefined;
    },
    reset() {
      this.cancel();
      foreground = [];
      background = [];
      audioBackground = [];
      audio = 0;
    },
  };
}
