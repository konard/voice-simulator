/** Budgeted per-syllable oral refinement. Unlicense. */
import { resample } from '../audio/resample.js';
import { logSpectralDistance } from '../metrics/distortion.js';
import { analyzeFrames } from '../recognition/frontend.js';
import { invertArticulation } from '../recognition/inversion.js';
import { DRAFT_RATE, renderDraft } from './copy-prosody.js';
import { REFINED_CHANNELS, scorePlan } from './score.js';
import { sampleTrack } from './warp.js';

export function blendControl(base, estimate, weight) {
  return base * (1 - weight) + estimate * weight;
}

export function offsetControl(value, delta, distance, radius) {
  const change = delta * (1 - distance / radius);
  return Math.max(0, Math.min(1, value + change));
}

export function offsetPenalty(candidate, previous) {
  return 4 * (candidate ** 2 - previous ** 2);
}

function pieceCuts(plan) {
  const cuts = [0];
  let candidates = [];
  for (const segment of plan.segments) {
    if (segment.kind !== 'pause' || segment.token?.kind === 'sound') {
      continue;
    }
    const middle = Math.round(
      ((segment.start + segment.end) * plan.frameRate) / 2
    );
    if (middle - cuts.at(-1) >= 5 * plan.frameRate) {
      const cut = candidates.at(-1) ?? middle;
      if (cut < plan.frameCount - 1) {
        cuts.push(cut);
      }
      candidates = [];
    }
    candidates.push(middle);
  }
  if (
    plan.frameCount - 1 - cuts.at(-1) > 5 * plan.frameRate &&
    candidates.at(-1) > cuts.at(-1)
  ) {
    cuts.push(candidates.at(-1));
  }
  return [...new Set([...cuts, plan.frameCount - 1])];
}

function bounds(plan, words) {
  const { frameRate, segments } = plan;
  return words.flatMap(({ syllables }) =>
    syllables.map(({ start, end }) => {
      const vowel = segments.find(
        (segment) =>
          segment.kind === 'vowel' && segment.end > start && segment.start < end
      );
      return {
        start: Math.round(start * frameRate),
        end: Math.round(end * frameRate),
        nucleus: Math.round(
          (vowel ? (vowel.start + vowel.end) / 2 : (start + end) / 2) *
            frameRate
        ),
      };
    })
  );
}

function slicePlan(plan, from, to) {
  return {
    ...plan,
    duration: (to - from) / plan.frameRate,
    frameCount: to - from + 1,
    channels: Object.fromEntries(
      Object.entries(plan.channels).map(([key, values]) => [
        key,
        values.subarray(from, to + 1),
      ])
    ),
  };
}

function blendSyllable(piece, inversion, syllable, accept) {
  const { start: from, end: to } = syllable;
  const base = REFINED_CHANNELS.map((key) =>
    piece.channels[key].slice(from, to)
  );
  let best = base;
  for (const weight of [0.5, 1]) {
    REFINED_CHANNELS.forEach((key, k) => {
      for (let i = from; i < to; i++) {
        const estimate = sampleTrack(
          inversion.channels[key],
          (i * inversion.frameRate) / piece.frameRate
        );
        piece.channels[key][i] = blendControl(
          base[k][i - from],
          estimate,
          weight
        );
      }
    });
    if (accept(0, 0)) {
      best = REFINED_CHANNELS.map((key) => piece.channels[key].slice(from, to));
    }
  }
  REFINED_CHANNELS.forEach((key, k) => piece.channels[key].set(best[k], from));
}

function tweakSyllable(piece, { start, end, nucleus }, accept) {
  const radius = Math.max(1, Math.round(0.05 * piece.frameRate));
  const from = Math.max(start, nucleus - radius);
  const to = Math.min(end, nucleus + radius + 1);
  if (to <= from) {
    return;
  }
  const offsets = new Map(REFINED_CHANNELS.map((key) => [key, 0]));
  for (let round = 0; round < 2; round++) {
    for (const key of REFINED_CHANNELS) {
      const channel = piece.channels[key];
      const offset = offsets.get(key);
      const original = channel.slice(from, to);
      let best = original;
      let chosen = offset;
      for (const delta of [-0.05, 0.05]) {
        for (let i = from; i < to; i++) {
          channel[i] = offsetControl(
            original[i - from],
            delta,
            Math.abs(i - nucleus),
            radius
          );
        }
        const candidate = offset + delta;
        if (accept(offsetPenalty(candidate, chosen), 0.05)) {
          best = channel.slice(from, to);
          chosen = candidate;
        }
      }
      channel.set(best, from);
      offsets.set(key, chosen);
    }
  }
}

function searchPiece(piece, reference, syllables, render) {
  const first = render(piece);
  if (!first || !reference.length || !syllables.length) {
    return;
  }
  const inversion = invertArticulation(analyzeFrames(reference, DRAFT_RATE), {
    voice: piece.head,
  });
  let best = logSpectralDistance(reference, first, DRAFT_RATE);
  const accept = (penalty, improvement) => {
    const audio = render(piece);
    if (!audio) {
      return false;
    }
    const cost = logSpectralDistance(reference, audio, DRAFT_RATE) + penalty;
    const reduction = best - cost;
    if (reduction > 0 && reduction >= improvement) {
      best = cost - penalty;
      return true;
    }
    return false;
  };
  for (const syllable of syllables) {
    blendSyllable(piece, inversion, syllable, accept);
    tweakSyllable(piece, syllable, accept);
  }
}

export function refineCopy(score, samples, sampleRate, { seed, budget }) {
  const plan = scorePlan(score);
  const reference = resample(samples, sampleRate, DRAFT_RATE);
  const cuts = pieceCuts(plan);
  const syllables = bounds(plan, score.words);
  function render(piece) {
    if (budget <= 0) {
      return null;
    }
    budget--;
    return renderDraft(piece, seed);
  }
  for (let i = 1; budget > 0 && i < cuts.length; i++) {
    const from = cuts[i - 1];
    const to = cuts[i];
    const local = syllables
      .filter(({ nucleus }) => nucleus >= from && nucleus < to)
      .map(({ start, end, nucleus }) => ({
        start: Math.max(start, from) - from,
        end: Math.min(end, to) - from,
        nucleus: nucleus - from,
      }));
    if (local.length) {
      searchPiece(
        slicePlan(plan, from, to),
        reference.subarray(
          Math.round((from * DRAFT_RATE) / plan.frameRate),
          Math.round((to * DRAFT_RATE) / plan.frameRate)
        ),
        local,
        render
      );
    }
  }
  return plan;
}
