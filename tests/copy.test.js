/** Copy-synthesis regressions at the 16 kHz minimal tier. Unlicense. */
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'test-anywhere';
import { runCli } from '../bin/voice-simulator.js';
import { measureTiers } from '../scripts/copy-report.mjs';
import { toPlanModes } from '../src/recognition/modes.js';
import {
  applyPitch,
  matchLoudness,
  renderedRmsTrack,
  repairOctaves,
  rmsTrack,
} from '../src/session/copy-prosody.js';
import { groupPhones, warpPlan } from '../src/session/warp.js';
import {
  copyRecording,
  encodeWav,
  errorRate,
  f0Errors,
  getAudioTier,
  pitchTrack,
  planUtterance,
  presetHeadConfig,
  renderPlan,
  renderScore,
  saveVoice,
  synthesize,
  toScore,
} from '../src/index.js';
import { rmsLevel } from '../src/metrics/distortion.js';

const sampleRate = 16000;
const options = { tier: 'minimal', sampleRate, seed: 1, engine: 'js' };
const draft = { sampleRate, sections: 22, seed: 1, engine: 'js' };
const near = (actual, expected, limit) =>
  assert.ok(
    Number.isFinite(actual) && Math.abs(actual - expected) <= limit,
    `${actual} outside ${expected} ± ${limit}`
  );

function vowelWithPitch(duration = 0.85) {
  const plan = planUtterance('aː', {
    head: { pitch: 125, vibrato: 0 },
    durations: [duration],
  });
  for (let i = 0; i < plan.frameCount; i++) {
    plan.channels.f0[i] = 100 + (50 * i) / (plan.frameCount - 1);
  }
  return plan;
}

function medianPitch(samples) {
  const values = pitchTrack(samples, sampleRate)
    .filter((hz) => hz > 0)
    .sort();
  return values[Math.floor(values.length / 2)];
}

it('keeps loudness windows intact across renderer blocks', () => {
  const plan = vowelWithPitch();
  for (const rate of [8000, 16000]) {
    const settings = { ...draft, sampleRate: rate };
    const audio = renderPlan(plan, settings);
    assert.ok(audio.length > 4096 && audio.length % 4096 > 0);
    assert.deepEqual(
      renderedRmsTrack(plan, settings),
      rmsTrack(audio, rate, plan.frameCount, plan.frameRate)
    );
  }
});

describe('copy controls', () => {
  it('keeps measured durations', () => {
    const plan = planUtterance('ˈmama');
    const measurements = groupPhones(plan.segments).map(
      ({ token, start, end }) => ({
        ipa: token.symbol,
        start: start * 1.5,
        end: end * 1.5,
      })
    );
    const result = groupPhones(warpPlan(plan, measurements).segments);
    for (const [index, group] of result.entries()) {
      near(
        group.end - group.start,
        measurements[index].end - measurements[index].start,
        1 / plan.frameRate
      );
    }
    const stop = planUtterance('ta');
    const stretched = warpPlan(
      stop,
      groupPhones(stop.segments).map(({ token, start, end }) => ({
        ipa: token.symbol,
        start: 10 * start,
        end: 10 * end,
      }))
    );
    near(
      stretched.segments.find(({ kind }) => kind === 'release').duration,
      stop.segments.find(({ kind }) => kind === 'release').duration,
      1e-9
    );
    assert.equal(stretched.warnings.length, 2);
  });

  it('returns to a measured phone boundary after an earlier clamp', () => {
    const plan = planUtterance('ama');
    const measured = [
      { ipa: 'a', start: 0, end: 0.005 },
      { ipa: 'm', start: 0.005, end: 0.135 },
      { ipa: 'a', start: 0.135, end: 0.2 },
    ];
    const warped = warpPlan(plan, measured);
    const phones = groupPhones(warped.segments);
    assert.ok(phones[0].end > measured[0].end);
    near(phones[1].end, measured[1].end, 1e-9);
    near(phones[2].start, measured[2].start, 1e-9);
  });

  it('imposes the measured pitch', () => {
    const source = vowelWithPitch();
    const target = planUtterance('aː', {
      head: source.head,
      durations: [0.85],
    });
    const original = renderPlan(source, draft);
    applyPitch(target, original, sampleRate, []);
    const copy = renderPlan(target, draft);
    const measurement = f0Errors(
      pitchTrack(original, sampleRate),
      pitchTrack(copy, sampleRate)
    );
    near(measurement.rmseCents, 0, 30);
  });

  it('copies and replays acoustic pitch in falsetto', () => {
    const modes = [
      { from: 0, to: 1, start: 0, end: 0.85, phonation: { falsetto: 1 } },
    ];
    const settings = {
      head: { pitch: 125, vibrato: 0 },
      durations: [0.85],
      modes: toPlanModes(modes),
    };
    const source = planUtterance('aː', settings);
    const target = planUtterance('aː', settings);
    const original = renderPlan(source, draft);
    const pitch = medianPitch(original);
    near(pitch, 250, 5);

    applyPitch(target, original, sampleRate, modes);
    near(medianPitch(renderPlan(target, draft)), pitch, 5);
    const score = toScore(
      target,
      { words: [], languages: [], modes },
      saveVoice(target.head)
    );
    near(score.f0.values[Math.floor(score.f0.values.length / 2)], pitch, 5);
    near(medianPitch(renderScore(score, options).samples), pitch, 5);
  });

  it('repairs an octave jump', () => {
    const values = new Float32Array(64).fill(120);
    values.fill(240, 24, 29);
    assert.deepEqual(
      repairOctaves(values, 200),
      new Float32Array(64).fill(120)
    );
  });

  it('raises a vowel by 6 dB when the loudness doubles', () => {
    const plan = vowelWithPitch();
    const source = renderPlan(plan, draft);
    plan.channels.loudness = plan.channels.loudness.map((value) => 2 * value);
    const louder = renderPlan(plan, draft);
    near(20 * Math.log10(rmsLevel(louder) / rmsLevel(source)), 6, 1);
  });

  it('round-trips a score and replays pitch edits', () => {
    const plan = vowelWithPitch();
    const modes = [
      {
        from: 0,
        to: 1,
        start: 0,
        end: plan.duration,
        notation: null,
        confidence: 1,
        phonation: { tension: 0.5 },
      },
    ];
    const score = toScore(
      plan,
      { words: [], languages: [], modes },
      saveVoice(plan.head)
    );
    assert.deepEqual(score.modes, modes);
    const output = renderScore(score, options);
    const decoded = JSON.parse(JSON.stringify(score));
    assert.deepEqual(renderScore(decoded, options).samples, output.samples);
    assert.deepEqual(
      renderScore({ ...decoded, ipa: undefined }, options).samples,
      output.samples
    );
    decoded.f0.values = decoded.f0.values.map((value) => value * 2 ** (2 / 12));
    const higher = renderScore(decoded, options);
    near(
      12 * Math.log2(medianPitch(higher.samples) / medianPitch(output.samples)),
      2,
      0.2
    );
    decoded.segments[0].ipa = 'i';
    const editedPhone = renderScore(decoded, options);
    assert.notDeepEqual(editedPhone.samples, higher.samples);
    decoded.segments[0].start += 0.1;
    assert.notDeepEqual(
      renderScore(decoded, options).samples,
      editedPhone.samples
    );
  });
});

it('matches the measured level in the telephone renderer', () => {
  const settings = { ...getAudioTier('telephone'), seed: 1, engine: 'js' };
  const plan = () => planUtterance('uː', { head: { pitch: 125, vibrato: 0 } });
  const original = plan();
  const copy = plan();
  original.channels.loudness = original.channels.loudness.map(
    (gain) => 2 * gain
  );
  const samples = renderPlan(original, settings);

  matchLoudness(copy, samples, settings.sampleRate, settings.seed, settings);

  const level = rmsLevel(renderPlan(copy, settings));
  near(20 * Math.log10(level / rmsLevel(samples)), 0, 0.6);
});

it('replays measured stretches without vocal fold vibration', () => {
  const settings = { ...getAudioTier('telephone'), seed: 1, engine: 'js' };
  const plan = vowelWithPitch();
  const samples = renderPlan(plan, settings);
  samples.fill(0, 0, Math.round(0.35 * settings.sampleRate));

  const voicing = applyPitch(plan, samples, settings.sampleRate, [], true);
  const score = toScore(
    plan,
    { words: [], languages: [], modes: [] },
    saveVoice(plan.head)
  );
  score.voicing = voicing;
  const recorded = JSON.parse(JSON.stringify(score));
  const track = pitchTrack(
    renderScore(recorded, { tier: 'telephone', engine: 'js' }).samples,
    settings.sampleRate
  );
  assert.equal(track.slice(4, 20).filter((hz) => hz > 0).length, 0);
  assert.ok(track.slice(50, 75).some((hz) => hz > 0));
});

describe('copy synthesis', () => {
  it('reports copy metrics for each requested tier', () => {
    const item = {
      id: 'silence',
      ipa: '',
      samples: new Float32Array(sampleRate / 5),
      sampleRate,
    };
    const rows = Array.from(
      measureTiers(item, ['minimal', 'telephone'], {
        ...options,
        voice: saveVoice({ pitch: 125 }),
      })
    );
    assert.deepEqual(
      rows.map(({ tier }) => tier),
      ['minimal', 'telephone']
    );
    assert.ok(rows.every(({ mcd }) => Number.isFinite(mcd)));
  });

  it('copies a synthetic original', () => {
    const head = presetHeadConfig('female');
    const languages = ['en'];
    const source = synthesize('Hello world.', {
      ...options,
      head,
    });
    const result = copyRecording(source.samples, sampleRate, {
      ...options,
      languages,
    });
    assert.equal(result.recognition.text, 'Hello world.');
    assert.equal(result.voice.preset, 'female');
    const phonemeError = errorRate(
      source.ipa,
      result.recognition.ipa,
      'phone'
    ).rate;
    assert.deepEqual(
      renderScore(JSON.parse(JSON.stringify(result.score)), options).samples,
      result.samples
    );
    const { rmseCents } = result.metrics.f0;
    const { timingError } = result.metrics;
    const measured = JSON.stringify({
      recognized: result.recognition.text,
      phonemeError,
      rmseCents,
      timingError,
    });
    assert.ok(
      phonemeError === 0 &&
        rmseCents !== null &&
        rmseCents <= 30 &&
        timingError !== null &&
        timingError <= 10,
      measured
    );
  });

  it('CLI copy writes audio and a score', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'voice-copy-'));
    try {
      const input = join(directory, 'in.wav');
      const output = join(directory, 'out.wav');
      const replay = join(directory, 'replay.wav');
      const score = join(directory, 'score.json');
      const voice = join(directory, 'voice.json');
      const original = renderPlan(vowelWithPitch(0.18), draft);
      writeFileSync(input, encodeWav(original, sampleRate));
      writeFileSync(voice, JSON.stringify(saveVoice({ pitch: 125 })));
      const errors = [];
      const logs = [];
      const io = {
        stderr: (line) => errors.push(line),
        stdout: (line) => logs.push(line),
      };
      const args = [
        '--tier',
        'minimal',
        '--sample-rate',
        '16000',
        '--engine',
        'js',
      ];
      assert.equal(
        await runCli(
          [
            'copy',
            input,
            '-o',
            output,
            '--score',
            score,
            '--voice',
            voice,
            '--languages',
            'en',
            '--json',
            ...args,
          ],
          io
        ),
        0,
        errors.join('\n')
      );
      assert.equal(
        JSON.parse(readFileSync(score)).format,
        'voice-simulator/score'
      );
      assert.ok(JSON.parse(logs.at(-1)).metrics);
      assert.equal(
        await runCli(
          ['copy', '--from-score', score, '-o', replay, '--engine', 'js'],
          io
        ),
        0,
        errors.join('\n')
      );
      assert.deepEqual(readFileSync(output), readFileSync(replay));
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
