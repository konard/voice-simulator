import { createElement as h } from 'react';
import { MAX_ENCLOSURE_CELLS, ROOM_PRESETS } from '../../../../src/index.js';
import { DEFAULT_ACOUSTICS, boxProblem } from '../engine/listening.js';

const MICROPHONE_SLIDERS = [
  { key: 'micDistance', min: 1, max: 200, step: 1, unit: 'cm' },
  { key: 'micAzimuth', min: -180, max: 180, step: 15, unit: '°' },
  { key: 'micElevation', min: -90, max: 90, step: 15, unit: '°' },
];

const BOX_SLIDERS = [
  { key: 'boxWidth', min: 10, max: 60, step: 2, unit: 'cm' },
  { key: 'boxHeight', min: 10, max: 60, step: 2, unit: 'cm' },
  { key: 'boxDepth', min: 26, max: 60, step: 2, unit: 'cm' },
  { key: 'boxAbsorption', min: 0, max: 1, step: 0.05, unit: '' },
];

function Slider({ slider, value, label, disabled, onChange }) {
  const id = `acoustics-${slider.key}`;
  const decimals = slider.step < 1 ? 2 : 0;
  return h(
    'label',
    { className: 'slider', htmlFor: id },
    h(
      'span',
      { className: 'slider-label' },
      h('span', null, label),
      h('output', { htmlFor: id }, `${value.toFixed(decimals)} ${slider.unit}`)
    ),
    h('input', {
      id,
      type: 'range',
      min: slider.min,
      max: slider.max,
      step: slider.step,
      value,
      disabled,
      onChange: (event) => onChange(slider.key, Number(event.target.value)),
    })
  );
}

function Check({ id, label, checked, onChange }) {
  return h(
    'label',
    { className: 'toggle', htmlFor: id },
    h('input', {
      id,
      type: 'checkbox',
      checked,
      onChange: (event) => onChange(event.target.checked),
    }),
    h('span', null, label)
  );
}

/**
 * Microphone position, room reverberation and the box of air around the
 * head (see listeningSettings for how they reach the simulation).
 */
export function AcousticsSettings({ acoustics, head, t, onChange }) {
  const strings = t.acoustics;
  const update = (key, value) => onChange({ ...acoustics, [key]: value });
  const slider = (entry, disabled = false) =>
    h(Slider, {
      key: entry.key,
      slider: entry,
      value: acoustics[entry.key],
      label: strings[entry.key],
      disabled,
      onChange: update,
    });
  const problem = boxProblem(acoustics, head);
  return h(
    'section',
    { className: 'panel editor-panel', 'aria-labelledby': 'acoustics-title' },
    h(
      'div',
      { className: 'editor-header' },
      h('h2', { id: 'acoustics-title' }, strings.title),
      h(
        'button',
        { type: 'button', onClick: () => onChange({ ...DEFAULT_ACOUSTICS }) },
        t.reset
      )
    ),
    h(
      'div',
      { className: 'editor-grid' },
      h(
        'fieldset',
        { className: 'editor-group' },
        h('legend', null, strings.microphone),
        MICROPHONE_SLIDERS.map((entry) => slider(entry)),
        h(Check, {
          id: 'acoustics-compensate',
          label: strings.micCompensate,
          checked: acoustics.micCompensate,
          onChange: (value) => update('micCompensate', value),
        })
      ),
      h(
        'fieldset',
        { className: 'editor-group' },
        h('legend', null, strings.room),
        h(
          'label',
          { className: 'field', htmlFor: 'acoustics-room' },
          h('span', null, strings.roomPreset),
          h(
            'select',
            {
              id: 'acoustics-room',
              value: acoustics.room,
              onChange: (event) => update('room', event.target.value),
            },
            Object.keys(ROOM_PRESETS).map((name) =>
              h('option', { key: name, value: name }, strings.rooms[name])
            )
          )
        ),
        h('small', null, strings.roomNote)
      ),
      h(
        'fieldset',
        { className: 'editor-group' },
        h('legend', null, strings.box),
        h(Check, {
          id: 'acoustics-box',
          label: strings.boxEnabled,
          checked: acoustics.box,
          onChange: (value) => update('box', value),
        }),
        BOX_SLIDERS.map((entry) => slider(entry, !acoustics.box)),
        h('small', null, strings.boxNote),
        problem
          ? h(
              'p',
              { className: 'error', role: 'alert' },
              problem.message ??
                `${strings.boxTooLarge} (${problem.tiers.join(', ')}; ≤ ${MAX_ENCLOSURE_CELLS})`
            )
          : null
      )
    )
  );
}
