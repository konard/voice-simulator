/** End-to-end session recovery, speaker change and CPU gates. Unlicense. */
import { describe, expect, it } from 'test-anywhere';
import { cpuUsage } from 'node:process';
import {
  copyVoice,
  createVoiceSession,
  HEAD_PARAMETERS,
  loadVoice,
  presetHeadConfig,
  synthesize,
} from '../../src/index.js';
import { loadGolden } from '../helpers/golden.js';
import { heavyLimit, writeReport } from './helpers/report.js';

const RATE = 16000;
const TEXT =
  'A little bird sings in the morning. We heard it again across the green field. ' +
  'The road climbed slowly through the forest toward a house beside the river. ' +
  'She turned around and saw the lights come on in every room. ' +
  'They brought some tea and set the table before walking home together. ' +
  'The wind blew through the trees while we looked for a place to rest.';
const synthetic = [];
const golden = [];
const speakerChange = { changes: [], stable: [] };
const realtime = {};

function render(head, seconds, tier = 'minimal') {
  const { samples } = synthesize(TEXT, {
    head,
    lang: 'en',
    seed: 1,
    sampleRate: RATE,
    tier,
    engine: 'js',
  });
  if (samples.length < seconds * RATE) {
    throw new Error('Synthetic text is too short for the test window');
  }
  return samples.subarray(0, seconds * RATE);
}

function errors(file, truth) {
  if (!file) {
    return null;
  }
  const { head } = loadVoice(file);
  return Object.fromEntries(
    HEAD_PARAMETERS.map(({ key }) => [key, Math.abs(head[key] - truth[key])])
  );
}

function percent(row, pass, key) {
  const error = row[pass]?.[key];
  return error === undefined
    ? '—'
    : `${((100 * error) / row.truth[key]).toFixed(2)}%`;
}

function report() {
  const keys = ['vocalTractLength', 'pitch', 'speechRate'];
  const rows = synthetic.map((row) => {
    const columns = keys.map(
      (key) => `${percent(row, 'first', key)} → ${percent(row, 'last', key)}`
    );
    return `| ${row.id} | ${columns.join(' | ')} | ${row.passes} | ${row.converged} |`;
  });
  writeReport(
    'copy-voice-session',
    [
      '# Voice session recovery',
      '',
      '| Speaker | Tract length error | Pitch error | Rate error | Passes | Converged |',
      '| --- | --- | --- | --- | --- | --- |',
      ...rows,
      '',
      'Columns show first and last passes. The JSON records errors in parameter units for every head parameter.',
      '',
      `Golden recordings meeting the distance gate: ${golden.filter(({ passed }) => passed).length} of ${golden.length}.`,
      `Speaker changes (s): ${speakerChange.changes.join(', ') || 'none'}.`,
      `Telephone CPU (s): ${realtime.cpu ?? 'not measured'}.`,
    ].join('\n'),
    { synthetic, golden, speakerChange, realtime }
  );
}

function feed(session, samples) {
  for (let start = 0; start < samples.length; start += 4096) {
    session.push(samples.subarray(start, start + 4096));
  }
}

function distances(history) {
  return history.map(({ distance }) => distance);
}

describe('voice session', () => {
  it('recovers known parameters', () => {
    const male = presetHeadConfig('male');
    const inputs = [
      ['male', male],
      ['female', presetHeadConfig('female')],
      ['child', presetHeadConfig('child')],
      [
        'custom male',
        { ...male, vocalTractLength: 17.8, pitch: 100, speechRate: 0.85 },
      ],
    ];
    const failures = [];
    for (const [id, truth] of inputs.slice(0, heavyLimit(inputs.length))) {
      const session = createVoiceSession({
        sampleRate: RATE,
        languages: ['en'],
        window: 20,
        maxIterations: 12,
      });
      let first;
      session.on('voice', ({ voice }) => {
        first ??= voice;
      });
      feed(session, render(truth, 20));
      session.flush();
      const row = {
        id,
        truth,
        first: errors(first, truth),
        last: errors(session.voice, truth),
        passes: session.history.length,
        distances: distances(session.history),
        converged: session.converged,
        uncertainty: session.uncertainty,
      };
      synthetic.push(row);
      report();
      for (const [key, threshold] of [
        ['vocalTractLength', 0.03],
        ['pitch', 0.02],
        ['speechRate', 0.05],
      ]) {
        const error = row.last?.[key];
        if (error === undefined || error > threshold * truth[key]) {
          failures.push({ id, key, error, threshold });
        }
        const sd = row.uncertainty?.[key];
        if (error === undefined || sd === undefined || error > 3 * sd) {
          failures.push({ id, key, error, sd });
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('notices another speaker', () => {
    const female = presetHeadConfig('female');
    const session = createVoiceSession({ sampleRate: RATE, languages: ['en'] });
    session.on('state', ({ state, reason, time }) => {
      if (reason === 'speaker-change') {
        speakerChange.changes.push(time);
      }
      if (state === 'stable') {
        speakerChange.stable.push({
          time,
          errors: errors(session.voice, female),
        });
      }
    });
    feed(session, render(presetHeadConfig('male'), 12));
    feed(session, render(female, 12));
    session.flush();
    report();
    expect(speakerChange.changes.some((time) => time >= 12 && time <= 16)).toBe(
      true
    );
    expect(speakerChange.stable.length).toBe(2);
    const { errors: error } = speakerChange.stable[1];
    expect(error.pitch / female.pitch).toBeLessThanOrEqual(0.03);
    expect(
      error.vocalTractLength / female.vocalTractLength
    ).toBeLessThanOrEqual(0.05);
  });

  it('improves on the golden set', () => {
    for (const item of loadGolden().slice(0, heavyLimit(Infinity))) {
      const { history } = copyVoice(item.samples, item.sampleRate, {
        languages: [item.lang],
      });
      const readings = distances(history);
      const passed =
        readings.length > 1 &&
        readings.at(-1) <= 0.9 * readings[0] &&
        readings.slice(1).every((distance, i) => distance <= readings[i]);
      golden.push({ id: item.id, distances: readings, passed });
      report();
    }
    expect(golden.length).toBeGreaterThan(0);
    expect(golden.filter(({ passed }) => !passed)).toEqual([]);
  });

  it('fits one core at the telephone tier', async () => {
    const samples = render(presetHeadConfig('male'), 20, 'telephone');
    const session = createVoiceSession({
      sampleRate: RATE,
      languages: ['en'],
      level: 'low',
      realtime: true,
    });
    const start = cpuUsage();
    for (let i = 0; i < samples.length; i += 4096) {
      session.push(samples.subarray(i, i + 4096));
      await new Promise((resolve) => globalThis.setTimeout(resolve, 0));
    }
    session.flush();
    const { user, system } = cpuUsage(start);
    realtime.cpu = (user + system) / 1e6;
    realtime.passes = session.history.length;
    realtime.converged = session.converged;
    report();
    expect(realtime.cpu).toBeLessThan(20);
  });
});
