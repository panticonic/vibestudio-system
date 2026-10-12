/**
 * Fuzzy matching for the palette and launcher: the query's characters must
 * appear in order (case-insensitive). Matches at word starts and runs of
 * consecutive characters score higher, so "sl" ranks "Server Logs" above
 * "Sessions list".
 */
export interface FuzzyMatch {
  score: number;
  /** Indices of matched characters in the candidate, for highlighting. */
  positions: number[];
}

function isWordStart(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text[index - 1]!;
  const current = text[index]!;
  return (
    /[\s\-_/.:·]/.test(previous) ||
    (previous === previous.toLowerCase() && current !== current.toLowerCase())
  );
}

export function fuzzyMatch(query: string, candidate: string): FuzzyMatch | null {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return { score: 0, positions: [] };
  const haystack = candidate.toLowerCase();
  // Prefer the best of a greedy match starting at each occurrence of the first character.
  let best: FuzzyMatch | null = null;
  for (
    let start = haystack.indexOf(needle[0]!);
    start !== -1;
    start = haystack.indexOf(needle[0]!, start + 1)
  ) {
    const positions: number[] = [];
    let score = 0;
    let at = start;
    let previous = -2;
    for (const char of needle) {
      if (char === " ") continue;
      const found = haystack.indexOf(char, at);
      if (found === -1) {
        positions.length = 0;
        break;
      }
      score += 1;
      if (found === previous + 1) score += 4;
      if (isWordStart(candidate, found)) score += 6;
      score -= Math.min(3, (found - previous - 1) * 0.1);
      positions.push(found);
      previous = found;
      at = found + 1;
    }
    if (positions.length === 0) continue;
    score -= positions[0]! * 0.05;
    if (!best || score > best.score) best = { score, positions };
  }
  return best;
}

/** Filter and rank items by `text(item)`; stable for equal scores; empty query keeps order. */
export function fuzzyFilter<T>(
  items: readonly T[],
  query: string,
  text: (item: T) => string
): Array<{ item: T; match: FuzzyMatch }> {
  const ranked: Array<{ item: T; match: FuzzyMatch; order: number }> = [];
  items.forEach((item, order) => {
    const match = fuzzyMatch(query, text(item));
    if (match) ranked.push({ item, match, order });
  });
  ranked.sort((a, b) => b.match.score - a.match.score || a.order - b.order);
  return ranked.map(({ item, match }) => ({ item, match }));
}
