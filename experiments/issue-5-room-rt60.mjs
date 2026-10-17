// Measured (Schroeder T20) vs target RT60 of the room post-process.
import {
  ROOM_PRESETS,
  roomImpulseResponse,
  resolveRoom,
} from '../src/acoustics/room.js';

export function measureRt60(response, sampleRate, from = -5, to = -25) {
  const energy = new Float64Array(response.length + 1);
  for (let index = response.length - 1; index >= 0; index--) {
    energy[index] = energy[index + 1] + response[index] ** 2;
  }
  const total = energy[0];
  const level = (index) => 10 * Math.log10(energy[index] / total);
  let start = 0;
  while (level(start) > from) {
    start++;
  }
  let end = start;
  while (end < response.length - 1 && level(end) > to) {
    end++;
  }
  const slope = (level(end) - level(start)) / ((end - start) / sampleRate);
  return -60 / slope;
}

const sampleRate = 48000;
for (const name of Object.keys(ROOM_PRESETS)) {
  const room = resolveRoom(name);
  if (!room) {
    continue;
  }
  for (const distance of [3, 100]) {
    const began = globalThis.performance.now();
    const response = roomImpulseResponse(name, {
      sampleRate,
      distance,
      seconds: room.rt60 * 1.2,
    });
    const ms = globalThis.performance.now() - began;
    let reverb = 0;
    for (let i = 1; i < response.length; i++) {
      reverb += response[i] ** 2;
    }
    const t20 = measureRt60(response.subarray(1), sampleRate);
    const t30 = measureRt60(response.subarray(1), sampleRate, -5, -35);
    console.log(
      `${name.padEnd(10)} d=${String(distance).padStart(3)}cm target ${room.rt60.toFixed(2)} s, alpha ${room.absorption.toFixed(3)}, T20 ${t20.toFixed(2)} T30 ${t30.toFixed(2)}, reverb/direct ${(10 * Math.log10(reverb)).toFixed(1)} dB, ${ms.toFixed(0)} ms`
    );
  }
}
