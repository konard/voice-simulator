/**
 * Local HTTP API (node:http, no dependencies).
 *
 *   GET  /api/health              -> {status, version}
 *   GET  /api/languages           -> supported languages with samples
 *   GET  /api/tiers               -> audio and visual LOD tiers, default
 *                                    tier and the engine in use
 *   GET  /api/ipa?text=&lang=&accent= -> {lang, accent, ipa, words}
 *   GET|POST /api/timeline        -> {lang, accent, ipa, modes, sounds,
 *                                    warnings, timeline}: when each word
 *                                    and syllable is spoken
 *   GET  /api/head/random?seed=   -> random head configuration
 *   GET  /api/mesh.obj?seed=&lod= -> low-poly head model (Wavefront OBJ)
 *   GET|POST /api/synthesize      -> complete audio file (WAV by default)
 *   GET|POST /api/stream          -> WAV, AU or raw streamed while simulated
 *
 * Synthesis parameters come from the query string or a JSON body:
 * text, lang, accent (a code such as en-GB, ru-x-south or en-x-ru, a
 * {code, strength} object or an accent definition in a JSON body; never a
 * file path, see docs/accents.md), accentLevel (0..1), ipa (boolean),
 * markup (boolean: true reads inline tags, false none; SSML that starts
 * with `<speak` is read unless it is false; see docs/markup.md), seed,
 * head (object or "random"), preset, tier, solver, sampleRate, micDistance
 * (cm), micAzimuth and micElevation (degrees), micCompensate (boolean) and
 * room (a preset name, or a {width, height, depth, rt60} object in a JSON
 * body), and the encoding: format (wav | flac | aiff | au | raw), bitDepth,
 * float (boolean), and engine=js, which renders that request with the
 * JavaScript engine, not the server's (any other value is a 400
 * error). The text that is read may hold 2000 characters, a
 * marked-up input 8000; markup that cannot be read is a 400 error.
 * sampleRate is one of 8000, 11025, 16000, 22050, 24000,
 * 32000, 44100, 48000; without it the narrow-band tiers (telephone,
 * narrowband, wideband) render at their own rate and the others at 24000.
 */

import { createServer } from 'node:http';
import { URL } from 'node:url';
import {
  AUDIO_FORMATS,
  audioEncoding,
  audioStreamEncoder,
} from '../audio/formats.js';
import { LANGUAGES, textToIpa } from '../g2p/index.js';
import { accentSettings, loadAccent } from '../accent/index.js';
import { MarkupError, isSsml, parseMarkup } from '../markup/index.js';
import { headModelObj } from '../geometry/model.js';
import { visemeTrack } from '../animation/visemes.js';
import {
  DEFAULT_HEAD,
  decodeHeadConfig,
  randomHeadConfig,
  HEAD_PRESET_NAMES,
} from '../head-config.js';
import { resolveMicrophone } from '../acoustics/microphone.js';
import { resolveRoom } from '../acoustics/room.js';
import { AUDIO_TIERS, DEFAULT_AUDIO_TIER, VISUAL_TIERS } from '../perf/lod.js';
import {
  prepareUtterance,
  synthesize,
  synthesizeStream,
} from '../synthesize.js';
import { createEngine } from '../engine/index.js';

export { INDEX_PAGE } from './index-page.js';

const MAX_TEXT = 2000;
const MAX_BODY = 64 * 1024;
const SAMPLE_RATES = new Set([
  8000, 11025, 16000, 22050, 24000, 32000, 44100, 48000,
]);
/** Output rate when a request names none (narrow-band tiers use theirs). */
const DEFAULT_SAMPLE_RATE = 24000;

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

/** The accent option of a request: a code, {code, strength} or a definition. */
function readAccentParam(value) {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'string') {
    // The server never reads files: a code is letters, digits and dashes.
    if (!/^[\w-]+$/u.test(value)) {
      throw new HttpError(400, `accent "${value}" is not an accent code`);
    }
    return value;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new HttpError(400, 'accent must be a code or an object');
  }
  if (value.format !== undefined || value.rules !== undefined) {
    return loadAccent(value);
  }
  if (typeof value.code !== 'string') {
    throw new HttpError(400, 'accent.code must be an accent code');
  }
  return { code: value.code, strength: value.strength };
}

function readAccentLevel(value) {
  if (value === undefined || value === '') {
    return undefined;
  }
  const level = Number(value);
  if (!(level >= 0 && level <= 1)) {
    throw new HttpError(400, 'accentLevel must be a number from 0 to 1');
  }
  return level;
}

/**
 * The accent and accentLevel of a request, checked against the language
 * (or the language of the accent code when lang is "auto"): an unknown
 * code or a bad level is a 400 error.
 */
function accentParams(params, lang) {
  try {
    const accent = readAccentParam(params.accent);
    const level = readAccentLevel(params.accentLevel);
    const code = accent?.language ?? accent?.code ?? accent;
    const language = Object.hasOwn(LANGUAGES, lang)
      ? lang
      : String(code ?? '').split('-')[0];
    if (accent !== undefined && Object.hasOwn(LANGUAGES, language)) {
      accentSettings(language, accent, { level });
    }
    return { accent, accentLevel: level };
  } catch (error) {
    throw error instanceof HttpError
      ? error
      : new HttpError(400, error.message);
  }
}

/** The `markup` parameter: true, false or undefined (SSML only). */
function markupParam(value) {
  if (value === true || value === 'true') {
    return true;
  }
  return value === false || value === 'false' ? false : undefined;
}

/**
 * The text limits: `MAX_TEXT` characters of the text that is read and
 * `4 * MAX_TEXT` of the marked-up input; markup that cannot be read is a
 * 400 error.
 */
function checkTextLength(text, markup) {
  const marked = markup === true || (markup !== false && isSsml(text));
  if (!marked) {
    if (text.length > MAX_TEXT) {
      throw new HttpError(413, `Text longer than ${MAX_TEXT} characters`);
    }
    return;
  }
  if (text.length > 4 * MAX_TEXT) {
    throw new HttpError(
      413,
      `Marked-up text longer than ${4 * MAX_TEXT} characters`
    );
  }
  let parsed;
  try {
    parsed = parseMarkup(text, { markup });
  } catch (error) {
    throw new HttpError(400, error.message);
  }
  if (parsed.text.trim().length > MAX_TEXT) {
    throw new HttpError(413, `Text longer than ${MAX_TEXT} characters`);
  }
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
  const ipa = params.ipa === true || params.ipa === 'true';
  const markup = ipa ? false : markupParam(params.markup);
  checkTextLength(text, markup);
  const tier = params.tier ?? DEFAULT_AUDIO_TIER;
  const entry = AUDIO_TIERS.find((candidate) => candidate.name === tier);
  if (!entry) {
    throw new HttpError(400, `Unknown tier ${tier}`);
  }
  // A narrow-band tier (one with a band limit) renders at its own rate
  // unless the request asks for another; the others at 24 kHz.
  const sampleRate = Number(
    params.sampleRate ??
      (entry.bandLimit ? entry.sampleRate : DEFAULT_SAMPLE_RATE)
  );
  if (!SAMPLE_RATES.has(sampleRate)) {
    throw new HttpError(400, `Unsupported sampleRate ${params.sampleRate}`);
  }
  const seed = params.seed ?? 1;
  const lang = params.lang ?? 'auto';
  return {
    text,
    options: {
      lang,
      ...accentParams(params, lang),
      ipa,
      markup,
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

/**
 * The engine of a request: the server's, or the JavaScript engine for
 * `engine=js`.
 * @param {Record<string, unknown>} params
 * @param {Promise<object>} engine the server's engine
 */
function requestEngine(params, engine) {
  if (params.engine === undefined) {
    return engine;
  }
  if (params.engine !== 'js') {
    throw new HttpError(
      400,
      `engine must be js (or left out for the server's), not ${params.engine}`
    );
  }
  return createEngine('js');
}

function createRoutes(version, engine) {
  return {
    'GET /api/health': () => ({ status: 'ok', version }),
    'GET /api/languages': () => Object.values(LANGUAGES),
    'GET /api/tiers': async () => ({
      audio: AUDIO_TIERS,
      visual: VISUAL_TIERS,
      default: DEFAULT_AUDIO_TIER,
      engine: (await engine).name,
    }),
    'GET /api/ipa': (params) => {
      const { text, options } = synthesisOptions(params);
      const { lang, accent, accentLevel, markup } = options;
      return textToIpa(text, { lang, accent, accentLevel, markup });
    },
    'GET /api/timeline': (params) => {
      const { text, options } = synthesisOptions(params);
      const { lang, accent, ipa, timeline, plan, warnings } = prepareUtterance(
        text,
        options
      );
      return {
        lang,
        accent: accent ?? null,
        ipa,
        modes: plan.modes,
        sounds: plan.sounds,
        warnings,
        timeline,
      };
    },
    'GET /api/visemes': (params) => {
      const { text, options } = synthesisOptions(params);
      const { plan, head } = prepareUtterance(text, options);
      const fps = Number(params.fps ?? 60);
      if (!(fps > 0 && fps <= 240)) {
        throw new HttpError(400, `fps must be in (0, 240], got ${params.fps}`);
      }
      try {
        return visemeTrack(plan, head, {
          format: params.format ?? 'arkit',
          fps,
        });
      } catch (error) {
        throw new HttpError(400, error.message);
      }
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
    'GET /api/synthesize': async (params, response) => {
      const { text, options } = synthesisOptions(params);
      const { format, ...encoding } = encodingOptions(params);
      options.engine = await requestEngine(params, engine);
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
    'GET /api/stream': async (params, response) => {
      const { text, options } = synthesisOptions(params);
      const encoder = streamEncoder(params, options.sampleRate);
      options.engine = await requestEngine(params, engine);
      return streamAudio(response, text, options, encoder);
    },
  };
}

/**
 * Create the HTTP server (call `.listen(port)` to start it).
 * @param {{version?: string, index?: string, engine?: 'auto'|'rust'|'js'|object}} [options]
 *   `index` is HTML served at "/". `engine` (default 'auto') is created
 *   once, here, and renders every request (see createEngine).
 */
export function createVoiceServer(options = {}) {
  const engine = createEngine(options.engine ?? 'auto');
  // A failed load is reported by the requests that need the engine.
  engine.catch(() => {});
  const routes = createRoutes(options.version ?? '0.0.0', engine);
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
      const status = error.status ?? (error instanceof MarkupError ? 400 : 500);
      sendJson(response, status, { error: error.message });
    }
  });
}
