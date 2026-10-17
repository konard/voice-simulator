/**
 * Download formats offered by the app. Raw PCM is left out: without a
 * header, players cannot tell its rate or sample type.
 */

import { audioFormat, encodeAudio } from '../../../../src/index.js';

export const EXPORT_PRESETS = Object.freeze(
  [
    { format: 'wav', bitDepth: 16 },
    { format: 'wav', bitDepth: 24 },
    { format: 'wav', bitDepth: 32, float: true },
    { format: 'flac', bitDepth: 16 },
    { format: 'flac', bitDepth: 24 },
    { format: 'aiff', bitDepth: 16 },
    { format: 'aiff', bitDepth: 24 },
    { format: 'au', bitDepth: 16 },
  ].map((preset) =>
    Object.freeze({
      ...preset,
      float: Boolean(preset.float),
      id: `${preset.format}-${preset.bitDepth}${preset.float ? 'f' : ''}`,
    })
  )
);

export const DEFAULT_EXPORT = EXPORT_PRESETS[0].id;

/** Preset by id; unknown ids fall back to 16-bit WAV. */
export function exportPreset(id) {
  return EXPORT_PRESETS.find((preset) => preset.id === id) ?? EXPORT_PRESETS[0];
}

/**
 * Menu label such as "FLAC · 24 bit".
 * @param {{format: string, bitDepth: number, float: boolean}} preset
 * @param {{bits: string, float: string}} t UI strings.
 */
export function exportLabel(preset, t) {
  const depth = `${preset.bitDepth} ${t.bits}${preset.float ? ` ${t.float}` : ''}`;
  return `${audioFormat(preset.format).label} · ${depth}`;
}

/**
 * Encode mono samples as a downloadable file.
 * @param {Float32Array} samples
 * @param {number} sampleRate
 * @param {string} [id] Preset id (default 16-bit WAV).
 * @param {string} [baseName]
 * @returns {{blob: Blob, fileName: string}}
 */
export function exportAudio(
  samples,
  sampleRate,
  id = DEFAULT_EXPORT,
  baseName = 'voice-simulator'
) {
  const preset = exportPreset(id);
  const format = audioFormat(preset.format);
  const bytes = encodeAudio(samples, sampleRate, preset);
  return {
    blob: new Blob([bytes], { type: format.mimeType }),
    fileName: `${baseName}.${format.extension}`,
  };
}
