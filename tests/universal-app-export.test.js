import { describe, it, expect } from 'test-anywhere';
import { readFileSync } from 'node:fs';
import { decodeAudio } from '../src/index.js';
import {
  DEFAULT_EXPORT,
  EXPORT_PRESETS,
  exportAudio,
  exportLabel,
  exportPreset,
} from '../examples/universal-app/src/engine/audio-export.js';
import { strings } from '../examples/universal-app/src/i18n.js';

const tone = Float32Array.from(
  { length: 2400 },
  (_, index) => 0.5 * Math.sin(index / 5)
);

describe('example app audio export', () => {
  it('encodes every preset as a file the decoder reads back', async () => {
    for (const preset of EXPORT_PRESETS) {
      const { blob, fileName } = exportAudio(tone, 24000, preset.id);
      const decoded = decodeAudio(new Uint8Array(await blob.arrayBuffer()));
      expect(decoded.format).toBe(preset.format);
      expect(decoded.bitDepth).toBe(preset.bitDepth);
      expect(decoded.float).toBe(preset.float);
      expect(decoded.sampleRate).toBe(24000);
      expect(decoded.samples.length).toBe(tone.length);
      expect(fileName.startsWith('voice-simulator.')).toBe(true);
    }
  });

  it('names files and MIME types after the format', () => {
    const flac = exportAudio(tone, 24000, 'flac-24');
    expect(flac.fileName).toBe('voice-simulator.flac');
    expect(flac.blob.type).toBe('audio/flac');
    const fallback = exportAudio(tone, 24000, 'nope');
    expect(fallback.fileName).toBe('voice-simulator.wav');
    expect(fallback.blob.type).toBe('audio/wav');
    expect(exportPreset('nope').id).toBe(DEFAULT_EXPORT);
  });

  it('labels presets in both UI languages', () => {
    const ids = EXPORT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(exportLabel(exportPreset('flac-24'), strings('en'))).toBe(
      'FLAC · 24 bit'
    );
    expect(exportLabel(exportPreset('wav-32f'), strings('ru'))).toBe(
      'WAV · 32 бит float'
    );
  });

  it('downloads through the audio format menu', () => {
    const app = readFileSync('examples/universal-app/src/App.js', 'utf8');
    const controls = readFileSync(
      'examples/universal-app/src/components/ExportControls.js',
      'utf8'
    );
    expect(app).toContain('h(ExportControls, {');
    expect(app).toContain('exportAudio(preset)');
    expect(controls).toContain('EXPORT_PRESETS.map(');
    expect(controls.includes('node:')).toBe(false);
  });
});
