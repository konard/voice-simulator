import { describe, it, expect } from 'test-anywhere';
import { parseIpa } from '../src/ipa/parse.js';
import { listSymbols } from '../src/ipa/inventory.js';
import { phoneDistance, gapCost } from '../src/recognition/phone-distance.js';

const phone = (ipa) => parseIpa(ipa).tokens[0];

describe('IPA to text', () => {
  it('distance is bounded, symmetric and zero on every inventory sound', () => {
    const sounds = [
      ...listSymbols(),
      't͡ʃ',
      'd͡ʒ',
      'aː',
      'ã',
      'nʲ',
      'a˨˩˦',
      'a˧˥',
    ].map(phone);
    for (const a of sounds) {
      expect(phoneDistance(a, a)).toBe(0);
      expect(
        phoneDistance(a, {
          ...a,
          affricate: a.affricate ? { ...a.affricate } : null,
        })
      ).toBe(0);
      for (const b of sounds) {
        const distance = phoneDistance(a, b);
        expect(distance >= 0 && distance <= 1).toBe(true);
        expect(distance).toBe(phoneDistance(b, a));
      }
    }
  });

  it('uses feature flags, sandhi and reduced gap costs', () => {
    expect(phoneDistance(phone('p'), phone('b'))).toBe(0.25);
    expect(phoneDistance(phone('n'), phone('nʲ'))).toBe(0.2);
    expect(phoneDistance(phone('a˨˩˦'), phone('a˨˩'))).toBe(0);
    expect(phoneDistance(phone('a˨˩˦'), phone('a˧˥'))).toBe(0.15);
    expect(gapCost(phone('ə'))).toBe(0.5);
    expect(gapCost(phone('ʔ'))).toBe(0.5);
    expect(gapCost(phone('k'))).toBe(1);
  });
});
