const STOPWORDS = new Set<string>([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'but',
  'by',
  'for',
  'from',
  'had',
  'has',
  'have',
  'he',
  'her',
  'hers',
  'him',
  'his',
  'how',
  'i',
  'if',
  'in',
  'into',
  'is',
  'it',
  'its',
  'just',
  'like',
  'me',
  'my',
  'no',
  'not',
  'of',
  'on',
  'or',
  'our',
  'ours',
  'she',
  'so',
  'that',
  'the',
  'their',
  'them',
  'then',
  'there',
  'these',
  'they',
  'this',
  'to',
  'too',
  'up',
  'us',
  'was',
  'we',
  'were',
  'what',
  'when',
  'where',
  'which',
  'who',
  'why',
  'with',
  'you',
  'your',
  'yours',
]);

function normalizeQuotes(value: string): string {
  return value
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-');
}

export function normalizeKeytermTerm(value: string): string {
  return normalizeQuotes(value)
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenizeScriptForKeyterms(scriptContent: string): string[] {
  const text = normalizeQuotes(scriptContent).replace(/\r\n/g, '\n').replace(/\n+/g, ' ');
  // Keeps hyphenated words and apostrophes inside words.
  const tokenRegex = /[A-Za-z0-9]+(?:['.-][A-Za-z0-9]+)*/g;
  return (text.match(tokenRegex) ?? []).map((t) => t.trim()).filter(Boolean);
}

function tokenIsSignal(token: string): boolean {
  if (!token) return false;
  if (/[0-9]/.test(token)) return true;
  if (/[-]/.test(token)) return true;
  if (/^[A-Z0-9]{2,}$/.test(token)) return true;
  if (/^[A-Z][a-z]/.test(token)) return true;
  const normalized = normalizeKeytermTerm(token);
  if (normalized.length <= 2) return false;
  return !STOPWORDS.has(normalized);
}

export function extractNormalizedKeytermCandidatesFromScript(
  scriptContent: string,
  options?: {
    maxPhraseLen?: number;
    maxCandidates?: number;
  }
): string[] {
  const maxPhraseLen = Math.max(1, Math.min(6, options?.maxPhraseLen ?? 4));
  const maxCandidates = Math.max(100, options?.maxCandidates ?? 6000);

  const tokens = tokenizeScriptForKeyterms(scriptContent);
  if (tokens.length === 0) return [];

  const candidates = new Set<string>();

  for (let i = 0; i < tokens.length; i += 1) {
    if (candidates.size >= maxCandidates) break;
    const first = tokens[i];
    if (!first) continue;

    for (let len = 1; len <= maxPhraseLen; len += 1) {
      const slice = tokens.slice(i, i + len);
      if (slice.length !== len) break;
      // Require at least one "signal" token to avoid exploding candidates.
      if (!slice.some(tokenIsSignal)) continue;

      const phrase = slice.join(' ');
      const normalized = normalizeKeytermTerm(phrase);
      if (!normalized) continue;
      if (normalized.length < 3) continue;

      candidates.add(normalized);
      if (candidates.size >= maxCandidates) break;
    }
  }

  return Array.from(candidates);
}

