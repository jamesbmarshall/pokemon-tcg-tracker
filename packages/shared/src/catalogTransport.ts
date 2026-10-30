/** Bound decompressed provider JSON before parsing, regardless of Content-Length. */
export const CATALOGUE_RESPONSE_LIMIT = 16 * 1024 * 1024;
export async function catalogueJson<T>(response: Response): Promise<T> {
  const declared = Number(response.headers.get('content-length'));
  if (declared > CATALOGUE_RESPONSE_LIMIT) {
    await response.body?.cancel();
    throw new Error('Card API response exceeds size limit');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Card API returned an empty response');
  const decoder = new TextDecoder();
  const chunks: string[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > CATALOGUE_RESPONSE_LIMIT) {
        await reader.cancel();
        throw new Error('Card API response exceeds size limit');
      }
      chunks.push(decoder.decode(value, { stream: true }));
    }
    chunks.push(decoder.decode());
    return JSON.parse(chunks.join('')) as T;
  } finally { reader.releaseLock(); }
}
