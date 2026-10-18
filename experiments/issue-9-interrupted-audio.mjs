/**
 * Issue 9 reproduction: an AudioContext interrupted while the tab was in
 * the background (Safari reports 'interrupted') stays silent after the
 * player is unlocked again. Run: node experiments/issue-9-interrupted-audio.mjs
 */
import { AudioPlayer } from '../examples/universal-app/src/engine/audio-player.js';

class Context {
  constructor() {
    this.state = 'running';
    this.currentTime = 0;
  }
  resume() {
    this.state = 'running';
    return Promise.resolve();
  }
}
globalThis.AudioContext = Context;
const player = new AudioPlayer();
const context = await player.unlock();
context.state = 'interrupted'; // the tab was hidden for a while
await player.unlock(); // the user presses Speak again
console.log(`state after unlock: ${player.context.state}`);
process.exitCode = player.context.state === 'running' ? 0 : 1;
