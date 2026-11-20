/** Run recognition stages incrementally, starting a new voice inside a long gap. Unlicense. */
import { DEFAULT_HEAD, normalizeHeadConfig } from '../head-config.js';
import { buildCodebook } from './codebook.js';
import { decoderCodebook, fitDecoderVoice } from './decode-pipeline.js';
import { decoderTemplates } from './decode-model.js';
import { createFormantTracker } from './formants.js';
import { createArticulationInverter } from './inversion.js';

function frameWindow(frames, first) {
  const sample = Math.round(first * frames.hop * frames.rate);
  const window = { ...frames };
  for (const [key, value] of Object.entries(frames)) {
    if (ArrayBuffer.isView(value)) {
      window[key] = value.subarray(
        key === 'samples' ? sample : first * (value.length / frames.capacity)
      );
    }
  }
  window.startTime = frames.startTime + first * frames.hop;
  window.capacity = frames.capacity - first;
  return {
    ...window,
    get count() {
      return Math.max(0, frames.count - first);
    },
    get sampleCount() {
      return Math.max(0, frames.sampleCount - sample);
    },
  };
}

function pitchWindow(pitch, frames, first) {
  return {
    ...pitch,
    f0: pitch.f0.subarray(first),
    strength: pitch.strength.subarray(first),
    voicing: pitch.voicing.subarray(first),
    startTime: frames.startTime,
    get count() {
      return Math.max(0, pitch.count - first);
    },
    get committed() {
      return Math.max(0, pitch.committed - first);
    },
  };
}

function trackSection(frames, pitch, first, voice, silent = false) {
  const input = frameWindow(frames, first);
  const part = pitchWindow(pitch, input, first);
  const formants = createFormantTracker(input, {
    pitch: part,
    vocalTractLength: voice.vocalTractLength,
  });
  const inversion = createArticulationInverter(input, {
    voice,
    pitch: part,
    formants: formants.track,
    // Leave time to resolve competing phone endpoints before commitment.
    lag: 15,
    codebook: silent
      ? buildCodebook(voice, { size: 1 })
      : decoderCodebook(voice),
  });
  return {
    first,
    voice,
    formants,
    inversion,
    advance(final) {
      formants.advance(final);
      inversion.advance(final);
    },
  };
}

// Only allocate and join full-length tracks when the fitted voice changes.
function trackArrays(track) {
  return Object.fromEntries(
    Object.entries(track).map(([key, value]) => {
      if (ArrayBuffer.isView(value)) {
        return [key, new value.constructor(value.length)];
      }
      return [
        key,
        value && typeof value === 'object' && key !== 'head'
          ? trackArrays(value)
          : value,
      ];
    })
  );
}

function trackCopy(destination, source, capacity, first, copied, count) {
  for (const [key, value] of Object.entries(source)) {
    if (ArrayBuffer.isView(value)) {
      const width = value.length / capacity;
      destination[key].set(
        value.subarray(copied * width, count * width),
        (first + copied) * width
      );
    } else if (value && typeof value === 'object' && key !== 'head') {
      trackCopy(destination[key], value, capacity, first, copied, count);
    }
  }
}

function mergeTracks(output, section, frames, copied) {
  const { first, formants, inversion } = section;
  const capacity = frames.capacity - first;
  const pitchFormants = formants.track;
  const articulation = inversion.track;
  trackCopy(
    output.formants,
    pitchFormants,
    capacity,
    first,
    copied,
    pitchFormants.committed
  );
  trackCopy(
    output.articulation,
    articulation,
    capacity,
    first,
    copied,
    articulation.committed
  );
  output.formants.vocalTractLength = pitchFormants.vocalTractLength;
  output.formants.committed = first + pitchFormants.committed;
  output.formants.count = output.formants.committed;
  output.articulation.head = articulation.head;
  output.articulation.committed = first + articulation.committed;
  output.articulation.frameCount = output.articulation.committed;
  output.articulation.duration = articulation.duration + first * frames.hop;
}

export function createDecodeTracks(frames, pitch, options, language) {
  let voice = options.voice ? normalizeHeadConfig(options.voice) : DEFAULT_HEAD;
  let section = null;
  let combined = null;
  let copied = 0;
  let scanned = 0;
  let firstSpeech = -1;
  let latestSpeech = -1;
  let fittedThrough = -1;
  const changes = [];

  function fit(last) {
    const to = Math.min(
      frames.sampleCount,
      Math.round(last * frames.hop * frames.rate)
    );
    voice = fitDecoderVoice(
      frames.samples.subarray(0, to),
      frames.rate,
      language.language,
      voice
    );
    fittedThrough = latestSpeech;
  }

  function switchVoice() {
    const first = frames.count;
    // The last 300 ms are silent. Uncommitted pitch rows in this gap are
    // unvoiced in both sections, so the old track can finish at the switch.
    const previous = pitch.committed;
    pitch.committed = first;
    try {
      section.advance(true);
    } finally {
      pitch.committed = previous;
    }
    if (!combined) {
      combined = {
        formants: trackArrays(section.formants.track),
        articulation: trackArrays(section.inversion.track),
      };
    }
    mergeTracks(combined, section, frames, copied);
    fit(latestSpeech + 1);
    changes.push({ time: first * frames.hop, voice });
    section = trackSection(frames, pitch, first, voice);
    copied = 0;
  }

  function scanSpeech() {
    for (; scanned < frames.count; scanned++) {
      if (frames.speech[scanned]) {
        if (firstSpeech < 0) {
          firstSpeech = scanned;
        }
        latestSpeech = scanned;
      }
    }
  }

  return {
    advance(final) {
      scanSpeech();
      if (!section) {
        if (firstSpeech < 0 && !final) {
          return;
        }
        if (!options.voice && firstSpeech >= 0) {
          if (!final && (scanned - firstSpeech) * frames.hop < 0.15) {
            return;
          }
          fit(scanned);
        }
        section = trackSection(frames, pitch, 0, voice, firstSpeech < 0);
        changes.push({ time: 0, voice });
      }
      if (
        !final &&
        !options.voice &&
        latestSpeech > fittedThrough &&
        (scanned - latestSpeech - 1) * frames.hop >= 0.3
      ) {
        switchVoice();
      }
      section.advance(final);
      if (combined) {
        mergeTracks(combined, section, frames, copied);
        copied = Math.min(
          section.formants.track.committed,
          section.inversion.track.committed
        );
      }
    },
    templatesAt(time) {
      const change = changes.findLast((entry) => entry.time <= time);
      return decoderTemplates(
        change?.voice ?? voice,
        language.symbols,
        options.articulationOffsets
      );
    },
    get voice() {
      return voice;
    },
    get tracks() {
      return (
        combined ??
        (section && {
          formants: section.formants.track,
          articulation: section.inversion.track,
        })
      );
    },
  };
}
