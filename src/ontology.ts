/** Query expansion over taught aliases. */

const WORD = /[A-Za-z0-9]+/g;

/** Append each alias's canonical word once, when the alias is a whole word and the canonical is absent. */
export function expandQuery(
  query: string,
  aliases: readonly { alias: string; canonical: string }[],
): string {
  const present = new Set((query.match(WORD) ?? []).map((word) => word.toLowerCase()));
  let expanded = query;
  for (const { alias, canonical } of aliases) {
    const canonicalKey = canonical.toLowerCase();
    if (!present.has(alias.toLowerCase())) continue;
    if (present.has(canonicalKey)) continue;
    present.add(canonicalKey);
    expanded += ` ${canonical}`;
  }
  return expanded;
}
