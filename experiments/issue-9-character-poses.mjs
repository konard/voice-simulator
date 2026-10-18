// Pose sheet of the talking character for the docs. Import it in a page
// served by the universal app's dev server (npm run example:web:dev):
//   const { posesSheet } = await import('/@fs/<repo>/experiments/issue-9-character-poses.mjs');
//   await posesSheet({ root: '/@fs/<repo>/src/index.js', phones: ['', 'ɑ', 'm'] });
export async function posesSheet({ root, phones, size = 260 }) {
  const lib = await import(root);
  const { CharacterViewer } = await import('/src/viewer/character-viewer.js');
  const sheet = globalThis.document.createElement('div');
  sheet.id = 'pose-sheet';
  sheet.style.cssText =
    'position:fixed;inset:0;z-index:99;background:#eef1ee;display:flex;flex-wrap:wrap;gap:6px;padding:6px;font:16px sans-serif';
  globalThis.document.body.append(sheet);
  for (const ipa of phones) {
    const cell = globalThis.document.createElement('figure');
    cell.style.cssText = `margin:0;width:${size}px;text-align:center`;
    const box = globalThis.document.createElement('div');
    box.style.cssText = `position:relative;width:${size}px;height:${size}px`;
    cell.append(box);
    const caption = globalThis.document.createElement('figcaption');
    caption.textContent = ipa ? `/${ipa}/` : 'rest';
    cell.append(caption);
    sheet.append(cell);
    const viewer = new CharacterViewer(box);
    viewer.renderer.setSize(size, size, false);
    viewer.camera.aspect = 1;
    viewer.camera.updateProjectionMatrix();
    let state = {};
    const head = lib.presetHeadConfig('male');
    if (ipa) {
      const { plan } = lib.prepareUtterance(ipa, { ipa: true, head });
      const segment = plan.segments.find((entry) => entry.kind !== 'pause');
      state = lib.sampleState(plan, (segment.start + segment.end) / 2);
    }
    viewer.update(state, head);
    viewer.render();
  }
  return phones.length;
}
