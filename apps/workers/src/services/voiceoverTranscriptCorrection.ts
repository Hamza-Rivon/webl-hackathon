import { GoogleGenerativeAI } from '@google/generative-ai';
import { supportsOpenAiTemperature } from './openaiModelSupport.js';
import { callBedrockMistralChat } from './bedrockMistral.js';
import { config } from '../config.js';
import { logger as sharedLogger } from '@webl/shared';
import {
  type AiProvider,
  getOpenAiCompatibleClient,
  getOpenAiCompatibleModel,
  getProviderLogContext,
  isProviderConfigured,
} from './llmProvider.js';

export interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

interface ScriptWord {
  text: string;
  normalized: string;
  index: number;
  sentenceIndex: number;
}

interface ScriptSentence {
  index: number;
  text: string;
  words: ScriptWord[];
  wordCount: number;
}

interface ScriptChunk {
  index: number;
  text: string;
  words: ScriptWord[];
  startWordIndex: number;
  endWordIndex: number;
  sentenceStartIndex: number;
  sentenceEndIndex: number;
}

interface TranscriptWord extends WordTimestamp {
  index: number;
  normalized: string;
}

interface TranscriptWindow {
  words: TranscriptWord[];
  startIndex: number;
  endIndex: number;
  startMs: number;
  endMs: number;
}

interface ChunkResult {
  chunkIndex: number;
  startWordIndex: number;
  words: WordTimestamp[];
  usedLlm: boolean;
  fallbackReason?: string;
}

export interface TranscriptCorrectionStats {
  totalScriptWords: number;
  totalTranscriptWords: number;
  chunkCount: number;
  usedLlm: boolean;
  fallbackChunks: number;
  llmCallCount: number;
  skipped: boolean;
  skipReason?: string;
}

const MIN_SENTENCES_PER_CHUNK = 5;
const MAX_SENTENCES_PER_CHUNK = 10;
const MIN_WORDS_PER_CHUNK = 200;
const MAX_WORDS_PER_CHUNK = 500;
const MAX_TRANSCRIPT_WINDOW_WORDS = 900;
const WINDOW_PADDING_RATIO = 0.5;
const WINDOW_PADDING_MIN_WORDS = 40;
const MIN_WORD_DURATION_MS = 40;

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\-]/g, '');
}

function splitScriptSentences(scriptContent: string): ScriptSentence[] {
  const normalized = scriptContent.replace(/\r\n/g, '\n').trim();
  const rawSentences = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const sentences: ScriptSentence[] = [];
  let wordIndex = 0;

  rawSentences.forEach((sentence, sentenceIndex) => {
    const words = extractScriptWords(sentence, sentenceIndex, wordIndex);
    if (words.length === 0) {
      return;
    }
    sentences.push({
      index: sentenceIndex,
      text: sentence,
      words,
      wordCount: words.length,
    });
    wordIndex += words.length;
  });

  return sentences;
}

function extractScriptWords(text: string, sentenceIndex: number, startIndex: number): ScriptWord[] {
  const tokenRegex = /[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g;
  const tokens = text.match(tokenRegex) ?? [];
  return tokens.map((token, offset) => ({
    text: token,
    normalized: normalizeToken(token),
    index: startIndex + offset,
    sentenceIndex,
  }));
}

function buildScriptChunks(sentences: ScriptSentence[]): ScriptChunk[] {
  if (sentences.length === 0) return [];

  const chunks: ScriptChunk[] = [];
  let cursor = 0;

  while (cursor < sentences.length) {
    let wordCount = 0;
    let end = cursor;

    while (end < sentences.length) {
      wordCount += sentences[end]?.wordCount ?? 0;
      const sentenceCount = end - cursor + 1;
      const reachedMin =
        sentenceCount >= MIN_SENTENCES_PER_CHUNK || wordCount >= MIN_WORDS_PER_CHUNK;
      const reachedMax =
        sentenceCount >= MAX_SENTENCES_PER_CHUNK || wordCount >= MAX_WORDS_PER_CHUNK;

      if (reachedMax || (reachedMin && end + 1 >= sentences.length)) {
        break;
      }
      if (reachedMin) {
        const nextWordCount = wordCount + (sentences[end + 1]?.wordCount ?? 0);
        if (nextWordCount > MAX_WORDS_PER_CHUNK) {
          break;
        }
      }
      end += 1;
    }

    if (end >= sentences.length) {
      end = sentences.length - 1;
    }

    const selectedSentences = sentences.slice(cursor, end + 1);
    const words = selectedSentences.flatMap((s) => s.words);
    const startWordIndex = words[0]?.index ?? 0;
    const endWordIndex = (words[words.length - 1]?.index ?? 0) + 1;

    chunks.push({
      index: chunks.length,
      text: selectedSentences.map((s) => s.text).join(' '),
      words,
      startWordIndex,
      endWordIndex,
      sentenceStartIndex: cursor,
      sentenceEndIndex: end,
    });

    const sentenceCount = end - cursor + 1;
    const overlap = sentenceCount >= 8 ? 2 : 1;
    const nextCursor = Math.max(end + 1 - overlap, cursor + 1);
    cursor = nextCursor;
  }

  return chunks;
}

function normalizeTranscriptWords(rawTranscript: unknown): TranscriptWord[] {
  if (!Array.isArray(rawTranscript)) return [];

  const words = rawTranscript
    .map((entry): TranscriptWord | null => {
      const word = typeof entry?.word === 'string' ? entry.word.trim() : '';
      const startMs = Number(entry?.startMs);
      const endMs = Number(entry?.endMs);
      const confidence = Number(entry?.confidence ?? 1);

      if (!word || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }

      return {
        word,
        startMs,
        endMs,
        confidence: Number.isFinite(confidence) ? confidence : 1,
        index: 0,
        normalized: normalizeToken(word),
      };
    })
    .filter((entry): entry is TranscriptWord => Boolean(entry))
    .sort((a, b) => a.startMs - b.startMs);

  return words.map((word, index) => ({
    ...word,
    index,
  }));
}

function buildTranscriptWindow(
  chunk: ScriptChunk,
  transcriptWords: TranscriptWord[],
  totalScriptWords: number
): TranscriptWindow {
  const transcriptCount = transcriptWords.length;
  if (transcriptCount === 0) {
    return { words: [], startIndex: 0, endIndex: 0, startMs: 0, endMs: 0 };
  }

  const ratioStart =
    totalScriptWords > 0 ? Math.min(1, chunk.startWordIndex / totalScriptWords) : 0;
  const ratioEnd =
    totalScriptWords > 0 ? Math.min(1, chunk.endWordIndex / totalScriptWords) : 1;

  let startIndex = Math.floor(ratioStart * transcriptCount);
  let endIndex = Math.ceil(ratioEnd * transcriptCount);

  const padding = Math.round(
    Math.max(WINDOW_PADDING_MIN_WORDS, chunk.words.length * WINDOW_PADDING_RATIO)
  );

  startIndex = Math.max(0, startIndex - padding);
  endIndex = Math.min(transcriptCount, endIndex + padding);

  if (endIndex - startIndex > MAX_TRANSCRIPT_WINDOW_WORDS) {
    const mid = Math.round((startIndex + endIndex) / 2);
    startIndex = Math.max(0, mid - Math.floor(MAX_TRANSCRIPT_WINDOW_WORDS / 2));
    endIndex = Math.min(transcriptCount, startIndex + MAX_TRANSCRIPT_WINDOW_WORDS);
  }

  if (endIndex - startIndex < 60) {
    const extra = Math.max(0, 60 - (endIndex - startIndex));
    startIndex = Math.max(0, startIndex - Math.floor(extra / 2));
    endIndex = Math.min(transcriptCount, endIndex + Math.ceil(extra / 2));
  }

  const words = transcriptWords.slice(startIndex, endIndex);
  const startMs = words[0]?.startMs ?? 0;
  const endMs = words[words.length - 1]?.endMs ?? startMs;

  return {
    words,
    startIndex,
    endIndex,
    startMs,
    endMs,
  };
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

function medianDuration(words: TranscriptWord[]): number {
  const durations = words
    .map((w) => w.endMs - w.startMs)
    .filter((d) => Number.isFinite(d) && d > 0)
    .sort((a, b) => a - b);
  if (durations.length === 0) return 180;
  const mid = Math.floor(durations.length / 2);
  const median = durations.length % 2 === 0
    ? (durations[mid - 1]! + durations[mid]!) / 2
    : durations[mid]!;
  return Math.max(80, Math.min(400, Math.round(median)));
}

function enforceMonotonic(words: WordTimestamp[], defaultDurationMs: number): WordTimestamp[] {
  let prevEnd = 0;
  return words.map((word) => {
    let startMs = Number.isFinite(word.startMs) ? word.startMs : prevEnd;
    let endMs = Number.isFinite(word.endMs) ? word.endMs : startMs + defaultDurationMs;

    if (startMs < prevEnd) startMs = prevEnd;
    if (endMs <= startMs) endMs = startMs + defaultDurationMs;

    prevEnd = endMs;
    return {
      ...word,
      startMs: Math.round(startMs),
      endMs: Math.round(endMs),
    };
  });
}

function interpolateWordsFromWindow(
  scriptWords: ScriptWord[],
  windowWords: TranscriptWord[],
  defaultDurationMs: number
): WordTimestamp[] {
  const total = scriptWords.length;
  const windowCount = windowWords.length;
  if (total === 0) return [];

  if (windowCount >= total && total > 1) {
    return scriptWords.map((word, i) => {
      const idx = Math.round((i / (total - 1)) * (windowCount - 1));
      const windowWord = windowWords[idx] ?? windowWords[windowCount - 1];
      const startMs = windowWord?.startMs ?? 0;
      const endMs = windowWord?.endMs ?? startMs + defaultDurationMs;
      return {
        word: word.text,
        startMs,
        endMs,
        confidence: windowWord?.confidence ?? 1,
      };
    });
  }

  const startMs = windowWords[0]?.startMs ?? 0;
  const endMs = windowWords[windowWords.length - 1]?.endMs ?? startMs + total * defaultDurationMs;
  const totalDuration = Math.max(endMs - startMs, total * defaultDurationMs);
  const slot = totalDuration / total;

  return scriptWords.map((word, i) => {
    const wordStart = startMs + slot * i;
    return {
      word: word.text,
      startMs: Math.round(wordStart),
      endMs: Math.round(wordStart + slot),
      confidence: 1,
    };
  });
}

function fillMissingTimes(
  scriptWords: ScriptWord[],
  draftWords: Array<{ startMs: number; endMs: number }>,
  windowWords: TranscriptWord[],
  defaultDurationMs: number
): WordTimestamp[] {
  const total = scriptWords.length;
  const windowStartMs = windowWords[0]?.startMs ?? 0;
  const windowEndMs =
    windowWords[windowWords.length - 1]?.endMs ?? windowStartMs + total * defaultDurationMs;

  const result: WordTimestamp[] = scriptWords.map((word, index) => ({
    word: word.text,
    startMs: draftWords[index]?.startMs ?? NaN,
    endMs: draftWords[index]?.endMs ?? NaN,
    confidence: 1,
  }));

  const validIndices = result
    .map((word, index) => ({
      index,
      valid: Number.isFinite(word.startMs) && Number.isFinite(word.endMs) && word.endMs > word.startMs,
    }))
    .filter((entry) => entry.valid)
    .map((entry) => entry.index);

  if (validIndices.length === 0) {
    return enforceMonotonic(interpolateWordsFromWindow(scriptWords, windowWords, defaultDurationMs), defaultDurationMs);
  }

  const segments: Array<{ start: number; end: number; prevIndex: number | null; nextIndex: number | null }> = [];
  let cursor = 0;
  while (cursor < total) {
    if (validIndices.includes(cursor)) {
      cursor += 1;
      continue;
    }
    const start = cursor;
    while (cursor < total && !validIndices.includes(cursor)) {
      cursor += 1;
    }
    const end = cursor - 1;
    const prevIndex = start > 0 ? [...validIndices].reverse().find((i) => i < start) ?? null : null;
    const nextIndex = cursor < total ? validIndices.find((i) => i >= cursor) ?? null : null;
    segments.push({ start, end, prevIndex, nextIndex });
  }

  for (const segment of segments) {
    const missingCount = segment.end - segment.start + 1;
    const segmentStartMs = segment.prevIndex !== null
      ? (result[segment.prevIndex]?.endMs ?? windowStartMs)
      : windowStartMs;
    const segmentEndMs = segment.nextIndex !== null
      ? (result[segment.nextIndex]?.startMs ?? windowEndMs)
      : windowEndMs;

    if (segmentEndMs <= segmentStartMs) {
      for (let i = 0; i < missingCount; i += 1) {
        const index = segment.start + i;
        const startMs = segmentStartMs + defaultDurationMs * i;
        const existing = result[index];
        if (existing) {
          result[index] = {
            word: existing.word,
            startMs,
            endMs: startMs + defaultDurationMs,
            confidence: existing.confidence,
          };
        }
      }
      continue;
    }

    const slot = (segmentEndMs - segmentStartMs) / missingCount;
    for (let i = 0; i < missingCount; i += 1) {
      const index = segment.start + i;
      const startMs = segmentStartMs + slot * i;
      const existing = result[index];
      if (existing) {
        result[index] = {
          word: existing.word,
          startMs,
          endMs: startMs + Math.max(slot, MIN_WORD_DURATION_MS),
          confidence: existing.confidence,
        };
      }
    }
  }

  return enforceMonotonic(result, defaultDurationMs);
}

function attachConfidence(
  words: WordTimestamp[],
  windowWords: TranscriptWord[]
): WordTimestamp[] {
  if (windowWords.length === 0) return words;
  let windowIndex = 0;

  return words.map((word) => {
    while (windowIndex < windowWords.length && windowWords[windowIndex]!.endMs <= word.startMs) {
      windowIndex += 1;
    }

    let idx = windowIndex;
    let sum = 0;
    let count = 0;

    while (idx < windowWords.length && windowWords[idx]!.startMs < word.endMs) {
      sum += windowWords[idx]!.confidence ?? 1;
      count += 1;
      idx += 1;
    }

    if (count === 0) {
      return { ...word, confidence: 1 };
    }

    return { ...word, confidence: Number((sum / count).toFixed(3)) };
  });
}

function buildCorrectionPrompt(args: {
  chunk: ScriptChunk;
  window: TranscriptWindow;
  keyterms: string[];
}): string {
  const scriptWords = args.chunk.words.map((w) => w.text);
  const deepgramWords = args.window.words.map((w) => ({
    i: w.index,
    w: w.word,
    s: w.startMs,
    e: w.endMs,
    c: Number((w.confidence ?? 1).toFixed(3)),
  }));

  return `You are reconstructing a corrected word-level transcript for a scripted voiceover.

Goal:
- Output words must match the SCRIPT exactly (word-for-word, same order, same count).
- Use Deepgram timestamps as anchors.
- Handle split or misheard words (e.g., "T so" -> "Tissot") by merging timestamps.
- If a script word is missing in the Deepgram window, interpolate between neighboring timestamps.
- If multiple repeated takes exist, choose the single contiguous span that best matches the script.
  Prefer the most complete/clean take, usually the last complete take.
- When the speaker restarts mid-sentence ("I always... uh... I always need..."), ignore false starts and anchor to the final fluent delivery.

Script chunk (text):
${args.chunk.text}

Script words (exact order, must output the same list):
${JSON.stringify(scriptWords)}

Deepgram word window (indices + timestamps):
${JSON.stringify(deepgramWords)}

Keyterms (proper nouns/brands): ${args.keyterms.length > 0 ? args.keyterms.join(', ') : '[]'}

Return JSON ONLY with this exact shape:
{
  "words": [
    { "word": "I", "startMs": 12850, "endMs": 13010 },
    { "word": "got", "startMs": 13010, "endMs": 13210 }
  ]
}

Rules:
- Output words array length must equal the script words length.
- Timestamps must be non-decreasing and within the window (${args.window.startMs}ms - ${args.window.endMs}ms).
- Each word must have startMs < endMs.
- No extra keys, no markdown.`;
}

async function callTranscriptCorrectionLlm(prompt: string, logger = sharedLogger): Promise<WordTimestamp[] | null> {
  const provider = config.ai.provider as AiProvider;

  if (!isProviderConfigured(provider)) {
    return null;
  }

  try {
    if (provider === 'mistral') {
      const text = await callBedrockMistralChat({
        systemPrompt: 'You output corrected word-level transcripts that match a script. Return JSON only.',
        userPrompt: prompt,
        temperature: 0.2,
      });
      const parsed = parseAIJsonResponse<{ words?: WordTimestamp[] }>(text);
      return Array.isArray(parsed.words) ? parsed.words : null;
    }

    if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: config.ai.geminiModel,
        generationConfig: { responseMimeType: 'application/json' },
      });
      const response = await model.generateContent(prompt);
      const text = response.response.text();
      const parsed = parseAIJsonResponse<{ words?: WordTimestamp[] }>(text);
      return Array.isArray(parsed.words) ? parsed.words : null;
    }

    const client = getOpenAiCompatibleClient(provider);
    const model = getOpenAiCompatibleModel(config.openai.model, provider);
    if (provider === 'runpod') {
      logger.info('[Runpod][transcript-correction] request', getProviderLogContext(provider));
    }
    const temperature = supportsOpenAiTemperature(model, null) ? 0.2 : undefined;
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You output corrected word-level transcripts that match a script. Return JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      ...(temperature !== undefined ? { temperature } : {}),
    });
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = parseAIJsonResponse<{ words?: WordTimestamp[] }>(content);
    if (provider === 'runpod') {
      logger.info('[Runpod][transcript-correction] response', {
        ...getProviderLogContext(provider),
        wordCount: Array.isArray(parsed.words) ? parsed.words.length : 0,
      });
    }
    return Array.isArray(parsed.words) ? parsed.words : null;
  } catch (error) {
    logger.error('Transcript correction LLM call failed', error);
    return null;
  }
}

export async function reconstructTranscriptWithLlm(args: {
  scriptContent: string;
  transcriptWords: WordTimestamp[];
  keyterms?: string[];
  logger?: typeof sharedLogger;
}): Promise<{ correctedWords: WordTimestamp[]; stats: TranscriptCorrectionStats }> {
  const logger = args.logger ?? sharedLogger;
  const normalizedTranscript = normalizeTranscriptWords(args.transcriptWords);
  const sentences = splitScriptSentences(args.scriptContent);
  const chunks = buildScriptChunks(sentences);
  const scriptWords = sentences.flatMap((s) => s.words);
  const totalScriptWords = scriptWords.length;

  if (chunks.length === 0 || totalScriptWords === 0 || normalizedTranscript.length === 0) {
    return {
      correctedWords: args.transcriptWords,
      stats: {
        totalScriptWords,
        totalTranscriptWords: normalizedTranscript.length,
        chunkCount: 0,
        usedLlm: false,
        fallbackChunks: 0,
        llmCallCount: 0,
        skipped: true,
        skipReason: 'missing_chunks_or_transcript',
      },
    };
  }

  const keyterms = (args.keyterms ?? []).filter(Boolean).slice(0, 60);
  const chunkResults: ChunkResult[] = [];
  let fallbackChunks = 0;
  let llmCallCount = 0;
  const provider = config.ai.provider as AiProvider;
  const canCallLlm = isProviderConfigured(provider);

  for (const chunk of chunks) {
    const window = buildTranscriptWindow(chunk, normalizedTranscript, totalScriptWords);
    const defaultDurationMs = medianDuration(window.words);
    const prompt = buildCorrectionPrompt({ chunk, window, keyterms });

    if (canCallLlm) {
      llmCallCount += 1;
    }
    const llmWords = canCallLlm ? await callTranscriptCorrectionLlm(prompt, logger) : null;

    if (!llmWords || llmWords.length !== chunk.words.length) {
      fallbackChunks += 1;
      const fallbackWords = interpolateWordsFromWindow(chunk.words, window.words, defaultDurationMs);
      chunkResults.push({
        chunkIndex: chunk.index,
        startWordIndex: chunk.startWordIndex,
        words: attachConfidence(fallbackWords, window.words),
        usedLlm: false,
        fallbackReason: llmWords ? 'length_mismatch' : 'llm_failed',
      });
      continue;
    }

    const draftWords = llmWords.map((word) => ({
      startMs: Number(word.startMs),
      endMs: Number(word.endMs),
    }));

    const corrected = fillMissingTimes(chunk.words, draftWords, window.words, defaultDurationMs);
    chunkResults.push({
      chunkIndex: chunk.index,
      startWordIndex: chunk.startWordIndex,
      words: attachConfidence(corrected, window.words),
      usedLlm: true,
    });
  }

  const merged: Array<WordTimestamp | null> = new Array(totalScriptWords).fill(null);
  for (const result of chunkResults) {
    result.words.forEach((word, offset) => {
      const index = result.startWordIndex + offset;
      if (index >= merged.length) return;
      const existing = merged[index];
      const duration = word.endMs - word.startMs;
      if (!existing || (existing.endMs - existing.startMs) < MIN_WORD_DURATION_MS) {
        merged[index] = {
          word: scriptWords[index]?.text ?? word.word,
          startMs: word.startMs,
          endMs: word.endMs,
          confidence: word.confidence ?? 1,
        };
      } else if (duration >= MIN_WORD_DURATION_MS && (existing.endMs - existing.startMs) < duration) {
        merged[index] = {
          word: scriptWords[index]?.text ?? word.word,
          startMs: word.startMs,
          endMs: word.endMs,
          confidence: word.confidence ?? 1,
        };
      }
    });
  }

  const fallbackDefaultDuration = medianDuration(normalizedTranscript);
  const mergedWords = merged.map((word, index) => ({
    word: scriptWords[index]?.text ?? word?.word ?? '',
    startMs: word?.startMs ?? NaN,
    endMs: word?.endMs ?? NaN,
    confidence: word?.confidence ?? 1,
  }));

  const finalWords = fillMissingTimes(
    scriptWords,
    mergedWords.map((word) => ({ startMs: word.startMs, endMs: word.endMs })),
    normalizedTranscript,
    fallbackDefaultDuration
  );

  const finalWithConfidence = attachConfidence(finalWords, normalizedTranscript);

  return {
    correctedWords: finalWithConfidence,
    stats: {
      totalScriptWords,
      totalTranscriptWords: normalizedTranscript.length,
      chunkCount: chunks.length,
      usedLlm: chunkResults.some((result) => result.usedLlm),
      fallbackChunks,
      llmCallCount,
      skipped: false,
    },
  };
}
