/** Measure mode references for the shipped telephone voices. Unlicense. */
import { writeFileSync } from 'node:fs';
import { serialize } from 'node:v8';
import { gzipSync } from 'node:zlib';
import { HEAD_PRESETS, presetHeadConfig } from '../src/head-config.js';
import {
  BASELINE_TEXT,
  baselineHead,
  emotionReferences,
  modeBaselineKey,
  physicalReferences,
  voiceBaseline,
} from '../src/recognition/mode-baseline.js';
import {
  modeBaselineFile,
  modeBaselineVersion,
} from '../src/recognition/node-models.js';
import { AUDIO_TIERS, audioTierIndex } from '../src/perf/lod.js';

export function buildModeBaselines() {
  const rows = new Map();
  const { sampleRate, name } = AUDIO_TIERS[audioTierIndex('telephone')];
  for (const preset of Object.keys(HEAD_PRESETS)) {
    for (const voice of [preset, { head: presetHeadConfig(preset) }]) {
      const head = baselineHead(voice);
      for (const language of Object.keys(BASELINE_TEXT)) {
        const key = modeBaselineKey(head, name, language);
        if (rows.has(key)) {
          continue;
        }
        const baseline = voiceBaseline(voice, sampleRate, language);
        rows.set(key, {
          ipa: baseline.ipa,
          features: baseline.features,
          vowels: baseline.vowels,
          references: emotionReferences(baseline),
          physical: physicalReferences(baseline),
        });
      }
    }
  }
  const asset = gzipSync(serialize([modeBaselineVersion, rows]));
  writeFileSync(modeBaselineFile(), asset);
  console.log(
    `voice-simulator-recognition-modes.bin.gz: ${asset.length} bytes`
  );
}
