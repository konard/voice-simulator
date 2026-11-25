import { createElement as h } from 'react';

const HEADROOMS = ['auto', 0, 3, 6, 12];

export function SettingCheck({ id, label, checked, disabled, onChange }) {
  return h(
    'label',
    { className: 'toggle', htmlFor: id },
    h('input', {
      id,
      type: 'checkbox',
      checked,
      disabled,
      onChange: (event) => onChange(event.target.checked),
    }),
    h('span', null, label)
  );
}

export function SettingSelect({ id, label, value, options, onChange }) {
  return h(
    'label',
    { className: 'field', htmlFor: id },
    h('span', null, label),
    h(
      'select',
      {
        id,
        value: String(value),
        onChange: (event) => {
          const picked = options.find(
            (option) => String(option.value) === event.target.value
          );
          onChange(picked.value);
        },
      },
      options.map((option) =>
        h(
          'option',
          { key: String(option.value), value: String(option.value) },
          option.label
        )
      )
    )
  );
}

export function SettingSlider({
  id,
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}) {
  return h(
    'label',
    { className: 'slider', htmlFor: id },
    h(
      'span',
      { className: 'slider-label' },
      h('span', null, label),
      h('output', { htmlFor: id }, format(value))
    ),
    h('input', {
      id,
      type: 'range',
      min,
      max,
      step,
      value,
      onChange: (event) => onChange(Number(event.target.value)),
    })
  );
}

/**
 * Accent strength, weak forms, breaths, the voice source and its coupling
 * to the tract, and the level headroom of the next utterance.
 */
export function VoiceSettings({ settings, onChange, t }) {
  const strings = t.voiceSettings;
  const update = (patch) => onChange({ ...settings, ...patch });
  const folds = settings.source === 'folds';
  return h(
    'details',
    { className: 'settings voice-settings' },
    h('summary', null, strings.title),
    h(SettingSlider, {
      id: 'voice-accent-level',
      label: strings.accentLevel,
      value: settings.accentLevel,
      min: 0,
      max: 1,
      step: 0.05,
      format: (value) => `${Math.round(value * 100)}%`,
      onChange: (accentLevel) => update({ accentLevel }),
    }),
    h(SettingSelect, {
      id: 'voice-source',
      label: strings.source,
      value: settings.source,
      options: [
        { value: 'lf', label: strings.sources.lf },
        { value: 'folds', label: strings.sources.folds },
      ],
      onChange: (source) => update({ source }),
    }),
    h(SettingSelect, {
      id: 'voice-headroom',
      label: strings.headroom,
      value: settings.headroom,
      options: HEADROOMS.map((value) => ({
        value,
        label: value === 'auto' ? strings.headroomAuto : `${value} dB`,
      })),
      onChange: (headroom) => update({ headroom }),
    }),
    h(
      'div',
      { className: 'row toggles' },
      h(SettingCheck, {
        id: 'voice-weak-forms',
        label: strings.weakForms,
        checked: settings.weakForms,
        onChange: (weakForms) => update({ weakForms }),
      }),
      h(SettingCheck, {
        id: 'voice-breaths',
        label: strings.breaths,
        checked: settings.breaths,
        onChange: (breaths) => update({ breaths }),
      }),
      h(SettingCheck, {
        id: 'voice-interaction',
        label: strings.interaction,
        checked: folds && settings.interaction,
        disabled: !folds,
        onChange: (interaction) => update({ interaction }),
      }),
      h(SettingCheck, {
        id: 'voice-subglottal',
        label: strings.subglottal,
        checked: folds && settings.interaction && settings.subglottal,
        disabled: !folds || !settings.interaction,
        onChange: (subglottal) => update({ subglottal }),
      })
    ),
    h('p', { className: 'hud-note' }, strings.note)
  );
}
