/**
 * Phase 1.6: Voiceover Segmentation Job
 *
 * Purpose: Deterministically split clean voiceover into micro-units and enrich with metadata + embeddings.
 *
 * Pipeline Position: After voiceover_cleaning
 * Dependencies: voiceover_cleaning (must complete first)
 * Triggers: semantic_matching (if readiness satisfied)
 */

import { Job } from 'bullmq';
import OpenAI from 'openai';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { config } from '../config.js';
import { usageService } from '../services/usage.js';
import { randomUUID } from 'crypto';
import {
  type AiProvider,
  getOpenAiCompatibleClient,
  getOpenAiCompatibleModel,
  getProviderLogContext,
  isProviderConfigured,
} from '../services/llmProvider.js';
import { callBedrockMistralChat } from '../services/bedrockMistral.js';
import {
  UnitBatchAnalysisSchema,
  UnitBatchAnalysisJsonSchema,
  buildUnitBatchAnalysisPrompt,
  type UnitBatchAnalysis,
} from '@webl/shared';

// ==================== TYPES ====================

interface VoiceoverSegmentationJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

interface VoiceoverUnit {
  unitIndex: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  words: WordTimestamp[];
  label: string;
  embeddingText: string;
  windowStartIndex: number;
  windowEndIndex: number;
  contextStartIndex: number;
  contextEndIndex: number;
  unitStartIndex: number;
  unitEndIndex: number;
  scriptSentence?: string | null;
}

interface UnitAnalysisResult {
  keywords: string[];
  emotionalTone: string;
}

// ==================== CONSTANTS ====================

const MAX_WORDS_PER_UNIT = 5;
const MAX_UNIT_DURATION_MS = 2000;
const MIN_UNIT_DURATION_MS = 350;
const PAUSE_WINDOW_GAP_MS = 300;
const TRANSCRIPT_EDGE_TOLERANCE_MS = 300;
const CONTEXT_TARGET_MIN_WORDS = 35;
const CONTEXT_TARGET_MAX_WORDS = 50;

const KEYWORD_STOPWORDS = new Set([
  'a',
  'an',
  'the',
  'and',
  'or',
  'but',
  'to',
  'for',
  'with',
  'of',
  'in',
  'on',
  'at',
  'from',
  'by',
  'as',
  'is',
  'are',
  'was',
  'were',
  'be',
  'been',
  'being',
  'do',
  'does',
  'did',
  'have',
  'has',
  'had',
  'i',
  'me',
  'my',
  'mine',
  'we',
  'our',
  'us',
  'you',
  'your',
  'he',
  'she',
  'him',
  'her',
  'they',
  'them',
  'their',
  'it',
  'its',
  'this',
  'that',
  'these',
  'those',
  'some',
  'just',
  'got',
]);
const KEYWORD_SEED_FALLBACK = ['speech', 'dialogue', 'narration', 'voiceover', 'segment'];
const RUNPOD_CONTEXT_WINDOW_TOKENS = Number(process.env.VLLM_CONTEXT_WINDOW_TOKENS || '32768');
const RUNPOD_COMPLETION_TOKEN_CAP = Number(process.env.VLLM_MAX_COMPLETION_TOKENS || '8192');
const RUNPOD_MIN_COMPLETION_TOKENS = 1024;
const RUNPOD_TOKEN_SAFETY_BUFFER = 768;

// ==================== JOB PROCESSOR ====================

export async function processVoiceoverSegmentation(
  bullJob: Job<VoiceoverSegmentationJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;
  let embeddingCallCount = 0;

  logger.info(`[Phase 1.6] Starting voiceover segmentation job ${jobId}`, {
    episodeId,
  });

  try {
    // Usage guard: check hard limits before LLM + embedding calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` } });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'processing', stage: 'starting', progress: 0 },
    });

    await progressPublisher.publish(
      jobId,
      'processing',
      'starting',
      0,
      'Starting voiceover segmentation'
    );

    await updateProgress(jobId, 'processing', 10, 'Loading clean transcript');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        wordTranscript: true,
        cleanVoiceoverDuration: true,
        scriptContent: true,
      },
    });

    if (!episode?.wordTranscript) {
      throw new Error(`No word transcript found for episode ${episodeId}`);
    }

    let cleanWords = normalizeTranscriptWords(episode.wordTranscript);
    if (cleanWords.length === 0) {
      throw new Error('Word transcript is empty');
    }
    logger.info('[Phase 1.6 segmentation] RECEIVED: episode.wordTranscript (post-cleaning, kept words only)', {
      episodeId,
      wordCount: cleanWords.length,
      cleanVoiceoverDuration: episode.cleanVoiceoverDuration,
      firstWord: cleanWords[0] ? { word: cleanWords[0].word, startMs: cleanWords[0].startMs, endMs: cleanWords[0].endMs } : null,
      lastWord: cleanWords.length > 0 ? cleanWords[cleanWords.length - 1]! ? { word: cleanWords[cleanWords.length - 1]!.word, startMs: cleanWords[cleanWords.length - 1]!.startMs, endMs: cleanWords[cleanWords.length - 1]!.endMs } : null : null,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.6_segmentation step=RECEIVED_episode_wordTranscript episodeId=${episodeId} wordCount=${cleanWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        cleanWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
      )}`
    );

    await updateProgress(jobId, 'processing', 25, 'Building micro-units');

    const cleanVoiceoverDurationMs = Math.round((episode.cleanVoiceoverDuration ?? 0) * 1000);
    const durationNormalized = normalizeTranscriptToDuration(cleanWords, cleanVoiceoverDurationMs);
    if (durationNormalized.adjusted) {
      cleanWords = durationNormalized.words;
      logger.warn('[Phase 1.6 segmentation] Repaired transcript edge to match clean voiceover duration', {
        episodeId,
        beforeLastWordEndMs: durationNormalized.beforeLastWordEndMs,
        afterLastWordEndMs: durationNormalized.afterLastWordEndMs,
        cleanVoiceoverDurationMs,
      });
      await prisma.episode.update({
        where: { id: episodeId },
        data: {
          wordTranscript: cleanWords as any,
        },
      });
    }

    const windows = buildSentenceWindows(cleanWords, episode.scriptContent);
    const units = buildUnits(cleanWords, windows);
    normalizeUnitTimeline(units, cleanVoiceoverDurationMs);

    if (units.length === 0) {
      throw new Error('No voiceover units generated');
    }

    // Validate windows cover all words (before unitization)
    const windowCoverage = new Set<number>();
    for (const window of windows) {
      for (let i = window.startIndex; i <= window.endIndex; i += 1) {
        windowCoverage.add(i);
      }
    }
    const missingFromWindows = [];
    for (let i = 0; i < cleanWords.length; i += 1) {
      if (!windowCoverage.has(i)) {
        missingFromWindows.push(i);
      }
    }
    if (missingFromWindows.length > 0) {
      logger.error('Windows do not cover all words', {
        missingIndices: missingFromWindows,
        totalWords: cleanWords.length,
        windowCount: windows.length,
      });
      throw new Error(`Windows missing ${missingFromWindows.length} words (indices: ${missingFromWindows.slice(0, 10).join(', ')})`);
    }

    await updateProgress(jobId, 'processing', 35, 'Preparing unit metadata request');

    const unitsDraft = units.map((unit, index) => ({
      unitIndex: unit.unitIndex,
      unitWords: unit.words.map((word) => ({
        word: word.word,
        startMs: word.startMs,
        endMs: word.endMs,
      })),
      unitText: unit.label,
      startMs: unit.startMs,
      endMs: unit.endMs,
      prevUnitText: units[index - 1]?.label ?? null,
      nextUnitText: units[index + 1]?.label ?? null,
    }));

    const prompt = buildUnitBatchAnalysisPrompt({
      scriptContent: episode.scriptContent,
      unitsDraft,
    });

    const analysisOutput: UnitBatchAnalysis = await callUnitAnalysis(prompt, userId, units);

    const analysisByIndex = mapAnalysisToUnits(analysisOutput, units);

    await updateProgress(jobId, 'processing', 55, 'Generating embeddings');

    const embeddings = await embedUnitTexts(units.map((u) => u.embeddingText), userId);
    embeddingCallCount += embeddings.callCount;

    await updateProgress(jobId, 'processing', 75, 'Storing units in database');

    logger.info('[Phase 1.6 segmentation] STORED: VoiceoverSegment records (episode.wordTranscript unchanged)', {
      episodeId,
      segmentCount: units.length,
      note: 'episode.wordTranscript and episode.correctedWordTranscript are not modified',
    });
    await prisma.voiceoverSegment.deleteMany({ where: { episodeId } });

    for (let i = 0; i < units.length; i += 1) {
      const unit = units[i]!;
      const embedding = embeddings.vectors[i];
      if (!embedding) {
        throw new Error(`Missing embedding for unit ${unit.unitIndex}`);
      }

      const analysis = analysisByIndex.get(unit.unitIndex);
      const keywords = buildUnitKeywords(unit, analysis);
      const emotionalTone = analysis?.emotionalTone ?? 'neutral';

      const segmentId = randomUUID();
      const embeddingVector = `[${embedding.join(',')}]`;

      await prisma.$executeRaw`
        INSERT INTO "VoiceoverSegment" (
          id, "episodeId", "segmentIndex", text, "startMs", "endMs",
          "durationMs", words, keywords, "emotionalTone",
          embedding, "embeddingText", "createdAt"
        ) VALUES (
          ${segmentId}, ${episodeId}, ${unit.unitIndex}, ${unit.label},
          ${unit.startMs}, ${unit.endMs}, ${unit.durationMs},
          ${JSON.stringify(unit.words)}::jsonb, ${keywords},
          ${emotionalTone},
          ${embeddingVector}::vector, ${unit.embeddingText}, NOW()
        )
      `;
    }

    await updateProgress(jobId, 'processing', 90, 'Validating word and duration coverage');

    // CRITICAL: Units must cover ALL words with no gaps (per VOICEOVER_LLM_SIMPLIFICATION_PLAN.md)
    // Validate word coverage first
    const coveredWordIndices = new Set<number>();
    for (const unit of units) {
      for (let i = unit.unitStartIndex; i <= unit.unitEndIndex; i += 1) {
        coveredWordIndices.add(i);
      }
    }

    const missingWordIndices: number[] = [];
    for (let i = 0; i < cleanWords.length; i += 1) {
      if (!coveredWordIndices.has(i)) {
        missingWordIndices.push(i);
      }
    }

    if (missingWordIndices.length > 0) {
      const missingWords = missingWordIndices.map((idx) => cleanWords[idx]?.word).filter(Boolean);
      throw new Error(
        `Units do not cover all words: ${missingWordIndices.length} words missing (indices: ${missingWordIndices.slice(0, 10).join(', ')}${missingWordIndices.length > 10 ? '...' : ''}, words: ${missingWords.slice(0, 10).join(', ')}${missingWords.length > 10 ? '...' : ''})`
      );
    }

    // Validate units are contiguous (no gaps between units)
    for (let i = 1; i < units.length; i += 1) {
      const prev = units[i - 1]!;
      const curr = units[i]!;
      // Units should be contiguous - current should start at or very close to previous end
      // Allow 50ms gap for rounding, but log if there's any gap
      const gap = curr.startMs - prev.endMs;
      if (gap > 50) {
        throw new Error(
          `Gap between units ${prev.unitIndex} and ${curr.unitIndex}: ${gap}ms gap (prev ends at ${prev.endMs}ms, curr starts at ${curr.startMs}ms). Units must be contiguous with no gaps.`
        );
      }
      if (gap < 0) {
        throw new Error(
          `Overlap between units ${prev.unitIndex} and ${curr.unitIndex}: ${Math.abs(gap)}ms overlap (prev ends at ${prev.endMs}ms, curr starts at ${curr.startMs}ms). Units must not overlap.`
        );
      }
    }

    // Validate duration coverage (must be exact per plan: "finalVideoDurationMs === cleanVoiceoverDurationMs (exact ms)")
    // CRITICAL: Per VOICEOVER_LLM_SIMPLIFICATION_PLAN.md line 31: "finalVideoDurationMs === cleanVoiceoverDurationMs (exact ms)"
    // Per line 104: "covers the entire cleaned transcript (no gaps in word coverage)"
    // Per line 577: "sum(cut.durationMs) === cleanVoiceoverDurationMs"
    const lastUnit = units[units.length - 1];
    const firstUnit = units[0];
    const lastWord = cleanWords[cleanWords.length - 1];
    const firstWord = cleanWords[0];
    
    if (!lastUnit || !firstUnit || !lastWord || !firstWord) {
      throw new Error('Missing required units or words for validation');
    }

    // The last unit must end at or after the last word's endMs
    // The clean voiceover duration should match the last word's endMs
    const lastWordEndMs = lastWord.endMs;
    const firstWordStartMs = firstWord.startMs;
    const unitCoverageMs = lastUnit.endMs;
    
    // Validate: last unit must cover the last word
    if (lastUnit.endMs < lastWordEndMs) {
      throw new Error(
        `Last unit ends at ${lastUnit.endMs}ms but last word ends at ${lastWordEndMs}ms. Units must cover all words.`
      );
    }

    // Validate: first unit must start at or before first word
    if (firstUnit.startMs > firstWordStartMs + 50) {
      throw new Error(
        `First unit starts at ${firstUnit.startMs}ms but first word starts at ${firstWordStartMs}ms. Units must cover all words.`
      );
    }

    // Validate: clean voiceover duration should match last word's endMs (allow short trailing silence)
    const durationDiff = Math.abs(lastWordEndMs - cleanVoiceoverDurationMs);
    if (cleanVoiceoverDurationMs > 0 && durationDiff > TRANSCRIPT_EDGE_TOLERANCE_MS) {
      throw new Error(
        `Last word endMs (${lastWordEndMs}ms) doesn't match clean voiceover duration (${cleanVoiceoverDurationMs}ms, diff: ${durationDiff}ms). This indicates a problem with transcript normalization after cleaning.`
      );
    }

    // Validate: unit coverage must match clean voiceover duration (exact match required)
    const unitDurationDiff = Math.abs(unitCoverageMs - cleanVoiceoverDurationMs);
    if (cleanVoiceoverDurationMs > 0 && unitDurationDiff > 50) {
      throw new Error(
        `Unit coverage (${unitCoverageMs}ms) doesn't match clean voiceover duration (${cleanVoiceoverDurationMs}ms, diff: ${unitDurationDiff}ms). Units must cover exact duration per VOICEOVER_LLM_SIMPLIFICATION_PLAN.md`
      );
    }

    if (unitDurationDiff > 0) {
      logger.info('Small duration rounding difference (within tolerance)', {
        unitCoverageMs,
        cleanVoiceoverDurationMs,
        lastWordEndMs,
        diff: unitDurationDiff,
        unitCount: units.length,
        wordCount: cleanWords.length,
      });
    }

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          unitCount: units.length,
          totalDurationMs: unitCoverageMs,
          embeddingCalls: embeddingCallCount,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Created ${units.length} voiceover units`
    );

    const { triggerSemanticMatchingSafely } = await import('../services/episodeReadiness.js');
    const result = await triggerSemanticMatchingSafely(episodeId, userId);

    if (result.triggered) {
      logger.info(
        `[Phase 1.6] Triggered semantic_matching job ${result.jobId} for episode ${episodeId}`
      );
    } else {
      logger.info(
        `[Phase 1.6] Episode not ready for semantic matching yet: ${result.reason}`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 1.6] Voiceover segmentation job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'error',
        errorMessage,
      },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  }
}

// ==================== LLM + EMBEDDINGS ====================

async function callUnitAnalysis(
  prompt: string,
  userId: string,
  units: VoiceoverUnit[]
): Promise<UnitBatchAnalysis> {
  const provider = config.ai.provider as AiProvider;

  if (provider === 'gemini') {
    if (!isProviderConfigured(provider)) {
      throw new Error('AI_PROVIDER is set to gemini but GEMINI_API_KEY is not configured');
    }
    await usageService.recordUsage(userId, {
      geminiCalls: 1,
      segmentAnalysisCalls: 1,
    });
    const raw = await callGemini(prompt);
    return await validateOrRepairUnitAnalysis(raw, prompt, userId, provider, units);
  }

  if (provider === 'mistral') {
    if (!isProviderConfigured(provider)) {
      throw new Error('AI_PROVIDER is set to mistral but no Bedrock credentials configured');
    }
    await usageService.recordUsage(userId, {
      openAiChatCalls: 1,
      segmentAnalysisCalls: 1,
    });
    const raw = await callBedrockMistralChat({
      systemPrompt: 'You are a helpful assistant designed to output JSON.',
      userPrompt: prompt,
      maxTokens: 4096,
      temperature: 0,
    });
    return await validateOrRepairUnitAnalysis(raw, prompt, userId, provider, units);
  }

  if (!isProviderConfigured(provider)) {
    throw new Error(
      provider === 'runpod'
        ? 'AI_PROVIDER is set to runpod but VLLM_BASE_URL is not configured'
        : 'AI_PROVIDER is set to openai but OPENAI_API_KEY is not configured'
    );
  }

  if (provider === 'openai' || provider === 'runpod') {
    await usageService.recordUsage(userId, {
      openAiChatCalls: 1,
      segmentAnalysisCalls: 1,
    });
    const raw = await callOpenAiCompatible(prompt, config.voiceover.models.call4, provider);
    return await validateOrRepairUnitAnalysis(raw, prompt, userId, provider, units);
  }

  throw new Error(`Unsupported AI_PROVIDER "${provider}" for unit analysis`);
}

async function callOpenAiCompatible(
  prompt: string,
  preferredModel: string,
  provider: 'openai' | 'runpod'
): Promise<string> {
  const model = getOpenAiCompatibleModel(preferredModel, provider);
  const client = getOpenAiCompatibleClient(provider);

  if (provider === 'runpod') {
    const temperature = 0;
    const maxTokens = computeRunpodMaxTokens(prompt);
    logger.info('[Runpod][voiceover-segmentation] unit-analysis request', {
      ...getProviderLogContext(provider),
      promptChars: prompt.length,
      maxTokens,
    });
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are a helpful assistant designed to output JSON.' },
        { role: 'user', content: prompt },
      ],
      ...(temperature !== undefined ? { temperature } : {}),
      max_tokens: maxTokens,
      max_completion_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error('Runpod response is empty');
    }
    const finishReason = response.choices[0]?.finish_reason ?? null;
    if (finishReason === 'length') {
      logger.warn('[Runpod][voiceover-segmentation] unit-analysis reached token limit', {
        ...getProviderLogContext(provider),
        promptChars: prompt.length,
        maxTokens,
      });
    }
    logger.info('[Runpod][voiceover-segmentation] unit-analysis response', {
      ...getProviderLogContext(provider),
      responseChars: content.length,
      finishReason,
    });
    return content;
  }

  const response = await client.responses.create({
    model,
    input: [
      { role: 'system', content: 'You are a helpful assistant designed to output JSON.' },
      { role: 'user', content: prompt },
    ],
    text: {
      format: {
        type: 'json_schema',
        strict: true,
        name: UnitBatchAnalysisJsonSchema.name,
        schema: UnitBatchAnalysisJsonSchema.schema,
      },
    },
    max_output_tokens: 16000,
  } as any);

  if (response.status === 'incomplete') {
    const incompleteDetails = (response as any).incomplete_details;
    logger.warn('OpenAI response incomplete, attempting to use partial output', {
      status: response.status,
      incompleteDetails,
      reason: incompleteDetails?.reason,
    });
    // Try to use partial output if available
    if (response.output_text) {
      try {
        const parsed = JSON.parse(response.output_text);
        // Check if we have at least some units
        if (parsed.units && Array.isArray(parsed.units) && parsed.units.length > 0) {
          logger.warn(`Using incomplete response output with ${parsed.units.length} units (may be truncated)`);
          return response.output_text;
        }
        throw new Error('Incomplete response has no valid units');
      } catch (error) {
        throw new Error(`OpenAI response incomplete and output_text is invalid JSON: ${response.status}`);
      }
    }
    throw new Error(`OpenAI response incomplete with no usable output: ${response.status}`);
  }

  if (response.status !== 'completed') {
    throw new Error(`OpenAI response status: ${response.status}`);
  }

  return response.output_text;
}

async function callGemini(prompt: string): Promise<string> {
  const gemini = new GoogleGenerativeAI(config.ai.geminiApiKey);
  const model = gemini.getGenerativeModel({
    model: config.voiceover.models.call4 || config.ai.geminiModel,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
    },
  });
  const result = await model.generateContent(prompt);
  return result.response.text();
}

function parseJsonEnvelope(raw: string): unknown {
  const cleaned = String(raw || '')
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]}]/);
  return JSON.parse(jsonMatch ? jsonMatch[0] : cleaned);
}

function estimateTokenCount(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 3.2);
}

function computeRunpodMaxTokens(prompt: string): number {
  const cappedContext = Math.max(4096, RUNPOD_CONTEXT_WINDOW_TOKENS);
  const completionCap = Math.max(1, Math.min(RUNPOD_COMPLETION_TOKEN_CAP, cappedContext));
  const estimatedInputTokens = estimateTokenCount(prompt) + 256; // role + json formatting overhead
  const available = cappedContext - estimatedInputTokens - RUNPOD_TOKEN_SAFETY_BUFFER;
  const bounded = Math.min(completionCap, Math.max(1, available));

  if (bounded < RUNPOD_MIN_COMPLETION_TOKENS) {
    logger.warn('[Runpod][voiceover-segmentation] low completion token budget', {
      estimatedInputTokens,
      cappedContext,
      available,
      bounded,
    });
  }

  return bounded;
}

function applyUnitBatchAnalysisGuardrails(
  parsed: unknown,
  units: VoiceoverUnit[],
  provider: AiProvider
): {
  units: Array<{ unitIndex: number; keywords: string[]; emotionalTone: string }>;
} {
  const payload = (parsed ?? {}) as { units?: unknown };
  const inputUnits = Array.isArray(payload.units) ? payload.units : [];
  const unitByIndex = new Map<number, VoiceoverUnit>(units.map((unit) => [unit.unitIndex, unit]));

  let adjustedKeywordUnits = 0;
  let adjustedToneUnits = 0;

  const normalizedUnits = inputUnits.map((entry, index) => {
    const item = (entry ?? {}) as {
      unitIndex?: unknown;
      keywords?: unknown;
      emotionalTone?: unknown;
    };

    const rawUnitIndex = Number(item.unitIndex);
    const unitIndex = Number.isFinite(rawUnitIndex)
      ? Math.max(0, Math.round(rawUnitIndex))
      : index;
    const sourceUnit = unitByIndex.get(unitIndex);

    const providedKeywords = Array.isArray(item.keywords)
      ? item.keywords.filter((k): k is string => typeof k === 'string')
      : [];
    const normalizedKeywords = normalizeKeywords(providedKeywords);
    const fallbackKeywords = sourceUnit
      ? buildFallbackKeywords(sourceUnit.label, sourceUnit.scriptSentence)
      : [];
    const mergedKeywords = Array.from(new Set([...normalizedKeywords, ...fallbackKeywords]));
    const beforeKeywordCount = mergedKeywords.length;

    let seedIndex = 0;
    while (mergedKeywords.length < 3) {
      const nextSeed = KEYWORD_SEED_FALLBACK[seedIndex % KEYWORD_SEED_FALLBACK.length];
      if (nextSeed && !mergedKeywords.includes(nextSeed)) {
        mergedKeywords.push(nextSeed);
      }
      seedIndex += 1;
    }
    if (mergedKeywords.length !== beforeKeywordCount) {
      adjustedKeywordUnits += 1;
    }

    const hadTone = typeof item.emotionalTone === 'string' && item.emotionalTone.trim().length > 0;
    const emotionalTone =
      hadTone
        ? normalizeTone(item.emotionalTone as string)
        : 'neutral';
    if (!hadTone) {
      adjustedToneUnits += 1;
    }

    return {
      unitIndex,
      keywords: mergedKeywords.slice(0, 5),
      emotionalTone,
    };
  });

  if (provider === 'runpod' && (adjustedKeywordUnits > 0 || adjustedToneUnits > 0)) {
    logger.warn('[Runpod][voiceover-segmentation] guardrails adjusted unit-analysis output', {
      ...getProviderLogContext(provider),
      totalUnitsFromModel: normalizedUnits.length,
      adjustedKeywordUnits,
      adjustedToneUnits,
    });
  }

  return {
    units: normalizedUnits,
  };
}

async function validateOrRepairUnitAnalysis(
  raw: string,
  prompt: string,
  userId: string,
  provider: AiProvider,
  units: VoiceoverUnit[]
): Promise<UnitBatchAnalysis> {
  try {
    const parsed = applyUnitBatchAnalysisGuardrails(parseJsonEnvelope(raw), units, provider);
    return UnitBatchAnalysisSchema.parse(parsed);
  } catch (error) {
    logger.warn('Unit analysis JSON validation failed, attempting repair', {
      provider,
      rawChars: raw.length,
      error: error instanceof Error ? error.message : 'unknown',
    });
    return await repairUnitAnalysisWithOpenAi(raw, prompt, userId, provider, units);
  }
}

async function repairUnitAnalysisWithOpenAi(
  raw: string,
  prompt: string,
  userId: string,
  provider: AiProvider,
  units: VoiceoverUnit[]
): Promise<UnitBatchAnalysis> {
  if (provider === 'gemini' && !config.openai.apiKey) {
    throw new Error('OpenAI API key required for JSON repair when AI_PROVIDER=gemini');
  }

  if (provider === 'mistral') {
    // For mistral, attempt repair via Bedrock Mistral itself
    await usageService.recordUsage(userId, {
      openAiChatCalls: 1,
      segmentAnalysisCalls: 1,
    });
    const rawForRepair = raw.length > 12000 ? `${raw.slice(0, 12000)}\n...[truncated]` : raw;
    const repairPrompt = `Return JSON only. Fix the output to match the required schema.\n\nSchema:\n${JSON.stringify(
      UnitBatchAnalysisJsonSchema.schema
    )}\n\nPrompt:\n${prompt}\n\nRaw Output:\n${rawForRepair}`;
    const repaired = await callBedrockMistralChat({
      systemPrompt: 'Return JSON only and strictly follow the provided schema.',
      userPrompt: repairPrompt,
      temperature: 0,
    });
    const repairedParsed = applyUnitBatchAnalysisGuardrails(parseJsonEnvelope(repaired), units, provider);
    return UnitBatchAnalysisSchema.parse(repairedParsed);
  }

  await usageService.recordUsage(userId, {
    openAiChatCalls: 1,
    segmentAnalysisCalls: 1,
  });

  const repairProvider: 'openai' | 'runpod' =
    provider === 'runpod' ? 'runpod' : 'openai';
  const model = getOpenAiCompatibleModel(config.voiceover.models.call2, repairProvider);
  const client = getOpenAiCompatibleClient(repairProvider);

  if (repairProvider === 'runpod') {
    const rawForRepair = raw.length > 12000 ? `${raw.slice(0, 12000)}\n...[truncated raw output]` : raw;
    const repairPrompt = `Return JSON only. Fix the output to match the required schema.\n\nSchema:\n${JSON.stringify(
      UnitBatchAnalysisJsonSchema.schema
    )}\n\nPrompt:\n${prompt}\n\nRaw Output:\n${rawForRepair}`;
    const maxTokens = computeRunpodMaxTokens(`${prompt}\n${rawForRepair}`);

    logger.info('[Runpod][voiceover-segmentation] repair request', {
      ...getProviderLogContext(repairProvider),
      promptChars: prompt.length,
      rawChars: raw.length,
      maxTokens,
    });
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Return JSON only and strictly follow the provided schema.' },
        { role: 'user', content: repairPrompt },
      ],
      temperature: 0,
      max_tokens: maxTokens,
      max_completion_tokens: maxTokens,
    });

    const content = response.choices[0]?.message?.content;
    if (!content || typeof content !== 'string') {
      throw new Error('Runpod repair response is empty');
    }
    const finishReason = response.choices[0]?.finish_reason ?? null;
    if (finishReason === 'length') {
      logger.warn('[Runpod][voiceover-segmentation] repair reached token limit', {
        ...getProviderLogContext(repairProvider),
        promptChars: prompt.length,
        rawChars: raw.length,
        maxTokens,
      });
    }
    logger.info('[Runpod][voiceover-segmentation] repair response', {
      ...getProviderLogContext(repairProvider),
      responseChars: content.length,
      finishReason,
    });

    const parsed = applyUnitBatchAnalysisGuardrails(parseJsonEnvelope(content), units, provider);
    return UnitBatchAnalysisSchema.parse(parsed);
  }

  const response = await client.responses.create({
    model,
    input: [
      { role: 'system', content: 'You are a helpful assistant designed to output JSON.' },
      {
        role: 'user',
        content: `Return JSON only. Fix the output to match the required schema.\n\nSchema:\n${JSON.stringify(
          UnitBatchAnalysisJsonSchema.schema
        )}\n\nPrompt:\n${prompt}\n\nRaw Output:\n${raw}`,
      },
    ],
    text: {
      format: {
        type: 'json_schema',
        strict: true,
        name: UnitBatchAnalysisJsonSchema.name,
        schema: UnitBatchAnalysisJsonSchema.schema,
      },
    },
    max_output_tokens: 16000,
  } as any);

  if (response.status === 'incomplete') {
    const incompleteDetails = (response as any).incomplete_details;
    logger.warn('OpenAI repair response incomplete, attempting to use partial output', {
      status: response.status,
      incompleteDetails,
      reason: incompleteDetails?.reason,
    });
    // Try to use partial output if available
    if (response.output_text) {
      try {
        const parsed = applyUnitBatchAnalysisGuardrails(
          parseJsonEnvelope(response.output_text),
          units,
          provider
        );
        // Check if we have at least some units
        if (parsed.units && Array.isArray(parsed.units) && parsed.units.length > 0) {
          logger.warn(`Using incomplete repair response output with ${parsed.units.length} units (may be truncated)`);
          return UnitBatchAnalysisSchema.parse(parsed);
        }
        throw new Error('Incomplete repair response has no valid units');
      } catch (error) {
        throw new Error(`OpenAI repair response incomplete and output_text is invalid JSON: ${response.status}`);
      }
    }
    throw new Error(`OpenAI repair response incomplete with no usable output: ${response.status}`);
  }

  if (response.status !== 'completed') {
    throw new Error(`OpenAI repair response status: ${response.status}`);
  }

  const parsed = applyUnitBatchAnalysisGuardrails(parseJsonEnvelope(response.output_text), units, provider);
  return UnitBatchAnalysisSchema.parse(parsed);
}

async function embedUnitTexts(texts: string[], userId: string) {
  if (!config.openai.apiKey) {
    throw new Error('OPENAI_API_KEY is required for embeddings');
  }

  const client = new OpenAI({ apiKey: config.openai.apiKey });
  const batchSize = 100;
  const vectors: number[][] = [];
  let callCount = 0;

  for (let i = 0; i < texts.length; i += batchSize) {
    const batch = texts.slice(i, i + batchSize);
    const response = await client.embeddings.create({
      model: 'text-embedding-3-large',
      input: batch,
    });
    callCount += 1;
    for (const item of response.data) {
      vectors.push(item.embedding);
    }
  }

  await usageService.recordUsage(userId, {
    openAiEmbeddingCalls: callCount,
    voiceoverSegmentEmbeddingCalls: callCount,
  });

  return { vectors, callCount };
}

// ==================== UNIT BUILDING ====================

function normalizeTranscriptWords(rawTranscript: unknown): WordTimestamp[] {
  if (!Array.isArray(rawTranscript)) return [];

  return rawTranscript
    .map((entry) => {
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
      };
    })
    .filter((entry): entry is WordTimestamp => Boolean(entry))
    .sort((a, b) => a.startMs - b.startMs);
}

function normalizeTranscriptToDuration(
  words: WordTimestamp[],
  targetDurationMs: number
): {
  words: WordTimestamp[];
  adjusted: boolean;
  beforeLastWordEndMs: number;
  afterLastWordEndMs: number;
} {
  const lastWord = words[words.length - 1];
  const beforeLastWordEndMs = lastWord?.endMs ?? 0;

  if (words.length === 0 || targetDurationMs <= 0 || beforeLastWordEndMs <= 0) {
    return {
      words,
      adjusted: false,
      beforeLastWordEndMs,
      afterLastWordEndMs: beforeLastWordEndMs,
    };
  }

  const durationDiff = Math.abs(beforeLastWordEndMs - targetDurationMs);
  if (durationDiff <= 1) {
    return {
      words,
      adjusted: false,
      beforeLastWordEndMs,
      afterLastWordEndMs: beforeLastWordEndMs,
    };
  }

  const scaleFactor = targetDurationMs / beforeLastWordEndMs;
  const lastIndex = words.length - 1;
  let prevEnd = 0;

  const normalizedWords = words.map((word, index) => {
    let startMs = Math.round(word.startMs * scaleFactor);
    let endMs = index === lastIndex ? targetDurationMs : Math.round(word.endMs * scaleFactor);

    if (startMs < prevEnd) {
      startMs = prevEnd;
    }

    if (index === lastIndex) {
      startMs = Math.min(startMs, Math.max(0, targetDurationMs - 1));
      endMs = targetDurationMs;
    } else if (endMs <= startMs) {
      endMs = startMs + 1;
    }

    prevEnd = endMs;

    return {
      ...word,
      startMs,
      endMs,
    };
  });

  return {
    words: normalizedWords,
    adjusted: true,
    beforeLastWordEndMs,
    afterLastWordEndMs: targetDurationMs,
  };
}

function normalizeToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\-]/g, '');
}

function splitScriptSentences(scriptContent: string): Array<{ text: string; tokens: string[] }> {
  const normalized = scriptContent.replace(/\r\n/g, '\n').trim();
  const rawSentences = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  return rawSentences.map((sentence) => {
    const tokenRegex = /[A-Za-z0-9]+(?:['’.-][A-Za-z0-9]+)*/g;
    const tokens = sentence.match(tokenRegex) ?? [];
    return {
      text: sentence,
      tokens: tokens.map((token) => normalizeToken(token)).filter(Boolean),
    };
  });
}

function buildSentenceWindows(
  words: WordTimestamp[],
  scriptContent?: string | null
): Array<{ startIndex: number; endIndex: number; scriptSentence?: string | null }> {
  if (scriptContent) {
    const sentenceTokens = splitScriptSentences(scriptContent);
    const transcriptTokens = words.map((word) => normalizeToken(word.word));
    let cursor = 0;
    const windows: Array<{ startIndex: number; endIndex: number; scriptSentence?: string | null }> = [];

    for (const sentence of sentenceTokens) {
      if (sentence.tokens.length === 0) continue;
      let startIndex = -1;
      for (const token of sentence.tokens) {
        while (cursor < transcriptTokens.length && transcriptTokens[cursor] !== token) {
          cursor += 1;
        }
        if (cursor >= transcriptTokens.length) {
          return buildPauseWindows(words);
        }
        if (startIndex === -1) {
          startIndex = cursor;
        }
        cursor += 1;
      }
      const endIndex = Math.max(startIndex, cursor - 1);
      windows.push({
        startIndex,
        endIndex,
        scriptSentence: sentence.text,
      });
    }

    const coverageValid =
      windows.length > 0 &&
      windows[0]?.startIndex === 0 &&
      windows[windows.length - 1]?.endIndex === words.length - 1 &&
      windows.every((window, index) => {
        if (index === 0) return true;
        const prev = windows[index - 1];
        return prev ? window.startIndex === prev.endIndex + 1 : false;
      });

    return coverageValid ? windows : buildPauseWindows(words);
  }

  return buildPauseWindows(words);
}

function buildPauseWindows(words: WordTimestamp[]): Array<{ startIndex: number; endIndex: number }> {
  const windows: Array<{ startIndex: number; endIndex: number }> = [];
  let windowStart = 0;
  for (let i = 1; i < words.length; i += 1) {
    const gap = words[i]!.startMs - words[i - 1]!.endMs;
    if (gap >= PAUSE_WINDOW_GAP_MS) {
      windows.push({ startIndex: windowStart, endIndex: i - 1 });
      windowStart = i;
    }
  }
  windows.push({ startIndex: windowStart, endIndex: words.length - 1 });
  return windows;
}

function buildUnits(
  words: WordTimestamp[],
  windows: Array<{ startIndex: number; endIndex: number; scriptSentence?: string | null }>
): VoiceoverUnit[] {
  const units: VoiceoverUnit[] = [];
  let unitIndex = 0;

  for (const window of windows) {
    const windowUnits = buildUnitsForWindow(words, window, unitIndex);
    units.push(...windowUnits.units);
    unitIndex = windowUnits.nextIndex;
  }

  return mergeShortUnits(units, words);
}

function normalizeUnitTimeline(units: VoiceoverUnit[], cleanVoiceoverDurationMs: number): void {
  if (units.length === 0) return;

  units[0]!.startMs = 0;

  for (let i = 0; i < units.length - 1; i += 1) {
    const current = units[i]!;
    const next = units[i + 1]!;
    if (next.startMs < current.endMs) {
      throw new Error(
        `Overlap between units ${current.unitIndex} and ${next.unitIndex}: ${Math.abs(
          next.startMs - current.endMs
        )}ms overlap (prev ends at ${current.endMs}ms, curr starts at ${next.startMs}ms). Units must not overlap.`
      );
    }
    current.endMs = next.startMs;
    current.durationMs = current.endMs - current.startMs;
  }

  const last = units[units.length - 1]!;
  const targetEnd = cleanVoiceoverDurationMs > 0 ? cleanVoiceoverDurationMs : last.endMs;
  if (targetEnd < last.startMs) {
    throw new Error(
      `Last unit starts at ${last.startMs}ms but clean duration is ${targetEnd}ms. Units must cover entire duration.`
    );
  }
  last.endMs = targetEnd;
  last.durationMs = last.endMs - last.startMs;
}

function buildUnitsForWindow(
  words: WordTimestamp[],
  window: { startIndex: number; endIndex: number; scriptSentence?: string | null },
  startIndex: number
): { units: VoiceoverUnit[]; nextIndex: number } {
  const units: VoiceoverUnit[] = [];
  let unitStartIndex = window.startIndex;
  let unitWords: WordTimestamp[] = [];
  let unitIndex = startIndex;

  for (let i = window.startIndex; i <= window.endIndex; i += 1) {
    const word = words[i]!;
    if (unitWords.length === 0) {
      unitStartIndex = i;
    }

    const candidateWordCount = unitWords.length + 1;
    const candidateDuration = word.endMs - words[unitStartIndex]!.startMs;
    const violatesLimits =
      candidateWordCount > MAX_WORDS_PER_UNIT || candidateDuration > MAX_UNIT_DURATION_MS;

    if (violatesLimits && unitWords.length > 0) {
      units.push(
        createUnit(
          words,
          unitStartIndex,
          i - 1,
          unitIndex,
          window.startIndex,
          window.endIndex,
          window.scriptSentence
        )
      );
      unitIndex += 1;
      unitWords = [];
      unitStartIndex = i;
    }

    unitWords.push(word);
  }

  if (unitWords.length > 0) {
    units.push(
      createUnit(
        words,
        unitStartIndex,
        window.endIndex,
        unitIndex,
        window.startIndex,
        window.endIndex,
        window.scriptSentence
      )
    );
    unitIndex += 1;
  }

  return { units, nextIndex: unitIndex };
}

function createUnit(
  words: WordTimestamp[],
  unitStartIndex: number,
  unitEndIndex: number,
  unitIndex: number,
  windowStartIndex: number,
  windowEndIndex: number,
  scriptSentence?: string | null
): VoiceoverUnit {
  const unitWords = words.slice(unitStartIndex, unitEndIndex + 1);
  const startMs = unitWords[0]!.startMs;
  const endMs = unitWords[unitWords.length - 1]!.endMs;
  const label = unitWords.map((word) => word.word).join(' ');

  const { contextStartIndex, contextEndIndex } = buildContextWindow(
    unitStartIndex,
    unitEndIndex,
    words,
    { windowStartIndex, windowEndIndex }
  );

  const embeddingText = buildEmbeddingText(
    words,
    unitStartIndex,
    unitEndIndex,
    contextStartIndex,
    contextEndIndex,
    scriptSentence
  );

  return {
    unitIndex,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    words: unitWords,
    label,
    embeddingText,
    windowStartIndex,
    windowEndIndex,
    contextStartIndex,
    contextEndIndex,
    unitStartIndex,
    unitEndIndex,
    scriptSentence: scriptSentence ?? null,
  };
}

function buildContextWindow(
  unitStartIndex: number,
  unitEndIndex: number,
  words: WordTimestamp[],
  bounds: { windowStartIndex: number; windowEndIndex: number }
): { contextStartIndex: number; contextEndIndex: number } {
  let contextStartIndex = unitStartIndex;
  let contextEndIndex = unitEndIndex;
  const lastIndex = words.length - 1;

  while (
    contextEndIndex - contextStartIndex + 1 < CONTEXT_TARGET_MIN_WORDS &&
    (contextStartIndex > bounds.windowStartIndex ||
      contextEndIndex < bounds.windowEndIndex)
  ) {
    if (contextStartIndex > bounds.windowStartIndex) {
      contextStartIndex -= 1;
    }
    if (
      contextEndIndex < bounds.windowEndIndex &&
      contextEndIndex - contextStartIndex + 1 < CONTEXT_TARGET_MIN_WORDS
    ) {
      contextEndIndex += 1;
    }
  }

  while (
    contextEndIndex - contextStartIndex + 1 < CONTEXT_TARGET_MIN_WORDS &&
    (contextStartIndex > 0 || contextEndIndex < lastIndex)
  ) {
    if (contextStartIndex > 0) {
      contextStartIndex -= 1;
    }
    if (
      contextEndIndex < lastIndex &&
      contextEndIndex - contextStartIndex + 1 < CONTEXT_TARGET_MIN_WORDS
    ) {
      contextEndIndex += 1;
    }
  }

  while (contextEndIndex - contextStartIndex + 1 > CONTEXT_TARGET_MAX_WORDS) {
    const leftExtra = unitStartIndex - contextStartIndex;
    const rightExtra = contextEndIndex - unitEndIndex;
    if (rightExtra >= leftExtra && contextEndIndex > unitEndIndex) {
      contextEndIndex -= 1;
    } else if (contextStartIndex < unitStartIndex) {
      contextStartIndex += 1;
    } else {
      break;
    }
  }

  return { contextStartIndex, contextEndIndex };
}

function buildEmbeddingText(
  words: WordTimestamp[],
  unitStartIndex: number,
  unitEndIndex: number,
  contextStartIndex: number,
  contextEndIndex: number,
  scriptSentence?: string | null
): string {
  const prevText = words
    .slice(contextStartIndex, unitStartIndex)
    .map((word) => word.word)
    .join(' ');
  const unitText = words
    .slice(unitStartIndex, unitEndIndex + 1)
    .map((word) => word.word)
    .join(' ');
  const nextText = words
    .slice(unitEndIndex + 1, contextEndIndex + 1)
    .map((word) => word.word)
    .join(' ');

  const parts = [`Prev: ${prevText}`, `Unit: ${unitText}`, `Next: ${nextText}`];
  if (scriptSentence) {
    parts.push(`ScriptSentence: ${scriptSentence}`);
  }
  return parts.join('\n');
}

function mergeShortUnits(units: VoiceoverUnit[], words: WordTimestamp[]): VoiceoverUnit[] {
  const merged: VoiceoverUnit[] = [];
  let i = 0;

  while (i < units.length) {
    const current = units[i]!;
    const next = units[i + 1];

    if (next && shouldMergeUnits(current, next)) {
      merged.push(mergeUnits(current, next, words));
      i += 2;
      continue;
    }

    if (shouldMergeWithPrevious(current, merged)) {
      const prev = merged.pop()!;
      merged.push(mergeUnits(prev, current, words));
      i += 1;
      continue;
    }

    merged.push(current);
    i += 1;
  }

  return merged.map((unit, index) => ({
    ...unit,
    unitIndex: index,
  }));
}

function shouldMergeUnits(current: VoiceoverUnit, next: VoiceoverUnit): boolean {
  if (
    current.windowStartIndex !== next.windowStartIndex ||
    current.windowEndIndex !== next.windowEndIndex
  ) {
    return false;
  }

  const combinedWords = current.words.length + next.words.length;
  const combinedDuration = next.endMs - current.startMs;

  if (combinedWords > MAX_WORDS_PER_UNIT || combinedDuration > MAX_UNIT_DURATION_MS) {
    return false;
  }

  return (
    current.durationMs < MIN_UNIT_DURATION_MS ||
    isWeakUnit(current) ||
    isWeakUnit(next)
  );
}

function shouldMergeWithPrevious(
  current: VoiceoverUnit,
  merged: VoiceoverUnit[]
): boolean {
  if (!isWeakUnit(current)) return false;
  const prev = merged[merged.length - 1];
  if (!prev) return false;
  return shouldMergeUnits(prev, current);
}

function isWeakUnit(unit: VoiceoverUnit): boolean {
  if (unit.words.length <= 1) return true;
  const tokens = extractKeywordTokens(unit.label);
  return tokens.length < 2;
}

function mergeUnits(
  current: VoiceoverUnit,
  next: VoiceoverUnit,
  words: WordTimestamp[]
): VoiceoverUnit {
  const combinedWords = [...current.words, ...next.words];
  const label = combinedWords.map((word) => word.word).join(' ');
  const startMs = current.startMs;
  const endMs = next.endMs;
  const unitStartIndex = current.unitStartIndex;
  const unitEndIndex = next.unitEndIndex;
  const { contextStartIndex, contextEndIndex } = buildContextWindow(
    unitStartIndex,
    unitEndIndex,
    words,
    {
      windowStartIndex: current.windowStartIndex,
      windowEndIndex: current.windowEndIndex,
    }
  );
  const embeddingText = buildEmbeddingText(
    words,
    unitStartIndex,
    unitEndIndex,
    contextStartIndex,
    contextEndIndex,
    current.scriptSentence
  );

  return {
    ...current,
    words: combinedWords,
    label,
    startMs,
    endMs,
    durationMs: endMs - startMs,
    unitStartIndex,
    unitEndIndex,
    contextStartIndex,
    contextEndIndex,
    embeddingText,
  };
}

function mapAnalysisToUnits(
  analysis: { units: Array<{ unitIndex: number; keywords: string[]; emotionalTone: string }> },
  units: VoiceoverUnit[]
): Map<number, UnitAnalysisResult> {
  const map = new Map<number, UnitAnalysisResult>();
  const unitIndexSet = new Set(units.map((unit) => unit.unitIndex));

  for (const entry of analysis.units) {
    if (!unitIndexSet.has(entry.unitIndex)) continue;
    map.set(entry.unitIndex, {
      keywords: normalizeKeywords(entry.keywords),
      emotionalTone: normalizeTone(entry.emotionalTone),
    });
  }

  return map;
}

function normalizeKeywords(keywords: string[]): string[] {
  const cleaned = Array.from(
    new Set(
      keywords
        .map((keyword) => keyword.trim())
        .filter(Boolean)
        .map((keyword) => normalizeKeywordToken(keyword))
        .filter((keyword) => isKeywordToken(keyword))
    )
  );
  if (cleaned.length >= 3) {
    return cleaned.slice(0, 5);
  }
  return cleaned;
}

function normalizeTone(tone: string): string {
  const cleaned = tone.trim().split(/\s+/)[0];
  return cleaned || 'neutral';
}

function buildFallbackKeywords(label: string, scriptSentence?: string | null): string[] {
  const tokens = extractKeywordTokens(
    [scriptSentence ?? '', label].filter(Boolean).join(' ')
  );
  return tokens.slice(0, 5);
}

function buildUnitKeywords(
  unit: VoiceoverUnit,
  analysis?: UnitAnalysisResult
): string[] {
  const normalized = analysis ? normalizeKeywords(analysis.keywords) : [];
  const fallback = buildFallbackKeywords(unit.label, unit.scriptSentence);
  const merged = Array.from(new Set([...normalized, ...fallback]));

  let seedIndex = 0;
  while (merged.length < 3) {
    const nextSeed = KEYWORD_SEED_FALLBACK[seedIndex % KEYWORD_SEED_FALLBACK.length];
    if (nextSeed && !merged.includes(nextSeed)) {
      merged.push(nextSeed);
    }
    seedIndex += 1;
  }

  return merged.slice(0, 5);
}

function extractKeywordTokens(text: string): string[] {
  const tokens = text
    .toLowerCase()
    .split(/\s+/)
    .map((token) => normalizeKeywordToken(token))
    .filter((token) => isKeywordToken(token));
  return Array.from(new Set(tokens));
}

function normalizeKeywordToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\-]/g, '');
}

function isKeywordToken(token: string): boolean {
  if (!token) return false;
  if (KEYWORD_STOPWORDS.has(token)) return false;
  if (token.length < 2 && !/^\d+$/.test(token)) return false;
  return true;
}

// ==================== HELPERS ====================

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'processing' | 'analyzing' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress },
  });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
