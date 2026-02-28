/**
 * Script Alignment Service (V2)
 *
 * Uses word-level dynamic programming to align a clean script to a noisy transcript.
 * This is designed to handle repeated takes and false starts with high precision.
 */
import { logger as sharedLogger } from '@webl/shared';
export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}
export interface KeepSegment {
  startMs: number;
  endMs: number;
}
export interface ScriptAlignmentStats {
  sentenceCount: number;
  matchedCount: number;
  usedLlm: boolean;
  averageBestScore: number;
  keptSegmentCount: number;
  repeatedSentencesDetected: number;
  artifactsRemoved: number;
  scriptTokenCount?: number;
  matchedTokenCount?: number;
  tokenCoverage?: number;
  avgConfidence?: number;
}
interface ScriptSentence {
  index: number;
  text: string;
  tokens: string[];
  tokenIndices: number[];
}
interface ScriptToken {
  token: string;
  sentenceIndex: number;
}
interface TranscriptToken {
  token: string;
  word: WordTimestamp;
}
interface AlignmentResult {
  transcriptIndexByScript: Array<number | null>;
  scoreByScript: number[];
  matchedTokenCount: number;
  averageConfidence: number;
}
const SCRIPT_MIN_WORDS = 2;
const GAP_SCRIPT_PENALTY = -1.2;
const GAP_TRANSCRIPT_PENALTY = -0.3;
const SCORE_MATCH = 2.0;
const SCORE_SIMILAR = 1.0;
const SCORE_MISMATCH = -0.8;
const MAX_TOKEN_GAP = 3;
const MIN_DENSITY = 0.4;
const MIN_COVERAGE_SHORT = 0.8;
const MIN_COVERAGE_LONG = 0.55;
const PRE_PAD_MS = 150;
const POST_PAD_MS = 150;
function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
function normalizeToken(token: string): string {
  return normalizeText(token);
}
function removeArtifacts(text: string): string {
  return text
    .replace(/\[BLANK_AUDIO\]/gi, '')
    .replace(/\[blank_audio\]/gi, '')
    .replace(/\[.*?\]/g, '')
    .trim();
}
function tokenize(text: string): string[] {
  const normalized = normalizeText(text);
  if (!normalized) return [];
  return normalized.split(' ').filter(Boolean);
}
function splitScriptSentences(scriptContent: string): ScriptSentence[] {
  const normalized = scriptContent.replace(/\r\n/g, '\n').trim();
  const rawSentences = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentences: ScriptSentence[] = [];

  for (const sentence of rawSentences) {
    const tokens = tokenize(sentence);
    if (tokens.length < SCRIPT_MIN_WORDS) {
      continue;
    }
    sentences.push({
      index: sentences.length,
      text: sentence,
      tokens,
      tokenIndices: [],
    });
  }
  return sentences;
}

function buildScriptTokens(sentences: ScriptSentence[]): ScriptToken[] {
  const tokens: ScriptToken[] = [];
  for (const sentence of sentences) {
    sentence.tokenIndices = [];
    for (const token of sentence.tokens) {
      sentence.tokenIndices.push(tokens.length);
      tokens.push({ token, sentenceIndex: sentence.index });
    }
  }
  return tokens;
}
function buildTranscriptTokens(words: WordTimestamp[]): TranscriptToken[] {
  const tokens: TranscriptToken[] = [];
  for (const word of words) {
    const cleaned = removeArtifacts(word.word);
    const token = normalizeToken(cleaned);
    if (!token) continue;
    tokens.push({ token, word });
  }
  return tokens;
}
function levenshteinDistance(a: string, b: string, maxDistance: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDistance) return maxDistance + 1;

  const prev = new Array(b.length + 1).fill(0);
  const curr = new Array(b.length + 1).fill(0);

  for (let j = 0; j <= b.length; j += 1) prev[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const del = prev[j] + 1;
      const ins = curr[j - 1] + 1;
      const sub = prev[j - 1] + cost;
      const value = Math.min(del, ins, sub);
      curr[j] = value;
      rowMin = Math.min(rowMin, value);
    }
    if (rowMin > maxDistance) return maxDistance + 1;
    for (let j = 0; j <= b.length; j += 1) prev[j] = curr[j];
  }

  return prev[b.length];
}
function isSimilarToken(a: string, b: string): boolean {
  if (!a || !b) return false;
  const maxDistance = a.length <= 4 && b.length <= 4 ? 1 : 2;
  return levenshteinDistance(a, b, maxDistance) <= maxDistance;
}
function tokenMatchScore(scriptToken: string, transcriptToken: string, confidence: number): number {
  const boost = Math.max(0, Math.min(0.5, confidence - 0.6));
  if (scriptToken === transcriptToken) {
    return SCORE_MATCH + boost;
  }
  if (isSimilarToken(scriptToken, transcriptToken)) {
    return SCORE_SIMILAR + boost * 0.5;
  }
  return SCORE_MISMATCH;
}
function alignScriptTokens(
  scriptTokens: ScriptToken[],
  transcriptTokens: TranscriptToken[]
): AlignmentResult {
  const scriptCount = scriptTokens.length;
  const transcriptCount = transcriptTokens.length;

  const dp: Float64Array[] = Array.from(
    { length: scriptCount + 1 },
    () => new Float64Array(transcriptCount + 1)
  );
  const trace: Uint8Array[] = Array.from(
    { length: scriptCount + 1 },
    () => new Uint8Array(transcriptCount + 1)
  );

  for (let i = 1; i <= scriptCount; i += 1) {
    const row = dp[i];
    const prevRow = dp[i - 1];
    const traceRow = trace[i];
    if (!row || !prevRow || !traceRow) continue;
    row[0] = (prevRow[0] ?? 0) + GAP_SCRIPT_PENALTY;
    traceRow[0] = 2;
  }
  {
    const row = dp[0]!;
    const traceRow = trace[0]!;
    for (let j = 1; j <= transcriptCount; j += 1) {
      row[j] = 0;
      traceRow[j] = 3;
    }
  }

  for (let i = 1; i <= scriptCount; i += 1) {
    const scriptToken = scriptTokens[i - 1]?.token ?? '';
    const row = dp[i];
    const prevRow = dp[i - 1];
    const traceRow = trace[i];
    if (!row || !prevRow || !traceRow) continue;
    for (let j = 1; j <= transcriptCount; j += 1) {
      const transcriptToken = transcriptTokens[j - 1]?.token ?? '';
      const confidence = transcriptTokens[j - 1]?.word.confidence ?? 1;
      const match = tokenMatchScore(scriptToken, transcriptToken, confidence);

      const diag = (prevRow[j - 1] ?? 0) + match;
      const up = (prevRow[j] ?? 0) + GAP_SCRIPT_PENALTY;
      const left = (row[j - 1] ?? 0) + GAP_TRANSCRIPT_PENALTY;

      let best = diag;
      let dir = 1;
      if (left > best || (left === best && dir !== 1)) {
        best = left;
        dir = 3;
      }
      if (up > best) {
        best = up;
        dir = 2;
      }

      row[j] = best;
      traceRow[j] = dir;
    }
  }

  let endJ = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  const lastRow = dp[scriptCount]!;
  for (let j = 0; j <= transcriptCount; j += 1) {
    const score = lastRow[j] ?? Number.NEGATIVE_INFINITY;
    if (score > bestScore) {
      bestScore = score;
      endJ = j;
    }
  }

  const transcriptIndexByScript = new Array<number | null>(scriptCount).fill(null);
  const scoreByScript = new Array<number>(scriptCount).fill(0);

  let i = scriptCount;
  let j = endJ;
  while (i > 0 || j > 0) {
    if (i === 0) {
      j -= 1;
      continue;
    }
    if (j === 0) {
      i -= 1;
      continue;
    }
    const dir = trace[i]?.[j] ?? 0;
    if (dir === 1) {
      const transcriptToken = transcriptTokens[j - 1];
      const scriptToken = scriptTokens[i - 1];
      if (transcriptToken && scriptToken) {
        const matchScore = tokenMatchScore(
          scriptToken.token,
          transcriptToken.token,
          transcriptToken.word.confidence
        );
        transcriptIndexByScript[i - 1] = j - 1;
        scoreByScript[i - 1] = matchScore;
      }
      i -= 1;
      j -= 1;
    } else if (dir === 2) {
      i -= 1;
    } else {
      j -= 1;
    }
  }

  let matchedTokenCount = 0;
  let confidenceSum = 0;
  for (let k = 0; k < transcriptIndexByScript.length; k += 1) {
    const index = transcriptIndexByScript[k];
    if (typeof index !== 'number') continue;
    const score = scoreByScript[k] ?? 0;
    if (score <= 0) continue;
    matchedTokenCount += 1;
    confidenceSum += transcriptTokens[index]?.word.confidence ?? 1;
  }

  const averageConfidence = matchedTokenCount > 0 ? confidenceSum / matchedTokenCount : 0;

  return {
    transcriptIndexByScript,
    scoreByScript,
    matchedTokenCount,
    averageConfidence,
  };
}

function selectSentenceCluster(
  sentence: ScriptSentence,
  transcriptTokens: TranscriptToken[],
  alignment: AlignmentResult
): { startMs: number; endMs: number; coverage: number } | null {
  const matched: Array<{ transcriptIndex: number; score: number; confidence: number }> = [];

  for (const scriptIndex of sentence.tokenIndices) {
    const transcriptIndex = alignment.transcriptIndexByScript[scriptIndex];
    if (typeof transcriptIndex !== 'number') continue;
    const score = alignment.scoreByScript[scriptIndex] ?? 0;
    if (score <= 0) continue;
    const transcriptToken = transcriptTokens[transcriptIndex];
    if (!transcriptToken) continue;
    matched.push({
      transcriptIndex,
      score,
      confidence: transcriptToken.word.confidence ?? 1,
    });
  }

  if (matched.length === 0) {
    return null;
  }

  matched.sort((a, b) => a.transcriptIndex - b.transcriptIndex);
  const clusters: Array<{ indices: number[]; scoreSum: number; confidenceSum: number }> = [];

  let current = {
    indices: [matched[0]!.transcriptIndex],
    scoreSum: matched[0]!.score,
    confidenceSum: matched[0]!.confidence,
  };

  for (let i = 1; i < matched.length; i += 1) {
    const prev = matched[i - 1]!;
    const next = matched[i]!;
    if (next.transcriptIndex - prev.transcriptIndex <= MAX_TOKEN_GAP) {
      current.indices.push(next.transcriptIndex);
      current.scoreSum += next.score;
      current.confidenceSum += next.confidence;
    } else {
      clusters.push(current);
      current = {
        indices: [next.transcriptIndex],
        scoreSum: next.score,
        confidenceSum: next.confidence,
      };
    }
  }
  clusters.push(current);

  const sentenceTokenCount = sentence.tokens.length;
  const minCoverage = sentenceTokenCount <= 3 ? MIN_COVERAGE_SHORT : MIN_COVERAGE_LONG;
  const minMatches = sentenceTokenCount <= 3 ? sentenceTokenCount : Math.max(2, Math.floor(sentenceTokenCount * 0.5));

  const ranked = clusters
    .map((cluster) => {
      const minIndex = Math.min(...cluster.indices);
      const maxIndex = Math.max(...cluster.indices);
      const matchedCount = cluster.indices.length;
      const spanTokens = maxIndex - minIndex + 1;
      const coverage = matchedCount / sentenceTokenCount;
      const density = matchedCount / spanTokens;
      const avgConfidence = cluster.confidenceSum / matchedCount;

      return {
        minIndex,
        maxIndex,
        coverage,
        density,
        avgConfidence,
        scoreSum: cluster.scoreSum,
      };
    })
    .filter((cluster) => cluster.coverage >= minCoverage && cluster.density >= MIN_DENSITY)
    .filter((cluster) => cluster.coverage * sentenceTokenCount >= minMatches)
    .sort((a, b) => {
      if (b.coverage !== a.coverage) return b.coverage - a.coverage;
      if (b.density !== a.density) return b.density - a.density;
      if (b.avgConfidence !== a.avgConfidence) return b.avgConfidence - a.avgConfidence;
      return b.scoreSum - a.scoreSum;
    });

  const best = ranked[0];
  if (!best) return null;

  const startWord = transcriptTokens[best.minIndex]?.word;
  const endWord = transcriptTokens[best.maxIndex]?.word;
  if (!startWord || !endWord) return null;

  const startMs = Math.max(0, startWord.startMs - PRE_PAD_MS);
  const endMs = endWord.endMs + POST_PAD_MS;

  return { startMs, endMs, coverage: best.coverage };
}

function mergeSegments(segments: KeepSegment[], maxGapMs = 200): KeepSegment[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const merged: KeepSegment[] = [];

  let current = { ...sorted[0]! };
  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i]!;
    if (next.startMs <= current.endMs + maxGapMs) {
      current.endMs = Math.max(current.endMs, next.endMs);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }
  merged.push(current);
  return merged;
}

function buildMatchedTokenSegments(
  transcriptTokens: TranscriptToken[],
  alignment: AlignmentResult
): KeepSegment[] {
  if (transcriptTokens.length === 0) return [];

  const matchedIndices: number[] = [];

  for (let i = 0; i < alignment.transcriptIndexByScript.length; i += 1) {
    const transcriptIndex = alignment.transcriptIndexByScript[i];
    const score = alignment.scoreByScript[i] ?? 0;
    if (typeof transcriptIndex !== 'number') continue;
    if (score <= 0) continue;
    matchedIndices.push(transcriptIndex);
  }

  if (matchedIndices.length === 0) return [];

  const uniqueSorted = Array.from(new Set(matchedIndices)).sort((a, b) => a - b);

  const segments: KeepSegment[] = [];
  let startIndex = uniqueSorted[0]!;
  let prevIndex = uniqueSorted[0]!;

  for (let i = 1; i < uniqueSorted.length; i += 1) {
    const index = uniqueSorted[i]!;
    if (index === prevIndex + 1) {
      prevIndex = index;
      continue;
    }

    const startWord = transcriptTokens[startIndex]?.word;
    const endWord = transcriptTokens[prevIndex]?.word;
    if (startWord && endWord) {
      segments.push({
        startMs: Math.max(0, startWord.startMs - PRE_PAD_MS),
        endMs: endWord.endMs + POST_PAD_MS,
      });
    }

    startIndex = index;
    prevIndex = index;
  }

  const finalStartWord = transcriptTokens[startIndex]?.word;
  const finalEndWord = transcriptTokens[prevIndex]?.word;
  if (finalStartWord && finalEndWord) {
    segments.push({
      startMs: Math.max(0, finalStartWord.startMs - PRE_PAD_MS),
      endMs: finalEndWord.endMs + POST_PAD_MS,
    });
  }

  return segments;
}

export async function findScriptAlignedSegments(
  scriptContent: string | null | undefined,
  words: WordTimestamp[],
  logger = sharedLogger
): Promise<{ keepSegments: KeepSegment[]; stats: ScriptAlignmentStats } | null> {
  if (!scriptContent || words.length === 0) return null;

  const cleanedWords = words.filter((w) => {
    const cleaned = removeArtifacts(w.word);
    return cleaned.length > 0;
  });

  if (cleanedWords.length === 0) {
    logger.warn('No words remaining after artifact removal');
    return null;
  }

  const artifactsRemoved = words.length - cleanedWords.length;
  const sentences = splitScriptSentences(scriptContent);
  if (sentences.length === 0) return null;

  const scriptTokens = buildScriptTokens(sentences);
  const transcriptTokens = buildTranscriptTokens(cleanedWords);
  if (scriptTokens.length === 0 || transcriptTokens.length === 0) return null;

  const alignment = alignScriptTokens(scriptTokens, transcriptTokens);

  const keepSegments: KeepSegment[] = [];
  const sentenceCoverages: number[] = [];
  let matchedSentenceCount = 0;

  for (const sentence of sentences) {
    const match = selectSentenceCluster(sentence, transcriptTokens, alignment);
    if (!match) continue;
    sentenceCoverages.push(match.coverage);
    matchedSentenceCount += 1;
  }

  const matchedTokenSegments = buildMatchedTokenSegments(transcriptTokens, alignment);

  keepSegments.push(...matchedTokenSegments);

  if (keepSegments.length === 0) {
    logger.warn('Script alignment produced no keep segments');
    return null;
  }

  const mergedKeepSegments = mergeSegments(keepSegments);
  const averageBestScore =
    sentenceCoverages.length > 0
      ? sentenceCoverages.reduce((sum, val) => sum + val, 0) / sentenceCoverages.length
      : 0;

  const stats: ScriptAlignmentStats = {
    sentenceCount: sentences.length,
    matchedCount: matchedSentenceCount,
    usedLlm: false,
    averageBestScore: Number(averageBestScore.toFixed(3)),
    keptSegmentCount: mergedKeepSegments.length,
    repeatedSentencesDetected: 0,
    artifactsRemoved,
    scriptTokenCount: scriptTokens.length,
    matchedTokenCount: alignment.matchedTokenCount,
    tokenCoverage: scriptTokens.length > 0 ? alignment.matchedTokenCount / scriptTokens.length : 0,
    avgConfidence: Number(alignment.averageConfidence.toFixed(3)),
  };

  const minMatched = Math.max(2, Math.floor(sentences.length * 0.3));
  if (matchedSentenceCount < minMatched) {
    logger.warn('Script alignment match coverage too low, falling back to silence cleanup', {
      sentenceCount: sentences.length,
      matchedCount: matchedSentenceCount,
      averageBestScore: stats.averageBestScore,
      minRequired: minMatched,
    });
    return null;
  }

  logger.info('Script alignment V2 complete', {
    ...stats,
    coverage: `${((matchedSentenceCount / sentences.length) * 100).toFixed(1)}%`,
  });

  return { keepSegments: mergedKeepSegments, stats };
}
