/**
 * Air flow and turbulence noise sources.
 *
 * The lungs push air through two orifices in series: the glottis (area
 * A_g) and the narrowest place of the mouth (A_c, plus the velopharyngeal
 * port). The pressure in the mouth P_o splits the lung pressure P_L between
 * them. In a steady state the same flow passes both orifices, which gives
 * P_o = P_L A_g² / (A_g² + A_c²). The walls and the air behind the
 * constriction are a compliance C, so P_o follows that target with a lag:
 * the pressure builds up behind a closure and falls at its release.
 *
 * Turbulent air makes noise with a strength that grows as the pressure drop
 * to the power 1.5 and the square root of the area (Stevens 1971), but only
 * above a critical Reynolds number. The burst of a stop is the flow change
 * at the release (Stevens 1993): a transient, then frication at the
 * opening constriction, then aspiration at the glottis.
 *
 * All quantities are cgs: areas cm², flow cm³/s, pressure dyn/cm²
 * (1 Pa = 10 dyn/cm²).
 */

import { AIR_DENSITY } from './transfer.js';
import { whisperPosture } from './whisper.js';

/** Compliance of the walls and the air behind a constriction (cm⁵/dyn). */
export const ORAL_COMPLIANCE = 1e-3;

/** Kinematic viscosity of air (cm²/s). */
export const VISCOSITY = 0.15;

/** Reynolds number above which the jet becomes turbulent. */
export const RE_CRITICAL = 1800;

/** Mean glottal area of modal voicing (cm²). */
export const GLOTTIS_VOICED = 0.05;

/** Glottal area of an open glottis: [h], voiceless obstruents (cm²). */
export const GLOTTIS_OPEN = 0.25;

/** Extra mean glottal area of a fully breathy voice (cm²). */
export const GLOTTIS_BREATHY = 0.1;

/** Reference state of the relative strengths (dyn/cm² and cm²). */
export const REFERENCE_LUNG_PRESSURE = 8000;
export const REFERENCE_GLOTTIS = 0.25;
export const REFERENCE_CONSTRICTION = 0.09;

/**
 * Reynolds number of a jet of flow U (cm³/s) through an area A (cm²),
 * with the diameter of a circle of that area.
 * @param {number} flow
 * @param {number} area
 */
export function reynolds(flow, area) {
  if (!(area > 0)) {
    return 0;
  }
  return ((flow / area) * Math.sqrt((4 * area) / Math.PI)) / VISCOSITY;
}

/**
 * Strength (amplitude, arbitrary units) of the turbulence noise made by a
 * pressure drop `dp` (dyn/cm²) across an orifice of area `area` (cm²)
 * carrying the flow `flow` (cm³/s): dp^1.5 A^0.5, gated by the Reynolds
 * number between `reCritical` (head.reCritical, RE_CRITICAL by default)
 * and twice that.
 * @param {number} dp
 * @param {number} area
 * @param {number} flow
 * @param {number} [reCritical]
 */
export function sourceStrength(dp, area, flow, reCritical = RE_CRITICAL) {
  if (!(dp > 0) || !(area > 0)) {
    return 0;
  }
  const gate = Math.min(
    1,
    Math.max(0, (reynolds(flow, area) - reCritical) / reCritical)
  );
  if (gate === 0) {
    return 0;
  }
  return gate * dp * Math.sqrt(dp) * Math.sqrt(area);
}

/**
 * Steady state of the two orifices: mouth pressure and flow.
 * @param {number} lungPressure dyn/cm².
 * @param {number} glottalArea cm².
 * @param {number} constrictionArea cm².
 */
export function steadyFlow(lungPressure, glottalArea, constrictionArea) {
  const g2 = glottalArea * glottalArea;
  const c2 = constrictionArea * constrictionArea;
  const oralPressure = g2 + c2 > 0 ? (lungPressure * g2) / (g2 + c2) : 0;
  return {
    oralPressure,
    flow: constrictionArea * Math.sqrt((2 * oralPressure) / AIR_DENSITY),
  };
}

/**
 * Strength at the constriction of a default voiceless fricative (P_L 8000,
 * A_g 0.25, A_c 0.09): the unit of the relative frication strength.
 */
export const FRICATION_REFERENCE = (() => {
  const { oralPressure, flow } = steadyFlow(
    REFERENCE_LUNG_PRESSURE,
    REFERENCE_GLOTTIS,
    REFERENCE_CONSTRICTION
  );
  return sourceStrength(oralPressure, REFERENCE_CONSTRICTION, flow);
})();

/**
 * Strength at an open glottis (A_g 0.25) under an open tract (the whole
 * lung pressure drops at the glottis): the unit of the relative aspiration
 * strength.
 */
export const ASPIRATION_REFERENCE = sourceStrength(
  REFERENCE_LUNG_PRESSURE,
  REFERENCE_GLOTTIS,
  REFERENCE_GLOTTIS * Math.sqrt((2 * REFERENCE_LUNG_PRESSURE) / AIR_DENSITY)
);

/**
 * Relative aspiration strength of a glottis of area `glottalArea` under an
 * open tract: what a glottis without an Aerodynamics state assumes.
 * @param {number} lungPressure dyn/cm².
 * @param {number} glottalArea cm².
 * @param {number} [reCritical] head.reCritical.
 */
export function openTractStrength(lungPressure, glottalArea, reCritical) {
  const flow = glottalArea * Math.sqrt((2 * lungPressure) / AIR_DENSITY);
  return (
    sourceStrength(lungPressure, glottalArea, flow, reCritical) /
    ASPIRATION_REFERENCE
  );
}

/**
 * Mean glottal area (cm²) of the LF source. A whisper (`control.whisper`,
 * issue 53) takes the voiced opening away by `1 - whisper` and adds the
 * half-open glottis of the whisper (`whisperPosture()` of whisper.js).
 * @param {{voicing: number, aspiration: number, closure: number, whisper?: number, stopClosure?: number, fricative?: number, effort?: number}} control
 * @param {number} breathiness Head breathiness (0 to 1).
 * @param {number} chink Glottal chink (mm²).
 * @param {{glottisVoiced?: number, glottisOpen?: number, glottisBreathy?: number}} [areas]
 *   The areas of a head (GLOTTIS_VOICED, GLOTTIS_OPEN and GLOTTIS_BREATHY
 *   by default).
 */
export function glottalArea(control, breathiness = 0.2, chink = 0, areas = {}) {
  const voicing = Math.max(0, control.voicing);
  const aspiration = Math.max(0, control.aspiration);
  const closure = Math.min(1, Math.max(0, control.closure ?? 0));
  const whisper = control.whisper ?? 0;
  if (whisper > 0) {
    const voiced = voicing * (1 - Math.min(1, whisper));
    return (
      ((areas.glottisVoiced ?? GLOTTIS_VOICED) * voiced +
        (areas.glottisOpen ?? GLOTTIS_OPEN) * aspiration +
        (areas.glottisBreathy ?? GLOTTIS_BREATHY) * breathiness * voiced) *
        (1 - closure) +
      whisperPosture(control) +
      Math.max(0, chink) / 100
    );
  }
  return (
    ((areas.glottisVoiced ?? GLOTTIS_VOICED) * voicing +
      (areas.glottisOpen ?? GLOTTIS_OPEN) * aspiration +
      (areas.glottisBreathy ?? GLOTTIS_BREATHY) * breathiness * voicing) *
      (1 - closure) +
    Math.max(0, chink) / 100
  );
}

/**
 * 1 - exp(-x) of a first-order lag over x time constants, with exp(-x)
 * replaced by 1 / (1 + x + x²/2 + x³/6): relative error of exp(-x) below
 * 5e-6 at x = 0.1 (a control block against the shortest time constant),
 * between 0 and 1 for every x >= 0, and only + and / so that every runtime
 * gives the same bits (JavaScriptCore and V8 round Math.exp differently).
 * @param {number} x
 */
export function lagFactor(x) {
  return 1 - 1 / (1 + x * (1 + x * (0.5 + x / 6)));
}

export class Aerodynamics {
  /**
   * @param {{compliance?: number}} [options] `compliance` is
   *   head.oralCompliance (ORAL_COMPLIANCE by default).
   */
  constructor(options = {}) {
    this.compliance = options.compliance ?? ORAL_COMPLIANCE;
    this.reset();
  }

  reset() {
    this.oralPressure = 0;
    this.flow = 0;
  }

  /**
   * Advance by dt seconds with constant inputs.
   * @param {number} dt
   * @param {number} lungPressure P_L (dyn/cm²).
   * @param {number} glottalArea A_g (cm²).
   * @param {number} constrictionArea A_c (cm²).
   * @returns {{flow: number, flowDerivative: number, oralPressure: number, glottalDrop: number, constrictionDrop: number}}
   */
  step(dt, lungPressure, glottalArea, constrictionArea) {
    const lung = Math.max(0, lungPressure);
    const glottis = Math.max(0, glottalArea);
    const constriction = Math.max(0, constrictionArea);
    const total = glottis + constriction;
    if (total > 0) {
      const g2 = glottis * glottis;
      const target = (lung * g2) / (g2 + constriction * constriction);
      const tau =
        (this.compliance * Math.sqrt((AIR_DENSITY * lung) / 2)) / total;
      this.oralPressure +=
        tau > 0
          ? (target - this.oralPressure) * lagFactor(dt / tau)
          : target - this.oralPressure;
    }
    const flow =
      constriction *
      Math.sqrt((2 * Math.max(0, this.oralPressure)) / AIR_DENSITY);
    const flowDerivative = dt > 0 ? (flow - this.flow) / dt : 0;
    this.flow = flow;
    return {
      flow,
      flowDerivative,
      oralPressure: this.oralPressure,
      glottalDrop: lung - this.oralPressure,
      constrictionDrop: this.oralPressure,
    };
  }
}
