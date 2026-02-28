/**
 * Script Alignment Service (LLM-based)
 *
 * Aligns a script to a noisy transcript and returns timestamp ranges to keep.
 * Uses LLM to select best take per sentence when repeats exist; falls back to heuristic.
 */

import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { supportsOpenAiTemperature } from './openaiModelSupport.js';
import { config } from '../config.js';
import { logger as sharedLogger } from '@webl/shared';
import { usageService } from './usage.js';

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
}

interface ScriptSentence {
  index: number;
  text: string;
  tokens: string[];
}

interface TranscriptSegment {
  index: number;
  startMs: number;
  endMs: number;
  wordStartIndex: number;
  wordEndIndex: number;
  text: string;
  tokens: string[];
  normalizedText: string;
}

interface CandidateMatch {
  segmentIndex: number;
  score: number;
  normalizedText: string;
  tokenCount: number;
  lengthRatio: number;
}

interface LlmMatch {
  sentenceIndex: number;
  segmentIndex: number | null;
  confidence: number;
  reason?: string;
}

interface RepeatedSegmentGroup {
  normalizedText: string;
  segments: TranscriptSegment[];
}

const GAP_SPLIT_MS = 700;
const MAX_SEGMENT_WORDS = 30;
const MAX_SEGMENT_DURATION_MS = 15000;
const DEFAULT_MAX_CANDIDATES = 5;
const MIN_CANDIDATE_SCORE = 0.2;
const MIN_CANDIDATE_LENGTH_RATIO_SHORT = 0.75;
const MIN_CANDIDATE_LENGTH_RATIO_LONG = 0.6;
const AMBIGUOUS_MATCH_SCORE = 0.75;
const AMBIGUOUS_MATCH_MIN_SENTENCES = 2;
const AMBIGUOUS_MATCH_RATIO = 0.2;
const MAX_SENTENCES_PER_BATCH = 12;
const MAX_SENTENCES_TOTAL = 100;
const MIN_REPEAT_SEGMENT_TOKENS = 3;
const MIN_REPEAT_SIMILARITY = 0.92;
const MIN_REPEAT_LENGTH_RATIO = 0.8;
const MERGE_MAX_GAP_MS = 200;
const HEURISTIC_HOLE_FILL_MIN_SCORE = 0.3;

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
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
  const scriptMinWords = config.voiceover.takeSelection.scriptMinWords ?? 2;
  const normalized = scriptContent.replace(/\r\n/g, '\n').trim();
  const rawSentences = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentences: ScriptSentence[] = [];
  let index = 0;

  for (const sentence of rawSentences) {
    const tokens = tokenize(sentence);
    if (tokens.length < scriptMinWords) continue;
    sentences.push({ index, text: sentence, tokens });
    index += 1;
  }

  return sentences;
}

function buildTranscriptSegments(words: WordTimestamp[]): TranscriptSegment[] {
  if (words.length === 0) return [];

  const segments: TranscriptSegment[] = [];
  let segmentStartIndex = 0;
  const firstWord = words[0];
  if (!firstWord) return [];
  let segmentStartMs = firstWord.startMs;

  for (let i = 1; i < words.length; i += 1) {
    const prev = words[i - 1];
    const current = words[i];
    if (!prev || !current) continue;

    const gapMs = current.startMs - prev.endMs;
    const wordCount = i - segmentStartIndex;
    const durationMs = prev.endMs - segmentStartMs;

    const shouldSplit =
      gapMs >= GAP_SPLIT_MS ||
      wordCount >= MAX_SEGMENT_WORDS ||
      durationMs >= MAX_SEGMENT_DURATION_MS;

    if (shouldSplit) {
      const segmentWords = words.slice(segmentStartIndex, i);
      if (segmentWords.length > 0) {
        segments.push(buildSegment(segmentWords, segmentStartIndex, i - 1));
      }
      segmentStartIndex = i;
      segmentStartMs = current.startMs;
    }
  }

  const lastSegmentWords = words.slice(segmentStartIndex);
  if (lastSegmentWords.length > 0) {
    segments.push(buildSegment(lastSegmentWords, segmentStartIndex, words.length - 1));
  }

  return segments.map((segment, index) => ({ ...segment, index }));
}

function buildSegment(
  segmentWords: WordTimestamp[],
  wordStartIndex: number,
  wordEndIndex: number
): TranscriptSegment {
  const text = segmentWords.map((w) => w.word).join(' ');
  const cleanedText = removeArtifacts(text);
  const tokens = tokenize(cleanedText);
  const normalizedText = normalizeText(cleanedText);
  return {
    index: 0,
    startMs: segmentWords[0]?.startMs ?? 0,
    endMs: segmentWords[segmentWords.length - 1]?.endMs ?? 0,
    wordStartIndex,
    wordEndIndex,
    text: cleanedText,
    tokens,
    normalizedText,
  };
}

function scoreTokenOverlap(aTokens: string[], bTokens: string[]): number {
  if (aTokens.length === 0 || bTokens.length === 0) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  for (const token of aSet) {
    if (bSet.has(token)) overlap += 1;
  }
  return (2 * overlap) / (aSet.size + bSet.size);
}

function detectRepeatedSegments(segments: TranscriptSegment[]): RepeatedSegmentGroup[] {
  const groups = new Map<string, TranscriptSegment[]>();

  for (const segment of segments) {
    const key = segment.normalizedText;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(segment);
  }

  const repeatedGroups: RepeatedSegmentGroup[] = [];
  for (const [normalizedText, segmentList] of groups.entries()) {
    if (segmentList.length >= 2 && normalizedText.length > 10) {
      repeatedGroups.push({
        normalizedText,
        segments: segmentList,
      });
    }
  }

  if (repeatedGroups.length > 0) return repeatedGroups;

  const used = new Set<number>();
  const fuzzyGroups: RepeatedSegmentGroup[] = [];

  for (let i = 0; i < segments.length; i += 1) {
    if (used.has(i)) continue;
    const base = segments[i];
    if (!base) continue;
    if (base.tokens.length < MIN_REPEAT_SEGMENT_TOKENS) continue;
    if (base.normalizedText.length <= 10) continue;

    const groupSegments: TranscriptSegment[] = [base];

    for (let j = i + 1; j < segments.length; j += 1) {
      if (used.has(j)) continue;
      const other = segments[j];
      if (!other) continue;
      if (other.tokens.length < MIN_REPEAT_SEGMENT_TOKENS) continue;
      if (other.normalizedText.length <= 10) continue;

      const lengthRatio =
        Math.min(base.tokens.length, other.tokens.length) /
        Math.max(base.tokens.length, other.tokens.length);
      if (lengthRatio < MIN_REPEAT_LENGTH_RATIO) continue;

      const similarity = scoreTokenOverlap(base.tokens, other.tokens);
      if (similarity >= MIN_REPEAT_SIMILARITY) {
        groupSegments.push(other);
      }
    }

    if (groupSegments.length >= 2) {
      for (const seg of groupSegments) {
        used.add(seg.index);
      }
      fuzzyGroups.push({ normalizedText: base.normalizedText, segments: groupSegments });
    }
  }

  return fuzzyGroups;
}

function buildCandidates(
  sentences: ScriptSentence[],
  segments: TranscriptSegment[]
): Map<number, CandidateMatch[]> {
  const candidateMap = new Map<number, CandidateMatch[]>();

  for (const sentence of sentences) {
    const scores: CandidateMatch[] = [];
    const sentenceTokenCount = sentence.tokens.length;
    const minLengthRatio =
      sentenceTokenCount <= 5 ? MIN_CANDIDATE_LENGTH_RATIO_SHORT : MIN_CANDIDATE_LENGTH_RATIO_LONG;
    for (const segment of segments) {
      const lengthRatio = sentenceTokenCount > 0 ? segment.tokens.length / sentenceTokenCount : 0;
      if (lengthRatio < minLengthRatio) continue;
      const score = scoreTokenOverlap(sentence.tokens, segment.tokens);
      if (score >= MIN_CANDIDATE_SCORE) {
        scores.push({
          segmentIndex: segment.index,
          score,
          normalizedText: segment.normalizedText,
          tokenCount: segment.tokens.length,
          lengthRatio,
        });
      }
    }
    scores.sort((a, b) => b.score - a.score);
    const maxCandidates = Math.max(
      1,
      config.voiceover.takeSelection.maxCandidates || DEFAULT_MAX_CANDIDATES
    );
    candidateMap.set(sentence.index, scores.slice(0, maxCandidates));
  }

  return candidateMap;
}

function averageBestScore(candidateMap: Map<number, CandidateMatch[]>): number {
  const scores: number[] = [];
  for (const matches of candidateMap.values()) {
    if (matches[0]) scores.push(matches[0].score);
  }
  if (scores.length === 0) return 0;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

function selectHeuristicCandidate(
  matches: CandidateMatch[],
  maxSegmentIndex: number,
  preferLatest: boolean
): CandidateMatch | undefined {
  if (matches.length === 0) return undefined;

  let best: CandidateMatch | undefined;
  let bestComposite = -Infinity;
  const denominator = Math.max(1, maxSegmentIndex);

  for (const candidate of matches) {
    const recency = candidate.segmentIndex / denominator;
    const completeness = Math.max(0, Math.min(1.2, candidate.lengthRatio));
    let composite = candidate.score * 0.78 + completeness * 0.17;
    composite += recency * (preferLatest ? 0.12 : 0.05);
    if (candidate.lengthRatio < 0.6) {
      composite -= 0.08;
    }

    if (composite > bestComposite) {
      bestComposite = composite;
      best = candidate;
    }
  }

  return best;
}

function parseAIJsonResponse<T>(text: string): T {
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  return JSON.parse(cleaned);
}

async function callAlignmentLlm(
  userId: string,
  sentences: ScriptSentence[],
  segments: TranscriptSegment[],
  candidateMap: Map<number, CandidateMatch[]>,
  repeatedGroups: RepeatedSegmentGroup[],
  logger = sharedLogger
): Promise<LlmMatch[]> {
  const provider = config.ai.provider;

  if (provider === 'gemini' && !config.ai.geminiApiKey) {
    return [];
  }
  if (provider === 'openai' && !config.openai.apiKey) {
    return [];
  }

  const repeatedContext = repeatedGroups.map((group) => ({
    text: group.normalizedText.slice(0, 100),
    count: group.segments.length,
    segmentIndices: group.segments.map((s) => s.index),
    timestamps: group.segments.map((s) => ({
      segmentIndex: s.index,
      startMs: s.startMs,
      endMs: s.endMs,
      text: s.text.slice(0, 150),
    })),
  }));

  const candidatesForPrompt = sentences.map((sentence) => {
    const matches = candidateMap.get(sentence.index) || [];
    return {
      sentenceIndex: sentence.index,
      sentence: sentence.text,
      candidates: matches
        .map((match) => {
          const segment = segments.find((s) => s.index === match.segmentIndex);
          if (!segment) return null;

          const isRepeated = repeatedGroups.some((group) =>
            group.segments.some((s) => s.index === segment.index)
          );

          return {
            segmentIndex: segment.index,
            startMs: segment.startMs,
            endMs: segment.endMs,
            text: segment.text.slice(0, 250),
            normalizedText: segment.normalizedText.slice(0, 200),
            score: Number(match.score.toFixed(3)),
            tokenCount: match.tokenCount,
            lengthRatio: Number(match.lengthRatio.toFixed(2)),
            isRepeated,
          };
        })
        .filter(Boolean),
    };
  });

  const llmConfidenceThreshold = config.voiceover.takeSelection.llmConfidenceThreshold ?? 0.5;

  const prompt = `You are aligning a clean script to a noisy transcript that may contain repeated sentences.

Your task:
1. For each script sentence, pick the BEST matching transcript segment from the candidates
2. For each sentence, segmentIndex MUST be exactly one of the segmentIndex values in that sentence's candidates array. Do not use a segmentIndex from another sentence or invent an index.
3. If a sentence appears multiple times in the transcript (repeated), choose the latest complete take that matches script meaning
4. If no candidate is a good match, return null for that sentence
5. Skip candidates that are partial, cut off, or clearly incomplete takes

IMPORTANT:
- segmentIndex must come from the candidates for that sentence only
- Confidence 0.5–1.0: ${llmConfidenceThreshold}+ is acceptable when the transcript is already script-aligned; use 0.8+ for ambiguous or repeated takes
- Prefer exact meaning matches over partial matches
- Prefer candidates with lengthRatio near 1.0 (complete takes)
- In false-start patterns ("I always... uh... I always need..."), prefer the final fluent completion, not the early restart

Repeated segments detected in transcript:
${JSON.stringify(repeatedContext, null, 2)}

Script sentences and their candidate matches:
${JSON.stringify(candidatesForPrompt, null, 2)}

Return JSON only in this exact shape (segmentIndex must be one of the candidate segmentIndex values for that sentence):
{
  "matches": [
    {"sentenceIndex": 0, "segmentIndex": 0, "confidence": 0.85, "reason": "Best match"},
    {"sentenceIndex": 1, "segmentIndex": null, "confidence": 0.2, "reason": "No good match found"}
  ]
}

Rules:
- Only choose from the provided candidates for each sentence
- Confidence is 0.0 to 1.0
- Provide a brief reason for your choice`;

  try {
    if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: config.voiceover.models.call2 || config.ai.geminiModel,
        generationConfig: { responseMimeType: 'application/json' },
      });
      await usageService.recordUsage(userId, {
        geminiCalls: 1,
        scriptAlignmentLlmCalls: 1,
      });
      const response = await model.generateContent(prompt);
      const text = response.response.text();
      const parsed = parseAIJsonResponse<{ matches: LlmMatch[] }>(text);
      logger.info(
        `LLM alignment returned ${parsed.matches?.length || 0} matches for ${sentences.length} sentences`
      );
      return parsed.matches || [];
    }

    const client = new OpenAI({ apiKey: config.openai.apiKey });
    await usageService.recordUsage(userId, {
      openAiChatCalls: 1,
      scriptAlignmentLlmCalls: 1,
    });
    const temperature = supportsOpenAiTemperature(config.voiceover.models.call2, null) ? 0.3 : undefined;
    const response = await client.chat.completions.create({
      model: config.voiceover.models.call2,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You are an expert at aligning scripts to transcripts. Return JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      ...(temperature !== undefined ? { temperature } : {}),
    });
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = parseAIJsonResponse<{ matches: LlmMatch[] }>(content);
    logger.info(
      `LLM alignment returned ${parsed.matches?.length || 0} matches for ${sentences.length} sentences`
    );
    return parsed.matches || [];
  } catch (error) {
    logger.error('LLM alignment failed', error);
    return [];
  }
}

function mergeSegments(segments: KeepSegment[], maxGapMs = MERGE_MAX_GAP_MS): KeepSegment[] {
  if (segments.length === 0) return [];
  const sorted = [...segments].sort((a, b) => a.startMs - b.startMs);
  const merged: KeepSegment[] = [];
  const first = sorted[0];
  if (!first) return [];
  let current: KeepSegment = { startMs: first.startMs, endMs: first.endMs };

  for (let i = 1; i < sorted.length; i += 1) {
    const next = sorted[i];
    if (!next) continue;
    if (next.startMs <= current.endMs + maxGapMs) {
      current.endMs = Math.max(current.endMs, next.endMs);
    } else {
      merged.push({ startMs: current.startMs, endMs: current.endMs });
      current = { startMs: next.startMs, endMs: next.endMs };
    }
  }
  merged.push({ startMs: current.startMs, endMs: current.endMs });
  return merged;
}

export async function findScriptAlignedSegments(
  scriptContent: string | null | undefined,
  words: WordTimestamp[],
  userId: string,
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
  if (artifactsRemoved > 0) {
    logger.info(`Removed ${artifactsRemoved} artifact words (e.g., [BLANK_AUDIO])`);
  }

  const sentences = splitScriptSentences(scriptContent);
  if (sentences.length === 0) return null;

  const segments = buildTranscriptSegments(cleanedWords);
  if (segments.length === 0) return null;

  const repeatedGroups = detectRepeatedSegments(segments);
  const repeatedCount = repeatedGroups.reduce((sum, group) => sum + group.segments.length - 1, 0);

  if (repeatedGroups.length > 0) {
    logger.info(
      `Detected ${repeatedGroups.length} repeated sentence groups (${repeatedCount} total repetitions)`
    );
  }

  const candidateMap = buildCandidates(sentences, segments);
  const avgBest = averageBestScore(candidateMap);
  const ambiguousSentences = [...candidateMap.values()].filter((matches) => {
    const strongMatches = matches.filter((match) => match.score >= AMBIGUOUS_MATCH_SCORE);
    return strongMatches.length >= 2;
  }).length;
  const ambiguousThreshold = Math.max(
    AMBIGUOUS_MATCH_MIN_SENTENCES,
    Math.floor(sentences.length * AMBIGUOUS_MATCH_RATIO)
  );
  const hasAmbiguousMatches = ambiguousSentences >= ambiguousThreshold;
  const nearTieSentences = [...candidateMap.values()].filter((matches) => {
    if (matches.length < 2) return false;
    const first = matches[0];
    const second = matches[1];
    if (!first || !second) return false;
    return first.score - second.score <= 0.12;
  }).length;
  const hasNearTieMatches = nearTieSentences > 0;

  const hasGemini = config.ai.provider === 'gemini' && !!config.ai.geminiApiKey;
  const hasOpenai = config.ai.provider === 'openai' && !!config.openai.apiKey;
  const canUseLlm = hasGemini || hasOpenai;

  const shouldUseLlm =
    canUseLlm &&
    (repeatedGroups.length > 0 || avgBest < 0.85 || hasAmbiguousMatches || hasNearTieMatches) &&
    sentences.length <= MAX_SENTENCES_TOTAL;

  const llmMinCandidateScore = config.voiceover.takeSelection.llmMinCandidateScore ?? 0.35;
  const llmConfidenceThreshold = config.voiceover.takeSelection.llmConfidenceThreshold ?? 0.5;
  const heuristicKeepScore = config.voiceover.takeSelection.heuristicKeepScore ?? 0.5;

  const chosen: Map<number, number> = new Map();
  let usedLlm = false;
  let totalLlmMatchesReturned = 0;
  const rejectionReasons: { notInCandidates: number; scoreLow: number; confidenceLow: number } = {
    notInCandidates: 0,
    scoreLow: 0,
    confidenceLow: 0,
  };
  const borderlineMatches: Array<{
    sentenceIndex: number;
    segmentIndex: number;
    score: number;
    confidence: number;
  }> = [];

  if (shouldUseLlm) {
    usedLlm = true;
    logger.info(
      `Using LLM for alignment (repeated groups: ${repeatedGroups.length}, ` +
        `avg score: ${avgBest.toFixed(3)}, ambiguous sentences: ${ambiguousSentences}, near-tie sentences: ${nearTieSentences})`
    );

    const batches: ScriptSentence[][] = [];
    let current: ScriptSentence[] = [];

    for (const sentence of sentences) {
      const matches = candidateMap.get(sentence.index) || [];
      if (matches.length === 0) continue;
      current.push(sentence);

      if (current.length >= MAX_SENTENCES_PER_BATCH) {
        batches.push(current);
        current = [];
      }
    }
    if (current.length > 0) batches.push(current);

    logger.info(`Processing ${batches.length} batches of sentences`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      if (!batch || batch.length === 0) continue;

      const llmMatches = await callAlignmentLlm(
        userId,
        batch,
        segments,
        candidateMap,
        repeatedGroups,
        logger
      );
      totalLlmMatchesReturned += llmMatches?.length ?? 0;

      for (const match of llmMatches ?? []) {
        if (match.segmentIndex === null) continue;
        const candidates = candidateMap.get(match.sentenceIndex) || [];
        const chosenCandidate = candidates.find(
          (candidate) => candidate.segmentIndex === match.segmentIndex
        );
        if (!chosenCandidate) {
          rejectionReasons.notInCandidates += 1;
          logger.info(
            `Take selection: rejecting match for sentence ${match.sentenceIndex} (reason: not_in_candidates, segmentIndex ${match.segmentIndex} not in candidates)`
          );
          continue;
        }
        if (chosenCandidate.score < llmMinCandidateScore) {
          rejectionReasons.scoreLow += 1;
          const borderlineScoreFloor = Math.max(0, llmMinCandidateScore - 0.08);
          if (
            chosenCandidate.score >= borderlineScoreFloor &&
            match.confidence >= llmConfidenceThreshold
          ) {
            borderlineMatches.push({
              sentenceIndex: match.sentenceIndex,
              segmentIndex: match.segmentIndex,
              score: chosenCandidate.score,
              confidence: match.confidence,
            });
          }
          logger.info(
            `Take selection: rejecting match for sentence ${match.sentenceIndex} (reason: score_below_threshold, score ${chosenCandidate.score.toFixed(2)} < ${llmMinCandidateScore})`
          );
          continue;
        }
        if (match.confidence < llmConfidenceThreshold) {
          rejectionReasons.confidenceLow += 1;
          logger.info(
            `Take selection: rejecting match for sentence ${match.sentenceIndex} (reason: confidence_below_threshold, confidence ${match.confidence.toFixed(2)} < ${llmConfidenceThreshold})`
          );
          continue;
        }
        chosen.set(match.sentenceIndex, match.segmentIndex);
        if (match.reason) {
          logger.debug(
            `Matched sentence ${match.sentenceIndex} to segment ${match.segmentIndex}: ${match.reason}`
          );
        }
      }
    }

    if (borderlineMatches.length > 0) {
      for (const candidate of borderlineMatches) {
        if (chosen.has(candidate.sentenceIndex)) continue;
        chosen.set(candidate.sentenceIndex, candidate.segmentIndex);
      }
      logger.info(
        `Take selection: accepted ${borderlineMatches.length} borderline matches to avoid sentence holes`
      );
    }

    const accepted = chosen.size;
    logger.info(
      `Take selection: ${totalLlmMatchesReturned} matches returned, ${accepted} accepted. Rejection reasons: not_in_candidates=${rejectionReasons.notInCandidates}, score_below_threshold=${rejectionReasons.scoreLow}, confidence_below_threshold=${rejectionReasons.confidenceLow}`
    );
  }

  const fallbackMode = chosen.size === 0 || chosen.size < sentences.length * 0.3;
  if (fallbackMode) {
    logger.info(
      `Using heuristic fallback (LLM matches: ${chosen.size}, sentences: ${sentences.length})`
    );
  }

  const preferLatestInHeuristic = repeatedGroups.length > 0 || hasNearTieMatches;
  const maxSegmentIndex = segments[segments.length - 1]?.index ?? 0;
  let heuristicRecovered = 0;

  for (const sentence of sentences) {
    if (chosen.has(sentence.index)) continue;
    const matches = candidateMap.get(sentence.index) || [];
    const best = selectHeuristicCandidate(matches, maxSegmentIndex, preferLatestInHeuristic);
    if (!best) continue;

    const minScore = fallbackMode ? heuristicKeepScore : HEURISTIC_HOLE_FILL_MIN_SCORE;
    if (best.score < minScore) continue;

    chosen.set(sentence.index, best.segmentIndex);
    heuristicRecovered += 1;
  }

  if (heuristicRecovered > 0) {
    logger.info(
      `Take selection: heuristics recovered ${heuristicRecovered} missing sentence matches (preferLatest=${preferLatestInHeuristic})`
    );
  }

  if (chosen.size === 0) return null;

  const orderedSentences = [...chosen.keys()].sort((a, b) => a - b);
  const keepSegments: KeepSegment[] = [];
  let lastSegmentIndex = -1;

  for (const sentenceIndex of orderedSentences) {
    const segmentIndex = chosen.get(sentenceIndex);
    if (segmentIndex === undefined) continue;

    if (segmentIndex < lastSegmentIndex - 5) {
      logger.debug(
        `Skipping out-of-order segment ${segmentIndex} (last: ${lastSegmentIndex})`
      );
      continue;
    }

    const segment = segments.find((s) => s.index === segmentIndex);
    if (!segment) continue;
    keepSegments.push({ startMs: segment.startMs, endMs: segment.endMs });
    lastSegmentIndex = Math.max(lastSegmentIndex, segmentIndex);
  }

  const mergedKeepSegments = mergeSegments(keepSegments);
  const stats: ScriptAlignmentStats = {
    sentenceCount: sentences.length,
    matchedCount: orderedSentences.length,
    usedLlm,
    averageBestScore: Number(avgBest.toFixed(3)),
    keptSegmentCount: mergedKeepSegments.length,
    repeatedSentencesDetected: repeatedCount,
    artifactsRemoved,
  };

  const minMatched = Math.max(2, Math.floor(sentences.length * 0.3));
  if (orderedSentences.length < minMatched) {
    logger.warn('Script alignment match coverage too low, falling back to silence cleanup', {
      sentenceCount: sentences.length,
      matchedCount: orderedSentences.length,
      averageBestScore: stats.averageBestScore,
      minRequired: minMatched,
    });
    return null;
  }

  logger.info('Script alignment complete', {
    ...stats,
    coverage: `${((orderedSentences.length / sentences.length) * 100).toFixed(1)}%`,
  });
  return { keepSegments: mergedKeepSegments, stats };
}

export function countRepeatedTranscriptSegments(words: WordTimestamp[]): {
  repeatedGroupCount: number;
  repeatedSegmentCount: number;
  immediateRepeatCount: number;
  immediateRepeatSamples: string[];
} {
  const segments = buildTranscriptSegments(words);
  const immediateRepeats = { count: 0, samples: [] as string[] };

  if (segments.length === 0) {
    return {
      repeatedGroupCount: 0,
      repeatedSegmentCount: immediateRepeats.count,
      immediateRepeatCount: immediateRepeats.count,
      immediateRepeatSamples: immediateRepeats.samples,
    };
  }

  const repeatedGroups = detectRepeatedSegments(segments);
  const repeatedSegmentCount = repeatedGroups.reduce(
    (sum, group) => sum + Math.max(0, group.segments.length - 1),
    0
  );

  return {
    repeatedGroupCount: repeatedGroups.length,
    repeatedSegmentCount: repeatedSegmentCount + immediateRepeats.count,
    immediateRepeatCount: immediateRepeats.count,
    immediateRepeatSamples: immediateRepeats.samples,
  };
}
