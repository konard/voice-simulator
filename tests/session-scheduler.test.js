/** Session scheduling with queued callbacks and a controlled work queue. Unlicense. */
import { expect, it } from 'test-anywhere';
import { createSessionScheduler } from '../src/session/scheduler.js';

function testScheduler() {
  const pending = [];
  const completed = [];
  const scheduler = createSessionScheduler(
    { realtime: true, schedule: (run) => pending.push(run) },
    (value) => completed.push(value)
  );
  scheduler.foreground(0, 1000);
  scheduler.share = 0.25;
  return { pending, completed, scheduler };
}

function* work() {
  yield;
  return 'voice fit';
}

it('ignores a queued slice when its work has already finished', () => {
  const { pending, completed, scheduler } = testScheduler();
  scheduler.replace(work());
  expect(pending.length).toBe(1);

  scheduler.drain();
  pending.shift()();

  expect(completed).toEqual(['voice fit']);
  expect(scheduler.busy).toBe(false);
});
