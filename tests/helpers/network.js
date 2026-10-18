/** A HEAD request, or a one-byte range; null when the answer is usable. */
async function probe(url, range, fetchFn) {
  const signal = globalThis.AbortSignal.timeout(5000);
  if (!range) {
    const response = await fetchFn(url, { method: 'HEAD', signal });
    return response.ok ? null : `${url} answered HTTP ${response.status}`;
  }
  const response = await fetchFn(url, {
    method: 'GET',
    headers: { Range: 'bytes=0-0' },
    signal,
  });
  await response.body?.cancel?.();
  return response.status === 206
    ? null
    : `${url} refused a range request (HTTP ${response.status})`;
}

/**
 * Explain why a network integration cannot run without disguising a permission denial.
 * With `range`, one byte is asked for, so a server refusing ranges at the
 * moment is reported too.
 */
export async function networkSkipReason({
  url,
  range = false,
  runtime = globalThis.Deno,
  fetchFn = fetch,
}) {
  if (typeof runtime?.permissions?.query === 'function') {
    const host = new globalThis.URL(url).host;
    const { state } = await runtime.permissions.query({ name: 'net', host });
    if (state !== 'granted') {
      return `Deno net permission for ${host} is ${state}`;
    }
  }
  try {
    return await probe(url, range, fetchFn);
  } catch (error) {
    return `${url} is unreachable (${error?.cause?.message ?? error?.message ?? error})`;
  }
}
