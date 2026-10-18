/**
 * Every release of the app stays online for comparison: earlier ones are
 * rebuilt from their commits (previous-versions.json) into /v1/, /v2/, …
 * and the current build is published both at the root and at the next
 * free path, so links to it keep working after the next release.
 *
 * When a release changes the app, add the commit the site was built from
 * before the release to previous-versions.json; the build script then
 * moves the current version to the next path on its own.
 */

/** The GitHub Pages site the versions are published under. */
export const PAGES_URL = 'https://konard.github.io/voice-simulator/';

/**
 * Path of the current version, one after the last previous one.
 * @param {{path: string}[]} previous
 */
export function currentVersionPath(previous) {
  const numbers = previous.map((version) => Number(version.path.slice(1)));
  return `v${Math.max(0, ...numbers) + 1}`;
}

/**
 * Links to all versions, oldest first; the last one is this build.
 * @param {{path: string}[]} previous
 * @param {string} [base]
 * @returns {{path: string, number: number, href: string, current: boolean}[]}
 */
export function versionLinks(previous, base = PAGES_URL) {
  const paths = [
    ...previous.map((version) => version.path),
    currentVersionPath(previous),
  ];
  return paths.map((path, index) => ({
    path,
    number: Number(path.slice(1)),
    href: `${base}${path}/`,
    current: index === paths.length - 1,
  }));
}
