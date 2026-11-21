import { createElement as h, useRef, useState } from 'react';
import {
  HEAD_GROUPS,
  HEAD_PARAMETERS,
  loadVoice,
  saveVoice,
} from '../../../../src/index.js';
import { download } from '../download.js';
import { parameterLabel } from '../i18n.js';

export function formatValue(parameter, value) {
  const decimals = Math.max(0, -Math.floor(Math.log10(parameter.step)));
  const unit =
    parameter.unit && parameter.unit !== 'x' && parameter.unit !== '1'
      ? ` ${parameter.unit}`
      : '';
  const prefix = parameter.unit === 'x' ? '×' : '';
  return `${prefix}${value.toFixed(decimals)}${unit}`;
}

function Slider({ parameter, value, locale, onChange }) {
  const id = `head-${parameter.key}`;
  return h(
    'label',
    { className: 'slider', htmlFor: id, title: parameter.description },
    h(
      'span',
      { className: 'slider-label' },
      h('span', null, parameterLabel(parameter, locale)),
      h('output', { htmlFor: id }, formatValue(parameter, value))
    ),
    h('input', {
      id,
      type: 'range',
      min: parameter.min,
      max: parameter.max,
      step: parameter.step,
      value,
      onChange: (event) => onChange(parameter.key, Number(event.target.value)),
    })
  );
}

/** One collapsible section per HEAD_GROUPS entry. */
function GroupSection({ group, head, locale, t, showAll, onChange }) {
  const all = HEAD_PARAMETERS.filter((parameter) => parameter.group === group);
  const shown = showAll ? all : all.filter((parameter) => !parameter.advanced);
  const count = showAll ? `${all.length}` : `${shown.length} / ${all.length}`;
  return h(
    'details',
    { className: 'editor-group', open: true, 'data-group': group },
    h(
      'summary',
      null,
      h('span', null, t.groups[group]),
      h('span', { className: 'editor-count' }, count)
    ),
    h(
      'div',
      { className: 'editor-sliders' },
      shown.map((parameter) =>
        h(Slider, {
          key: parameter.key,
          parameter,
          value: head[parameter.key],
          locale,
          onChange,
        })
      )
    )
  );
}

/** "Show all parameters", "Import voice" and "Export voice". */
function VoiceFileBar({
  head,
  preset,
  t,
  showAll,
  onShowAll,
  onHead,
  exportDisabled,
}) {
  const input = useRef(null);
  const [error, setError] = useState(null);
  const importFile = async (file) => {
    if (!file) {
      return;
    }
    try {
      onHead(loadVoice(await file.text()).head);
      setError(null);
    } catch (caught) {
      setError(`${t.voiceFile.importFailed} ${file.name}:\n${caught.message}`);
    }
  };
  const exportFile = () => {
    const voice = saveVoice({ preset: preset === 'any' ? null : preset, head });
    download(
      new Blob([`${JSON.stringify(voice, null, 2)}\n`], {
        type: 'application/json',
      }),
      'voice.json'
    );
  };
  return h(
    'div',
    { className: 'voice-file' },
    h(
      'label',
      { className: 'toggle', htmlFor: 'head-show-all' },
      h('input', {
        id: 'head-show-all',
        type: 'checkbox',
        role: 'switch',
        checked: showAll,
        onChange: (event) => onShowAll(event.target.checked),
      }),
      h('span', null, `${t.voiceFile.showAll} (${HEAD_PARAMETERS.length})`)
    ),
    h(
      'button',
      { type: 'button', onClick: () => input.current?.click() },
      t.voiceFile.import
    ),
    h('input', {
      ref: input,
      type: 'file',
      accept: '.json,application/json',
      hidden: true,
      'aria-label': t.voiceFile.import,
      onChange: (event) => {
        importFile(event.target.files?.[0]);
        event.target.value = '';
      },
    }),
    h(
      'button',
      { type: 'button', onClick: exportFile, disabled: exportDisabled },
      t.voiceFile.export
    ),
    error
      ? h('p', { className: 'error voice-file-error', role: 'alert' }, error)
      : null
  );
}

/**
 * Sliders for every head and voice parameter in the six groups of
 * HEAD_GROUPS; the advanced ones appear with "Show all parameters". Voice
 * files (src/voice-file.js) are imported and exported as JSON.
 */
export function HeadEditor({
  head,
  preset,
  locale,
  t,
  onChange,
  onHead,
  exportDisabled,
}) {
  const [showAll, setShowAll] = useState(false);
  return h(
    'div',
    { className: 'head-editor' },
    h(VoiceFileBar, {
      head,
      preset,
      t,
      showAll,
      onShowAll: setShowAll,
      onHead,
      exportDisabled,
    }),
    h(
      'div',
      { className: 'editor-grid' },
      HEAD_GROUPS.map((group) =>
        h(GroupSection, {
          key: group,
          group,
          head,
          locale,
          t,
          showAll,
          onChange,
        })
      )
    )
  );
}
