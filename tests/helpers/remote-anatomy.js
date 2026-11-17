import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { measureSource } from '../../scripts/build-dental-reference.mjs';
import { OPEN_FULL_JAW, fetchAnatomy } from '../../scripts/fetch-anatomy.mjs';
import {
  ArchiveNetworkError,
  RangeRefusedError,
} from '../../scripts/fetch-dvtd.mjs';
import { networkSkipReason } from './network.js';

/** Fetch before test registration so CPU-bound cases cannot starve the download. */
export async function fetchJawReference({
  patient = 14,
  probe = networkSkipReason,
  download = fetchAnatomy,
  measure = measureSource,
  signal = AbortSignal.timeout(20000),
} = {}) {
  const url = OPEN_FULL_JAW.url(patient);
  const reason = await probe({ url, range: true });
  if (reason) {
    return { reason };
  }
  const directory = mkdtempSync(join(tmpdir(), 'open-full-jaw-'));
  try {
    await download('open-full-jaw', directory, { patients: [patient], signal });
    return {
      measured: measure('open-full-jaw', join(directory, `Patient_${patient}`)),
    };
  } catch (error) {
    if (
      (signal.aborted &&
        (error === signal.reason || error.cause === signal.reason)) ||
      error instanceof ArchiveNetworkError ||
      error instanceof RangeRefusedError
    ) {
      return { reason: `${url} download unavailable (${error.message})` };
    }
    return { error };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
