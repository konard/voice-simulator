const audio = {
  channelCount: 1,
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

function stopTracks(stream) {
  stream.getTracks().forEach((track) => track.stop());
}

async function captureNode(context, receive, fail) {
  if (context.audioWorklet) {
    await context.audioWorklet.addModule(
      new URL('./capture-processor.js', import.meta.url)
    );
    const node = new globalThis.AudioWorkletNode(
      context,
      'recognition-capture',
      {
        channelCount: 1,
        outputChannelCount: [1],
      }
    );
    node.port.onmessage = ({ data }) => receive(data);
    node.onprocessorerror = () =>
      fail(new Error('Audio capture processor failed'));
    return node;
  }

  const node = context.createScriptProcessor(2048, 1, 1);
  node.onaudioprocess = ({ inputBuffer }) =>
    receive(inputBuffer.getChannelData(0).slice());
  return node;
}

/** Capture mono PCM from one microphone without playing it back. */
export function createMicrophone(
  callbacks = {},
  {
    context,
    getUserMedia = (constraints) =>
      globalThis.navigator.mediaDevices.getUserMedia(constraints),
  } = {}
) {
  let active = null;

  function stop() {
    const capture = active;
    active = null;
    if (!capture) {
      return;
    }
    if (capture.stream) {
      stopTracks(capture.stream);
    }
    capture.input?.disconnect();
    capture.node?.disconnect();
    capture.node?.port?.close();
    return capture.context?.close();
  }

  async function start({ onChunk, onError } = callbacks) {
    if (active) {
      return;
    }
    const capture = {};
    active = capture;
    try {
      const stream = await getUserMedia({ audio });
      if (active !== capture) {
        stopTracks(stream);
        return;
      }
      capture.stream = stream;
      const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
      const ctx = context ?? new Context();
      capture.context = ctx;
      const node = await captureNode(
        ctx,
        (samples) => {
          if (active === capture) {
            onChunk?.(samples, ctx.sampleRate);
          }
        },
        (error) => {
          if (active === capture) {
            onError?.(error);
          }
        }
      );
      if (active !== capture) {
        node.port?.close();
        return;
      }
      capture.node = node;
      capture.input = ctx.createMediaStreamSource(stream);
      capture.input.connect(node);
      node.connect(ctx.destination);
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
    } catch (error) {
      if (active === capture) {
        await stop();
        throw error;
      }
    }
  }

  return {
    start,
    stop,
    get sampleRate() {
      return active?.context?.sampleRate;
    },
  };
}
