/** Screen physically rendered telephone copy controls on a golden recording. Unlicense. */
import { resample } from '../src/audio/resample.js';
import { renderPlan } from '../src/acoustics/voice.js';
import {
  compareRecordings,
  copyRecording,
  copyVoice,
  DEFAULT_HEAD,
  errorRate,
  getAudioTier,
  loadVoice,
  recognize,
  saveVoice,
} from '../src/index.js';
import { CODEBOOK_CHANNELS } from '../src/recognition/codebook.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { invertArticulation } from '../src/recognition/inversion.js';
import { applyPitch, matchLoudness } from '../src/session/copy-prosody.js';
import { measureCopyMetrics } from '../src/session/copy.js';
import {
  planRecording,
  renderScore,
  scorePlan,
  toScore,
} from '../src/session/score.js';
import { sampleTrack, warpPlan } from '../src/session/warp.js';
import { loadGolden } from '../tests/helpers/golden.js';

const options = { tier: 'telephone', engine: 'js' };
const settings = { ...getAudioTier(options.tier), engine: 'js', seed: 1 };
const { sampleRate } = settings;
const single = process.argv.includes('--single');
const low = single || process.argv.includes('--low');
const ids = process.argv.slice(2).filter((arg) => !arg.startsWith('--'));
if (!ids.length) {
  ids.push('en-01');
}
const names = CODEBOOK_CHANNELS.map(({ name }) => name);
const noise = ['aspiration', 'frication', 'sibilance'];

function measure(item, input, original, output, treatment) {
  const reread = recognize(output, sampleRate, {
    languages: [original.score.language],
    level: 'low',
    includeModeLabels: false,
  });
  const metrics = compareRecordings(
    { samples: input, sampleRate },
    { samples: output, sampleRate },
    { formants: false }
  );
  console.log(
    JSON.stringify({
      id: item.id,
      treatment,
      language: original.score.language,
      reference: original.recognition.text,
      replay: reread.text,
      cents: metrics.f0.rmseCents,
      mcd: metrics.mcd,
      timingMs:
        output === original.samples ? original.metrics.timingError : undefined,
      agreement:
        1 - errorRate(original.recognition.ipa, reread.ipa, 'phone').rate,
    })
  );
}

function lowLevelCopy(input) {
  const { recognition: initial, voice: fitted } = copyVoice(input, sampleRate, {
    engine: settings.engine,
    level: 'low',
  });
  const voice = fitted ?? saveVoice(DEFAULT_HEAD);
  const language = initial.languages[0]?.language;
  const recognition =
    single && language ? analyzeSingle(input, language, voice) : initial;
  const { ipa, modes, segments, languages } = recognition;
  const base = planRecording(ipa, languages[0]?.language, voice, modes);
  const duration = input.length / sampleRate;
  const plan = warpPlan(base, segments ?? [], { duration });
  const voicing = applyPitch(plan, input, sampleRate, modes, true);
  matchLoudness(plan, input, sampleRate, settings.seed, settings);
  const score = {
    ...toScore(plan, recognition, voice),
    voicing,
    duration,
    planDuration: plan.duration,
  };
  const output = renderScore(score, options);
  const metrics = measureCopyMetrics(
    input,
    sampleRate,
    output,
    score,
    options,
    {
      warnings: plan.warnings,
    }
  );
  return { ...output, score, recognition, metrics };
}

function analyzeSingle(input, language, voice) {
  const { head, articulationOffsets } = loadVoice(voice);
  return recognize(input, sampleRate, {
    languages: [language],
    voice: head,
    articulationOffsets,
    engine: settings.engine,
    deterministic: true,
    level: 'low',
    segments: true,
  });
}

function impose(plan, inverted, channels, weight) {
  for (const name of channels) {
    const output = plan.channels[name];
    for (let i = 0; i < output.length; i++) {
      const row =
        (i / plan.frameRate - inverted.startTime) * inverted.frameRate;
      const estimated = sampleTrack(inverted.channels[name], row);
      output[i] += weight * (estimated - output[i]);
    }
  }
}

const items = loadGolden().filter(({ id }) => ids.includes(id));
if (items.length !== ids.length) {
  throw new Error('Supply distinct golden recording IDs, such as en-01');
}
for (const item of items) {
  const input = resample(item.samples, item.sampleRate, sampleRate);
  if (low) {
    const copy = lowLevelCopy(input);
    const treatment = single
      ? 'single-language batch analysis'
      : 'low-tier analysis';
    measure(item, input, copy, copy.samples, treatment);
    continue;
  }
  const copy = copyRecording(input, sampleRate, options);
  measure(item, input, copy, copy.samples, 'copy');
  const render = (plan, treatment) => {
    const output = new Float32Array(input.length);
    output.set(renderPlan(plan, settings).subarray(0, input.length));
    measure(item, input, copy, output, treatment);
  };

  const reduceNoise = scorePlan(copy.score);
  reduceNoise.channels.breath.fill(0);
  reduceNoise.channels.harsh.fill(0);
  render(reduceNoise, 'neutral breath and harshness');

  const { ipa, modes, segments } = copy.recognition;
  const base = planRecording(ipa, copy.score.language, copy.voice, modes);
  const unrestricted = warpPlan(base, segments, {
    clamp: false,
    duration: input.length / sampleRate,
  });
  applyPitch(unrestricted, input, sampleRate, modes, true);
  matchLoudness(unrestricted, input, sampleRate, settings.seed, settings);
  render(unrestricted, 'extended measured durations');

  const frames = analyzeFrames(input, sampleRate);
  const inverted = invertArticulation(frames, { voice: base.head });
  const oral = scorePlan(copy.score);
  impose(oral, inverted, names, 0.5);
  matchLoudness(oral, input, sampleRate, settings.seed, settings);
  render(oral, 'tract blend');

  const source = scorePlan(copy.score);
  impose(source, inverted, ['voicing', ...noise], 0.8);
  matchLoudness(source, input, sampleRate, settings.seed, settings);
  render(source, 'source blend');

  const measured = scorePlan(copy.score);
  impose(measured, inverted, [...names, 'voicing', ...noise], 1);
  matchLoudness(measured, input, sampleRate, settings.seed, settings);
  render(measured, 'inverted tract and source');
}
