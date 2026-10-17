import { createElement as h, useEffect, useRef, useState } from 'react';
import { decodeAudio as decodeFile } from '../../../../src/index.js';

const NO_VOICE = 'No voiced speech found in the recording';

/**
 * Decode an audio file to mono samples: WAV, FLAC, AIFF and AU with the
 * library's decoders, anything else the browser can play (MP3, Ogg, ...)
 * with Web Audio.
 */
async function decodeAudio(buffer) {
  try {
    const { samples, sampleRate } = decodeFile(new Uint8Array(buffer));
    return { samples, sampleRate };
  } catch {
    // Not a format the library reads; let the browser try.
  }
  const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
  const context = new Context();
  try {
    const audio = await context.decodeAudioData(buffer);
    const samples = new Float32Array(audio.length);
    for (let channel = 0; channel < audio.numberOfChannels; channel++) {
      const data = audio.getChannelData(channel);
      for (let index = 0; index < samples.length; index++) {
        samples[index] += data[index] / audio.numberOfChannels;
      }
    }
    return { samples, sampleRate: audio.sampleRate };
  } finally {
    context.close();
  }
}

/** Start a microphone recording; resolves to a stop function. */
async function startRecording(onAudio) {
  const stream = await globalThis.navigator.mediaDevices.getUserMedia({
    audio: true,
  });
  const recorder = new globalThis.MediaRecorder(stream);
  const parts = [];
  recorder.addEventListener('dataavailable', (event) => parts.push(event.data));
  recorder.addEventListener('stop', () => {
    stream.getTracks().forEach((track) => track.stop());
    onAudio(new Blob(parts, { type: recorder.mimeType }));
  });
  recorder.start();
  return () => recorder.stop();
}

function FeatureList({ features, t }) {
  const items = [
    [t.features.pitch, `${features.f0.toFixed(0)} ${t.units.hz}`],
    [t.features.range, `${features.f0Range.toFixed(1)} ${t.units.semitones}`],
    [
      t.features.formants,
      `${features.formants
        .slice(0, 3)
        .map((value) => value.toFixed(0))
        .join(' / ')} ${t.units.hz}`,
    ],
    [t.features.tilt, `${features.h1h2.toFixed(1)} ${t.units.db}`],
    [t.features.noise, `${features.hnr.toFixed(1)} ${t.units.db}`],
    [t.features.rate, `${features.syllableRate.toFixed(1)} ${t.units.rate}`],
  ];
  return h(
    'dl',
    { className: 'match-features' },
    items.map(([label, value]) => [
      h('dt', { key: `${label}-label` }, label),
      h('dd', { key: `${label}-value` }, value),
    ])
  );
}

function MatchResult({ result, t }) {
  return h(
    'div',
    { 'aria-live': 'polite' },
    h(
      'p',
      null,
      `${t.closest}: ${t.presets[result.preset]} · ${t.distance} ${result.distance.toFixed(2)}`
    ),
    h(FeatureList, { features: result.features, t })
  );
}

function SourceRow({ busy, recording, t, onFile, onRecord }) {
  return h(
    'div',
    { className: 'row' },
    h(
      'label',
      { className: 'field', htmlFor: 'match-file' },
      h('span', null, t.recording),
      h('input', {
        id: 'match-file',
        type: 'file',
        accept: 'audio/*,.wav,.flac,.aiff,.aif,.au',
        disabled: busy,
        onChange: (event) => {
          const [file] = event.target.files;
          if (file) {
            onFile(file, file.name);
          }
        },
      })
    ),
    globalThis.MediaRecorder
      ? h(
          'button',
          { type: 'button', disabled: busy, onClick: onRecord },
          recording ? t.stopRecording : t.record
        )
      : null
  );
}

/**
 * Copy a voice: load or record speech, find the head whose simulated voice
 * is closest (in a worker) and apply it.
 */
export function VoiceMatch({ text, lang, t, onHead }) {
  const [audio, setAudio] = useState(null);
  const [transcript, setTranscript] = useState('');
  const [stopRecording, setStopRecording] = useState(null);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const workerRef = useRef(null);

  useEffect(() => () => workerRef.current?.terminate(), []);

  const load = async (blob, name) => {
    setError('');
    setResult(null);
    try {
      const decoded = await decodeAudio(await blob.arrayBuffer());
      setAudio({ ...decoded, name });
    } catch {
      setAudio(null);
      setError(t.decodeFailed);
    }
  };

  const record = async () => {
    if (stopRecording) {
      stopRecording();
      setStopRecording(null);
      return;
    }
    try {
      const stop = await startRecording((blob) => load(blob, t.recorded));
      setStopRecording(() => stop);
      setTranscript((current) => current || text);
    } catch {
      setError(t.micFailed);
    }
  };

  const cancel = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setProgress(null);
  };

  const match = () => {
    cancel();
    setError('');
    setResult(null);
    const worker = new Worker(
      new URL('../engine/match-worker.js', import.meta.url),
      { type: 'module' }
    );
    workerRef.current = worker;
    worker.addEventListener('message', (event) => {
      const message = event.data;
      if (message.type === 'step') {
        setProgress(message);
        return;
      }
      cancel();
      if (message.type === 'done') {
        setResult(message);
      } else {
        setError(message.message === NO_VOICE ? t.noVoice : message.message);
      }
    });
    worker.postMessage({
      samples: audio.samples,
      sampleRate: audio.sampleRate,
      transcript: transcript.trim() || undefined,
      lang: lang === 'auto' ? undefined : lang,
    });
    setProgress({ step: 0, total: 1 });
  };

  const busy = progress !== null;
  return h(
    'section',
    { className: 'panel match-panel', 'aria-labelledby': 'match-title' },
    h('h2', { id: 'match-title' }, t.match),
    h('p', { className: 'hud-note' }, t.matchHint),
    h(SourceRow, {
      busy,
      recording: Boolean(stopRecording),
      t,
      onFile: load,
      onRecord: record,
    }),
    audio
      ? h(
          'p',
          { className: 'hud-note' },
          `${audio.name} · ${(audio.samples.length / audio.sampleRate).toFixed(1)} s`
        )
      : null,
    h(
      'label',
      { className: 'field', htmlFor: 'match-transcript' },
      h('span', null, t.transcript),
      h('textarea', {
        id: 'match-transcript',
        rows: 2,
        maxLength: 2000,
        value: transcript,
        onChange: (event) => setTranscript(event.target.value),
      })
    ),
    h(
      'div',
      { className: 'row actions' },
      busy
        ? h('button', { type: 'button', onClick: cancel }, t.cancel)
        : h(
            'button',
            {
              type: 'button',
              className: 'primary',
              disabled: !audio || Boolean(stopRecording),
              onClick: match,
            },
            t.findVoice
          ),
      result
        ? h(
            'button',
            { type: 'button', onClick: () => onHead(result.head) },
            t.applyVoice
          )
        : null
    ),
    busy
      ? h(
          'p',
          { className: 'hud-note', 'aria-live': 'polite' },
          `${t.matching} ${progress.step} / ${progress.total}`
        )
      : null,
    result ? h(MatchResult, { result, t }) : null,
    error ? h('p', { className: 'error', role: 'alert' }, error) : null
  );
}
