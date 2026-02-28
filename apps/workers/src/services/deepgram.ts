/**
 * Deepgram transcription service
 *
 * Provides word-level timestamps for audio files.
 */

import { config } from '../config.js';
import { logger } from '@webl/shared';

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

interface DeepgramWord {
  word?: string;
  punctuated_word?: string;
  start?: number;
  end?: number;
  confidence?: number;
}

interface DeepgramAlternative {
  transcript?: string;
  words?: DeepgramWord[];
}

interface DeepgramChannel {
  alternatives?: DeepgramAlternative[];
}

interface DeepgramResponse {
  metadata?: {
    duration?: number;
  };
  results?: {
    channels?: DeepgramChannel[];
  };
}

export interface DeepgramTranscriptResult {
  words: WordTimestamp[];
  durationSeconds: number | null;
  transcript: string | null;
  /** Raw API response exactly as received (for debugging / no alteration) */
  rawResponse?: DeepgramResponse;
}

export interface DeepgramTranscribeOptions {
  /**
   * Deepgram Keyterm Prompting (Nova-3 / Flux).
   * Prefer this over `keywords` when supported by the model.
   */
  keyterms?: string[];
  /**
   * Deepgram Keywords boosting (Nova-2 / Nova-1 / Enhanced / Base).
   * Values are `term:intensifier` strings.
   */
  keywords?: string[];
}

const DEEPGRAM_API_URL = 'https://api.deepgram.com/v1/listen';

function sanitizeWord(value: string): string {
  return value.replace(/[.,!?;:]/g, '');
}

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
  'first',
  'next',
  'today',
  'tomorrow',
  'yesterday',
]);

function isAllCapsToken(token: string): boolean {
  return /^[A-Z0-9]{2,}$/.test(token);
}

function normalizeKeytermKey(term: string): string {
  return term
    .toLowerCase()
    .replace(/['’]/g, "'")
    .replace(/[^a-z0-9'\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokenLooksLikeKeyterm(token: string): boolean {
  if (!token) return false;
  if (isAllCapsToken(token)) return true;
  if (/[0-9]/.test(token)) return true;
  if (/[-–]/.test(token)) return true;
  // TitleCase / Proper noun
  if (/^[A-Z][a-z0-9]+/.test(token)) return true;
  return false;
}

function extractKeytermsFromScript(scriptContent: string, maxKeyterms: number): string[] {
  if (!scriptContent || maxKeyterms <= 0) return [];

  const text = scriptContent.replace(/\r\n/g, '\n').replace(/\n+/g, ' ');
  const tokenRegex = /[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g;
  const rawTokens = text.match(tokenRegex) ?? [];

  type Candidate = { term: string; key: string; score: number; tokenCount: number; charCount: number };
  const candidatesByKey = new Map<string, Candidate>();
  const freqByKey = new Map<string, number>();

  const cleanedTokens = rawTokens
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => t.replace(/[“”]/g, '"').replace(/[‘’]/g, "'"));

  // Multi-word proper noun phrases (up to 4 tokens)
  for (let i = 0; i < cleanedTokens.length; i += 1) {
    const first = cleanedTokens[i];
    if (!first) continue;
    if (!tokenLooksLikeKeyterm(first)) continue;

    // Build a phrase of consecutive "keyterm-like" tokens (e.g., New York, NBA, T-Race)
    const phraseTokens: string[] = [];
    for (let j = i; j < Math.min(cleanedTokens.length, i + 4); j += 1) {
      const tok = cleanedTokens[j];
      if (!tok) break;
      if (!tokenLooksLikeKeyterm(tok)) break;

      const lower = tok.toLowerCase();
      const tokenIsStopword = STOPWORDS.has(lower);
      const tokenIsAllowedStopword = isAllCapsToken(tok) || /[-–0-9]/.test(tok);
      if (tokenIsStopword && !tokenIsAllowedStopword) break;

      phraseTokens.push(tok);
    }

    // Add phrase candidates of length 1..N (we'll rank longer phrases higher later)
    for (let len = 1; len <= phraseTokens.length; len += 1) {
      const term = phraseTokens.slice(0, len).join(' ');
      const key = normalizeKeytermKey(term);
      if (!key) continue;

      const occurrences = (freqByKey.get(key) ?? 0) + 1;
      freqByKey.set(key, occurrences);

      const tokenCount = len;
      const charCount = term.length;
      let score = 0;
      for (const pt of term.split(/\s+/)) {
        if (isAllCapsToken(pt)) score += 3;
        else if (/^[A-Z]/.test(pt)) score += 2;
        if (/[-–]/.test(pt)) score += 2;
        if (/[0-9]/.test(pt)) score += 2;
        if (pt.length >= 9) score += 1;
      }
      score += Math.min(3, occurrences - 1);
      // Prefer longer multi-word phrases slightly
      if (tokenCount >= 2) score += 1;

      const prev = candidatesByKey.get(key);
      if (!prev || score > prev.score || (score === prev.score && charCount > prev.charCount)) {
        candidatesByKey.set(key, { term, key, score, tokenCount, charCount });
      }
    }
  }

  const candidates = Array.from(candidatesByKey.values())
    .filter((c) => c.key.length >= 3)
    .filter((c) => {
      // Avoid obvious sentence-start generic words (e.g. "Just", "First") even if TitleCase
      if (c.tokenCount === 1 && STOPWORDS.has(c.key)) return false;
      return true;
    })
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      if (a.tokenCount !== b.tokenCount) return b.tokenCount - a.tokenCount;
      return b.charCount - a.charCount;
    });

  const selected: string[] = [];
  const usedKeys = new Set<string>();

  for (const candidate of candidates) {
    if (selected.length >= maxKeyterms) break;
    if (usedKeys.has(candidate.key)) continue;
    usedKeys.add(candidate.key);
    selected.push(candidate.term);
  }

  return selected;
}

function modelSupportsKeytermPrompting(model: string): boolean {
  const lower = (model || '').toLowerCase();
  return lower.startsWith('nova-2') || lower.startsWith('flux');
}

function buildQueryParams(options?: DeepgramTranscribeOptions): URLSearchParams {
  const params = new URLSearchParams();
  params.set('model', config.deepgram.model);
  params.set('language', config.deepgram.language);
  params.set('punctuate', config.deepgram.punctuate ? 'true' : 'false');
  params.set('smart_format', config.deepgram.smartFormat ? 'true' : 'false');
  params.set('filler_words', config.deepgram.fillerWords ? 'true' : 'false');
  params.set('numerals', config.deepgram.numerals ? 'true' : 'false');
  const utterancesEnabled =
    config.deepgram.utterances || Number.isFinite(config.deepgram.utteranceSplit);
  if (utterancesEnabled) {
    params.set('utterances', 'true');
  }
  if (Number.isFinite(config.deepgram.utteranceSplit)) {
    params.set('utt_split', String(config.deepgram.utteranceSplit));
  }

  const keyterms = (options?.keyterms ?? []).map((t) => t.trim()).filter(Boolean);
  const keywords = (options?.keywords ?? []).map((t) => t.trim()).filter(Boolean);

  if (keyterms.length > 0 && modelSupportsKeytermPrompting(config.deepgram.model)) {
    for (const keyterm of keyterms.slice(0, 100)) {
      params.append('keyterm', keyterm);
    }
  } else if (keywords.length > 0) {
    for (const keyword of keywords.slice(0, 100)) {
      params.append('keywords', keyword);
    }
  }

  return params;
}

export const deepgramService = {
  extractKeytermsFromScript,
  async transcribeFromUrl(
    audioUrl: string,
    options?: DeepgramTranscribeOptions
  ): Promise<DeepgramTranscriptResult> {
    if (!config.deepgram.apiKey) {
      throw new Error('DEEPGRAM_API_KEY is not configured');
    }

    const query = buildQueryParams(options).toString();
    const response = await fetch(`${DEEPGRAM_API_URL}?${query}`, {
      method: 'POST',
      headers: {
        Authorization: `Token ${config.deepgram.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ url: audioUrl }),
    });

    const responseText = await response.text();

    if (!response.ok) {
      throw new Error(
        `Deepgram transcription failed: ${response.status} ${response.statusText} - ${responseText.slice(0, 500)}`
      );
    }

    const data = JSON.parse(responseText) as DeepgramResponse;
    const alternative = data.results?.channels?.[0]?.alternatives?.[0];
    const rawWords = alternative?.words ?? [];

    logger.info('[Deepgram] RECEIVED: raw API response', {
      metadataDuration: data.metadata?.duration,
      rawWordCount: rawWords.length,
      firstWord: rawWords[0] ? { word: rawWords[0].word, start: rawWords[0].start, end: rawWords[0].end } : null,
      lastWord: rawWords.length > 0 ? rawWords[rawWords.length - 1] ? { word: rawWords[rawWords.length - 1]!.word, start: rawWords[rawWords.length - 1]!.start, end: rawWords[rawWords.length - 1]!.end } : null : null,
      transcriptPreview: alternative?.transcript?.slice(0, 80) ?? null,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] source=Deepgram step=RECEIVED_RAW_API wordCount=${rawWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        rawWords.map((w) => ({ word: w.word, start: w.start, end: w.end, confidence: w.confidence }))
      )}`
    );

    const words = rawWords
      .map((word): WordTimestamp | null => {
        const rawText = word.punctuated_word || word.word || '';
        const cleaned = sanitizeWord(rawText).trim();
        if (!cleaned) {
          return null;
        }

        const startMs = Math.round((word.start ?? 0) * 1000);
        const endMs = Math.round((word.end ?? 0) * 1000);

        if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
          return null;
        }

        return {
          word: cleaned,
          startMs,
          endMs,
          confidence: word.confidence ?? 1,
        };
      })
      .filter((word): word is WordTimestamp => Boolean(word));

    const durationSeconds = data.metadata?.duration ?? null;

    logger.info('[Deepgram] DOING: normalized words (sanitize punctuation, seconds->ms)', {
      inputRawCount: rawWords.length,
      outputWordCount: words.length,
      dropped: rawWords.length - words.length,
    });
    logger.info('[Deepgram] RETURNING: transcript result', {
      wordCount: words.length,
      durationSeconds,
      firstWord: words[0] ? { word: words[0].word, startMs: words[0].startMs, endMs: words[0].endMs } : null,
      lastWord: words.length > 0 ? words[words.length - 1]! ? { word: words[words.length - 1]!.word, startMs: words[words.length - 1]!.startMs, endMs: words[words.length - 1]!.endMs } : null : null,
      keytermCount: (options?.keyterms ?? []).length,
      keywordCount: (options?.keywords ?? []).length,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] source=Deepgram step=RETURNING_NORMALIZED wordCount=${words.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(words.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence })))}`
    );

    return {
      words,
      durationSeconds,
      transcript: alternative?.transcript ?? null,
      rawResponse: data,
    };
  },
};
