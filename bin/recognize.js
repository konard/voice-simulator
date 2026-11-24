/** CLI input and output for audio recognition. Unlicense. */
import { readFileSync } from 'node:fs';
import { decodeAudio } from '../src/audio/formats.js';
import { createRawDecoder } from '../src/audio/raw-stream.js';
import {
  createRecognizer,
  recognizeAsync,
} from '../src/recognition/recognizer.js';
import { recognitionParams } from '../src/recognition/recognizer-params.js';

async function rawRecognition(input, values, options, print) {
  const sampleRate = Number(values['sample-rate'] ?? 16000);
  const raw = createRawDecoder({ bitDepth: Number(values['bit-depth'] ?? 16) });
  const recognizer = createRecognizer({ ...options, sampleRate });
  let error;
  recognizer.on('final', print);
  recognizer.on('error', (failure) => {
    error = failure;
  });
  for await (const bytes of input) {
    recognizer.push(raw.push(Buffer.from(bytes)));
    if (error) {
      throw error;
    }
  }
  raw.flush();
  recognizer.flush();
}

export async function recognizeCommand(values, [file], io) {
  if (!file) {
    throw new Error('Expected an audio file or - for standard input');
  }
  const options = {
    ...recognitionParams(values),
    rescoring: values.rescore,
    whisper: values['no-whisper'] ? false : undefined,
    decoder: values.decoder,
    oov: !values['no-oov'],
    // Plain text uses prosody for decoding, but has no fields for mode labels.
    includeModeLabels: Boolean(values.json || values.ipa),
  };
  const print = (result) =>
    io.stdout(
      values.json
        ? JSON.stringify(result)
        : values.ipa
          ? result.ipa
          : result.text
    );
  if (file === '-' && values.format === 'raw') {
    await rawRecognition(io.stdin, values, options, print);
    return;
  }
  let bytes;
  if (file === '-') {
    const chunks = [];
    for await (const chunk of io.stdin) {
      chunks.push(Buffer.from(chunk));
    }
    bytes = Buffer.concat(chunks);
  } else {
    bytes = readFileSync(file);
  }
  const { samples, sampleRate } = decodeAudio(bytes);
  print(await recognizeAsync(samples, sampleRate, options));
}
