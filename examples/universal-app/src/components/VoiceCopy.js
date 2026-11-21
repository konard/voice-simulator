import {
  createElement as h,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import * as simulator from '../../../../src/index.js';
import CopyWorker from 'virtual:copy-session-worker';
import { download } from '../download.js';
import { AudioPlayer } from '../engine/audio-player.js';
import { CopySession, canSave } from '../engine/copy-session.js';
import { decodeAudioFile } from '../engine/decode-file.js';
import { createMicrophone } from '../engine/microphone.js';
import { parameterLabel } from '../i18n.js';
import { formatValue } from './HeadEditor.js';
import { SourceControls } from './Recognition.js';
import { recognitionTimeline } from './recognition-timeline.js';
import { useRecognitionHighlight } from './recognition-preview.js';
import { SpokenText } from './SpokenText.js';

function useCopySession() {
  const pending = useRef([]);
  const [status, setStatus] = useState(null);
  const [session] = useState(() => {
    let last = null;
    return new CopySession({
      createWorker: () => new CopyWorker(),
      onChange(next) {
        if (next.lastSyllable === null) {
          pending.current.length = 0;
        } else if (next.lastSyllable !== last) {
          pending.current.push(next.lastSyllable);
        }
        last = next.lastSyllable;
        setStatus(next);
      },
    });
  });
  useEffect(() => () => session.dispose(), [session]);
  return { session, status: status ?? session.status, pending };
}

function useHeadPreview(voice, state, onHead) {
  const last = useRef({ time: -Infinity, stable: false });
  useEffect(() => {
    if (!voice) {
      last.current.stable = false;
      return;
    }
    const reduced = globalThis.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (reduced && (state !== 'stable' || last.current.stable)) {
      return;
    }
    const delay = Math.max(0, 250 + last.current.time - performance.now());
    const timer = globalThis.setTimeout(() => {
      last.current = { time: performance.now(), stable: state === 'stable' };
      onHead(voice);
    }, delay);
    return () => globalThis.clearTimeout(timer);
  }, [voice, state, onHead]);
}

function Progress({ status, t }) {
  const { state, voicedSeconds, stability, changes } = status;
  const values = {
    collecting: Math.min(1, voicedSeconds / 2),
    fitting: undefined,
    inverting: undefined,
    refining: stability,
    stable: 1,
  };
  const largest = Math.max(0, ...Object.values(changes));
  return h(
    'div',
    { className: 'row copy-indicators' },
    h(
      'label',
      { className: 'field', htmlFor: 'copy-progress' },
      t.copyProgress,
      h('progress', {
        id: 'copy-progress',
        max: 1,
        value: Object.hasOwn(values, state) ? values[state] : 0,
        'aria-label': t.copyProgress,
      })
    ),
    h(
      'label',
      { className: 'field', htmlFor: 'copy-stability' },
      t.copyStability,
      h('meter', {
        id: 'copy-stability',
        min: 0,
        max: 1,
        value: stability,
        'aria-label': t.copyStability,
      }),
      status.voice &&
        h('span', null, t.copyChange.replace('{n}', (largest * 100).toFixed(1)))
    )
  );
}

function Parameters({ voice, uncertainty, locale, t }) {
  if (!voice) {
    return null;
  }
  return h(
    'table',
    { className: 'copy-parameters', 'aria-label': t.copyParameters },
    h(
      'thead',
      null,
      h(
        'tr',
        null,
        h('th', { scope: 'col' }, t.copyParameter),
        h('th', { scope: 'col' }, t.copyValue),
        h('th', { scope: 'col' }, t.copyUncertainty)
      )
    ),
    h(
      'tbody',
      null,
      simulator.HEAD_PARAMETERS.map((parameter) =>
        h(
          'tr',
          { key: parameter.key },
          h('th', { scope: 'row' }, parameterLabel(parameter, locale)),
          h('td', null, formatValue(parameter, voice.head[parameter.key])),
          h(
            'td',
            null,
            Number.isFinite(uncertainty?.[parameter.key])
              ? `± ${formatValue(parameter, uncertainty[parameter.key])}`
              : ''
          )
        )
      )
    )
  );
}

function save(voice) {
  const file =
    typeof simulator.saveVoice === 'function'
      ? simulator.saveVoice(voice)
      : voice.head;
  download(
    new Blob([`${JSON.stringify(file, null, 2)}\n`], {
      type: 'application/json',
    }),
    'voice.json'
  );
}

function CopyActions({
  status,
  voice,
  consent,
  setConsent,
  onSpeak,
  onRepeat,
  onReset,
  t,
}) {
  return h(
    'div',
    { className: 'copy-actions' },
    h(
      'label',
      { className: 'toggle', htmlFor: 'copy-consent' },
      h('input', {
        id: 'copy-consent',
        type: 'checkbox',
        checked: consent,
        onChange: (event) => setConsent(event.target.checked),
      }),
      h('span', null, t.copyConsent)
    ),
    h(
      'div',
      { className: 'row' },
      h(
        'button',
        { type: 'button', disabled: !voice, onClick: onSpeak },
        t.copySpeak
      ),
      h(
        'button',
        {
          type: 'button',
          disabled: !voice || !status.canRepeat,
          onClick: onRepeat,
        },
        t.copyRepeat
      ),
      h(
        'button',
        {
          type: 'button',
          disabled: !canSave(status, consent),
          onClick: () => save(voice),
        },
        t.copySave
      ),
      h(
        'button',
        { type: 'button', disabled: !voice, onClick: onReset },
        t.copyReset
      )
    )
  );
}

export function VoiceCopy({
  t,
  locale,
  benchmarkTier,
  tier,
  consent,
  setConsent,
  onBegin,
  onHead,
  onSpeak,
}) {
  const { session, status, pending } = useCopySession();
  const [playError, setPlayError] = useState(null);
  const player = useRef(null);
  const restore = useRef(null);
  const root = useRef(null);
  const voice = useMemo(
    () => (status.voice ? simulator.loadVoice(status.voice) : null),
    [status.voice]
  );
  const { text, timeline } = useMemo(
    () => recognitionTimeline(status.result),
    [status.result]
  );
  useRecognitionHighlight({
    state: status.active ? 'running' : 'done',
    timeline,
    root,
    pending,
  });
  useHeadPreview(voice, status.state, onHead);
  useEffect(
    () => () => {
      void player.current?.context?.close();
    },
    []
  );
  useEffect(() => {
    if (status.reason === 'speaker-change' || status.state === 'error') {
      setConsent(false);
      player.current?.stop();
      restore.current?.();
      if (status.state === 'error') {
        restore.current = null;
      }
    }
  }, [status.reason, status.state, setConsent]);

  const start = (source) => {
    restore.current = onBegin();
    player.current?.stop();
    setPlayError(null);
    setConsent(false);
    session.start(source, { tier: benchmarkTier });
  };
  const reset = () => {
    session.reset();
    player.current?.stop();
    setConsent(false);
    setPlayError(null);
    restore.current?.();
    restore.current = null;
  };
  const repeat = async () => {
    setPlayError(null);
    player.current ??= new AudioPlayer();
    try {
      const [, { samples, sampleRate }] = await Promise.all([
        player.current.unlock(),
        session.repeat(tier),
      ]);
      player.current.begin(sampleRate);
      player.current.push(0, samples);
    } catch (error) {
      if (error.name !== 'AbortError') {
        setPlayError(error.message);
      }
    }
  };

  const detail =
    status.error?.code === 'denied'
      ? t.recognitionDenied
      : status.error?.code === 'decode-failed'
        ? t.decodeFailed
        : (status.error?.message ?? playError);
  return h(
    'section',
    { className: 'panel copy-panel', 'aria-labelledby': 'copy-title' },
    h('h2', { id: 'copy-title' }, t.copyTitle),
    h('p', { className: 'hud-note' }, t.copyPrivacy),
    h(SourceControls, {
      id: 'copy-file',
      active: status.active,
      onStart: () => start(createMicrophone({}, { sampleRate: 16000 })),
      onStop: () => session.stop(),
      onFile: (file) => start(decodeAudioFile(file)),
      labels: { start: t.copyStart, stop: t.copyStop, file: t.copyFile },
    }),
    h(
      'p',
      {
        role: 'status',
        className: detail ? 'error' : 'hud-note',
        'aria-atomic': true,
      },
      [
        status.reason === 'speaker-change' && t.copySpeakerChanged,
        t.copyStates[status.state],
        status.overloaded && t.copyOverloaded,
        detail,
      ]
        .filter(Boolean)
        .join(' ')
    ),
    h(Progress, { status, t }),
    h(SpokenText, {
      rootRef: root,
      text,
      timeline,
      committedWords: status.committedWords,
      t,
    }),
    h(Parameters, {
      voice,
      uncertainty: status.state === 'stable' ? status.uncertainty : null,
      locale,
      t,
    }),
    h(CopyActions, {
      status,
      voice,
      consent,
      setConsent,
      onSpeak: () => onSpeak(voice),
      onRepeat: repeat,
      onReset: reset,
      t,
    })
  );
}
