/** Shared recognition options for the CLI and HTTP query strings. */
export function recognitionParams({ lang, nbest, level, engine, threads }) {
  return {
    languages:
      lang === undefined || lang === 'auto'
        ? undefined
        : lang.split(',').map((code) => code.trim()),
    nbest: nbest === undefined ? undefined : Number(nbest),
    level,
    engine,
    threads:
      threads === undefined || threads === 'auto' ? threads : Number(threads),
  };
}
