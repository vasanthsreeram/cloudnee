/** Markdown paragraph packing, sized for embedding and extraction. */

export interface Chunk {
  id: string;
  text: string;
  index: number;
}

const DEFAULT_MAX_CHARS = 2000;

/**
 * Packs consecutive paragraphs (split on blank lines) up to maxChars each.
 * A paragraph longer than maxChars stays whole; chunks never split mid-paragraph.
 */
export function chunkMarkdown(markdown: string, opts?: { maxChars?: number }): Chunk[] {
  const trimmed = markdown.trim();
  if (trimmed === "") return [];

  const maxChars = opts?.maxChars ?? DEFAULT_MAX_CHARS;
  const paragraphs = trimmed
    .split("\n\n")
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== "");

  const chunks: Chunk[] = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current === "") {
      current = paragraph;
      continue;
    }
    const joined = `${current}\n\n${paragraph}`;
    if (joined.length <= maxChars) {
      current = joined;
    } else {
      chunks.push({ id: `c${chunks.length}`, text: current, index: chunks.length });
      current = paragraph;
    }
  }
  if (current !== "") {
    chunks.push({ id: `c${chunks.length}`, text: current, index: chunks.length });
  }
  return chunks;
}
