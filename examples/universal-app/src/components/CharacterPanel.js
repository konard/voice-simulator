import { createElement as h, useEffect, useRef, useState } from 'react';
import { CharacterViewer } from '../viewer/character-viewer.js';

const FORMAT_NAMES = {
  arkit: 'ARKit',
  oculus: 'Oculus visemes',
  vrm: 'VRM vowels',
};

function describe(info, t) {
  if (!info) {
    return '';
  }
  const name = info.name === 'demo' ? t.demoCharacter : info.name;
  if (!info.format) {
    return `${name}: ${t.noMouthShapes}`;
  }
  return `${name} · ${FORMAT_NAMES[info.format]} · ${info.bound} ${t.morphTargets}`;
}

/**
 * The utterance on a head-only character: the demo face, or a glTF, GLB
 * or VRM model the user loads. Its mouth follows the simulated
 * articulators through the face rig bridge.
 */
export function CharacterPanel({ simulator, head, t }) {
  const containerRef = useRef(null);
  const viewerRef = useRef(null);
  const headRef = useRef(head);
  headRef.current = head;
  const [info, setInfo] = useState(null);
  const [error, setError] = useState('');
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let viewer = null;
    try {
      viewer = new CharacterViewer(containerRef.current);
    } catch {
      setFailed(true);
      return undefined;
    }
    viewerRef.current = viewer;
    setInfo(viewer.info);
    let handle = 0;
    let wasSpeaking = true;
    const loop = () => {
      handle = requestAnimationFrame(loop);
      const frame = simulator.frameRef.current;
      const speaking = Boolean(frame?.speaking);
      if (speaking || wasSpeaking) {
        viewer.update(speaking ? frame.state : {}, headRef.current);
      }
      wasSpeaking = speaking;
      viewer.render();
    };
    handle = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(handle);
      viewer.dispose();
      viewerRef.current = null;
    };
  }, [simulator.frameRef]);

  const load = async (file) => {
    if (!file || !viewerRef.current) {
      return;
    }
    setError('');
    try {
      setInfo(
        await viewerRef.current.load(await file.arrayBuffer(), file.name)
      );
    } catch (problem) {
      setError(`${t.loadFailed}: ${problem.message}`);
    }
  };

  return h(
    'section',
    {
      className: 'panel character-panel',
      'aria-labelledby': 'character-title',
    },
    h(
      'div',
      { className: 'editor-header' },
      h('h2', { id: 'character-title' }, t.character),
      h(
        'label',
        { className: 'file-button' },
        h('span', null, t.loadCharacter),
        h('input', {
          type: 'file',
          accept: '.vrm,.glb,.gltf',
          onChange: (event) => load(event.target.files?.[0]),
        })
      ),
      h(
        'button',
        {
          type: 'button',
          onClick: () => {
            setError('');
            setInfo(viewerRef.current?.showDemo() ?? null);
          },
        },
        t.demoCharacter
      )
    ),
    h('p', { className: 'hint' }, t.characterHint),
    h(
      'div',
      { className: 'character-stage' },
      h('div', { className: 'viewer', ref: containerRef }),
      failed ? h('p', { className: 'stage-note' }, t.noWebgl) : null
    ),
    h(
      'p',
      { className: 'character-status', role: 'status' },
      describe(info, t)
    ),
    error ? h('p', { className: 'error', role: 'alert' }, error) : null
  );
}
