#!/usr/bin/env node
/**
 * Issue 41: find a phrase on which a head parameter acts. Renders each
 * candidate IPA phrase (with an optional language) at the parameter's min
 * and max and prints the relative change of every measure, so that the
 * entries that do nothing on `ˈmama ˈsasa` can name a phrase in
 * `effect.ipa` (and `effect.options.lang`).
 *
 *   node experiments/issue-41-effect-phrases.mjs durationTone3 'zh:ma˨˩ ma'
 *   node experiments/issue-41-effect-phrases.mjs speedTrill 'ˈara' 'ˈarra'
 *   node experiments/issue-41-effect-phrases.mjs --measures duration ...
 *   node experiments/issue-41-effect-phrases.mjs \
 *     --options '{"solver":"fdtd2d"}' speedLateral 'ˈalila'
 *   node experiments/issue-41-effect-phrases.mjs \
 *     --head '{"pitchRange":0.5}' vibrato 'ˈaː'
 */

import { HEAD_PARAMETERS } from '../src/head-config.js';
import {
  MEASURES,
  effectValues,
  measureVoice,
  renderEffect,
} from '../tests/helpers/voice-measures.js';

const args = process.argv.slice(2);
const measuresAt = args.indexOf('--measures');
const measures =
  measuresAt >= 0 ? args.splice(measuresAt, 2)[1].split(',') : MEASURES;
const optionsAt = args.indexOf('--options');
const extra = optionsAt >= 0 ? JSON.parse(args.splice(optionsAt, 2)[1]) : {};
const headAt = args.indexOf('--head');
const head = headAt >= 0 ? JSON.parse(args.splice(headAt, 2)[1]) : {};
const [key, ...phrases] = args;
const parameter = HEAD_PARAMETERS.find((entry) => entry.key === key);
if (!parameter) {
  throw new Error(`Unknown head parameter "${key}"`);
}

for (const phrase of phrases) {
  const [lang, ipa] = phrase.includes(':')
    ? phrase.split(':')
    : [undefined, phrase];
  const candidate = {
    ...parameter,
    effect: {
      ...parameter.effect,
      ipa,
      tier: extra.tier ?? parameter.effect.tier,
      head: { ...parameter.effect.head, ...head },
      options: { ...parameter.effect.options, ...extra, ...(lang && { lang }) },
    },
  };
  const results = effectValues(candidate).map((value) =>
    renderEffect(candidate, value)
  );
  const line = measures.map((measure) => {
    const [low, high] = results.map((result) => measureVoice(result, measure));
    const relative = (high - low) / (Math.abs(low) + 1e-12);
    return `${measure} ${relative >= 0 ? '+' : ''}${(relative * 100).toFixed(2)}%`;
  });
  console.log(`${key} ${phrase}: ${line.join(', ')}`);
}
