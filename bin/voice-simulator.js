#!/usr/bin/env node

import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { fileURLToPath, URL } from 'node:url';
import { parseArgs } from 'node:util';

import {
  AUDIO_TIERS,
  ROOM_PRESETS,
  benchmarkAudioTiers,
  decodeHeadConfig,
  encodeHeadConfig,
  encodeWav,
  headModelObj,
  measureAudioTier,
  randomHeadConfig,
  synthesize,
  textToIpa,
} from '../src/index.js';
import { INDEX_PAGE, createVoiceServer } from '../src/server/server.js';

const OPTIONS = {
  lang: { type: 'string', short: 'l' },
  out: { type: 'string', short: 'o' },
  tier: { type: 'string', short: 't' },
  solver: { type: 'string' },
  dx: { type: 'string' },
  seed: { type: 'string', short: 's' },
  head: { type: 'string' },
  output: { type: 'string' },
  'sample-rate': { type: 'string' },
  'mic-distance': { type: 'string' },
  'mic-azimuth': { type: 'string' },
  'mic-elevation': { type: 'string' },
  'mic-compensate': { type: 'boolean' },
  room: { type: 'string' },
  rt60: { type: 'string' },
  box: { type: 'string' },
  'box-absorption': { type: 'string' },
  ipa: { type: 'boolean' },
  lod: { type: 'string' },
  seconds: { type: 'string' },
  port: { type: 'string', short: 'p' },
  host: { type: 'string' },
  json: { type: 'boolean' },
  help: { type: 'boolean', short: 'h' },
  version: { type: 'boolean', short: 'v' },
};

function usage() {
  return [
    'Usage: voice-simulator <command> [options]',
    '',
    'Commands:',
    '  ipa <text>          Print the IPA transcription (en, ru, hi, zh)',
    '  say <text> -o f.wav Simulate speech and write a WAV file',
    '  head                Print a random head configuration',
    '  mesh -o head.obj    Export the low-poly head model as OBJ',
    '  benchmark           Measure the audio LOD tiers on this machine',
    '  serve               Start the HTTP API (with streaming)',
    '',
    'Options:',
    '  -l, --lang <code>     auto | en | ru | hi | zh (default auto)',
    '  -o, --out <file>      Output file ("-" for stdout)',
    `  -t, --tier <name>     ${AUDIO_TIERS.map((tier) => tier.name).join(' | ')}`,
    '      --solver <name>   waveguide | fdtd3d (overrides the tier)',
    '      --dx <cm>         FDTD voxel size',
    '  -s, --seed <seed>     Random seed for the head and the voice',
    '      --head <value>    "random" or an encoded head (key=value&...)',
    '      --output <mode>   flow | microphone (FDTD only)',
    '      --sample-rate <n> Output sample rate',
    '      --mic-distance <cm>     Microphone distance from the lips (default 3)',
    '      --mic-azimuth <deg>     0 = ahead, 90 = left, 180 = behind the head',
    '      --mic-elevation <deg>   Positive = above the mouth',
    '      --mic-compensate        Keep the loudness of a 3 cm microphone',
    '      --room <name|WxHxD>     Room preset or size in metres (e.g. 5x3x4):',
    `                              ${Object.keys(ROOM_PRESETS).join(', ')}`,
    '      --rt60 <s>              Reverberation time of the room',
    '      --box <WxHxD>           Box of air around the head in cm (fdtd3d)',
    '      --box-absorption <0-1>  Wall absorption of the box (default 0.2)',
    '      --ipa             Treat <text> as IPA',
    '      --lod <0-3>       Mesh level of detail',
    '  -p, --port <port>     Server port (default 8080, env PORT)',
    '      --host <host>     Server host (default 127.0.0.1, env HOST)',
    '      --json            Machine-readable output',
    '  -h, --help            Show this help',
    '  -v, --version         Show package version',
  ].join('\n');
}

function readVersion() {
  const packageUrl = new URL('../package.json', import.meta.url);
  const packageJson = JSON.parse(readFileSync(packageUrl, 'utf8'));
  return packageJson.version;
}

function optionalNumber(value, label) {
  if (value === undefined) {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`${label} must be a finite number`);
  }
  return parsed;
}

function resolveHead(values) {
  if (values.head && values.head !== 'random') {
    return decodeHeadConfig(values.head);
  }
  if (values.head === 'random' || values.seed !== undefined) {
    return randomHeadConfig(values.seed ?? Date.now());
  }
  return undefined;
}

function boxSize(value, label) {
  const parts = value.split(/[x×*]/i).map(Number);
  if (parts.length !== 3 || !parts.every(Number.isFinite)) {
    throw new Error(`${label} must look like WxHxD, e.g. 5x3x4`);
  }
  return { width: parts[0], height: parts[1], depth: parts[2] };
}

function resolveRoomFlag(values) {
  const rt60 = optionalNumber(values.rt60, 'rt60');
  if (values.room === undefined && rt60 === undefined) {
    return undefined;
  }
  const name = values.room ?? 'small-room';
  if (/^[\d.]/.test(name)) {
    return { ...boxSize(name, 'room'), rt60 };
  }
  if (rt60 === undefined || name === 'anechoic') {
    return name;
  }
  if (!Object.hasOwn(ROOM_PRESETS, name)) {
    throw new Error(`Unknown room: ${name}`);
  }
  return { ...ROOM_PRESETS[name], rt60 };
}

/**
 * Microphone, room and enclosure options from the command-line flags.
 * @param {Record<string, string|boolean|undefined>} values Parsed flags.
 * @returns {{microphone?: object, room?: string|object, enclosure?: object}}
 */
export function listeningOptions(values) {
  const result = {};
  const microphone = {
    distance: optionalNumber(values['mic-distance'], 'mic-distance'),
    azimuth: optionalNumber(values['mic-azimuth'], 'mic-azimuth'),
    elevation: optionalNumber(values['mic-elevation'], 'mic-elevation'),
    compensate: values['mic-compensate'],
  };
  if (Object.values(microphone).some((value) => value !== undefined)) {
    result.microphone = microphone;
  }
  const room = resolveRoomFlag(values);
  if (room !== undefined) {
    result.room = room;
  }
  const absorption = optionalNumber(values['box-absorption'], 'box-absorption');
  if (values.box !== undefined) {
    result.enclosure = { ...boxSize(values.box, 'box'), absorption };
  } else if (absorption !== undefined) {
    throw new Error('box-absorption needs --box');
  }
  return result;
}

function requireText(positionals) {
  const text = positionals.join(' ').trim();
  if (!text) {
    throw new Error('Missing <text>');
  }
  return text;
}

function writeOutput(out, data, io) {
  if (out === '-') {
    io.stdoutBytes(data);
    return;
  }
  writeFileSync(out, data);
}

const COMMANDS = {
  ipa(values, positionals, io) {
    const result = textToIpa(requireText(positionals), { lang: values.lang });
    io.stdout(values.json ? JSON.stringify(result) : result.ipa);
  },

  say(values, positionals, io) {
    const result = synthesize(requireText(positionals), {
      lang: values.lang,
      ipa: values.ipa,
      seed: values.seed,
      head: resolveHead(values),
      tier: values.tier ?? 'medium',
      solver: values.solver,
      dx: optionalNumber(values.dx, 'dx'),
      output: values.output,
      sampleRate: optionalNumber(values['sample-rate'], 'sample-rate'),
      ...listeningOptions(values),
    });
    const out = values.out ?? 'voice.wav';
    writeOutput(out, encodeWav(result.samples, result.sampleRate), io);
    if (out !== '-') {
      io.stdout(
        `[${result.lang}] /${result.ipa}/ ${result.duration.toFixed(2)} s -> ${out}`
      );
    }
  },

  head(values, positionals, io) {
    const head = randomHeadConfig(values.seed ?? Date.now());
    io.stdout(
      values.json ? JSON.stringify(head, null, 2) : encodeHeadConfig(head)
    );
  },

  mesh(values, positionals, io) {
    const head = resolveHead(values) ?? randomHeadConfig(1);
    const obj = headModelObj(head, { lod: optionalNumber(values.lod, 'lod') });
    writeOutput(values.out ?? 'head.obj', obj, io);
  },

  benchmark(values, positionals, io) {
    const seconds = optionalNumber(values.seconds, 'seconds') ?? 0.3;
    if (values.tier) {
      const tier = AUDIO_TIERS.find((entry) => entry.name === values.tier);
      if (!tier) {
        throw new Error(`Unknown tier: ${values.tier}`);
      }
      const load = measureAudioTier(tier, { seconds });
      io.stdout(`${tier.name}: load ${load.toFixed(3)}`);
      return;
    }
    const result = benchmarkAudioTiers({ seconds });
    if (values.json) {
      io.stdout(JSON.stringify(result));
      return;
    }
    result.loads.forEach((load, index) => {
      const note = result.measured[index] ? '' : ' (predicted, not run)';
      io.stdout(`${AUDIO_TIERS[index].name}: load ${load.toFixed(3)}${note}`);
    });
    io.stdout(`selected: ${result.tier.name}`);
  },

  serve(values, positionals, io) {
    const port =
      optionalNumber(values.port ?? process.env.PORT, 'port') ?? 8080;
    const host = values.host ?? process.env.HOST ?? '127.0.0.1';
    const server = createVoiceServer({
      version: readVersion(),
      index: INDEX_PAGE,
    });
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, () => {
        const address = server.address();
        io.stdout(
          `voice-simulator listening on http://${host}:${address.port}`
        );
        io.onServer?.(server);
        server.once('close', () => resolve());
      });
    });
  },
};

/**
 * Run the CLI.
 * @param {string[]} argv Arguments without the node and script paths.
 * @param {{stderr?: Function, stdout?: Function, stdoutBytes?: Function, onServer?: Function}} [io]
 * @returns {Promise<number>} Exit code.
 */
export async function runCli(argv, io = {}) {
  const streams = {
    stderr: io.stderr ?? console.error,
    stdout: io.stdout ?? console.log,
    stdoutBytes: io.stdoutBytes ?? ((data) => process.stdout.write(data)),
    onServer: io.onServer,
  };
  try {
    const { values, positionals } = parseArgs({
      args: argv,
      options: OPTIONS,
      allowPositionals: true,
    });
    const [command, ...rest] = positionals;
    if (values.version) {
      streams.stdout(readVersion());
      return 0;
    }
    if (!command || values.help) {
      streams.stdout(usage());
      return 0;
    }
    const handler = Object.hasOwn(COMMANDS, command) ? COMMANDS[command] : null;
    if (!handler) {
      streams.stderr(`Unknown command: ${command}`);
      streams.stderr(usage());
      return 1;
    }
    await handler(values, rest, streams);
    return 0;
  } catch (error) {
    streams.stderr(error.message);
    return 1;
  }
}

function isCliEntryPoint() {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return (
      realpathSync(process.argv[1]) ===
      realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isCliEntryPoint()) {
  process.exitCode = await runCli(process.argv.slice(2));
}
