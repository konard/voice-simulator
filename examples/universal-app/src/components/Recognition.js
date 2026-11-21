import { createElement as h, useMemo, useRef, useState } from 'react';
import { LANGUAGES } from '../../../../src/g2p/index.js';
import { AUDIO_FILE_ACCEPT, decodeAudioFile } from '../engine/decode-file.js';
import { createMicrophone } from '../engine/microphone.js';
import { recognitionTimeline } from './recognition-timeline.js';
import {
  useRecognition,
  useRecognitionHighlight,
} from './recognition-preview.js';
import { SpokenText } from './SpokenText.js';

function modeLine(modes, t) {
  if (!modes.length) {
    return null;
  }
  const spans = modes.map(({ notation, emotion, start, end }) => {
    const label =
      notation ?? t.recognitionEmotions[emotion?.name] ?? t.recognitionEmotion;
    return `${label} ${start.toFixed(2)}–${end.toFixed(2)} ${t.units.seconds}`;
  });
  return h(
    'p',
    { className: 'spoken-ipa' },
    `${t.recognitionModes} · ${spans.join(' · ')}`
  );
}

function errorText(error, t) {
  const labels = {
    denied: t.recognitionDenied,
    empty: t.recognitionEmpty,
    'too-noisy': t.recognitionTooNoisy,
    'decode-failed': t.decodeFailed,
  };
  return error ? (labels[error.code] ?? error.message) : '';
}

export function SourceControls({
  id,
  active,
  onStart,
  onStop,
  onFile,
  labels,
}) {
  return h(
    'div',
    { className: 'row' },
    h(
      'button',
      { type: 'button', onClick: onStart, disabled: active },
      labels.start
    ),
    h(
      'button',
      { type: 'button', onClick: onStop, disabled: !active },
      labels.stop
    ),
    h(
      'label',
      { className: 'field', htmlFor: id },
      h('span', null, labels.file),
      h('input', {
        id,
        type: 'file',
        accept: AUDIO_FILE_ACCEPT,
        disabled: active,
        onChange: (event) => {
          const file = event.target.files[0];
          event.target.value = '';
          if (file) {
            onFile(file);
          }
        },
      })
    )
  );
}

function LanguageChoice({ lang, onChange, disabled, t }) {
  return h(
    'label',
    { className: 'field', htmlFor: 'recognition-language' },
    h('span', null, t.language),
    h(
      'select',
      {
        id: 'recognition-language',
        value: lang,
        onChange: (event) => onChange(event.target.value),
        disabled,
      },
      h('option', { value: 'auto' }, t.recognitionAuto),
      Object.values(LANGUAGES).map(({ code, native }) =>
        h('option', { key: code, value: code, lang: code }, native)
      )
    )
  );
}

export function Recognition({ t, onSpeakBack }) {
  const { session, status, pending } = useRecognition();
  const [lang, setLang] = useState('auto');
  const [dragging, setDragging] = useState(false);
  const root = useRef(null);
  const { result, committedWords, error } = status;
  const { text, timeline } = useMemo(
    () => recognitionTimeline(result),
    [result]
  );
  const state = useRecognitionHighlight({
    state: status.state,
    timeline,
    root,
    pending,
  });
  const active = state === 'asking' || state === 'running';
  const start = (source) =>
    session.start(source, { languages: lang === 'auto' ? undefined : [lang] });
  const detail = errorText(error, t);

  return h(
    'section',
    {
      className: dragging
        ? 'panel recognition-panel dragging'
        : 'panel recognition-panel',
      'aria-labelledby': 'recognition-title',
      onDragOver: (event) => {
        if (event.dataTransfer.types.includes('Files')) {
          event.preventDefault();
          event.dataTransfer.dropEffect = active ? 'none' : 'copy';
          setDragging(!active);
        }
      },
      onDragLeave: (event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          setDragging(false);
        }
      },
      onDrop: (event) => {
        event.preventDefault();
        setDragging(false);
        const file = event.dataTransfer.files[0];
        if (!active && file) {
          start(decodeAudioFile(file));
        }
      },
    },
    h('h2', { id: 'recognition-title' }, t.recognitionTitle),
    h('p', { className: 'hud-note' }, t.recognitionPrivacy),
    h(SourceControls, {
      id: 'recognition-file',
      active,
      onStart: () => start(createMicrophone()),
      onStop: () => session.stop(),
      onFile: (file) => start(decodeAudioFile(file)),
      labels: {
        start: t.recognitionStart,
        stop: t.recognitionStop,
        file: t.recognitionFile,
      },
    }),
    h(LanguageChoice, { lang, onChange: setLang, disabled: active, t }),
    h(SpokenText, {
      rootRef: root,
      text,
      timeline,
      committedWords,
      modes: modeLine(result.modes, t),
      t,
    }),
    h(
      'button',
      {
        type: 'button',
        disabled: state !== 'done' || !text.trim(),
        onClick: () => onSpeakBack(text, result.words[0]?.language ?? 'auto'),
      },
      t.recognitionSpeakBack
    ),
    h(
      'p',
      { role: 'status', className: error ? 'error' : 'hud-note' },
      [t.recognitionStates[state], detail].filter(Boolean).join(' · ')
    )
  );
}
