/** Stage A calibration readings of issue 63. Unlicense. */
import { describe, it, expect } from 'test-anywhere';
import {
  cppBreathiness,
  rdTenseness,
} from '../src/analysis/voice-fit-tables.js';
import {
  plannedSpeechTime,
  plannedPitchRange,
  transcriptSpeechRate,
  transcriptPitchRange,
  plannedMedianF0,
  transcriptPitch,
} from '../src/analysis/voice-fit-transcript.js';
import {
  BREATHINESS_CPP,
  SPEECH_TIME,
  PLANNED_RANGE_RATIO,
  DEFAULT_SYLLABLE_RATE,
  TEXT_TRACT,
  TEXT_SYLLABLE_RATIO,
  TEXT_FORMANT_WEIGHT,
} from '../src/analysis/voice-fit-calibration.js';
import {
  accumulate,
  emptyState,
  statisticsResult,
} from '../src/analysis/voice-fit-statistics.js';
import { vectorDistance } from '../src/analysis/voice-fit-objective.js';
import { fitVoice, synthesize, createVoiceFitter } from '../src/index.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { findLandmarks } from '../src/recognition/landmarks.js';
import { totalNuclei } from '../src/analysis/voice-fit-nuclei.js';
import { nearestPreset } from '../src/analysis/voice-fit.js';
import { presetHeadConfig } from '../src/head-config.js';
const TEXT =
  'The north wind and the sun were disputing which was the stronger.';
const close = (a, b, tolerance) => Math.abs(a - b) <= tolerance;
describe('voice fitting calibration', () => {
  it('reads breathiness from CPP at the table pitches and between them', () => {
    expect(
      close(cppBreathiness(BREATHINESS_CPP.cpp[2][3], 150).value, 0.3, 1e-9)
    ).toBe(true);
    // Halfway in log pitch between 110 and 150 Hz the row is the mean.
    const f0 = Math.sqrt(110 * 150),
      cpp = (BREATHINESS_CPP.cpp[1][5] + BREATHINESS_CPP.cpp[2][5]) / 2;
    expect(close(cppBreathiness(cpp, f0).value, 0.5, 1e-9)).toBe(true);
    // Outside the table the nearest row is used.
    expect(
      close(cppBreathiness(BREATHINESS_CPP.cpp[0][2], 40).value, 0.2, 1e-9)
    ).toBe(true);
    expect(cppBreathiness(99, 150).value).toBe(0);
  });
  it('reads tenseness from rd and averages a saturated stretch', () => {
    const table = {
      tenseness: [0.2, 0.5, 0.8],
      breathiness: [0, 1],
      pitch: [100, 200],
      bin: 0.05,
      rd: [
        [
          [1.2, 0.9, 0.6],
          [1.4, 1.1, 0.8],
        ],
        [
          [0.9, 0.9, 0.6],
          [0.9, 0.9, 0.6],
        ],
      ],
    };
    expect(close(rdTenseness(0.75, 100, 0, table).value, 0.65, 0.003)).toBe(
      true
    );
    expect(close(rdTenseness(0.95, 100, 0.5, table).value, 0.55, 0.003)).toBe(
      true
    );
    const flat = rdTenseness(0.9, 200, 0, table);
    // 0.2 to 0.5 read 0.9, and so (within half a bin) up to 0.525.
    expect(close(flat.value, 0.3625, 0.006)).toBe(true);
    expect(close(flat.spread, 0.1625, 0.006)).toBe(true);
    // A missing (0) entry takes the other pitch's value.
    table.rd[1][0][2] = 0;
    expect(close(rdTenseness(0.7, 150, 0, table).value, 0.7, 0.003)).toBe(true);
  });
  it('inverts the planned speaking time and f0 range of a transcript', () => {
    for (const rate of [0.7, 1, 1.3]) {
      const seconds =
        SPEECH_TIME.slope * plannedSpeechTime(TEXT, rate) + SPEECH_TIME.offset;
      expect(close(transcriptSpeechRate(seconds, TEXT), rate, 0.01)).toBe(true);
    }
    expect(plannedSpeechTime(TEXT, 0.7) > plannedSpeechTime(TEXT, 1.3)).toBe(
      true
    );
    for (const range of [2, 3.6, 5]) {
      const semitones = PLANNED_RANGE_RATIO * plannedPitchRange(TEXT, range);
      expect(
        close(transcriptPitchRange(semitones, TEXT), range, 0.05 * range)
      ).toBe(true);
    }
    expect(transcriptSpeechRate(0, TEXT)).toBe(null);
    // The words move the median f0 away from the pitch; the reading
    // inverts the plan, which is linear in the pitch.
    for (const pitch of [90, 160, 260]) {
      const median = plannedMedianF0(TEXT, pitch, 3);
      expect(
        close(transcriptPitch(median, TEXT, 3), pitch, 0.001 * pitch)
      ).toBe(true);
    }
    expect(transcriptPitch(0, TEXT, 3)).toBe(null);
  });
  it('reads rate and pitch range of a preset head saying the transcript', () => {
    // The legacy matchVoice cases of tests/voice-match.test.js: syllable
    // counting read 1.2 and 1.78 for this male head.
    const head = presetHeadConfig('male');
    const audio = synthesize(TEXT, {
      head,
      solver: 'waveguide',
      sampleRate: 22050,
      seed: 1,
      engine: 'js',
    });
    const fit = fitVoice(audio.samples, audio.sampleRate, {
      refine: false,
      transcript: TEXT,
    });
    expect(close(fit.head.speechRate, head.speechRate, 0.05)).toBe(true);
    expect(close(fit.head.pitchRange, head.pitchRange, 1)).toBe(true);
    // Read against the plan of the same words the pitch is 115.6 Hz for
    // 118 Hz, within the 3 % of issue 63 for a transcript
    // (experiments/issue-63/preset-pitch.txt).
    expect(close(fit.head.pitch, head.pitch, 0.03 * head.pitch)).toBe(true);
    expect(fit.parameters.speechRate.sd > 0).toBe(true);
  });
  it('keeps the preset of stage A while the tract stays in its range', () => {
    // The female preset fitted at 209.8 Hz and 14.71 cm lies closer to the
    // child at size 1 (215 Hz, 14.6 cm) than to any female size.
    const final = { pitch: 209.8, vocalTractLength: 14.71 },
      start = { pitch: 215, vocalTractLength: 15.84 };
    expect(nearestPreset(final).name).toBe('child');
    expect(nearestPreset(final, undefined, start).name).toBe('female');
    expect(nearestPreset(final, 'child', start).name).toBe('child');
    // A tract more than 1 cm below the female range (14 to 15.6) moves on.
    const small = { pitch: 260, vocalTractLength: 12.9 };
    expect(nearestPreset(small, undefined, start).name).toBe('child');
  });
  it('counts landmark nuclei across updates like the whole recording', () => {
    const { samples, sampleRate } = synthesize('The north wind and the sun.', {
      head: {
        vocalTractLength: 18.5,
        pitch: 100,
        tenseness: 0.75,
        speechRate: 0.9,
      },
      seed: 1,
      sampleRate: 16000,
      solver: 'waveguide',
    });
    const whole = findLandmarks(analyzeFrames(samples, sampleRate)).nuclei;
    const one = createVoiceFitter();
    one.update(samples, sampleRate);
    expect(totalNuclei(one.state)).toBe(whole.length);
    // Two stretches analysed alone count 4 + 3 nuclei for these 7.
    const middle = Math.floor(samples.length / 2);
    const first = createVoiceFitter();
    first.update(samples.subarray(0, middle), sampleRate);
    const second = createVoiceFitter({
      state: JSON.parse(JSON.stringify(first.state)),
    });
    second.update(samples.subarray(middle), sampleRate);
    expect(totalNuclei(second.state)).toBe(whole.length);
    expect(second.state.landmarks.carry.length).toBe(2 * sampleRate);
    const broken = JSON.parse(JSON.stringify(first.state));
    broken.landmarks.carry.push(0.5);
    expect(() => createVoiceFitter({ state: broken })).toThrow(RangeError);
  });
});
describe('voice fitting without a transcript', () => {
  it('reads tract and rate of an average text without a transcript', () => {
    const { samples } = synthesize(
      'The birch canoe slid on the smooth planks.',
      {
        seed: 1,
        sampleRate: 16000,
        solver: 'waveguide',
      }
    );
    const state = accumulate(emptyState(), samples, 16000);
    const none = statisticsResult(state),
      named = statisticsResult(state, {
        transcript: 'The birch canoe slid on the smooth planks.',
        language: 'en',
      });
    const reading = none.features.vocalTractLength,
      tract = none.parameters.vocalTractLength;
    expect(close(tract.value, reading / TEXT_TRACT.ratio, 1e-9)).toBe(true);
    expect(tract.sd >= TEXT_TRACT.spread * tract.value).toBe(true);
    expect(close(named.parameters.vocalTractLength.value, reading, 1e-9)).toBe(
      true
    );
    expect(
      close(
        none.head.speechRate,
        none.features.syllableRate /
          DEFAULT_SYLLABLE_RATE /
          TEXT_SYLLABLE_RATIO,
        1e-9
      )
    ).toBe(true);
  });
  it('weighs the words out of the objective without a transcript', () => {
    // A candidate one scale away in ln dF alone (index 2); without a
    // transcript the target's ln syllable rate (index 11) reads as
    // MATCH_TEXT would at the same speechRate.
    const target = {
      values: Array(36).fill(0),
      scales: Array(36).fill(1),
      speechTime: 0,
    };
    const candidate = {
      ...target,
      values: target.values.map((_, i) =>
        i === 2 ? 1 : i === 11 ? -Math.log(TEXT_SYLLABLE_RATIO) : 0
      ),
    };
    const weight = 8 + 4 * TEXT_FORMANT_WEIGHT + 24 * 0.3;
    expect(
      close(
        vectorDistance(target, candidate, false),
        Math.sqrt(TEXT_FORMANT_WEIGHT / weight),
        1e-12
      )
    ).toBe(true);
    const timed = { ...candidate, values: [...candidate.values] };
    timed.values[11] = 0;
    expect(
      close(vectorDistance(target, timed, true, 0), Math.sqrt(1 / 40), 1e-12)
    ).toBe(true);
  });
});
