import { createElement as h, useState } from 'react';
import {
  DEFAULT_EXPORT,
  EXPORT_PRESETS,
  exportLabel,
  exportPreset,
} from '../engine/audio-export.js';

const STORAGE_KEY = 'audioExport';

function storedPreset() {
  try {
    return exportPreset(localStorage.getItem(STORAGE_KEY) ?? DEFAULT_EXPORT).id;
  } catch {
    return DEFAULT_EXPORT;
  }
}

/**
 * Audio file format menu with a download button for the last utterance.
 * @param {{t: object, onDownload: (preset: string) => void}} props
 */
export function ExportControls({ t, onDownload }) {
  const [preset, setPreset] = useState(storedPreset);
  const choose = (id) => {
    setPreset(id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch {
      // Storage can be unavailable (private mode); the choice still applies.
    }
  };
  return h(
    'div',
    { className: 'export' },
    h(
      'select',
      {
        id: 'audio-export',
        'aria-label': t.audioFormat,
        title: t.audioFormat,
        value: preset,
        onChange: (event) => choose(event.target.value),
      },
      EXPORT_PRESETS.map((option) =>
        h(
          'option',
          { key: option.id, value: option.id },
          exportLabel(option, t)
        )
      )
    ),
    h(
      'button',
      { type: 'button', onClick: () => onDownload(preset) },
      t.download
    )
  );
}
