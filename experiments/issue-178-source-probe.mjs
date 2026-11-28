/** Evaluate source and level corrections with the shared telephone renderer. Unlicense. */
import { renderPlan } from '../src/acoustics/voice.js';
import { pitchBeforePhonation } from '../src/acoustics/glottis.js';
import { smoothChannel } from '../src/articulation/plan.js';
import { resample } from '../src/audio/resample.js';
import {
  compareRecordings,
  copyRecording,
  errorRate,
  fitVoice,
  getAudioTier,
  recognize,
  saveVoice,
} from '../src/index.js';
import { alignEdits } from '../src/metrics/text.js';
import { pitchTrack } from '../src/metrics/pitch.js';
import { analyzeFrames } from '../src/recognition/frontend.js';
import { trackPitch } from '../src/recognition/pitch.js';
import {
  applyPitch,
  loudnessGain,
  pitchContour,
  rmsTrack,
} from '../src/session/copy-prosody.js';
import { planRecording, scorePlan } from '../src/session/score.js';
import { sampleTrack, warpPlan } from '../src/session/warp.js';
import { loadGolden } from '../tests/helpers/golden.js';

const options = { tier: 'telephone', engine: 'js' };
const settings = { ...getAudioTier(options.tier), engine: 'js', seed: 1 };
const { sampleRate } = settings;
const args = process.argv.slice(2);
const feedback = args.includes('--feedback');
const yin = args.includes('--yin');
const ids = args.filter((arg) => !arg.startsWith('--'));
if (!ids.length) {
  ids.push('en-01');
}

function timingError(before, after) {
  const first = before.flatMap(({ syllables }) => syllables);
  const second = after.flatMap(({ syllables }) => syllables);
  const phones = (syllables) => syllables.map(({ ipa }) => ipa);
  const { pairs } = alignEdits(phones(first), phones(second));
  return (
    pairs.reduce(
      (sum, [i, j]) => sum + Math.abs(first[i].start - second[j].start),
      0
    ) *
    (1000 / pairs.length)
  );
}

function measure(item, input, copy, output, treatment) {
  const replay = recognize(output, sampleRate, {
    languages: [copy.score.language],
    level: 'low',
    includeModeLabels: false,
  });
  const { f0, mcd } = compareRecordings(
    { samples: input, sampleRate },
    { samples: output, sampleRate },
    { formants: false }
  );
  console.log(
    JSON.stringify({
      id: item.id,
      treatment,
      reference: copy.recognition.text,
      replay: replay.text,
      cents: f0.rmseCents,
      mcd,
      timingMs: timingError(copy.score.words, replay.words),
      agreement: 1 - errorRate(copy.recognition.ipa, replay.ipa, 'phone').rate,
    })
  );
}

function reducedNoise(plan, pitch) {
  for (let i = 0; i < plan.frameCount; i++) {
    const row = (i / plan.frameRate - pitch.startTime) / pitch.hop;
    if (row < 0 || row >= pitch.count || sampleTrack(pitch.f0, row) <= 0) {
      continue;
    }
    const strength = sampleTrack(pitch.strength, row);
    const noiseShare = Math.min(1, 2 * (1 - strength));
    plan.channels.breath[i] *= noiseShare;
    plan.channels.harsh[i] *= noiseShare;
  }
}

function imposeYin(plan, input) {
  const measured = pitchTrack(input, sampleRate);
  const { frameCount, frameRate, channels } = plan;
  const onGrid = Float32Array.from({ length: frameCount }, (_, i) => {
    const row = 100 * (i / frameRate - 0.02);
    return measured[Math.round(row)] || 0;
  });
  const f0 = pitchContour(onGrid, frameRate, plan.head.pitch);
  for (let i = 0; i < frameCount; i++) {
    channels.f0[i] = pitchBeforePhonation(
      f0[i],
      channels.creak[i],
      channels.falsetto[i]
    );
  }
}

function matchEnvelope(plan, input) {
  const { frameCount, frameRate } = plan;
  const reference = rmsTrack(input, sampleRate, frameCount, frameRate);
  const loudness = plan.channels.loudness;
  for (let pass = 0; pass < 3; pass++) {
    const draft = rmsTrack(
      renderPlan(plan, settings),
      sampleRate,
      frameCount,
      frameRate
    );
    for (let i = 0; i < loudness.length; i++) {
      if (draft.values[i] > draft.threshold) {
        const target = Math.max(reference.values[i], reference.threshold);
        loudness[i] *= loudnessGain(target, draft.values[i]);
      }
    }
  }
}

function correctPitch(plan, reference) {
  const { frameCount, frameRate, channels } = plan;
  for (let pass = 0; pass < 4; pass++) {
    const draft = trackPitch(
      analyzeFrames(renderPlan(plan, settings), sampleRate)
    );
    const correction = Float32Array.from({ length: frameCount }, (_, i) => {
      const time = i / frameRate;
      const from = sampleTrack(draft.f0, (time - draft.startTime) / draft.hop);
      const to = sampleTrack(
        reference.f0,
        (time - reference.startTime) / reference.hop
      );
      if (!(from > 0 && to > 0 && channels.voicing[i] > 0.05)) {
        return 0;
      }
      return Math.max(-0.25, Math.min(0.25, 0.65 * Math.log2(to / from)));
    });
    const gain = smoothChannel(correction, 0.015, frameRate);
    for (let i = 0; i < frameCount; i++) {
      channels.f0[i] = Math.max(
        45,
        Math.min(900, channels.f0[i] * 2 ** gain[i])
      );
    }
  }
}

const items = loadGolden().filter(({ id }) => ids.includes(id));
if (items.length !== ids.length) {
  throw new Error('Supply distinct golden recording IDs, such as en-01');
}
for (const item of items) {
  const input = resample(item.samples, item.sampleRate, sampleRate);
  const copy = copyRecording(input, sampleRate, options);
  measure(item, input, copy, copy.samples, 'copy');
  const render = (plan, treatment) => {
    const output = new Float32Array(input.length);
    output.set(renderPlan(plan, settings).subarray(0, input.length));
    measure(item, input, copy, output, treatment);
  };
  const pitch = trackPitch(analyzeFrames(input, sampleRate));
  if (yin) {
    const corrected = scorePlan(copy.score);
    imposeYin(corrected, input);
    render(corrected, 'centred YIN pitch');

    const modal = scorePlan({ ...copy.score, voicing: undefined });
    imposeYin(modal, input);
    reducedNoise(modal, pitch);
    matchEnvelope(modal, input);
    render(modal, 'centred YIN pitch with planned voicing');
    continue;
  }
  if (feedback) {
    const corrected = scorePlan(copy.score);
    correctPitch(corrected, pitch);
    render(corrected, 'pitch feedback');

    const modal = scorePlan(copy.score);
    for (const channel of ['breath', 'harsh', 'creak', 'falsetto']) {
      modal.channels[channel].fill(0);
    }
    applyPitch(modal, input, sampleRate, copy.recognition.modes, false);
    matchEnvelope(modal, input);
    render(modal, 'modal source with measured envelope');
    correctPitch(modal, pitch);
    render(modal, 'modal source with pitch feedback');
    continue;
  }
  const strength = scorePlan(copy.score);
  reducedNoise(strength, pitch);
  matchEnvelope(strength, input);
  render(strength, 'source noise and measured envelope');

  const { score, recognition } = copy;
  const relaxed = scorePlan({
    ...score,
    voicing: score.voicing && {
      ...score.voicing,
      values: score.voicing.values.map((value) => 0.35 + 0.65 * value),
    },
  });
  reducedNoise(relaxed, pitch);
  matchEnvelope(relaxed, input);
  render(relaxed, 'partial voicing with source noise and measured envelope');

  const fit = fitVoice(input, sampleRate, { refine: false });
  const voice = saveVoice(fit);
  const fitted = warpPlan(
    planRecording(recognition.ipa, score.language, voice, recognition.modes),
    recognition.segments,
    { duration: input.length / sampleRate }
  );
  applyPitch(fitted, input, sampleRate, recognition.modes, true);
  reducedNoise(fitted, pitch);
  matchEnvelope(fitted, input);
  render(fitted, 'fitted voice with source noise and measured envelope');
}
