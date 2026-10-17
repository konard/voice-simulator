import { createElement as h } from 'react';
import { HEAD_PARAMETERS } from '../../../../src/index.js';
import { parameterLabel } from '../i18n.js';

const GROUPS = ['anatomy', 'mouth', 'face', 'voice'];

function formatValue(parameter, value) {
  const decimals = Math.max(0, -Math.floor(Math.log10(parameter.step)));
  const unit =
    parameter.unit && parameter.unit !== 'x' ? ` ${parameter.unit}` : '';
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

/**
 * Sliders for every head and voice parameter, grouped like HEAD_PARAMETERS.
 */
export function HeadEditor({ head, locale, t, onChange }) {
  return h(
    'div',
    { className: 'editor-grid' },
    GROUPS.map((group) =>
      h(
        'fieldset',
        { key: group, className: 'editor-group' },
        h('legend', null, t.groups[group]),
        HEAD_PARAMETERS.filter((parameter) => parameter.group === group).map(
          (parameter) =>
            h(Slider, {
              key: parameter.key,
              parameter,
              value: head[parameter.key],
              locale,
              onChange,
            })
        )
      )
    )
  );
}
