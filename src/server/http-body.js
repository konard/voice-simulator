/** Bounded request bodies for the local HTTP API. Unlicense. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export async function* boundedBytes(request, limit) {
  if (Number(request.headers['content-length']) > limit) {
    throw new HttpError(413, 'Request body too large');
  }
  // Keep the socket open for the error response if a chunk exceeds the limit.
  const iterator = request[Symbol.asyncIterator]();
  let size = 0;
  for (;;) {
    const { value, done } = await iterator.next();
    if (done) {
      return;
    }
    size += value.length;
    if (size > limit) {
      throw new HttpError(413, 'Request body too large');
    }
    yield value;
  }
}

export async function readBytes(request, limit) {
  const chunks = [];
  for await (const chunk of boundedBytes(request, limit)) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
