import * as simulator from '../../../../src/index.js';

// Retain PCM only when the recording renderer is available. Word times in
// recognizer events are absolute, including across utterances.
function recording(sampleRate) {
  let chunks = [];
  let end = 0;
  let last = null;
  return {
    push(samples) {
      chunks.push({ start: end, samples });
      end += samples.length;
    },
    finish(first, lastWord) {
      const from = Math.min(end, Math.round(first.start * sampleRate));
      const to = Math.min(end, Math.round(lastWord.end * sampleRate));
      last = new Float32Array(Math.max(0, to - from));
      const pending = [];
      for (const { start, samples } of chunks) {
        const low = Math.max(from, start);
        const high = Math.min(to, start + samples.length);
        if (high > low) {
          last.set(samples.subarray(low - start, high - start), low - from);
        }
        if (start + samples.length > to) {
          pending.push({ start, samples });
        }
      }
      chunks = pending;
    },
    get last() {
      return last;
    },
  };
}

function startSession({ sampleRate, languages, level = 'auto' }, post) {
  const session = simulator.createVoiceSession({
    sampleRate,
    languages,
    level,
    realtime: true,
    includeModeLabels: false,
  });
  const capture =
    typeof simulator.copyRecording === 'function'
      ? recording(sampleRate)
      : null;
  let received = 0;
  let nextLoad = sampleRate;
  let final;
  for (const type of ['state', 'voice', 'partial', 'final', 'syllable']) {
    session.on(type, (event) => {
      let extra;
      if (type === 'state') {
        extra = { voicedSeconds: session.voicedSeconds };
        if (event.reason === 'speaker-change') {
          final = null;
        }
      } else if (type === 'voice') {
        extra = { changes: session.history.at(-1)?.changes ?? {} };
      } else if (type === 'final' && event.words.length) {
        final = event;
        capture?.finish(event.words[0], event.words.at(-1));
      }
      post({ ...event, ...extra, type });
    });
  }
  session.on('error', ({ message }) => post({ type: 'error', message }));
  session.push(new Float32Array());
  return {
    session,
    push(samples) {
      capture?.push(samples);
      const voicedSeconds = session.voicedSeconds;
      session.push(samples);
      if (
        session.state === 'collecting' &&
        session.voicedSeconds !== voicedSeconds
      ) {
        post({ type: 'progress', voicedSeconds: session.voicedSeconds });
      }
      received += samples.length;
      while (received >= nextLoad) {
        post({ type: 'load', load: session.load });
        nextLoad += sampleRate;
      }
      post({ type: 'chunk' });
    },
    repeat(tier) {
      if (!final || !session.voice) {
        throw new Error('A finished utterance and a fitted voice are required');
      }
      if (capture) {
        return simulator.copyRecording(capture.last, sampleRate, {
          tier,
          voice: session.voice,
        });
      }
      const { head, articulationOffsets } = simulator.loadVoice(session.voice);
      const options = {
        ipa: true,
        lang: final.words[0].lang,
        head,
        articulationOffsets,
        tier,
      };
      const target = final.words.at(-1).end - final.words[0].start;
      const { plan } = simulator.prepareUtterance(final.ipa, options);
      const speechRate =
        target > 0
          ? head.speechRate * (plan.duration / target)
          : head.speechRate;
      return simulator.synthesize(final.ipa, {
        ...options,
        head: { ...head, speechRate },
      });
    },
  };
}

export function createSessionHost({ post }) {
  let active;
  const error = (caught, id) =>
    post({
      type: 'error',
      message: caught.message,
      ...(id === undefined ? {} : { id }),
    });
  return {
    async handle(message) {
      const { type, id, tier } = message;
      try {
        if (type === 'start') {
          active?.session.reset();
          active = startSession(message, post);
        } else if (type === 'reset') {
          active?.session.reset();
          active = null;
        } else if (active) {
          const { session } = active;
          switch (type) {
            case 'chunk':
              active.push(message.samples);
              break;
            case 'stop':
              if (session.backgroundShare === 0) {
                session.backgroundShare = 0.25;
              }
              session.flush();
              post({ type: 'stopped' });
              break;
            case 'share':
              session.backgroundShare = message.value;
              break;
            case 'speak':
            case 'repeat': {
              const { samples, sampleRate } = await (type === 'speak'
                ? session.speak(message.text, { lang: message.lang, tier })
                : active.repeat(tier));
              post({ type: 'audio', id, samples, sampleRate }, [
                samples.buffer,
              ]);
              break;
            }
          }
        }
      } catch (caught) {
        error(caught, id);
      }
    },
  };
}

if (
  typeof globalThis.WorkerGlobalScope !== 'undefined' &&
  globalThis instanceof globalThis.WorkerGlobalScope
) {
  const host = createSessionHost({
    post: (event, transfer = []) => globalThis.postMessage(event, transfer),
  });
  globalThis.onmessage = ({ data }) => host.handle(data);
}
