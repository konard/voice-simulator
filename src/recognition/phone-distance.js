/**
 * Articulatory edit costs (issue 68). Final calibration: vowels
 * height 2, backness 1.5, rounding .5, length .3, nasality .3;
 * consonants manner .5, place .35/11, voicing .25, aspiration .2,
 * palatalisation .2; tone .5, third/half-third 0, third/rising .15;
 * stress .2; glide/vowel .6; gaps 1, schwa/glottal-stop gaps .5.
 * The total is clamped to [0, 1]. Features come from parseIpa tokens.
 */

export const INSERT_COST = 1;
export const DELETE_COST = 1;

const PLACES = (
  'bilabial labiodental dental alveolar postalveolar retroflex ' +
  'alveolopalatal palatal velar uvular pharyngeal glottal'
).split(' ');

function places(place) {
  if (place === 'labial-velar') {
    return [0, 8];
  }
  if (place === 'labial-palatal') {
    return [0, 7];
  }
  const index = PLACES.indexOf(place);
  return [index < 0 ? 3 : index];
}

function placeDistance(a, b) {
  return (
    Math.min(
      ...places(a).flatMap((x) => places(b).map((y) => Math.abs(x - y)))
    ) / 11
  );
}

const differs = (a, b) => Number(Boolean(a) !== Boolean(b));

export function voicingDistance(a, b) {
  if (a.whispered && Number.isFinite(a.voicing)) {
    return Math.abs(Number(Boolean(b.voiced)) - a.voicing);
  }
  return b.whispered && Number.isFinite(b.voicing)
    ? voicingDistance(b, a)
    : differs(a.voiced, b.voiced);
}

function segmentDistance(a, b) {
  const x = a.phoneme ?? a;
  const y = b.phoneme ?? b;
  if (a.kind === 'vowel' && b.kind === 'vowel') {
    return (
      2 * Math.abs(x.height - y.height) +
      1.5 * Math.abs(x.backness - y.backness) +
      0.5 * differs(x.rounded, y.rounded) +
      0.3 * differs(a.long, b.long) +
      0.3 * differs(a.nasalized, b.nasalized)
    );
  }
  if (a.kind === 'consonant' && b.kind === 'consonant') {
    return (
      0.5 *
        Number(
          (a.affricate ? 'affricate' : x.manner) !==
            (b.affricate ? 'affricate' : y.manner)
        ) +
      0.35 * placeDistance(x.place, y.place) +
      0.25 * voicingDistance(a, b) +
      0.2 * differs(a.aspirated, b.aspirated) +
      0.2 * differs(a.palatalized, b.palatalized)
    );
  }
  const pair = [a.base, b.base].sort().join('');
  return pair === 'ij' || pair === 'uw' ? 0.6 : 1;
}

/** Symmetric tone cost, including the two third-tone sandhi forms. */
export function toneDistance(a, b) {
  const x = (a ?? []).join('');
  const y = (b ?? []).join('');
  if (x === y || (x === '214' && y === '21') || (y === '214' && x === '21')) {
    return 0;
  }
  if ((x === '214' && y === '35') || (y === '214' && x === '35')) {
    return 0.15;
  }
  return 0.5;
}

/** Distance of two parsed sounds, always in [0, 1]. */
export function phoneDistance(a, b, toneCost = toneDistance(a.tone, b.tone)) {
  const segment = segmentDistance(a, b);
  return Math.min(
    1,
    segment + toneCost + 0.2 * Number((a.stress ?? 0) !== (b.stress ?? 0))
  );
}

/** Insertion or deletion cost for a parsed sound. */
export function gapCost(token) {
  return token.base === 'ə' || token.base === 'ʔ' ? 0.5 : INSERT_COST;
}
