/** SHA-256 helpers for page hashes and deterministic edge ids. */

export async function contentHash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  let hex = "";
  for (const byte of new Uint8Array(digest)) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

export async function edgeIdFor(...parts: string[]): Promise<string> {
  return `e_${(await contentHash(parts.join("|"))).slice(0, 24)}`;
}
