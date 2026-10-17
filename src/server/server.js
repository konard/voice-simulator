/**
 * Local HTTP API (node:http, no dependencies).
 *
 *   GET  /api/health              -> {status, version}
 *   GET  /api/languages           -> supported languages with samples
 *   GET  /api/tiers               -> audio and visual LOD tiers
 *   GET  /api/ipa?text=&lang=     -> {lang, ipa, words}
 *   GET  /api/head/random?seed=   -> random head configuration
 *   GET  /api/mesh.obj?seed=&lod= -> low-poly head model (Wavefront OBJ)
 *   GET|POST /api/synthesize      -> complete audio file (WAV by default)
 *   GET|POST /api/stream          -> WAV, AU or raw streamed while simulated
 *
 * Synthesis parameters come from the query string or a JSON body:
 * text, lang, ipa (boolean), seed, head (object or "random"), tier,
 * solver, sampleRate, micDistance (cm), micAzimuth and micElevation
 * (degrees), micCompensate (boolean) and room (a preset name, or a
 * {width, height, depth, rt60} object in a JSON body), and the encoding:
 * format (wav | flac | aiff | au | raw), bitDepth, float (boolean).
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';
import {
  AUDIO_FORMATS,
  audioEncoding,
  audioStreamEncoder,
} from '../audio/formats.js';
import { LANGUAGES, textToIpa } from '../g2p/index.js';
import { headModelObj } from '../geometry/model.js';
import {
  DEFAULT_HEAD,
  decodeHeadConfig,
  randomHeadConfig,
  HEAD_PRESET_NAMES,
} from '../head-config.js';
import { resolveMicrophone } from '../acoustics/microphone.js';
import { resolveRoom } from '../acoustics/room.js';
import { AUDIO_TIERS, VISUAL_TIERS } from '../perf/lod.js';
import { synthesize, synthesizeStream } from '../synthesize.js';

export { INDEX_PAGE } from './index-page.js';

const MAX_TEXT = 2000;
const MAX_BODY = 64 * 1024;
const SAMPLE_RATES = new Set([16000, 22050, 24000, 32000, 44100, 48000]);

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

async function readBody(request) {
  if (request.method !== 'POST') {
    return {};
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) {
      throw new HttpError(413, 'Request body too large');
    }
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  if (!text.trim()) {
    return {};
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new HttpError(400, 'Body must be JSON');
  }
}

function parsePreset(value) {
  if (value === undefined) {
    return undefined;
  }
  if (!HEAD_PRESET_NAMES.includes(value)) {
    throw new HttpError(400, `Unknown preset ${value}`);
  }
  return value;
}

function parseHead(value, seed, preset) {
  if (value === 'random') {
    return randomHeadConfig(seed ?? Date.now(), { preset });
  }
  if (typeof value === 'string') {
    return decodeHeadConfig(value);
  }
  return value ?? DEFAULT_HEAD;
}

/**
 * Validate synthesis parameters from a query or JSON body.
 * @param {Record<string, unknown>} params
 */
export function synthesisOptions(params) {
  const text = String(params.text ?? '').trim();
  if (!text) {
    throw new HttpError(400, 'Missing "text"');
  }
  if (text.length > MAX_TEXT) {
    throw new HttpError(413, `Text longer than ${MAX_TEXT} characters`);
  }
  const sampleRate = Number(params.sampleRate ?? 24000);
  if (!SAMPLE_RATES.has(sampleRate)) {
    throw new HttpError(400, `Unsupported sampleRate ${params.sampleRate}`);
  }
  const tier = params.tier ?? 'medium';
  if (!AUDIO_TIERS.some((entry) => entry.name === tier)) {
    throw new HttpError(400, `Unknown tier ${tier}`);
  }
  const seed = params.seed ?? 1;
  return {
    text,
    options: {
      lang: params.lang ?? 'auto',
      ipa: params.ipa === true || params.ipa === 'true',
      seed,
      head: parseHead(params.head, seed, parsePreset(params.preset)),
      tier,
      sampleRate,
      ...listeningParams(params),
    },
  };
}

/**
 * Validate the output encoding ({format, bitDepth, float}); 16-bit WAV by
 * default.
 * @param {Record<string, unknown>} params
 */
export function encodingOptions(params) {
  try {
    const { format, bitDepth, float } = audioEncoding({
      format: params.format ?? 'wav',
      bitDepth: params.bitDepth,
      float: params.float === true || params.float === 'true',
    });
    return { format: format.name, bitDepth, float };
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

const MICROPHONE_PARAMS = {
  distance: 'micDistance',
  azimuth: 'micAzimuth',
  elevation: 'micElevation',
};

/** Microphone and room options; invalid values are a 400 error. */
function listeningParams(params) {
  const result = {};
  const microphone = {};
  for (const [name, param] of Object.entries(MICROPHONE_PARAMS)) {
    if (params[param] !== undefined && params[param] !== '') {
      microphone[name] = Number(params[param]);
    }
  }
  if (params.micCompensate !== undefined) {
    microphone.compensate =
      params.micCompensate === true || params.micCompensate === 'true';
  }
  if (Object.keys(microphone).length > 0) {
    result.microphone = microphone;
  }
  if (params.room !== undefined && params.room !== '') {
    result.room = params.room;
  }
  try {
    resolveMicrophone(result.microphone);
    resolveRoom(result.room);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  return result;
}

function sendJson(response, status, value) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

function streamEncoder(params, sampleRate) {
  const { format, ...encoding } = encodingOptions(params);
  try {
    return audioStreamEncoder(format, sampleRate, encoding);
  } catch (error) {
    throw new HttpError(400, error.message);
  }
}

async function streamAudio(response, text, options, encoder) {
  response.writeHead(200, {
    'content-type': encoder.mimeType,
    'cache-control': 'no-store',
  });
  response.write(encoder.header);
  for await (const chunk of synthesizeStream(text, options)) {
    if (response.destroyed) {
      return;
    }
    response.write(encoder.encode(chunk));
  }
  response.end();
}

function createRoutes(version) {
  return {
    'GET /api/health': () => ({ status: 'ok', version }),
    'GET /api/languages': () => Object.values(LANGUAGES),
    'GET /api/tiers': () => ({ audio: AUDIO_TIERS, visual: VISUAL_TIERS }),
    'GET /api/ipa': (params) => {
      const { text, options } = synthesisOptions(params);
      return textToIpa(text, { lang: options.lang });
    },
    'GET /api/head/random': (params) =>
      randomHeadConfig(params.seed ?? Date.now(), {
        preset: parsePreset(params.preset),
      }),
    'GET /api/mesh.obj': (params, response) => {
      const head = parseHead(
        params.head ?? 'random',
        params.seed ?? 1,
        parsePreset(params.preset)
      );
      response.writeHead(200, { 'content-type': 'model/obj' });
      response.end(headModelObj(head, { lod: Number(params.lod ?? 1) }));
    },
    'GET /api/synthesize': (params, response) => {
      const { text, options } = synthesisOptions(params);
      const { format, ...encoding } = encodingOptions(params);
      const result = synthesize(text, options);
      const audio = AUDIO_FORMATS[format];
      response.writeHead(200, {
        'content-type': audio.mimeType,
        'content-disposition': `inline; filename="voice.${audio.extension}"`,
        'x-ipa': encodeURIComponent(result.ipa),
        'x-language': result.lang,
      });
      response.end(audio.encode(result.samples, result.sampleRate, encoding));
    },
    'GET /api/stream': (params, response) => {
      const { text, options } = synthesisOptions(params);
      const encoder = streamEncoder(params, options.sampleRate);
      return streamAudio(response, text, options, encoder);
    },
  };
}

/**
 * Create the HTTP server (call `.listen(port)` to start it).
 * @param {{version?: string, index?: string}} [options] `index` is HTML served at "/".
 */
export function createVoiceServer(options = {}) {
  const routes = createRoutes(options.version ?? '0.0.0');
  return createServer(async (request, response) => {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'content-type');
    try {
      const url = new URL(request.url, 'http://localhost');
      if (request.method === 'OPTIONS') {
        response.writeHead(204);
        response.end();
        return;
      }
      if (url.pathname === '/' && options.index) {
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(options.index);
        return;
      }
      const method = request.method === 'POST' ? 'GET' : request.method;
      const route = routes[`${method} ${url.pathname}`];
      if (!route) {
        throw new HttpError(404, `Not found: ${url.pathname}`);
      }
      const params = {
        ...Object.fromEntries(url.searchParams),
        ...(await readBody(request)),
      };
      const result = await route(params, response);
      if (result !== undefined) {
        sendJson(response, 200, result);
      }
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error);
        return;
      }
      sendJson(response, error.status ?? 500, { error: error.message });
    }
  });
}
