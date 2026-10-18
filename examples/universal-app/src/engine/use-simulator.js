import { useEffect, useRef, useState } from 'react';
import { LodGovernor, VISUAL_TIERS } from '../../../../src/index.js';
import { paintHighlight } from '../components/highlight.js';
import { HeadViewer } from '../viewer/head-viewer.js';
import { VoiceEngine } from './voice-engine.js';

const FRAME_BUDGET = 1 / 60;
const HUD_INTERVAL = 400;
// Frames after a mesh rebuild include shader compilation and uploads; they
// say nothing about the steady-state cost of a tier.
const WARMUP_FRAMES = 12;

function currentSymbol(plan, time) {
  const segment = plan?.segments.find(
    (entry) => entry.start <= time && time < entry.end
  );
  return segment?.token?.symbol ?? '';
}

function writeProgress(refs, frame) {
  if (refs.phoneme.current) {
    refs.phoneme.current.textContent = frame.speaking
      ? currentSymbol(frame.plan, frame.time)
      : '';
  }
  if (refs.progress.current) {
    const share = frame.plan ? frame.time / frame.plan.duration : 0;
    refs.progress.current.style.transform = `scaleX(${share})`;
  }
  paintHighlight(refs.spoken.current, frame);
}

/**
 * Owns the voice engine, the 3D viewer and the animation loop. Settings are
 * read through a ref so the loop never restarts while the user edits them.
 */
export function useSimulator(settings) {
  const containerRef = useRef(null);
  const phonemeRef = useRef(null);
  const progressRef = useRef(null);
  const spokenRef = useRef(null);
  const engineRef = useRef(null);
  const viewerRef = useRef(null);
  const settingsRef = useRef(settings);
  const warmupRef = useRef(WARMUP_FRAMES);
  settingsRef.current = settings;
  const [status, setStatus] = useState({ phase: 'idle', loads: [] });
  const [visual, setVisual] = useState({ level: 2, load: 0 });
  const [webglError, setWebglError] = useState(false);

  useEffect(() => {
    const engine = new VoiceEngine({ onChange: setStatus });
    engineRef.current = engine;
    engine.setTier(settingsRef.current.tier);
    engine.benchmark(settingsRef.current.head);
    // Browsers suspend the audio of background tabs: resume it on return.
    const unwatch = engine.player.watch();
    return () => {
      unwatch();
      engine.dispose();
      engineRef.current = null;
    };
  }, []);

  useEffect(() => {
    let viewer = null;
    try {
      viewer = new HeadViewer(containerRef.current);
    } catch {
      setWebglError(true);
      return undefined;
    }
    viewerRef.current = viewer;
    return () => {
      viewer.dispose();
      viewerRef.current = null;
    };
  }, []);

  useEffect(() => {
    engineRef.current?.setTier(settings.tier);
  }, [settings.tier]);

  const meshLod = VISUAL_TIERS[visual.level].meshLod;
  useEffect(() => {
    const viewer = viewerRef.current;
    if (viewer) {
      viewer.setHead(settings.head, meshLod);
      warmupRef.current = WARMUP_FRAMES;
      viewer.update({ state: {}, field: null, animateMouth: false });
    }
  }, [settings.head, meshLod, webglError]);

  useEffect(() => {
    viewerRef.current?.setListening(settings.listening);
  }, [settings.listening, webglError]);

  useEffect(() => {
    viewerRef.current?.setCells(status.cells ? engineRef.current?.cells : null);
  }, [status.cells, status.solver]);

  useEffect(() => {
    const governor = new LodGovernor({
      tiers: VISUAL_TIERS,
      level: 2,
      target: 0.8,
      dwell: 90,
    });
    const refs = {
      phoneme: phonemeRef,
      progress: progressRef,
      spoken: spokenRef,
    };
    let handle = 0;
    let last = performance.now();
    let hudAt = 0;
    let wasSpeaking = false;
    const loop = (now) => {
      handle = requestAnimationFrame(loop);
      const interval = Math.min(0.25, (now - last) / 1000);
      last = now;
      const engine = engineRef.current;
      const viewer = viewerRef.current;
      if (!engine) {
        return;
      }
      const frame = engine.frame();
      writeProgress(refs, frame);
      const current = settingsRef.current;
      if (!viewer || current.mode === 'sound') {
        return;
      }
      const began = performance.now();
      if (frame.speaking || wasSpeaking) {
        const tier = VISUAL_TIERS[governor.level];
        viewer.update({
          state: frame.state,
          field: frame.field,
          animateMouth: current.animateMouth,
          showCells: tier.field && current.showField,
        });
      }
      wasSpeaking = frame.speaking;
      if (!viewer.render()) {
        return;
      }
      if (warmupRef.current > 0) {
        warmupRef.current--;
        return;
      }
      const busy = (performance.now() - began) / 1000;
      const dropped = Math.max(0, interval - FRAME_BUDGET * 1.5);
      governor.record(Math.max(busy, dropped), FRAME_BUDGET);
      if (now - hudAt > HUD_INTERVAL) {
        hudAt = now;
        setVisual({ level: governor.level, load: governor.load });
      }
    };
    handle = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(handle);
  }, []);

  return {
    containerRef,
    phonemeRef,
    progressRef,
    spokenRef,
    engineRef,
    status,
    visual,
    webglError,
  };
}
