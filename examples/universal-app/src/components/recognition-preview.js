import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { RecognitionSession } from '../engine/recognition-session.js';
import { highlightAt, paintHighlight } from './highlight.js';

const MARK_MS = 120;
const inside = (end) => end - 0.001;

export function useRecognition() {
  const pending = useRef([]);
  const [status, setStatus] = useState(null);
  const [session] = useState(() => {
    let last = null;
    return new RecognitionSession({
      onChange(next) {
        if (next.state === 'running' && next.lastSyllable !== last) {
          pending.current.push(next.lastSyllable);
        } else if (next.state !== 'running' && next.state !== 'done') {
          pending.current.length = 0;
        }
        last = next.lastSyllable;
        setStatus(next);
      },
    });
  });

  useEffect(() => {
    session.preload();
    return () => session.dispose();
  }, [session]);

  return { session, status: status ?? session.status, pending };
}

/** Give each queued event time to paint, even when a file decodes in one frame. */
export function useRecognitionHighlight({ state, timeline, root, pending }) {
  const [mark, setMark] = useState(null);
  const running = state === 'running' || state === 'done';
  const next = running
    ? pending.current.find((end) => highlightAt(timeline, inside(end)))
    : undefined;

  useLayoutEffect(() => {
    if (running && !mark && next !== undefined) {
      pending.current.splice(0, pending.current.indexOf(next) + 1);
      setMark({ end: next, until: globalThis.performance.now() + MARK_MS });
      return;
    }

    paintHighlight(root.current, {
      speaking: running && mark !== null,
      time: mark ? inside(mark.end) : 0,
      timeline,
      syllableOnlyAria: true,
    });

    if (!mark) {
      return;
    }
    if (!running) {
      setMark(null);
    } else if (next !== undefined || state === 'done') {
      const delay = Math.max(0, mark.until - globalThis.performance.now());
      const timer = globalThis.setTimeout(() => setMark(null), delay);
      return () => globalThis.clearTimeout(timer);
    }
  }, [mark, next, pending, root, running, state, timeline]);

  return state === 'done' && (mark || next !== undefined) ? 'running' : state;
}
