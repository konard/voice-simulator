import { decodeAudio as decodeFile } from '../../../../src/audio/formats.js';

export const AUDIO_FILE_ACCEPT = 'audio/*,.wav,.flac,.aiff,.aif,.au';

/**
 * Decode an audio file to mono samples: WAV, FLAC, AIFF and AU with the
 * library's decoders, anything else the browser can play (MP3, Ogg, ...)
 * with Web Audio.
 */
export async function decodeAudio(buffer) {
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
