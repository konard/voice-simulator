/**
 * Listening settings from the command line and the HTTP API.
 */

import { describe, it, expect } from 'test-anywhere';
import { listeningOptions, runCli } from '../bin/voice-simulator.js';
import { ROOM_PRESETS, decodeWav, synthesize } from '../src/index.js';
import { synthesisOptions } from '../src/server/server.js';

describe('listening command-line flags', () => {
  it('adds nothing without flags', () => {
    expect(listeningOptions({})).toEqual({});
  });

  it('parses the microphone, the room and the box', () => {
    const options = listeningOptions({
      'mic-distance': '30',
      'mic-azimuth': '-45',
      'mic-compensate': true,
      room: 'hall',
      box: '40x50x40',
      'box-absorption': '0.5',
    });
    expect(options.microphone).toEqual({
      distance: 30,
      azimuth: -45,
      elevation: undefined,
      compensate: true,
    });
    expect(options.room).toBe('hall');
    expect(options.enclosure).toEqual({
      width: 40,
      height: 50,
      depth: 40,
      absorption: 0.5,
    });
  });

  it('applies rt60 to a preset or a room size', () => {
    expect(listeningOptions({ room: 'office', rt60: '1.5' }).room).toEqual({
      ...ROOM_PRESETS.office,
      rt60: 1.5,
    });
    expect(listeningOptions({ rt60: '0.8' }).room.rt60).toBe(0.8);
    expect(listeningOptions({ room: '5x3x4', rt60: '0.4' }).room).toEqual({
      width: 5,
      height: 3,
      depth: 4,
      rt60: 0.4,
    });
  });

  it('rejects malformed values', () => {
    expect(() => listeningOptions({ 'mic-distance': 'far' })).toThrow(
      'mic-distance'
    );
    expect(() => listeningOptions({ box: '40x50' })).toThrow('WxHxD');
    expect(() => listeningOptions({ 'box-absorption': '0.5' })).toThrow(
      '--box'
    );
    expect(() => listeningOptions({ room: 'garage', rt60: '1' })).toThrow(
      'Unknown room'
    );
  });

  it('renders say with a distant microphone in a room', async () => {
    const chunks = [];
    const stderr = [];
    const code = await runCli(
      [
        'say',
        '--ipa',
        'ɑ',
        '--tier',
        'minimal',
        '--sample-rate',
        '16000',
        '--mic-distance',
        '50',
        '--room',
        'studio',
        '-o',
        '-',
      ],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
        stdoutBytes: (data) => chunks.push(data),
      }
    );
    expect(stderr).toEqual([]);
    expect(code).toBe(0);
    const { samples } = decodeWav(chunks[0]);
    const expected = synthesize('ɑ', {
      ipa: true,
      tier: 'minimal',
      sampleRate: 16000,
      microphone: { distance: 50 },
      room: 'studio',
    });
    expect(samples.length).toBe(expected.samples.length);
  });

  it('reports invalid microphone values', async () => {
    const stderr = [];
    const code = await runCli(
      ['say', '--ipa', 'ɑ', '--mic-distance', '0', '-o', '-'],
      {
        stdout: () => {},
        stderr: (line) => stderr.push(line),
        stdoutBytes: () => {},
      }
    );
    expect(code).toBe(1);
    expect(stderr[0]).toContain('microphone distance');
  });
});

describe('listening HTTP parameters', () => {
  it('reads the microphone and the room from the query', () => {
    const { options } = synthesisOptions({
      text: 'a',
      micDistance: '100',
      micElevation: '30',
      micCompensate: 'true',
      room: 'cathedral',
    });
    expect(options.microphone).toEqual({
      distance: 100,
      elevation: 30,
      compensate: true,
    });
    expect(options.room).toBe('cathedral');
    expect(synthesisOptions({ text: 'a' }).options.microphone).toBe(undefined);
  });

  it('rejects invalid values with status 400', () => {
    for (const params of [{ micAzimuth: '400' }, { room: 'garage' }]) {
      let status = 0;
      try {
        synthesisOptions({ text: 'a', ...params });
      } catch (error) {
        status = error.status;
      }
      expect(status).toBe(400);
    }
  });
});
