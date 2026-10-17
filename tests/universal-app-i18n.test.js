import { describe, it, expect } from 'test-anywhere';
import { HEAD_PARAMETERS } from '../src/index.js';
import {
  detectLocale,
  parameterLabel,
  strings,
} from '../examples/universal-app/src/i18n.js';

describe('example app i18n', () => {
  it('picks Russian for ru browsers and English otherwise', () => {
    expect(detectLocale(['ru-RU', 'en'])).toBe('ru');
    expect(detectLocale(['en-US', 'RU'])).toBe('ru');
    expect(detectLocale(['de-DE'])).toBe('en');
    expect(detectLocale([])).toBe('en');
  });

  it('has the same keys in every locale', () => {
    const english = strings('en');
    const russian = strings('ru');

    expect(Object.keys(russian).sort()).toEqual(Object.keys(english).sort());
    expect(Object.keys(russian.groups).sort()).toEqual(
      Object.keys(english.groups).sort()
    );
    expect(Object.keys(russian.themes).sort()).toEqual(
      Object.keys(english.themes).sort()
    );
    expect(Object.keys(russian.accents).sort()).toEqual(
      Object.keys(english.accents).sort()
    );
    expect(strings('xx')).toBe(english);
  });

  it('labels every head parameter and parameter group', () => {
    const english = strings('en');

    for (const parameter of HEAD_PARAMETERS) {
      expect(parameterLabel(parameter, 'en')).toBe(parameter.label);
      const russian = parameterLabel(parameter, 'ru');
      expect(russian.length > 0).toBe(true);
      expect(russian === parameter.label).toBe(false);
      expect(typeof english.groups[parameter.group]).toBe('string');
    }
  });
});
