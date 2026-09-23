/**
 * Serve stored bytes as a streamed response (Sep 23, 2026). A function on Vercel may not return a body over about
 * 4.5 MB in one piece, which is why a 23 MB brochure came back as "Failed to load PDF document"; a streamed body has
 * no such cap. Chunks of 1 MB, same headers as before.
 */
export function streamBytes(bytes: Uint8Array | Buffer, headers: Record<string, string>, status = 200): Response {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const CHUNK = 1024 * 1024;
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= data.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(data.subarray(offset, Math.min(offset + CHUNK, data.byteLength)));
      offset += CHUNK;
    },
  });
  return new Response(body, { status, headers: { ...headers, "content-length": String(data.byteLength), "accept-ranges": "none" } });
}
