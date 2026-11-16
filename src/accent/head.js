/**
 * What an accent does to a head: its articulation offsets are added to
 * head values and its prosody factors multiply the pitch range, the speech
 * rate and the stress lengthening; the result is clamped to the parameter
 * ranges (normalizeHeadConfig).
 */

import { normalizeHeadConfig } from '../head-config.js';

const FACTORS = Object.freeze({
  range: 'pitchRange',
  rate: 'speechRate',
  stressLengthening: 'stressLengthening',
});

/**
 * Add the articulation offsets of an accent to a head.
 * @param {Record<string, number>} head
 * @param {Record<string, number>} [articulation]
 */
export function offsetHead(head, articulation = {}) {
  const result = { ...head };
  for (const [key, offset] of Object.entries(articulation ?? {})) {
    if (Number.isFinite(result[key]) && Number.isFinite(offset)) {
      result[key] += offset;
    }
  }
  return normalizeHeadConfig(result);
}

/**
 * The head an accent speaks with: the offsets of `articulation` and the
 * factors of `prosody` applied to `head`.
 * @param {Record<string, number>} head
 * @param {{prosody?: {range?: number, rate?: number, stressLengthening?: number}, articulation?: Record<string, number>}} [accent]
 */
export function accentHead(head, accent = {}) {
  const result = offsetHead(head, accent?.articulation);
  for (const [factor, key] of Object.entries(FACTORS)) {
    const value = accent?.prosody?.[factor];
    if (Number.isFinite(value)) {
      result[key] *= value;
    }
  }
  return normalizeHeadConfig(result);
}
