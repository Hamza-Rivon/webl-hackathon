/**
 * Voxtral transcription service (via AWS Bedrock)
 *
 * Uses Mistral Voxtral model on AWS Bedrock for word-level audio transcription.
 * Drop-in alternative to Deepgram with the same WordTimestamp output format.
 *
 * Voxtral on Bedrock has a practical audio limit of ~55 seconds per request.
 * For longer audio, this service automatically splits into chunks, transcribes
 * each chunk separately, and merges the results with correct timestamp offsets.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type AudioFormat,
  type ContentBlock,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config.js';
import { logger } from '@webl/shared';
import type { WordTimestamp } from './deepgram.js';
import { execFile } from 'child_process';
import { writeFile, readFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

export interface VoxtralTranscriptResult {
  words: WordTimestamp[];
  durationSeconds: number | null;
  transcript: string | null;
  rawResponse?: unknown;
}

interface PreparedChunk {
  bytes: Uint8Array;
  offsetSeconds: number;
  durationSeconds: number;
}

const TRANSCRIPTION_PROMPT = `You are a precise speech-to-text transcription system. Transcribe the provided audio with word-level timestamps.

Output ONLY valid JSON (no markdown fences, no explanation) with this exact structure:
{"words":[{"word":"example","start":0.00,"end":0.50}],"duration":0.00}

Rules:
- "start" and "end" are in seconds with 2 decimal places
- Include every spoken word exactly as heard
- Remove all punctuation from the "word" field (no periods, commas, question marks, etc.)
- "duration" is the total audio duration in seconds
- Do not skip any words
- Preserve the original language
- Transcribe the ENTIRE audio from start to finish — do not stop early`;

/** Formats that Bedrock Voxtral actually accepts */
const BEDROCK_SUPPORTED_FORMATS = new Set<AudioFormat>(['mp3', 'wav']);

/** Max chunk duration in seconds — Voxtral truncates audio beyond ~55s */
const MAX_CHUNK_SECONDS = 50;
/** If a chunk fails with malformed/truncated JSON, split recursively down to this duration */
const MIN_ADAPTIVE_CHUNK_SECONDS = 12;
/** Maximum recursive split depth for a single failing chunk (50 -> 25 -> 12.5s) */
const MAX_ADAPTIVE_SPLIT_DEPTH = 2;

const EXTENSION_TO_FORMAT: Record<string, AudioFormat> = {
  wav: 'wav',
  mp3: 'mp3',
  ogg: 'ogg',
  flac: 'flac',
  webm: 'webm',
  aac: 'aac',
  m4a: 'm4a',
  mp4: 'mp4',
  opus: 'opus',
  pcm: 'pcm',
  mpeg: 'mpeg',
  mpga: 'mpga',
  mkv: 'mkv',
  mka: 'mka',
};

// ==================== AUDIO HELPERS ====================

function detectAudioFormat(url: string): AudioFormat {
  const pathname = new URL(url).pathname;
  const ext = pathname.split('.').pop()?.toLowerCase() ?? '';
  const format = EXTENSION_TO_FORMAT[ext];
  if (format) {
    logger.info('[Voxtral] detectAudioFormat: detected format from URL extension', { ext, format, url: url.slice(0, 120) });
    return format;
  }
  logger.warn(`[Voxtral] detectAudioFormat: could not detect format from extension "${ext}", defaulting to wav`, { url: url.slice(0, 120) });
  return 'wav';
}

/** Run ffprobe to get audio duration in seconds */
async function getAudioDuration(filePath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    execFile(
      'ffprobe',
      ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
      { timeout: 15_000 },
      (error, stdout, stderr) => {
        if (error) {
          logger.error('[Voxtral] ffprobe failed', { error: error.message, stderr: stderr?.slice(0, 300) });
          reject(new Error(`ffprobe failed: ${error.message}`));
          return;
        }
        const dur = parseFloat(stdout.trim());
        if (!Number.isFinite(dur) || dur <= 0) {
          reject(new Error(`ffprobe returned invalid duration: ${stdout.trim()}`));
          return;
        }
        resolve(dur);
      }
    );
  });
}

/**
 * Write audio bytes to a temp file, get duration, convert to mp3 if needed,
 * and split into chunks if longer than MAX_CHUNK_SECONDS.
 *
 * Returns an array of { bytes, offsetSeconds } chunks ready for Bedrock.
 */
async function prepareAudioChunks(
  audioBytes: Uint8Array,
  detectedFormat: AudioFormat
): Promise<{ chunks: PreparedChunk[]; totalDuration: number; format: AudioFormat }> {
  const id = randomUUID().slice(0, 8);
  const needsConvert = !BEDROCK_SUPPORTED_FORMATS.has(detectedFormat);
  const inputExt = needsConvert ? detectedFormat : (detectedFormat as string);
  const inputPath = join(tmpdir(), `voxtral-prep-${id}.${inputExt}`);
  const mp3Path = join(tmpdir(), `voxtral-full-${id}.mp3`);
  const tempFiles = [inputPath];

  try {
    await writeFile(inputPath, audioBytes);

    // Convert to mp3 if format not supported
    let mp3Bytes: Uint8Array;
    if (needsConvert) {
      logger.info('[Voxtral] prepareAudio: converting to mp3', { originalFormat: detectedFormat });
      tempFiles.push(mp3Path);
      await runFfmpeg(['-i', inputPath, '-vn', '-ar', '44100', '-ac', '1', '-b:a', '128k', '-f', 'mp3', '-y', mp3Path]);
      mp3Bytes = new Uint8Array(await readFile(mp3Path));
      logger.info('[Voxtral] prepareAudio: conversion done', {
        inputSizeMB: (audioBytes.byteLength / 1024 / 1024).toFixed(2),
        outputSizeMB: (mp3Bytes.byteLength / 1024 / 1024).toFixed(2),
      });
    } else {
      mp3Bytes = audioBytes;
    }

    // Get duration
    const sourcePath = needsConvert ? mp3Path : inputPath;
    const totalDuration = await getAudioDuration(sourcePath);
    logger.info('[Voxtral] prepareAudio: audio duration', { totalDuration: totalDuration.toFixed(2) });

    // If short enough, return as single chunk
    if (totalDuration <= MAX_CHUNK_SECONDS) {
      logger.info('[Voxtral] prepareAudio: audio within limit, single chunk', { totalDuration: totalDuration.toFixed(2), limit: MAX_CHUNK_SECONDS });
      return {
        chunks: [{ bytes: mp3Bytes, offsetSeconds: 0, durationSeconds: totalDuration }],
        totalDuration,
        format: 'mp3',
      };
    }

    // Split into chunks
    const chunkCount = Math.ceil(totalDuration / MAX_CHUNK_SECONDS);
    logger.info('[Voxtral] prepareAudio: splitting into chunks', {
      totalDuration: totalDuration.toFixed(2),
      chunkCount,
      chunkDuration: MAX_CHUNK_SECONDS,
    });

    // Write mp3 if we haven't already (when no conversion was needed)
    if (!needsConvert) {
      tempFiles.push(mp3Path);
      await writeFile(mp3Path, mp3Bytes);
    }

    const chunks: PreparedChunk[] = [];
    for (let i = 0; i < chunkCount; i++) {
      const startSec = i * MAX_CHUNK_SECONDS;
      const chunkPath = join(tmpdir(), `voxtral-chunk-${id}-${i}.mp3`);
      tempFiles.push(chunkPath);

      await runFfmpeg([
        '-i', mp3Path,
        '-ss', String(startSec),
        '-t', String(MAX_CHUNK_SECONDS),
        '-vn', '-ar', '44100', '-ac', '1', '-b:a', '128k',
        '-f', 'mp3', '-y', chunkPath,
      ]);

      const chunkBytes = new Uint8Array(await readFile(chunkPath));
      logger.info(`[Voxtral] prepareAudio: chunk ${i + 1}/${chunkCount} ready`, {
        offsetSeconds: startSec,
        durationSeconds: Math.min(MAX_CHUNK_SECONDS, Math.max(0, totalDuration - startSec)).toFixed(2),
        sizeMB: (chunkBytes.byteLength / 1024 / 1024).toFixed(2),
      });
      chunks.push({
        bytes: chunkBytes,
        offsetSeconds: startSec,
        durationSeconds: Math.min(MAX_CHUNK_SECONDS, Math.max(0, totalDuration - startSec)),
      });
    }

    return { chunks, totalDuration, format: 'mp3' };
  } finally {
    await Promise.all(tempFiles.map(f => unlink(f).catch(() => {})));
  }
}

/** Run an FFmpeg command and return a promise */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    execFile('ffmpeg', args, { timeout: 120_000 }, (error, _stdout, stderr) => {
      if (error) {
        logger.error('[Voxtral] FFmpeg failed', { error: error.message, stderr: stderr?.slice(0, 500) });
        reject(new Error(`FFmpeg failed: ${error.message}`));
      } else {
        resolve();
      }
    });
  });
}

async function downloadAudioBytes(url: string): Promise<Uint8Array> {
  logger.info('[Voxtral] downloadAudio: fetching audio bytes from signed URL', { urlLength: url.length });
  const t0 = Date.now();
  const response = await fetch(url);
  if (!response.ok) {
    logger.error('[Voxtral] downloadAudio: FAILED', { status: response.status, statusText: response.statusText });
    throw new Error(`Failed to download audio: ${response.status} ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  logger.info('[Voxtral] downloadAudio: SUCCESS', {
    sizeBytes: bytes.byteLength,
    sizeMB: (bytes.byteLength / 1024 / 1024).toFixed(2),
    contentType: response.headers.get('content-type'),
    elapsedMs: Date.now() - t0,
  });
  return bytes;
}

// ==================== BEDROCK CLIENT ====================

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (_client) return _client;

  if (config.bedrock.bearerToken) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = config.bedrock.bearerToken;
    logger.info('[Voxtral] createClient: using Bearer token auth', {
      region: config.bedrock.region,
      tokenPreview: config.bedrock.bearerToken.slice(0, 8) + '...',
    });
    _client = new BedrockRuntimeClient({ region: config.bedrock.region });
  } else {
    logger.info('[Voxtral] createClient: using IAM credentials auth (SigV4)', {
      region: config.bedrock.region,
      accessKeyIdPreview: config.bedrock.accessKeyId.slice(0, 8) + '...',
    });
    _client = new BedrockRuntimeClient({
      region: config.bedrock.region,
      credentials: {
        accessKeyId: config.bedrock.accessKeyId,
        secretAccessKey: config.bedrock.secretAccessKey,
      },
    });
  }
  return _client;
}

// ==================== RESPONSE PARSING ====================

interface VoxtralWord {
  word?: string;
  start?: number;
  end?: number;
}

interface VoxtralJsonResponse {
  words?: VoxtralWord[];
  duration?: number;
}

function extractJsonPayload(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith('```')) {
    logger.info('[Voxtral] parseResponse: stripping markdown fences');
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  }

  const firstBrace = cleaned.search(/[\[{]/);
  const lastObjectBrace = cleaned.lastIndexOf('}');
  const lastArrayBrace = cleaned.lastIndexOf(']');
  const lastBrace = Math.max(lastObjectBrace, lastArrayBrace);
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    return cleaned.slice(firstBrace, lastBrace + 1);
  }

  return cleaned;
}

function parseVoxtralResponse(text: string): VoxtralJsonResponse {
  const cleaned = extractJsonPayload(text);
  const parsed = JSON.parse(cleaned) as unknown;

  if (Array.isArray(parsed)) {
    // Some Voxtral responses are wrapped as [{ words: [...], duration: ... }]
    const first = parsed[0] as VoxtralJsonResponse | undefined;
    if (!first || (!Array.isArray(first.words) && !Number.isFinite(first.duration))) {
      throw new Error('Voxtral JSON array response does not contain a valid transcription object');
    }
    return first;
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Voxtral response JSON is not an object');
  }

  return parsed as VoxtralJsonResponse;
}

function sanitizeWord(value: string): string {
  return value.replace(/[.,!?;:'"()[\]{}<>]/g, '');
}

/** Normalize raw Voxtral words into WordTimestamp[], applying offset for chunks */
function normalizeWords(rawWords: VoxtralWord[], offsetMs: number): WordTimestamp[] {
  let droppedEmpty = 0;
  let droppedInvalidTiming = 0;

  const words = rawWords
    .map((w): WordTimestamp | null => {
      const rawText = w.word ?? '';
      const cleaned = sanitizeWord(rawText).trim();
      if (!cleaned) { droppedEmpty++; return null; }

      const startMs = Math.round((w.start ?? 0) * 1000) + offsetMs;
      const endMs = Math.round((w.end ?? 0) * 1000) + offsetMs;

      if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        droppedInvalidTiming++;
        return null;
      }

      return { word: cleaned, startMs, endMs, confidence: 1 };
    })
    .filter((w): w is WordTimestamp => Boolean(w));

  logger.info('[Voxtral] normalizeWords', {
    inputCount: rawWords.length,
    outputCount: words.length,
    droppedEmpty,
    droppedInvalidTiming,
    offsetMs,
  });

  return words;
}

// ==================== SINGLE CHUNK TRANSCRIPTION ====================

interface ChunkResult {
  words: WordTimestamp[];
  chunkDuration: number | null;
  rawOutput: string;
  usage: { inputTokens?: number; outputTokens?: number };
  stopReason?: string;
}

class VoxtralChunkRetryableError extends Error {
  constructor(
    message: string,
    readonly reason: 'invalid_json' | 'max_tokens' | 'empty_response'
  ) {
    super(message);
    this.name = 'VoxtralChunkRetryableError';
  }
}

/**
 * Transcribe a single audio chunk (must be mp3/wav, <=~55 seconds).
 */
async function transcribeChunk(
  audioBytes: Uint8Array,
  offsetSeconds: number,
  tag: string
): Promise<ChunkResult> {
  const scopedTag = tag ? `[${tag}]` : '';

  const content: ContentBlock[] = [
    { audio: { format: 'mp3', source: { bytes: audioBytes } } },
    { text: TRANSCRIPTION_PROMPT },
  ];

  const userMessage: Message = { role: 'user', content };
  const client = getClient();
  const command = new ConverseCommand({
    modelId: config.bedrock.voxtralModel,
    messages: [userMessage],
    inferenceConfig: { maxTokens: 16384, temperature: 0 },
  });

  logger.info(`[Voxtral] ${scopedTag} sending to Bedrock`, {
    audioSizeBytes: audioBytes.byteLength,
    offsetSeconds,
    modelId: config.bedrock.voxtralModel,
  });

  const t0 = Date.now();
  let response;
  try {
    response = await client.send(command);
  } catch (apiError) {
    logger.error(`[Voxtral] ${scopedTag} BEDROCK API ERROR`, {
      error: apiError instanceof Error ? apiError.message : String(apiError),
      errorName: apiError instanceof Error ? apiError.name : 'unknown',
      elapsedMs: Date.now() - t0,
      offsetSeconds,
    });
    throw apiError;
  }

  const elapsedMs = Date.now() - t0;
  const outputText = response.output?.message?.content
    ?.map((block) => ('text' in block ? block.text : ''))
    .join('') ?? '';

  logger.info(`[Voxtral] ${scopedTag} Bedrock response received`, {
    elapsedMs,
    stopReason: response.stopReason,
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
    outputTextLength: outputText.length,
  });

  if (!outputText) {
    throw new VoxtralChunkRetryableError(
      `Voxtral returned empty transcription response ${scopedTag}`,
      'empty_response'
    );
  }

  if (response.stopReason === 'max_tokens') {
    throw new VoxtralChunkRetryableError(
      `Voxtral reached max_tokens ${scopedTag}`,
      'max_tokens'
    );
  }

  // Parse
  let parsed: VoxtralJsonResponse;
  try {
    parsed = parseVoxtralResponse(outputText);
  } catch (parseError) {
    logger.error(`[Voxtral] ${scopedTag} JSON PARSE FAILED`, {
      error: parseError instanceof Error ? parseError.message : String(parseError),
      outputTextPreview: outputText.slice(0, 500),
    });
    throw new VoxtralChunkRetryableError(
      `Voxtral returned invalid JSON ${scopedTag}. Preview: ${outputText.slice(0, 200)}`,
      'invalid_json'
    );
  }

  const rawWords = parsed.words ?? [];
  const offsetMs = Math.round(offsetSeconds * 1000);
  const words = normalizeWords(rawWords, offsetMs);

  logger.info(`[Voxtral] ${scopedTag} transcription done`, {
    rawWordCount: rawWords.length,
    normalizedWordCount: words.length,
    chunkDuration: parsed.duration ?? null,
    offsetSeconds,
    firstWord: words[0] ? { word: words[0].word, startMs: words[0].startMs } : null,
    lastWord: words.length > 0 ? { word: words[words.length - 1]!.word, endMs: words[words.length - 1]!.endMs } : null,
  });

  return {
    words,
    chunkDuration: parsed.duration ?? null,
    rawOutput: outputText,
    usage: { inputTokens: response.usage?.inputTokens, outputTokens: response.usage?.outputTokens },
    stopReason: response.stopReason,
  };
}

async function splitChunkInHalf(chunk: PreparedChunk): Promise<[PreparedChunk, PreparedChunk]> {
  const id = randomUUID().slice(0, 8);
  const inputPath = join(tmpdir(), `voxtral-adaptive-in-${id}.mp3`);
  const firstPath = join(tmpdir(), `voxtral-adaptive-a-${id}.mp3`);
  const secondPath = join(tmpdir(), `voxtral-adaptive-b-${id}.mp3`);

  try {
    await writeFile(inputPath, chunk.bytes);
    const actualDuration = await getAudioDuration(inputPath).catch(() => chunk.durationSeconds);
    if (!Number.isFinite(actualDuration) || actualDuration <= 0) {
      throw new Error('Failed to determine adaptive chunk duration');
    }

    const splitAt = actualDuration / 2;
    if (splitAt <= 0 || splitAt >= actualDuration) {
      throw new Error(`Invalid adaptive split point for duration=${actualDuration}`);
    }

    await runFfmpeg([
      '-i', inputPath,
      '-ss', '0',
      '-t', String(splitAt),
      '-vn', '-ar', '44100', '-ac', '1', '-b:a', '128k',
      '-f', 'mp3', '-y', firstPath,
    ]);

    await runFfmpeg([
      '-i', inputPath,
      '-ss', String(splitAt),
      '-t', String(Math.max(0, actualDuration - splitAt)),
      '-vn', '-ar', '44100', '-ac', '1', '-b:a', '128k',
      '-f', 'mp3', '-y', secondPath,
    ]);

    const firstBytes = new Uint8Array(await readFile(firstPath));
    const secondBytes = new Uint8Array(await readFile(secondPath));

    if (firstBytes.byteLength === 0 || secondBytes.byteLength === 0) {
      throw new Error('Adaptive split produced an empty chunk');
    }

    return [
      {
        bytes: firstBytes,
        offsetSeconds: chunk.offsetSeconds,
        durationSeconds: splitAt,
      },
      {
        bytes: secondBytes,
        offsetSeconds: chunk.offsetSeconds + splitAt,
        durationSeconds: Math.max(0, actualDuration - splitAt),
      },
    ];
  } finally {
    await Promise.all([inputPath, firstPath, secondPath].map((f) => unlink(f).catch(() => {})));
  }
}

function canAdaptiveSplit(chunk: PreparedChunk, depth: number): boolean {
  return depth < MAX_ADAPTIVE_SPLIT_DEPTH && chunk.durationSeconds > MIN_ADAPTIVE_CHUNK_SECONDS;
}

async function transcribeChunkWithAdaptiveSplit(
  chunk: PreparedChunk,
  tag: string,
  depth = 0
): Promise<ChunkResult[]> {
  try {
    const result = await transcribeChunk(chunk.bytes, chunk.offsetSeconds, tag);
    return [result];
  } catch (error) {
    const retryable = error instanceof VoxtralChunkRetryableError;
    if (!retryable || !canAdaptiveSplit(chunk, depth)) {
      throw error;
    }

    logger.warn('[Voxtral] adaptive split retry for failing chunk', {
      tag,
      reason: error.reason,
      depth,
      durationSeconds: chunk.durationSeconds.toFixed(2),
      nextDepth: depth + 1,
    });

    const [left, right] = await splitChunkInHalf(chunk);

    if (
      left.durationSeconds < MIN_ADAPTIVE_CHUNK_SECONDS / 2 ||
      right.durationSeconds < MIN_ADAPTIVE_CHUNK_SECONDS / 2
    ) {
      logger.warn('[Voxtral] adaptive split reached minimal chunk duration', {
        tag,
        leftDuration: left.durationSeconds.toFixed(2),
        rightDuration: right.durationSeconds.toFixed(2),
      });
    }

    const leftResults = await transcribeChunkWithAdaptiveSplit(left, `${tag}.a`, depth + 1);
    const rightResults = await transcribeChunkWithAdaptiveSplit(right, `${tag}.b`, depth + 1);
    return [...leftResults, ...rightResults];
  }
}

// ==================== PUBLIC API ====================

export const voxtralService = {
  async transcribeFromUrl(audioUrl: string): Promise<VoxtralTranscriptResult> {
    const t0Total = Date.now();

    // ── Validate credentials ──
    const hasBearerToken = Boolean(config.bedrock.bearerToken);
    const hasIamCredentials = Boolean(config.bedrock.accessKeyId && config.bedrock.secretAccessKey);
    logger.info('[Voxtral] ====== TRANSCRIPTION START ======');
    logger.info('[Voxtral] credentials check', {
      hasBearerToken,
      hasIamCredentials,
      authMethod: hasBearerToken ? 'bearer_token' : hasIamCredentials ? 'iam_sigv4' : 'NONE',
      model: config.bedrock.voxtralModel,
      region: config.bedrock.region,
    });

    if (!hasBearerToken && !hasIamCredentials) {
      throw new Error(
        'AWS Bedrock auth not configured. Set AWS_BEARER_TOKEN_BEDROCK or AWS_ACCESS_KEY_ID/AWS_SECRET_ACCESS_KEY.'
      );
    }

    // ── Download audio ──
    const detectedFormat = detectAudioFormat(audioUrl);
    const audioBytes = await downloadAudioBytes(audioUrl);

    // ── Prepare chunks (convert + split if needed) ──
    const { chunks, totalDuration } = await prepareAudioChunks(audioBytes, detectedFormat);

    logger.info('[Voxtral] ready to transcribe', {
      chunkCount: chunks.length,
      totalDuration: totalDuration.toFixed(2),
      audioFormat: 'mp3',
    });

    // ── Transcribe each chunk sequentially ──
    const allWords: WordTimestamp[] = [];
    const rawOutputs: string[] = [];
    let totalInputTokens = 0;
    let totalOutputTokens = 0;

    let transcribedChunkCount = 0;
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!;
      const tag = chunks.length > 1 ? `chunk ${i + 1}/${chunks.length}` : 'chunk 1/1';
      const chunkResults = await transcribeChunkWithAdaptiveSplit(chunk, tag, 0);
      transcribedChunkCount += chunkResults.length;

      for (const result of chunkResults) {
        allWords.push(...result.words);
        rawOutputs.push(result.rawOutput);
        totalInputTokens += result.usage.inputTokens ?? 0;
        totalOutputTokens += result.usage.outputTokens ?? 0;
      }
    }

    allWords.sort((a, b) => {
      if (a.startMs !== b.startMs) return a.startMs - b.startMs;
      return a.endMs - b.endMs;
    });

    // ── Build final result ──
    const transcript = allWords.map((w) => w.word).join(' ') || null;
    const durationSeconds = totalDuration;
    const totalElapsedMs = Date.now() - t0Total;

    logger.info('[Voxtral] ====== TRANSCRIPTION COMPLETE ======', {
      provider: 'voxtral',
      model: config.bedrock.voxtralModel,
      region: config.bedrock.region,
      authMethod: hasBearerToken ? 'bearer_token' : 'iam_sigv4',
      audioFormat: 'mp3',
      audioSizeBytes: audioBytes.byteLength,
      audioSizeMB: (audioBytes.byteLength / 1024 / 1024).toFixed(2),
      chunkCount: chunks.length,
      transcribedChunkCount,
      wordCount: allWords.length,
      durationSeconds: durationSeconds.toFixed(2),
      totalElapsedMs,
      totalInputTokens,
      totalOutputTokens,
      firstWord: allWords[0] ? { word: allWords[0].word, startMs: allWords[0].startMs, endMs: allWords[0].endMs } : null,
      lastWord: allWords.length > 0 ? { word: allWords[allWords.length - 1]!.word, startMs: allWords[allWords.length - 1]!.startMs, endMs: allWords[allWords.length - 1]!.endMs } : null,
      transcriptPreview: transcript ? transcript.slice(0, 200) : null,
    });

    // Full word trace (matches Deepgram's VOICEOVER_TRACE pattern)
    logger.info(`[VOICEOVER_TRACE_FULL] source=Voxtral step=RETURNING_NORMALIZED wordCount=${allWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(allWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence })))}`
    );

    return {
      words: allWords,
      durationSeconds,
      transcript,
      rawResponse: { chunks: rawOutputs, totalInputTokens, totalOutputTokens },
    };
  },
};
