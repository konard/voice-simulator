/**
 * Characters whose most frequent reading differs from their first reading
 * in `ZH_READINGS` (Unihan kMandarin). Shared by `chinese.js` and
 * `scripts/build-lexicon.mjs`, which mines only the AISHELL-3 pairs that
 * these defaults read wrongly.
 */

export const CHARACTER_OVERRIDES = {
  长: 'cháng',
  还: 'hái',
  都: 'dōu',
  着: 'zhe',
  得: 'de',
  地: 'dì',
  和: 'hé',
  只: 'zhǐ',
  了: 'le',
  么: 'me',
  们: 'men',
  个: 'gè',
  子: 'zǐ',
  的: 'de',
  吗: 'ma',
  呢: 'ne',
  吧: 'ba',
  啊: 'a',
};
