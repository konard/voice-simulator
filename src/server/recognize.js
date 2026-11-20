/** Binary audio recognition endpoint for the local HTTP API. Unlicense. */
import { once } from 'node:events';
import { AudioDurationError } from '../audio/flac.js';
import { decodeAudio } from '../audio/formats.js';
import { createRawDecoder } from '../audio/raw-stream.js';
import {
  createRecognizer,
  recognize,
  RecognitionError,
} from '../recognition/recognizer.js';
import { recognitionParams } from '../recognition/recognizer-params.js';
import { boundedBytes, HttpError, readBytes } from './http-body.js';

const MAX_AUDIO_BODY = 10 * 1024 * 1024;
const MAX_AUDIO_SECONDS = 120;

function writeLine(response, value) {
  if (!response.headersSent) {
    response.writeHead(200, { 'content-type': 'application/x-ndjson' });
  }
  return response.write(`${JSON.stringify(value)}\n`);
}

async function streamRecognition(request, response, sampleRate, options) {
  const recognizer = createRecognizer({ ...options, sampleRate });
  const limit = Math.min(
    MAX_AUDIO_BODY,
    Math.floor(2 * sampleRate * MAX_AUDIO_SECONDS)
  );
  const pcm = createRawDecoder({ bitDepth: 16 });
  const signal = responseSignal(response);
  let error;
  let writable = true;
  recognizer.on('error', (failure) => {
    error = failure;
  });
  recognizer.on('final', (result) => {
    writable = writeLine(response, { type: 'final', ...result });
  });

  try {
    for await (const bytes of boundedBytes(request, limit)) {
      recognizer.push(pcm.push(bytes));
      if (error) {
        throw error;
      }
      if (!writable) {
        await once(response, 'drain', { signal });
      }
    }
    pcm.flush();
    const result = recognizer.flush();
    writeLine(response, { type: 'result', ...result });
  } catch (failure) {
    if (!response.headersSent) {
      throw failure;
    }
    if (!response.destroyed) {
      const recognition = failure instanceof RecognitionError;
      writeLine(response, {
        type: 'error',
        status: failure.status ?? (recognition ? 422 : 400),
        error: failure.message,
        ...(recognition && { code: failure.code }),
      });
    }
    request.resume();
  }
  response.end();
}

function responseSignal(response) {
  const abort = new AbortController();
  response.once('close', () => abort.abort());
  return abort.signal;
}

async function runRecognition(params, response, request) {
  const options = recognitionParams(params);
  if (params.stream === '1') {
    await streamRecognition(request, response, Number(params.rate), options);
    return undefined;
  }
  const bytes = await readBytes(request, MAX_AUDIO_BODY);
  let decoded;
  try {
    decoded = decodeAudio(bytes, { maxSeconds: MAX_AUDIO_SECONDS });
  } catch (error) {
    throw new HttpError(
      error instanceof AudioDurationError ? 413 : 400,
      error.message
    );
  }
  const { samples, sampleRate } = decoded;
  return recognize(samples, sampleRate, options);
}

export async function recognizeRoute(params, response, request) {
  try {
    return await runRecognition(params, response, request);
  } catch (error) {
    if (error instanceof RangeError) {
      throw new HttpError(400, error.message);
    }
    throw error;
  }
}
