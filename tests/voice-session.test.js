/** Session state and parameter reductions with controlled decoder snapshots. Unlicense. */
import { describe, expect, it } from 'test-anywhere';
import {
  createVoiceSession as publicSession,
  copyVoice,
  loadVoice,
  planUtterance,
  presetHeadConfig,
  saveVoice,
  synthesize,
} from '../src/index.js';
import { createSession } from '../src/session/voice-session.js';
import { emptyRecognition } from '../src/recognition/recognizer.js';
import { createEvents } from '../src/recognition/recognizer-stream.js';
import {
  controlledRefit,
  refit,
  uncertaintyFor,
  usableReading,
} from '../src/session/refine.js';
import { parameterChanges } from '../src/session/numerics.js';
import { createSpeakerTracking } from '../src/session/tracking.js';
import { channelTargets } from '../src/articulation/plan.js';

const SAMPLE_RATE = 16000;
const head = presetHeadConfig('male');
const voice = { head, preset: 'male' };
const text =
  'A little bird sings in the morning. We heard it again across the green field.';
const samples = synthesize(text, {
  head,
  lang: 'en',
  tier: 'minimal',
  sampleRate: SAMPLE_RATE,
  seed: 1,
}).samples;
const options = { sampleRate: SAMPLE_RATE, languages: ['en'], level: 'low' };
const reading = {
  decoded: {
    ipa: 'batadikutadubi',
    segments: Array.from('batadikutadubi', (ipa) => ({
      ipa,
      kind: 'aiu'.includes(ipa) ? 'vowel' : 'consonant',
      confidence: 0.8,
    })),
  },
};
const adjusted = { ...voice, head: { ...head, pitch: 119 } };
const passes = {
  *fitting() {
    yield;
    return { voice, distance: 2 };
  },
  *inverting(_samples, { voice: start }) {
    yield;
    return {
      voice: start,
      distance: 2,
      reading,
      usable: usableReading(reading.decoded),
    };
  },
  *refining(_samples, { voice: start, stableCount }) {
    yield;
    const changes = parameterChanges(start.head, adjusted.head);
    const stable = stableCount === 1;
    return {
      voice: adjusted,
      reading,
      distance: 1.5,
      changes,
      unchanged: true,
      stable,
      uncertainty: stable ? { pitch: 1 } : null,
    };
  },
  *tracking() {
    yield;
    return { tokens: [], distance: 1.5, samples: new Float32Array() };
  },
};

function openRecognizer() {
  const { emit, on, off } = createEvents();
  return {
    on,
    off,
    push() {},
    reset() {},
    discardVoiceChange() {},
    setVoice(_head, _offsets, _immediate, applied) {
      applied?.();
    },
    flush() {
      const result = emptyRecognition(1);
      emit('final', result);
      return result;
    },
  };
}

function collect(size) {
  const session = createSession(options, { passes, openRecognizer });
  const events = [];
  for (const type of ['state', 'voice', 'partial', 'final', 'syllable']) {
    session.on(type, (value) => events.push({ type, value }));
  }
  for (let i = 0; i < samples.length; i += size) {
    session.push(samples.subarray(i, i + size));
  }
  const recognition = session.flush();
  return { session, events, recognition };
}

function consume(work) {
  for (let step = work.next(); ; step = work.next()) {
    if (step.done) {
      return step.value;
    }
  }
}

describe('voice session', () => {
  let first;
  it('walks through the states in order with a confident reading', () => {
    first = collect(4096);
    const states = first.events
      .filter(({ type }) => type === 'state')
      .map(({ value }) => value.state);
    expect(states).toEqual([
      'collecting',
      'fitting',
      'inverting',
      'refining',
      'stable',
    ]);
    expect(first.session.converged).toBe(true);
    expect(first.recognition.voice).toEqual(first.session.voice);
    expect(first.session.uncertainty).toEqual({ pitch: 1 });
  });

  it('is deterministic for copied voices and events', () => {
    expect(collect(4096).events).toEqual(first.events);
    expect(collect(160).session.voice).toEqual(first.session.voice);
  });

  it('never raises pass distances and can speak with the copied voice', () => {
    const { session } = first;
    expect(session.history.map(({ distance }) => distance)).toEqual([
      2, 2, 1.5, 1.5,
    ]);
    expect(
      session.speak('Hello.', { tier: 'minimal', seed: 1 }).samples.length
    ).toBeGreaterThan(0);
    session.reset();
    expect(session.state).toBe('collecting');
    expect(session.history).toEqual([]);
    expect(() => session.speak('Hello.')).toThrow('No voice yet');
    expect(publicSession(options).state).toBe('collecting');
    const silent = copyVoice(new Float32Array(800), SAMPLE_RATE, {
      languages: ['en'],
      level: 'low',
    });
    expect(silent.voice).toBe(null);
    expect(silent.passes).toBe(0);
  });

  it('can seed inversion and pause background work', () => {
    const pending = [];
    const session = createSession(
      {
        ...options,
        voice: saveVoice(voice),
        backgroundShare: 0,
        realtime: true,
        schedule: (fn) => pending.push(fn),
      },
      { passes, openRecognizer }
    );
    session.push(samples.subarray(0, 4 * SAMPLE_RATE));
    expect(session.state).toBe('collecting');
    expect(pending.length).toBe(0);
    session.backgroundShare = 0.25;
    expect(session.state).toBe('inverting');
    expect(pending.length).toBe(1);
    session.backgroundShare = 0;
    session.flush();
    expect(session.voice).toEqual(saveVoice(voice));
    pending[0]();
    expect(session.history.map(({ state }) => state)).toEqual(['inverting']);
  });
});

describe('voice session reductions', () => {
  const tokens = Array.from({ length: 8 }, (_, i) => ({
    ipa: 'a',
    position: [0.4, -0.5, 0.1],
    f0: [119 + i, 250, 120 + i],
    durationRatio: 0.95 + i / 100,
    tractRatio: 1.01 + i / 100,
  }));

  it('filters octave errors and estimates bounded articulation and parameter spread', () => {
    const result = refit(voice, tokens);
    expect(result.head.pitch).toBe(123);
    expect(result.head.vocalTractLength).toBe(head.vocalTractLength * 1.045);
    expect(result.head.speechRate).toBe(0.985);
    expect(result.articulationOffsets.a.height).toBe(0.15);
    expect(result.articulationOffsets.a.backness).toBe(-0.15);
    expect(Math.abs(result.articulationOffsets.a.rounding - 0.1)).toBeLessThan(
      1e-12
    );
    const uncertainty = consume(uncertaintyFor(voice, tokens));
    expect(uncertainty.pitch).toBeGreaterThan(0);
    expect(uncertainty.vocalTractLength).toBeGreaterThan(0);
  });

  it('halves an uphill step three times and leaves the old estimate on rejection', () => {
    const tried = [];
    const result = consume(
      controlledRefit(
        voice,
        tokens,
        (candidate) => {
          tried.push(candidate.head.pitch);
          return 2;
        },
        1
      )
    );
    expect(tried).toEqual([123, 120.5, 119.25, 118.625]);
    expect(result).toEqual({ candidate: voice, distance: 1 });
  });

  it('requires ten confident phones and three distinct vowels', () => {
    const { segments } = reading.decoded;
    expect(usableReading({ segments })).toBe(true);
    expect(usableReading({ segments: segments.slice(0, 9) })).toBe(false);
    expect(
      usableReading({
        segments: segments.map((segment) =>
          segment.ipa === 'u' ? { ...segment, confidence: 0.49 } : segment
        ),
      })
    ).toBe(false);
  });

  it('compares speaker pitch after three voiced seconds', () => {
    const tracker = createSpeakerTracking({
      sampleRate: SAMPLE_RATE,
      halfLife: 30,
      driftFactor: 1.5,
    });
    tracker.start(1, 2);
    tracker.addPitch(
      Array.from({ length: 299 }, (_, i) => ({ f0: 210, time: i / 100 }))
    );
    expect(tracker.pitchChanged(head.pitch)).toBe(false);
    tracker.addPitch([{ f0: 210, time: 2.99 }]);
    expect(tracker.pitchChanged(head.pitch)).toBe(true);
  });

  it('round-trips vowel offsets and changes only the specified vowel targets', () => {
    const articulationOffsets = { a: { height: 0.1, rounding: 0.12 } };
    const file = saveVoice({ ...voice, articulationOffsets });
    expect(loadVoice(JSON.stringify(file)).articulationOffsets).toEqual(
      articulationOffsets
    );
    const options = { head };
    const standard = planUtterance('ˈpa ˈpi', options);
    const adjusted = planUtterance('ˈpa ˈpi', {
      ...options,
      articulationOffsets,
    });
    expect(
      JSON.stringify(
        planUtterance('ˈpa ˈpi', { ...options, articulationOffsets: {} })
      )
    ).toBe(JSON.stringify(standard));
    for (const channel of ['height', 'rounding']) {
      const plain = channelTargets(standard.segments, channel);
      const changed = channelTargets(adjusted.segments, channel);
      expect(
        changed.map(({ value }, i) =>
          i === 3 ? value > plain[i].value : value === plain[i].value
        )
      ).toEqual(changed.map(() => true));
    }
  });
});
