/**
 * Voice matching worker: finds the head that sounds like a recording
 * without blocking the page (every step renders a sentence).
 *
 * Message in:
 *   {samples, sampleRate, transcript?, lang?, preset?}
 * Messages out:
 *   {type: 'step', step, total, distance}
 *   {type: 'done', head, preset, features, distance}
 *   {type: 'error', message}
 */

import { matchVoiceSteps } from '../../../../src/index.js';

globalThis.addEventListener('message', (event) => {
  const { samples, sampleRate, ...options } = event.data;
  try {
    const steps = matchVoiceSteps(samples, sampleRate, options);
    let result = steps.next();
    while (!result.done) {
      const { step, total, distance } = result.value;
      globalThis.postMessage({ type: 'step', step, total, distance });
      result = steps.next();
    }
    const { head, preset, features, distance } = result.value;
    globalThis.postMessage({ type: 'done', head, preset, features, distance });
  } catch (error) {
    globalThis.postMessage({ type: 'error', message: error.message });
  }
});
