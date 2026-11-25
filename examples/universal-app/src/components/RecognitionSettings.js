import { createElement as h } from 'react';
import { NOISE_TYPES } from '../../../../src/audio/noise.js';
import { MICROPHONE_SETTINGS } from './settings.js';
import { SettingCheck, SettingSelect, SettingSlider } from './VoiceSettings.js';

const LEVELS = ['auto', 'low', 'medium', 'high'];
const MIN_VOICED = ['default', 0, 0.05, 0.1, 0.2, 0.3, 0.5];

function MicrophoneChecks({ settings, update, strings }) {
  return h(
    'div',
    { className: 'row toggles' },
    MICROPHONE_SETTINGS.map((key) =>
      h(SettingCheck, {
        key,
        id: `recognition-${key}`,
        label: strings.microphone[key],
        checked: settings[key],
        onChange: (checked) => update({ [key]: checked }),
      })
    )
  );
}

function NoiseControls({ settings, update, strings }) {
  return [
    h(SettingSelect, {
      key: 'noise',
      id: 'recognition-noise',
      label: strings.noise,
      value: settings.noise,
      options: ['none', ...NOISE_TYPES].map((value) => ({
        value,
        label: strings.noises[value] ?? value,
      })),
      onChange: (noise) => update({ noise }),
    }),
    h(SettingSlider, {
      key: 'snr',
      id: 'recognition-snr',
      label: strings.snr,
      value: settings.snr,
      min: -5,
      max: 40,
      step: 1,
      format: (value) => `${value} dB`,
      onChange: (snr) => update({ snr }),
    }),
  ];
}

/**
 * Decoder, level, speech gate, whisper and mode settings of the recognizer,
 * the browser's microphone processing, and noise for testing.
 */
export function RecognitionSettings({ settings, onChange, disabled, t }) {
  const strings = t.recognitionSettings;
  const update = (patch) => onChange({ ...settings, ...patch });
  const words = settings.decoder === 'words';
  return h(
    'details',
    { className: 'settings recognition-settings' },
    h('summary', null, strings.title),
    h(
      'fieldset',
      { className: 'settings-fields', disabled },
      h(SettingSelect, {
        id: 'recognition-level',
        label: strings.level,
        value: settings.level,
        options: LEVELS.map((value) => ({
          value,
          label: strings.levels[value],
        })),
        onChange: (level) => update({ level }),
      }),
      h(SettingSelect, {
        id: 'recognition-decoder',
        label: strings.decoder,
        value: settings.decoder,
        options: ['words', 'phones'].map((value) => ({
          value,
          label: strings.decoders[value],
        })),
        onChange: (decoder) => update({ decoder }),
      }),
      h(SettingSelect, {
        id: 'recognition-min-voiced',
        label: strings.minVoiced,
        value: settings.minVoiced,
        options: MIN_VOICED.map((value) => ({
          value,
          label:
            value === 'default'
              ? strings.minVoicedDefault
              : `${value} ${t.units.seconds}`,
        })),
        onChange: (minVoiced) => update({ minVoiced }),
      }),
      h(
        'div',
        { className: 'row toggles' },
        h(SettingCheck, {
          id: 'recognition-oov',
          label: strings.oov,
          checked: words && settings.oov,
          disabled: !words,
          onChange: (oov) => update({ oov }),
        }),
        h(SettingCheck, {
          id: 'recognition-whisper',
          label: strings.whisper,
          checked: settings.whisper,
          onChange: (whisper) => update({ whisper }),
        }),
        h(SettingCheck, {
          id: 'recognition-modes',
          label: strings.modes,
          checked: settings.modes,
          onChange: (modes) => update({ modes }),
        })
      ),
      h('p', { className: 'hud-note' }, strings.gateNote),
      h('h3', null, strings.microphoneTitle),
      h(MicrophoneChecks, { settings, update, strings }),
      h('p', { className: 'hud-note' }, strings.microphoneNote),
      h('h3', null, strings.noiseTitle),
      NoiseControls({ settings, update, strings }),
      h('p', { className: 'hud-note' }, strings.noiseNote)
    )
  );
}
