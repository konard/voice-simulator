/** Fixed-prefix streaming IPA decoding. Unlicense. */
import {
  decoderSettings,
  latticeOf,
  prepareIpaDecode,
  resultOf,
  segmentsOf,
} from './decode-pipeline.js';
import { decodeSearch, pathArcs } from './decode-search.js';
import { createDecodeTracks } from './decode-stream-tracks.js';
import { createFrameAnalyzer } from './frontend.js';
import { createLandmarkDetector } from './landmarks.js';
import { createPitchTracker } from './pitch.js';
import { whisperVoicing } from './whisper-result.js';
import { createWhisperDecisions } from './whisper-stream.js';
import { createWhisperFramePool } from './whisper-spectrum.js';

function matches(other, arc) {
  return (
    other?.unit === arc.unit && other.from === arc.from && other.to === arc.to
  );
}

export function fixedCount(path, frontier, times, clock, final) {
  if (final) {
    return path.length;
  }
  const alternatives = frontier.map(pathArcs);
  let count = 0;
  while (count < path.length) {
    const arc = path[count];
    if (arc.pause && arc.to === times.length - 1) {
      break;
    }
    const age = clock - times[arc.to];
    // A switch to an expired competitor on the next update would introduce a
    // phone retroactively. Resolve that disagreement using the current best.
    const deadline = alternatives.some(
      (other) => other[count] && clock - times[other[count].to] >= 0.52 - 1e-9
    );
    const consensus = alternatives.every((other) => matches(other[count], arc));
    if (age < 0.5 - 1e-9 && (age < 0.3 - 1e-9 || (!consensus && !deadline))) {
      break;
    }
    count++;
  }
  return count;
}

function appendLattice(archive, suffix, through = Infinity) {
  const shift =
    archive.times.length - Number(archive.times.at(-1) === suffix.times[0]);
  for (let i = archive.times.length - shift; i < suffix.times.length; i++) {
    if (suffix.times[i] > through) {
      break;
    }
    archive.times.push(suffix.times[i]);
  }
  for (const arc of suffix.edges) {
    if (suffix.times[arc.to] <= through) {
      archive.edges.push({
        ...arc,
        from: arc.from + shift,
        to: arc.to + shift,
      });
    }
  }
}

// Stage state and fixed-prefix bookkeeping belong to this stream instance.
// eslint-disable-next-line max-lines-per-function
export function createIpaDecoder(sampleRate, options = {}) {
  const settings = decoderSettings(sampleRate, options);
  const { language } = settings;
  const quantum = Math.max(1, Math.floor(sampleRate * 0.02));
  let input;
  let pitch;
  let landmarks;
  let decoder;
  let archive;
  let fixed;
  let from;
  let lastUnit;
  let samplesSeen;
  let closed;
  let current;
  let finalResult;
  let classifier;
  let whisper;
  let pool;

  function reset() {
    input = createFrameAnalyzer(sampleRate, {
      ...settings,
      maxSeconds: options.maxSeconds ?? 30,
    });
    pitch = createPitchTracker(input.frames, { kernels: settings.kernels });
    classifier = createWhisperDecisions(
      input.frames,
      pitch.track,
      settings.whisper
    );
    whisper = { through: 0, spans: [] };
    pool =
      settings.whisper === 'auto' || settings.whisper.length
        ? createWhisperFramePool(input.frames)
        : null;
    landmarks = createLandmarkDetector(input.frames);
    decoder = createDecodeTracks(
      pool?.frames ?? input.frames,
      pitch.track,
      options,
      language
    );
    archive = { times: [], edges: [] };
    fixed = [];
    from = 0;
    lastUnit = language.symbols.length;
    samplesSeen = 0;
    closed = false;
    current = null;
    finalResult = null;
  }

  function refresh(final) {
    const { frames } = input;
    const tracks = decoder.tracks;
    if (!tracks) {
      return;
    }
    const { articulation } = tracks;
    const analysis = {
      frames,
      whisperSpans: whisper.spans,
      voice: decoder.voice,
      tracks: {
        ...tracks,
        pitch: pitch.track,
        landmarks: landmarks.output,
        articulation: { ...articulation, frameCount: articulation.committed },
      },
    };
    const to = final
      ? frames.sampleCount / frames.rate
      : Math.min(articulation.committed, landmarks.output.committed) *
        frames.hop;
    const { prepared, templates } = prepareIpaDecode(
      analysis,
      settings,
      { from, to, open: !final, locked: fixed.length > 0 },
      decoder.templatesAt
    );
    const search = decodeSearch(prepared, language, { ...settings, lastUnit });
    current = { analysis, prepared, templates, search };
  }

  function collect(final, segments) {
    refresh(final);
    if (final) {
      finalResult = snapshot(false);
    }
    while (current && commit(final, segments) && !final) {
      refresh(false);
    }
  }

  function commit(final, segments) {
    const { search, prepared, templates } = current;
    const { times } = prepared;
    const best = search.paths[0] ?? (!final ? search.provisional : undefined);
    const path = pathArcs(best);
    let count = fixedCount(
      path,
      search.frontier,
      times,
      samplesSeen / sampleRate,
      final
    );
    while (count > 0 && times[path[count - 1].to] > whisper.through) {
      count--;
    }
    if (count === 0) {
      return false;
    }
    const continuation = segmentsOf(best, times, templates, language);
    const phones = whisperVoicing(
      fixed.concat(continuation),
      input.frames,
      whisper.spans,
      fixed.length
    )
      .slice(fixed.length, fixed.length + count)
      .map(Object.freeze);
    fixed.push(...phones);
    segments.push(...phones);
    const last = path[count - 1];
    from = times[last.to];
    lastUnit = last.unit;
    appendLattice(
      archive,
      latticeOf(times, search.edges, templates, language),
      from
    );
    return true;
  }

  function advance(final, segments, nuclei) {
    pitch.advance(final);
    const { frames } = input;
    const scored = pool ? frames.startTime + pool.frames.count * frames.hop : 0;
    whisper = classifier.advance(final, Math.max(from, scored));
    pool?.advance(whisper, final);
    nuclei.push(...landmarks.advance(final));
    decoder.advance(final);
    collect(final, segments);
  }

  function snapshot(provisional) {
    if (!current) {
      const analysis = {
        frames: input.frames,
        whisperSpans: whisper.spans,
        voice: decoder.voice,
        tracks: {
          pitch: pitch.track,
          landmarks: landmarks.output,
          formants: null,
          articulation: null,
        },
      };
      const prepared = { times: new Float64Array() };
      return resultOf(analysis, settings, prepared, [], {
        paths: [],
        edges: [],
      });
    }
    const { analysis, prepared, templates, search } = current;
    const lattice = { times: [...archive.times], edges: [...archive.edges] };
    appendLattice(
      lattice,
      latticeOf(prepared.times, search.edges, templates, language)
    );
    lattice.times = Float64Array.from(lattice.times);
    const reading =
      provisional && !search.paths.length && search.provisional
        ? { ...search, paths: [search.provisional] }
        : search;
    return resultOf(analysis, settings, prepared, templates, reading, {
      prefix: fixed,
      lattice,
    });
  }

  reset();
  return {
    get frames() {
      return input.frames;
    },
    push(chunk) {
      if (closed) {
        throw new RangeError(
          'Reset the IPA decoder before pushing after flush'
        );
      }
      const projected = Math.round(
        (samplesSeen + chunk.length) * (settings.rate / sampleRate)
      );
      if (projected > input.frames.samples.length) {
        throw new RangeError('The IPA decoder has reached its recording limit');
      }
      const segments = [];
      const nuclei = [];
      for (let first = 0; first < chunk.length; first += quantum) {
        const last = Math.min(first + quantum, chunk.length);
        const samples =
          typeof chunk.subarray === 'function'
            ? chunk.subarray(first, last)
            : Array.prototype.slice.call(chunk, first, last);
        input.push(samples);
        samplesSeen += samples.length;
        advance(false, segments, nuclei);
      }
      return { segments, nuclei };
    },
    flush() {
      const segments = [];
      const nuclei = [];
      if (!closed) {
        input.flush();
        advance(true, segments, nuclei);
        closed = true;
      }
      return { segments, nuclei };
    },
    result() {
      return finalResult ?? snapshot(true);
    },
    reset,
  };
}
