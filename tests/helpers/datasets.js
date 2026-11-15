/**
 * Skip reasons for tests that need a speech dataset of
 * datasets/registry.json (issue 16). Use it with `itUnless`:
 *
 *   const noFleurs = await datasetSkipReason('fleurs-ru');
 *   itUnless(noFleurs)('recognises FLEURS', async () => { ... });
 *
 * The test itself calls `fetchDataset` (a no-op when the cache verifies)
 * and then `readDataset`, both from scripts/datasets.mjs.
 */

import {
  entryUrls,
  findEntry,
  loadRegistry,
  verifyDataset,
} from '../../scripts/datasets.mjs';
import { networkSkipReason } from './network.js';

/**
 * @param {string} id dataset id of datasets/registry.json
 * @param {{cache?: string, registry?: string|object,
 *   probe?: typeof networkSkipReason}} [options]
 * @returns {Promise<string|null>} null when the dataset is in the cache and
 *   verifies, else the reason why its first URL cannot be reached (null
 *   when it can)
 */
export async function datasetSkipReason(id, options = {}) {
  const { probe = networkSkipReason } = options;
  let entry;
  try {
    const registry =
      typeof options.registry === 'object'
        ? options.registry
        : loadRegistry(options.registry);
    entry = findEntry(registry, id);
    const state = await verifyDataset(id, { ...options, registry });
    if (state.cached) {
      return null;
    }
  } catch (error) {
    return `dataset ${id}: ${error?.message ?? error}`;
  }
  return probe({ url: entryUrls(entry)[0] });
}
