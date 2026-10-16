/**
 * Articulatory targets for IPA segments.
 *
 * Every segment is described by the same small set of articulator
 * channels that drive the tube geometry:
 * - tongue body / jaw position in the vowel space (height, backness)
 * - lip rounding and lip constriction
 * - a tongue constriction (location along the tract, area, engagement)
 * - velum opening (nasal coupling)
 * - glottis: voicing, aspiration noise, glottal closure
 * - frication gain (how much turbulence a narrow constriction makes)
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
  plosive: { area: 0, frication: 0.7, duration: 75 },
  nasal: { area: 0, frication: 0, duration: 70, velum: 1 },
  trill: { area: 0.12, frication: 0.15, duration: 85, trill: true },
  tap: { area: 0, frication: 0.2, duration: 28 },
  fricative: { area: 0.09, frication: 1, duration: 105 },
  'lateral-fricative': { area: 0.1, frication: 0.9, duration: 105 },
  approximant: { area: 0.35, frication: 0, duration: 60 },
  'lateral-approximant': { area: 0.28, frication: 0, duration: 65 },
};

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
    aspiration: 0,
    glottalClosure: 0,
    frication: glottal ? 0 : manner.frication * (voiced ? 0.7 : 1),
    sibilance: sibilanceOf(phoneme),
    trill: manner.trill ? 1 : 0,
    rhotic: ['ɹ', 'ɻ'].includes(phoneme.symbol) ? 1 : 0,
    lateral: phoneme.manner.startsWith('lateral') ? 1 : 0,
    duration: manner.duration,
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
    target.duration = 120;
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
