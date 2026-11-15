/**
 * Articulatory targets for IPA segments.
 *
 * Every segment is described by the same small set of articulator
 * channels that drive the tube geometry:
 * - tongue body / jaw position in the vowel space (height, backness)
 * - lip rounding and lip constriction
 * - a tongue constriction (location along the tract, area, engagement)
 * - velum opening (nasal coupling)
 * - glottis: voicing, aspiration (opening of the glottis), glottal closure
 * - frication gain (how much turbulence a narrow constriction makes at a
 *   given air flow, see src/acoustics/aerodynamics.js)
 *
 * Consonants leave the vowel channels free, so the tongue body glides
 * from vowel to vowel through them (vowel-to-vowel coarticulation).
 */

/**
 * Constriction location along the tract (0 = glottis, 1 = lips) and the
 * Gaussian half-width of the constricting articulator, per place.
 */
export const PLACES = Object.freeze({
  bilabial: { lips: true, location: 1, width: 0.035 },
  labiodental: { lips: true, location: 0.985, width: 0.03 },
  dental: { location: 0.94, width: 0.03 },
  alveolar: { location: 0.905, width: 0.03 },
  postalveolar: { location: 0.87, width: 0.035 },
  retroflex: { location: 0.875, width: 0.03 },
  alveolopalatal: { location: 0.85, width: 0.045 },
  palatal: { location: 0.8, width: 0.055 },
  velar: { location: 0.66, width: 0.055 },
  uvular: { location: 0.55, width: 0.06 },
  pharyngeal: { location: 0.33, width: 0.07 },
  'labial-velar': { lips: true, location: 0.66, width: 0.055 },
  'labial-palatal': { lips: true, location: 0.8, width: 0.055 },
  glottal: { glottal: true, location: 0, width: 0.03 },
});

/** Minimal cross-section (cm²) and turbulence gain per manner. */
const MANNERS = {
  plosive: { area: 0, frication: 0.7 },
  nasal: { area: 0, frication: 0, velum: 1 },
  trill: { area: 0.12, frication: 0.04, trill: true },
  tap: { area: 0, frication: 0.2 },
  fricative: { area: 0.09, frication: 1 },
  'lateral-fricative': { area: 0.1, frication: 0.9 },
  approximant: { area: 0.35, frication: 0 },
  'lateral-approximant': { area: 0.28, frication: 0 },
};

/**
 * Opening of the glottis (the `aspiration` channel) of voiceless
 * obstruents: the folds part so that the air builds up pressure behind the
 * constriction. Fricatives open it wide (Stevens 1998: about 0.2 to
 * 0.3 cm²); stops a third of that, which plan.js raises to 1 for
 * aspirated stops.
 */
const VOICELESS_OPENING = {
  plosive: 0.35,
  fricative: 1,
  'lateral-fricative': 1,
};

/**
 * Coarticulation resistance (Recasens et al. 1997): how strongly a
 * consonant holds the tongue body (`height`, `backness`) against the
 * straight line between the neighbouring vowels. During a consonant the
 * vowel channels get `r * own + (1 - r) * line`. `levels` holds the four
 * values that experiments/issue-11-fit-dynamics.mjs fits; `phones`,
 * `manners` and `places` map a consonant to a level (first match wins);
 * `own` is the tongue-body position of a place.
 *
 * Starting levels after the scale of Recasens et al. (1997): 1 for
 * palatals, alveolo-palatals, `[ʃ ʒ]`, trills and dark `[ɫ]`; 0.6 for
 * `[s z]` and velars; 0.3 for other alveolars and dentals; 0 for labials
 * and glottals. Places the issue does not name follow their tongue body:
 * retroflex, uvular, pharyngeal and labial-velar as velars, labial-palatal
 * as palatals. Palatalized consonants hold a palatal and velarized ones a
 * dark-`[ɫ]` tongue body with the highest level.
 */
export const COARTICULATION_RESISTANCE = Object.freeze({
  levels: Object.freeze({ high: 1, medium: 0.6, low: 0.3, none: 0 }),
  phones: Object.freeze({
    s: 'medium',
    z: 'medium',
    ʃ: 'high',
    ʒ: 'high',
    ɫ: 'high',
  }),
  manners: Object.freeze({ trill: 'high' }),
  places: Object.freeze({
    bilabial: 'none',
    labiodental: 'none',
    dental: 'low',
    alveolar: 'low',
    postalveolar: 'high',
    retroflex: 'medium',
    alveolopalatal: 'high',
    palatal: 'high',
    velar: 'medium',
    uvular: 'medium',
    pharyngeal: 'medium',
    'labial-velar': 'medium',
    'labial-palatal': 'high',
    glottal: 'none',
  }),
  own: Object.freeze({
    bilabial: Object.freeze({ height: 0.5, backness: 0.5 }),
    labiodental: Object.freeze({ height: 0.5, backness: 0.5 }),
    dental: Object.freeze({ height: 0.7, backness: 0.3 }),
    alveolar: Object.freeze({ height: 0.7, backness: 0.3 }),
    postalveolar: Object.freeze({ height: 0.85, backness: 0.2 }),
    retroflex: Object.freeze({ height: 0.6, backness: 0.45 }),
    alveolopalatal: Object.freeze({ height: 1, backness: 0 }),
    palatal: Object.freeze({ height: 1, backness: 0 }),
    velar: Object.freeze({ height: 0.9, backness: 0.8 }),
    uvular: Object.freeze({ height: 0.6, backness: 1 }),
    pharyngeal: Object.freeze({ height: 0.2, backness: 1 }),
    'labial-velar': Object.freeze({ height: 0.9, backness: 0.8 }),
    'labial-palatal': Object.freeze({ height: 1, backness: 0 }),
    glottal: Object.freeze({ height: 0.5, backness: 0.5 }),
    dark: Object.freeze({ height: 0.6, backness: 0.85 }),
  }),
});

/**
 * Resistance level name, value and own tongue-body position of a consonant
 * token.
 * @param {object} token Segment token from parseIpa.
 * @param {Record<string, number>} [levels] Values of the four levels.
 * @returns {{level: string, resistance: number, height: number, backness: number}}
 */
export function resistance(token, levels = COARTICULATION_RESISTANCE.levels) {
  const { phoneme } = token;
  const table = COARTICULATION_RESISTANCE;
  const place = table.places[phoneme.place] ? phoneme.place : 'alveolar';
  let own = table.own[place];
  let level =
    table.phones[phoneme.symbol] ??
    table.manners[phoneme.manner] ??
    table.places[place];
  if (token.palatalized) {
    level = 'high';
    own = table.own.palatal;
  } else if (token.velarized || phoneme.velarized) {
    level = 'high';
    own = table.own.dark;
  }
  return { level, resistance: levels[level] ?? 0, ...own };
}

/** Neutral vowel used when a phrase starts or ends with consonants. */
export const NEUTRAL_VOWEL = Object.freeze({
  height: 0.5,
  backness: 0.5,
  rounding: 0,
});

function vowelTarget(token) {
  const { phoneme } = token;
  return {
    height: phoneme.height,
    backness: phoneme.backness,
    rounding: phoneme.rounded ? 1 : 0,
    rhotic: phoneme.symbol === 'ɚ' || phoneme.symbol === 'ɝ' || token.rhotic,
  };
}

/** Secondary articulation pushes the tongue body or lips. */
function secondaryArticulation(token) {
  return {
    palatalization: token.palatalized ? 1 : token.velarized ? -1 : 0,
    rounding: token.labialized ? 0.8 : 0,
  };
}

function consonantChannels(phoneme) {
  const place = PLACES[phoneme.place] ?? PLACES.alveolar;
  const manner = MANNERS[phoneme.manner] ?? MANNERS.approximant;
  const channels = {
    lipAmount: 0,
    lipArea: 2,
    tongueAmount: 0,
    tongueArea: 2,
    tongueLocation: place.location,
    tongueWidth: place.width,
  };
  if (place.lips) {
    channels.lipAmount = 1;
    channels.lipArea = phoneme.manner === 'approximant' ? 0.3 : manner.area;
  }
  if (!place.lips || place.location < 0.95) {
    channels.tongueAmount = place.glottal ? 0 : 1;
    channels.tongueArea = place.glottal ? 2 : manner.area;
    if (place.lips && phoneme.manner === 'approximant') {
      channels.tongueArea = 0.6;
    }
  }
  return { place, manner, channels };
}

function sibilanceOf(phoneme) {
  return phoneme.sibilant ? 1 : 0;
}

/**
 * Opening of the glottis of voiced fricatives: the folds part a little
 * from their voicing position, so that the air still builds pressure
 * behind the constriction while they vibrate (Stevens 1998, chapter 8).
 */
const VOICED_OPENING = {
  fricative: 0.1,
  'lateral-fricative': 0.1,
};

/** Glottal opening (`aspiration`) of an obstruent. */
function obstruentOpening(phoneme, voiced, glottal) {
  if (glottal) {
    return 0;
  }
  const table = voiced ? VOICED_OPENING : VOICELESS_OPENING;
  return table[phoneme.manner] ?? 0;
}

/**
 * Articulatory description of a consonant segment.
 * @param {object} token Segment token from parseIpa.
 */
export function consonantTarget(token) {
  const { phoneme } = token;
  const { place, manner, channels } = consonantChannels(phoneme);
  const glottal = Boolean(place.glottal);
  const voiced = token.voiced ?? phoneme.voiced;
  const target = {
    ...channels,
    velum: manner.velum ?? 0,
    voicing: voiced ? 1 : 0,
    aspiration: obstruentOpening(phoneme, voiced, glottal),
    glottalClosure: 0,
    frication: glottal ? 0 : manner.frication,
    sibilance: sibilanceOf(phoneme),
    trill: manner.trill ? 1 : 0,
    rhotic: ['ɹ', 'ɻ'].includes(phoneme.symbol) ? 1 : 0,
    lateral: phoneme.manner.startsWith('lateral') ? 1 : 0,
    ...secondaryArticulation(token),
  };
  if (phoneme.velarized) {
    target.palatalization = -1;
  }
  if (glottal && phoneme.manner === 'plosive') {
    target.glottalClosure = 1;
    target.voicing = 0;
  } else if (glottal) {
    target.aspiration = voiced ? 0.5 : 1;
  }
  if (token.syllabic) {
    target.tongueArea = Math.max(target.tongueArea, 0.25);
    target.lipArea = Math.max(target.lipArea, 0.25);
    target.frication = 0;
  }
  return target;
}

/**
 * Default glottal / velum channels of a vowel segment.
 * @param {object} token
 */
export function vowelChannels(token) {
  return {
    lipAmount: 0,
    tongueAmount: 0,
    velum: token.nasalized ? 0.6 : 0,
    voicing: token.voiced === false ? 0 : 1,
    aspiration: token.breathy ? 0.4 : 0,
    glottalClosure: 0,
    frication: 0,
    sibilance: 0,
    trill: 0,
    lateral: 0,
    ...secondaryArticulation(token),
  };
}

export { vowelTarget };
