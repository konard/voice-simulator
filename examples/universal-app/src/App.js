import { createElement as h, useEffect, useMemo, useState } from 'react';
import {
  ACCENTS,
  AUDIO_TIERS,
  DEFAULT_HEAD,
  LANGUAGES,
  VISUAL_TIERS,
  createSeed,
  headModelObj,
  presetHeadConfig,
  randomHeadConfig,
  textToIpa,
} from '../../../src/index.js';
import { ExportControls } from './components/ExportControls.js';
import { AcousticsSettings } from './components/AcousticsSettings.js';
import { HeadEditor } from './components/HeadEditor.js';
import { DEFAULT_ACOUSTICS, listeningSettings } from './engine/listening.js';
import { PresetSelect, initialPreset } from './components/PresetSelect.js';
import { VoiceMatch } from './components/VoiceMatch.js';
import { SpokenText } from './components/SpokenText.js';
import { useSimulator } from './engine/use-simulator.js';
import { detectLocale, strings } from './i18n.js';

const repositoryUrl =
  import.meta.env.VITE_REPOSITORY_URL ??
  'https://github.com/konard/voice-simulator';

// The previous release stays published next to the current one.
const PREVIOUS_VERSION_URL = 'https://konard.github.io/voice-simulator/v1/';
const THEMES = ['system', 'light', 'dark'];

function initialSeed() {
  const params = new URLSearchParams(window.location.search);
  return params.get('seed') || createSeed();
}

function initialTheme() {
  try {
    const stored = localStorage.getItem('theme');
    return THEMES.includes(stored) ? stored : 'system';
  } catch {
    return 'system';
  }
}

function useTheme() {
  const [theme, setTheme] = useState(initialTheme);
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'system') {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', theme);
    }
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Storage can be unavailable (private mode); the theme still applies.
    }
  }, [theme]);
  const next = () =>
    setTheme(THEMES[(THEMES.indexOf(theme) + 1) % THEMES.length]);
  return [theme, next];
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function transcribe(text, lang, accent) {
  try {
    return textToIpa(text, { lang, accent });
  } catch (error) {
    return { lang, ipa: '', error: error.message };
  }
}

function Select({ id, label, value, options, onChange }) {
  return h(
    'label',
    { className: 'field', htmlFor: id },
    h('span', null, label),
    h(
      'select',
      { id, value, onChange: (event) => onChange(event.target.value) },
      options.map((option) =>
        h('option', { key: option.value, value: option.value }, option.label)
      )
    )
  );
}

function Toggle({ id, label, checked, onChange }) {
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

function Meter({ label, tier, load, detail, t }) {
  const percent = Math.round(load * 100);
  return h(
    'div',
    { className: 'meter' },
    h('span', { className: 'meter-label' }, label),
    h('strong', null, tier),
    h(
      'span',
      { className: 'meter-bar', 'aria-hidden': true },
      h('span', {
        className: load > 0.8 ? 'over' : '',
        style: { width: `${Math.min(100, percent)}%` },
      }),
      h('i', { style: { left: '80%' } })
    ),
    h('small', null, `${t.load} ${percent}% · ${t.target}${detail ?? ''}`)
  );
}

function Hud({ status, visual, mode, t }) {
  const audioTier = AUDIO_TIERS[status.audioLevel ?? 0];
  const solver = status.solver ?? audioTier.solver;
  const underruns =
    (status.underruns ? ` · ${t.underruns} ${status.underruns}` : '') +
    (status.overloads ? ` · ${t.overloads} ${status.overloads}` : '');
  return h(
    'div',
    { className: 'hud', 'aria-live': 'polite' },
    mode !== 'visual'
      ? h(Meter, {
          label: t.audio,
          tier: `${audioTier.name} · ${solver}`,
          load: status.audioLoad ?? 0,
          detail: underruns,
          t,
        })
      : null,
    mode !== 'sound'
      ? h(Meter, {
          label: t.visuals,
          tier: VISUAL_TIERS[visual.level].name,
          load: visual.load,
          t,
        })
      : null,
    status.phase === 'benchmark'
      ? h('small', { className: 'hud-note' }, t.benchmarking)
      : null
  );
}

function Stage({ simulator, mode, t }) {
  return h(
    'div',
    { className: `stage stage-${mode}` },
    h('div', { className: 'viewer', ref: simulator.containerRef }),
    simulator.webglError
      ? h('p', { className: 'stage-note' }, t.noWebgl)
      : null,
    h('span', { className: 'phoneme', ref: simulator.phonemeRef }),
    h(Hud, { status: simulator.status, visual: simulator.visual, mode, t }),
    h('p', { className: 'stage-hint' }, t.viewerHint),
    h(
      'span',
      { className: 'progress', 'aria-hidden': true },
      h('span', { ref: simulator.progressRef })
    )
  );
}

function SamplePicker({ onPick }) {
  return h(
    'div',
    { className: 'samples' },
    Object.values(LANGUAGES).map((language) =>
      h(
        'button',
        {
          key: language.code,
          type: 'button',
          className: 'chip',
          onClick: () => onPick(language),
        },
        language.native
      )
    )
  );
}

/** Accent choice, shown for languages that have accents (English). */
function AccentSelect({ transcription, onChange, t }) {
  const accents = ACCENTS[transcription.lang];
  if (!accents) {
    return null;
  }
  return h(Select, {
    id: 'speech-accent',
    label: t.accent,
    value: transcription.accent ?? accents[0].code,
    options: accents.map((accent) => ({
      value: accent.code,
      label: t.accents[accent.code] ?? accent.name,
    })),
    onChange: (accent) => onChange({ accent }),
  });
}

function SpeakPanel({ speech, setSpeech, simulator, onSpeak, onStop, t }) {
  const transcription = useMemo(
    () => transcribe(speech.text, speech.lang, speech.accent),
    [speech.text, speech.lang, speech.accent]
  );
  const speaking = simulator.status.phase === 'speaking';
  const update = (patch) => setSpeech({ ...speech, ...patch });
  return h(
    'form',
    {
      className: 'panel speak-panel',
      onSubmit: (event) => {
        event.preventDefault();
        onSpeak();
      },
    },
    h(
      'label',
      { className: 'field', htmlFor: 'speech-text' },
      h('span', null, t.text),
      h('textarea', {
        id: 'speech-text',
        rows: 3,
        maxLength: 2000,
        value: speech.text,
        onChange: (event) => update({ text: event.target.value }),
      })
    ),
    h(SamplePicker, {
      onPick: (language) => update({ text: language.sample, lang: 'auto' }),
    }),
    h(
      'p',
      { className: 'ipa', lang: 'und-fonipa' },
      h('span', null, `${t.ipa} [${transcription.lang}]`),
      h('bdi', null, transcription.error ?? `/${transcription.ipa}/`)
    ),
    h(SpokenText, {
      key: simulator.status.utterance,
      rootRef: simulator.spokenRef,
      text: simulator.status.text ?? '',
      lang: simulator.status.lang,
      timeline: simulator.status.timeline,
      t,
    }),
    h(
      'div',
      { className: 'row' },
      h(Select, {
        id: 'speech-lang',
        label: t.language,
        value: speech.lang,
        options: [
          { value: 'auto', label: t.auto },
          ...Object.values(LANGUAGES).map((language) => ({
            value: language.code,
            label: `${language.native} (${language.code})`,
          })),
        ],
        onChange: (lang) => update({ lang }),
      }),
      h(Select, {
        id: 'speech-mode',
        label: t.mode,
        value: speech.mode,
        options: ['both', 'sound', 'visual'].map((mode) => ({
          value: mode,
          label: t[mode],
        })),
        onChange: (mode) => update({ mode }),
      })
    ),
    h(
      'div',
      { className: 'row' },
      h(Select, {
        id: 'speech-tier',
        label: t.quality,
        value: speech.tier,
        options: [
          { value: 'auto', label: t.autoQuality },
          ...AUDIO_TIERS.map((tier, index) => ({
            value: String(index),
            label: `${tier.name} · ${tier.solver} · ${tier.sampleRate / 1000} kHz`,
          })),
        ],
        onChange: (tier) => update({ tier }),
      }),
      h(AccentSelect, { transcription, onChange: update, t })
    ),
    h(
      'div',
      { className: 'row toggles' },
      h(Toggle, {
        id: 'animate-mouth',
        label: t.animateMouth,
        checked: speech.animateMouth,
        onChange: (animateMouth) => update({ animateMouth }),
      }),
      h(Toggle, {
        id: 'show-field',
        label: t.showField,
        checked: speech.showField,
        onChange: (showField) => update({ showField }),
      })
    ),
    h(
      'div',
      { className: 'row actions' },
      speaking
        ? h(
            'button',
            { type: 'button', className: 'primary', onClick: onStop },
            t.stop
          )
        : h(
            'button',
            {
              type: 'submit',
              className: 'primary',
              disabled: !transcription.ipa,
            },
            t.speak
          ),
      h(ExportControls, {
        t,
        onDownload: (preset) => {
          const file = simulator.engineRef.current?.exportAudio(preset);
          if (file) {
            download(file.blob, file.fileName);
          }
        },
      })
    ),
    simulator.status.error
      ? h('p', { className: 'error', role: 'alert' }, simulator.status.error)
      : null
  );
}

function EditorPanel({
  head,
  seed,
  preset,
  locale,
  t,
  onHead,
  onSeed,
  onPreset,
}) {
  return h(
    'section',
    { className: 'panel editor-panel', 'aria-labelledby': 'editor-title' },
    h(
      'div',
      { className: 'editor-header' },
      h('h2', { id: 'editor-title' }, t.head),
      h(
        'label',
        { className: 'seed', htmlFor: 'head-seed' },
        h('span', null, t.seed),
        h('input', {
          id: 'head-seed',
          value: seed,
          spellCheck: false,
          onChange: (event) => onSeed(event.target.value),
        })
      ),
      h(
        'button',
        { type: 'button', onClick: () => onSeed(createSeed()) },
        t.randomize
      ),
      h(PresetSelect, { preset, t, onChange: onPreset }),
      h(
        'button',
        {
          type: 'button',
          onClick: () =>
            onHead(
              preset === 'any' ? { ...DEFAULT_HEAD } : presetHeadConfig(preset)
            ),
        },
        t.reset
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () =>
            download(
              new Blob([headModelObj(head, { lod: 3 })], { type: 'model/obj' }),
              `head-${seed || 'custom'}.obj`
            ),
        },
        t.exportObj
      )
    ),
    h(HeadEditor, {
      head,
      locale,
      t,
      onChange: (key, value) => onHead({ ...head, [key]: value }),
    })
  );
}

export function App() {
  const locale = useMemo(() => detectLocale(), []);
  const t = strings(locale);
  const [theme, nextTheme] = useTheme();
  const [seed, setSeed] = useState(initialSeed);
  const [preset, setPreset] = useState(initialPreset);
  const [head, setHead] = useState(() => randomHeadConfig(seed, { preset }));
  const [speech, setSpeech] = useState({
    text: LANGUAGES[locale].sample,
    lang: 'auto',
    accent: 'en-US',
    mode: 'both',
    tier: 'auto',
    animateMouth: true,
    showField: true,
  });
  const [acoustics, setAcoustics] = useState(() => ({ ...DEFAULT_ACOUSTICS }));
  const listening = useMemo(() => listeningSettings(acoustics), [acoustics]);
  const simulator = useSimulator({
    listening,
    head,
    mode: speech.mode,
    animateMouth: speech.animateMouth,
    showField: speech.showField,
    tier: speech.tier === 'auto' ? null : Number(speech.tier),
  });

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.title;
  }, [locale, t.title]);

  const changeSeed = (value, nextPreset = preset) => {
    setSeed(value);
    setHead(randomHeadConfig(value || 1, { preset: nextPreset }));
  };
  const editHead = (next) => {
    setHead(next);
    setSeed('');
  };

  return h(
    'main',
    { className: 'app-shell' },
    h(
      'header',
      { className: 'app-header' },
      h(
        'div',
        null,
        h('p', { className: 'eyebrow' }, t.eyebrow),
        h('h1', { id: 'app-title' }, t.title),
        h('p', { className: 'lead' }, t.lead)
      ),
      h(
        'nav',
        { className: 'header-links' },
        h(
          'button',
          { type: 'button', className: 'ghost', onClick: nextTheme },
          `${t.theme}: ${t.themes[theme]}`
        ),
        h(
          'a',
          { href: PREVIOUS_VERSION_URL, target: '_blank', rel: 'noreferrer' },
          t.previousVersion
        ),
        h(
          'a',
          { href: repositoryUrl, target: '_blank', rel: 'noreferrer' },
          'GitHub'
        )
      )
    ),
    h(
      'section',
      { className: 'workspace', 'aria-labelledby': 'app-title' },
      h(Stage, { simulator, mode: speech.mode, t }),
      h(SpeakPanel, {
        speech,
        setSpeech,
        simulator,
        t,
        onSpeak: () =>
          simulator.engineRef.current?.speak({
            text: speech.text,
            lang: speech.lang,
            accent: speech.accent,
            head,
            seed,
            mode: speech.mode,
            ...listening,
          }),
        onStop: () => simulator.engineRef.current?.stop(),
      })
    ),
    h(EditorPanel, {
      head,
      seed,
      preset,
      locale,
      t,
      onHead: editHead,
      onSeed: changeSeed,
      onPreset: (next) => {
        setPreset(next);
        changeSeed(seed || createSeed(), next);
      },
    }),
    h(AcousticsSettings, { acoustics, head, t, onChange: setAcoustics }),
    h(VoiceMatch, { text: speech.text, lang: speech.lang, t, onHead: editHead })
  );
}
