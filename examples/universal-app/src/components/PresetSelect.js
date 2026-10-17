import { createElement as h } from 'react';
import { HEAD_PRESET_NAMES } from '../../../../src/index.js';

/** Read the randomization preset from the URL (?preset=female). */
export function initialPreset() {
  const value = new URLSearchParams(window.location.search).get('preset');
  return HEAD_PRESET_NAMES.includes(value) ? value : 'any';
}

/** Speaker group for Randomize: any, male, female or child. */
export function PresetSelect({ preset, t, onChange }) {
  return h(
    'label',
    { className: 'seed', htmlFor: 'head-preset' },
    h('span', null, t.preset),
    h(
      'select',
      {
        id: 'head-preset',
        value: preset,
        onChange: (event) => onChange(event.target.value),
      },
      HEAD_PRESET_NAMES.map((name) =>
        h('option', { key: name, value: name }, t.presets[name])
      )
    )
  );
}
