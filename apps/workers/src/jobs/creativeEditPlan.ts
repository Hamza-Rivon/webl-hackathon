/**
 * Creative Edit Plan Job
 *
 * LLM-powered "Creative Director" that sits between semantic_matching
 * and cut_plan_generation. Analyzes the full script, emotional tones,
 * and matched B-roll candidates to produce intelligent per-segment
 * edit decisions (source selection, pacing, preferred B-roll).
 *
 * Pipeline position:
 *   semantic_matching -> creative_edit_plan -> cut_plan_generation
 *
 * Graceful fallback: if any LLM batch fails or returns invalid JSON,
 * auto-normalize missing decisions with deterministic defaults and
 * still trigger cut_plan_generation.
 */

import { Job } from 'bullmq';
import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { prisma } from '../services/db.js';
import { config } from '../config.js';
import { progressPublisher, type ProgressStage, type ProgressStatus } from '../services/progress.js';
import { logger } from '@webl/shared';
import { triggerCutPlanGenerationSafely } from '../services/episodeReadiness.js';
import { usageService } from '../services/usage.js';
import {
  getOpenAiCompatibleClient,
  getOpenAiCompatibleModel,
  getProviderLogContext,
} from '../services/llmProvider.js';
import { callBedrockMistralChat } from '../services/bedrockMistral.js';

// ==================== TYPES ====================

interface CreativeEditPlanJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  triggeredBy?: string;
  forceReplan?: boolean;
}

export interface CreativeEditDecision {
  segmentIndex: number;
  source: 'a_roll' | 'b_roll';
  preferredChunkId?: string;
  targetCutDurationMs: number;
  pacingIntent: 'rapid' | 'medium' | 'hold';
  editReason?: string;
}

interface CandidateChunk {
  id: string;
  aiTags: string[] | null;
  aiSummary: string | null;
}

interface EnrichedCandidate {
  chunkId: string;
  aiTags: string[];
  aiSummary: string | null;
  matchScore: number;
}

interface EnrichedSegment {
  segmentIndex: number;
  text: string;
  startMs: number;
  endMs: number;
  durationMs: number;
  emotionalTone: string | null;
  keywords: string[];
  candidates: EnrichedCandidate[];
}

interface ScriptBeatContext {
  beatType?: string;
  energy?: number;
  emotion?: string;
  text?: string;
}

interface CreativePromptBatch {
  batchIndex: number;
  batchCount: number;
  prompt: string;
  promptChars: number;
  segments: EnrichedSegment[];
}

// ==================== CONSTANTS ====================

const MAX_CANDIDATES_PER_SEGMENT = 5;
const MAX_CANDIDATES_PER_SEGMENT_IN_PROMPT = 4;
const MAX_SEGMENTS_PER_BATCH = 28;
const MAX_PROMPT_CHARS_PER_BATCH = 26000;
const MAX_SCRIPT_CONTEXT_CHARS = 1800;
const MAX_SEGMENT_TEXT_CHARS = 170;
const MAX_CANDIDATE_SUMMARY_CHARS = 72;
const MAX_CANDIDATE_TAGS = 4;
const MAX_KEYWORDS_PER_SEGMENT = 6;
const MAX_GLOBAL_KEYWORDS = 12;
const MAX_SCRIPT_BEATS_IN_PROMPT = 10;
const HOOK_AROLL_MS = 3500;
const MAX_RETRIES = 2;
const DEFAULT_RAPID_DURATION_MS = 950;
const DEFAULT_MEDIUM_DURATION_MS = 1450;
const DEFAULT_HOLD_DURATION_MS = 2050;

// ==================== HELPERS ====================

type CreativeDirectorProvider = 'openai' | 'gemini' | 'runpod' | 'mistral';

function getGeminiModel(): GenerativeModel {
  const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
  return genAI.getGenerativeModel({
    model: config.ai.geminiModel,
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0.2,
      maxOutputTokens: 4096,
    },
  });
}

async function updateProgress(
  jobId: string,
  status: ProgressStatus,
  progress: number,
  message: string,
  stage?: ProgressStage,
): Promise<void> {
  const resolvedStage: ProgressStage = stage ?? (status === 'done' ? 'done' : 'processing');
  await prisma.job.update({
    where: { id: jobId },
    data: { status, progress, stage: resolvedStage },
  });
  await progressPublisher.publish(jobId, status, resolvedStage, progress, message);
}

function resolveCreativeDirectorProvider(): CreativeDirectorProvider {
  if (config.ai.provider === 'mistral') {
    if (
      config.bedrock.bearerToken ||
      (config.bedrock.accessKeyId && config.bedrock.secretAccessKey)
    ) {
      return 'mistral';
    }
    throw new Error(
      'Creative Director LLM is not configured: AI_PROVIDER=mistral but no Bedrock credentials'
    );
  }

  if (config.ai.provider === 'runpod') {
    if (config.vllm.baseUrl) return 'runpod';
    throw new Error(
      'Creative Director LLM is not configured: AI_PROVIDER=runpod but VLLM_BASE_URL is missing'
    );
  }

  if (config.ai.provider === 'openai') {
    if (config.openai.apiKey) return 'openai';
    if (config.ai.geminiApiKey) {
      logger.warn(
        '[Phase 3.5] Creative Director configured for OpenAI but OPENAI_API_KEY is missing, falling back to Gemini'
      );
      return 'gemini';
    }
    throw new Error('Creative Director LLM is not configured: OPENAI_API_KEY missing and no GEMINI_API_KEY fallback');
  }

  if (config.ai.geminiApiKey) return 'gemini';
  if (config.openai.apiKey) {
    logger.warn(
      '[Phase 3.5] Creative Director configured for Gemini but GEMINI_API_KEY is missing, falling back to OpenAI'
    );
    return 'openai';
  }

  throw new Error('Creative Director LLM is not configured: no GEMINI_API_KEY or OPENAI_API_KEY');
}

async function callCreativeDirectorLlm(args: {
  provider: CreativeDirectorProvider;
  prompt: string;
}): Promise<{
  rawText: string;
  model: string;
  responseMeta: Record<string, unknown>;
}> {
  if (args.provider === 'mistral') {
    const model = config.bedrock.mistralModel;
    const rawText = await callBedrockMistralChat({
      systemPrompt: 'You are a professional short-form video editor. Return valid JSON only.',
      userPrompt: args.prompt,
      temperature: 0.2,
    });
    if (!rawText || typeof rawText !== 'string') {
      throw new Error('Mistral Creative Director response is empty');
    }
    return { rawText, model, responseMeta: {} };
  }

  if (args.provider !== 'gemini') {
    const model = getOpenAiCompatibleModel(config.openai.model, args.provider);
    const client = getOpenAiCompatibleClient(args.provider);
    const response = await client.chat.completions.create({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are a professional short-form video editor. Return valid JSON only.',
        },
        {
          role: 'user',
          content: args.prompt,
        },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    });

    const rawText = response.choices[0]?.message?.content;
    if (!rawText || typeof rawText !== 'string') {
      throw new Error(`${args.provider.toUpperCase()} Creative Director response is empty`);
    }

    return {
      rawText,
      model,
      responseMeta: {
        id: response.id,
        created: response.created,
        finishReason: response.choices[0]?.finish_reason ?? null,
        usage: response.usage ?? null,
      },
    };
  }

  const model = config.ai.geminiModel;
  const geminiModel = getGeminiModel();
  const response = await geminiModel.generateContent(args.prompt);
  const rawText = response.response.text();
  if (!rawText || typeof rawText !== 'string') {
    throw new Error('Gemini Creative Director response is empty');
  }

  return {
    rawText,
    model,
    responseMeta: {
      usageMetadata: (response.response as unknown as { usageMetadata?: unknown }).usageMetadata ?? null,
      promptFeedback: (response.response as unknown as { promptFeedback?: unknown }).promptFeedback ?? null,
    },
  };
}

// ==================== PROMPT BUILDER ====================

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function truncateText(value: string | null | undefined, maxChars: number): string {
  const compact = collapseWhitespace(value || '');
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, Math.max(0, maxChars - 3))}...`;
}

function normalizePacingIntent(value: unknown): 'rapid' | 'medium' | 'hold' {
  if (value === 'rapid' || value === 'medium' || value === 'hold') {
    return value;
  }
  return 'medium';
}

function inferPacingIntentFromTone(tone: string | null): 'rapid' | 'medium' | 'hold' {
  const normalized = (tone || '').toLowerCase();
  if (['urgent', 'excited', 'angry', 'frustrated', 'surprised', 'passionate'].includes(normalized)) {
    return 'rapid';
  }
  if (['vulnerable', 'reflective', 'sad', 'calm', 'intimate', 'warm'].includes(normalized)) {
    return 'hold';
  }
  return 'medium';
}

function defaultTargetDurationMs(pacing: 'rapid' | 'medium' | 'hold'): number {
  if (pacing === 'rapid') return DEFAULT_RAPID_DURATION_MS;
  if (pacing === 'hold') return DEFAULT_HOLD_DURATION_MS;
  return DEFAULT_MEDIUM_DURATION_MS;
}

function clampTargetDurationMs(value: number): number {
  return Math.max(700, Math.min(2500, Math.round(value)));
}

function buildGlobalKeywordHints(segments: EnrichedSegment[]): string[] {
  const counts = new Map<string, number>();
  for (const segment of segments) {
    for (const rawKeyword of segment.keywords) {
      const keyword = rawKeyword.toLowerCase().trim();
      if (!keyword) continue;
      counts.set(keyword, (counts.get(keyword) ?? 0) + 1);
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_GLOBAL_KEYWORDS)
    .map(([keyword]) => keyword);
}

function buildFallbackDecision(
  segment: EnrichedSegment,
  isArollFirst: boolean,
  reason: string
): CreativeEditDecision {
  const hasCandidates = segment.candidates.length > 0;
  const pacingIntent = inferPacingIntentFromTone(segment.emotionalTone);

  let source: 'a_roll' | 'b_roll';
  if (isArollFirst) {
    source = segment.startMs < HOOK_AROLL_MS || !hasCandidates ? 'a_roll' : 'b_roll';
  } else {
    source = hasCandidates ? 'b_roll' : 'a_roll';
  }

  return {
    segmentIndex: segment.segmentIndex,
    source,
    preferredChunkId: source === 'b_roll' ? segment.candidates[0]?.chunkId : undefined,
    targetCutDurationMs: clampTargetDurationMs(defaultTargetDurationMs(pacingIntent)),
    pacingIntent,
    editReason: reason,
  };
}

function buildCreativeDirectorPrompt(args: {
  scriptContent: string;
  scriptBeats: ScriptBeatContext[] | null;
  globalKeywords: string[];
  segments: EnrichedSegment[];
  isArollFirst: boolean;
  totalDurationMs: number;
  totalSegments: number;
  batchIndex: number;
  batchCount: number;
}): string {
  const {
    scriptContent,
    scriptBeats,
    globalKeywords,
    segments,
    isArollFirst,
    totalDurationMs,
    totalSegments,
    batchIndex,
    batchCount,
  } = args;

  const scriptSummary = truncateText(scriptContent, MAX_SCRIPT_CONTEXT_CHARS);
  const beatsPayload = (scriptBeats ?? [])
    .slice(0, MAX_SCRIPT_BEATS_IN_PROMPT)
    .map((beat) => ({
      beatType: beat.beatType || 'content',
      energy: typeof beat.energy === 'number' ? beat.energy : null,
      emotion: beat.emotion || null,
      text: truncateText(beat.text, 90) || null,
    }));

  const segmentPayload = segments.map((segment) => ({
    segmentIndex: segment.segmentIndex,
    startMs: segment.startMs,
    endMs: segment.endMs,
    durationMs: segment.durationMs,
    emotionalTone: segment.emotionalTone || null,
    text: truncateText(segment.text, MAX_SEGMENT_TEXT_CHARS),
    keywords: segment.keywords.slice(0, MAX_KEYWORDS_PER_SEGMENT),
    candidates: segment.candidates.slice(0, MAX_CANDIDATES_PER_SEGMENT_IN_PROMPT).map((candidate) => ({
      chunkId: candidate.chunkId,
      matchScore: Number(candidate.matchScore.toFixed(4)),
      aiTags: candidate.aiTags.slice(0, MAX_CANDIDATE_TAGS),
      aiSummary: truncateText(candidate.aiSummary, MAX_CANDIDATE_SUMMARY_CHARS) || null,
    })),
  }));

  const payload = {
    templateMode: isArollFirst ? 'a_roll_first' : 'b_roll_only',
    totalDurationMs,
    totalSegments,
    batchIndex,
    batchCount,
    requestedSegmentIndices: segmentPayload.map((segment) => segment.segmentIndex),
    globalKeywordHints: globalKeywords,
    scriptSummary,
    beats: beatsPayload,
    segments: segmentPayload,
  };

  return [
    'You are a high-precision short-form video creative director.',
    `Return decisions for batch ${batchIndex}/${batchCount}.`,
    'Output must be valid JSON only with this top-level shape:',
    '{"decisions":[{"segmentIndex":0,"source":"a_roll","preferredChunkId":null,"targetCutDurationMs":1450,"pacingIntent":"medium","editReason":"..."}]}',
    'Hard requirements:',
    '- Return exactly one decision for each segment index in requestedSegmentIndices.',
    '- Do not return decisions for indices outside requestedSegmentIndices.',
    '- source must be "a_roll" or "b_roll".',
    '- preferredChunkId must be null for a_roll, and must match one candidate chunkId for b_roll.',
    '- targetCutDurationMs must be 700-2500.',
    '- pacingIntent must be one of rapid|medium|hold.',
    '- Keep editReason short (<= 16 words).',
    '- Prefer highest matchScore candidate unless semantic mismatch is obvious.',
    '- Avoid repeating the same preferredChunkId in consecutive segments when alternatives exist.',
    '- For a_roll_first template: use a_roll for first 3.5 seconds (hook) and for personal/vulnerable beats.',
    '- For b_roll_only template: use b_roll whenever candidates exist.',
    'INPUT_PAYLOAD_JSON:',
    JSON.stringify(payload),
  ].join('\n');
}

function buildCreativePromptBatches(args: {
  scriptContent: string;
  scriptBeats: ScriptBeatContext[] | null;
  segments: EnrichedSegment[];
  isArollFirst: boolean;
  totalDurationMs: number;
}): CreativePromptBatch[] {
  const initialBatches: EnrichedSegment[][] = [];
  for (let cursor = 0; cursor < args.segments.length; cursor += MAX_SEGMENTS_PER_BATCH) {
    initialBatches.push(args.segments.slice(cursor, cursor + MAX_SEGMENTS_PER_BATCH));
  }

  const boundedBatches: EnrichedSegment[][] = [];
  const queue = [...initialBatches];
  const globalKeywords = buildGlobalKeywordHints(args.segments);

  while (queue.length > 0) {
    const current = queue.shift()!;
    const probePrompt = buildCreativeDirectorPrompt({
      scriptContent: args.scriptContent,
      scriptBeats: args.scriptBeats,
      globalKeywords,
      segments: current,
      isArollFirst: args.isArollFirst,
      totalDurationMs: args.totalDurationMs,
      totalSegments: args.segments.length,
      batchIndex: 1,
      batchCount: 1,
    });

    if (probePrompt.length <= MAX_PROMPT_CHARS_PER_BATCH || current.length <= 1) {
      boundedBatches.push(current);
      continue;
    }

    const splitAt = Math.ceil(current.length / 2);
    const first = current.slice(0, splitAt);
    const second = current.slice(splitAt);
    queue.unshift(second);
    queue.unshift(first);
  }

  return boundedBatches.map((segments, index) => {
    const prompt = buildCreativeDirectorPrompt({
      scriptContent: args.scriptContent,
      scriptBeats: args.scriptBeats,
      globalKeywords,
      segments,
      isArollFirst: args.isArollFirst,
      totalDurationMs: args.totalDurationMs,
      totalSegments: args.segments.length,
      batchIndex: index + 1,
      batchCount: boundedBatches.length,
    });

    return {
      batchIndex: index + 1,
      batchCount: boundedBatches.length,
      prompt,
      promptChars: prompt.length,
      segments,
    };
  });
}

function hasLikelyTruncatedResponse(rawText: string, responseMeta: Record<string, unknown>): boolean {
  const finishReason = responseMeta.finishReason;
  if (finishReason === 'length') {
    return true;
  }

  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  return firstBrace < 0 || lastBrace <= firstBrace;
}

function parseCreativeDirectorResponsePayload(rawText: string): { decisions: unknown[] } {
  const cleaned = rawText.replace(/```json/gi, '').replace(/```/g, '').trim();
  const parseCandidates: string[] = [cleaned];
  const firstBrace = cleaned.indexOf('{');
  const lastBrace = cleaned.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    parseCandidates.push(cleaned.slice(firstBrace, lastBrace + 1));
  }

  for (const candidate of parseCandidates) {
    try {
      const parsed = JSON.parse(candidate) as { decisions?: unknown };
      if (parsed && Array.isArray(parsed.decisions)) {
        return { decisions: parsed.decisions };
      }
    } catch {
      // Try next parse candidate.
    }
  }

  throw new Error('Unable to parse Creative Director JSON payload');
}

function normalizeCreativeDecisionsForBatch(args: {
  rawDecisions: unknown[];
  batchSegments: EnrichedSegment[];
  isArollFirst: boolean;
}): {
  decisions: CreativeEditDecision[];
  rawCount: number;
  fallbackCount: number;
  correctedCount: number;
} {
  const batchIndexSet = new Set(args.batchSegments.map((segment) => segment.segmentIndex));
  const rawBySegmentIndex = new Map<number, Record<string, unknown>>();

  for (const rawDecision of args.rawDecisions) {
    if (!rawDecision || typeof rawDecision !== 'object') continue;
    const entry = rawDecision as Record<string, unknown>;
    const rawIndex = Number(entry.segmentIndex);
    if (!Number.isFinite(rawIndex) || !batchIndexSet.has(rawIndex)) continue;
    if (!rawBySegmentIndex.has(rawIndex)) {
      rawBySegmentIndex.set(rawIndex, entry);
    }
  }

  const decisions: CreativeEditDecision[] = [];
  let fallbackCount = 0;
  let correctedCount = 0;

  for (const segment of args.batchSegments) {
    const raw = rawBySegmentIndex.get(segment.segmentIndex);
    if (!raw) {
      fallbackCount += 1;
      decisions.push(
        buildFallbackDecision(segment, args.isArollFirst, 'Auto fallback: missing LLM decision')
      );
      continue;
    }

    const candidateIds = new Set(segment.candidates.map((candidate) => candidate.chunkId));
    const hasCandidates = candidateIds.size > 0;

    let source: 'a_roll' | 'b_roll' = raw.source === 'b_roll' ? 'b_roll' : 'a_roll';
    if (!args.isArollFirst && hasCandidates) {
      source = 'b_roll';
    }
    if (args.isArollFirst && segment.startMs < HOOK_AROLL_MS) {
      source = 'a_roll';
    }

    let preferredChunkId =
      typeof raw.preferredChunkId === 'string' && raw.preferredChunkId.trim().length > 0
        ? raw.preferredChunkId.trim()
        : undefined;

    if (source === 'b_roll') {
      if (!preferredChunkId || !candidateIds.has(preferredChunkId)) {
        preferredChunkId = segment.candidates[0]?.chunkId;
        correctedCount += 1;
      }
      if (!preferredChunkId) {
        source = 'a_roll';
        correctedCount += 1;
      }
    } else {
      preferredChunkId = undefined;
    }

    const pacingIntent = normalizePacingIntent(raw.pacingIntent);
    const parsedDuration = Number(raw.targetCutDurationMs);
    const targetCutDurationMs = clampTargetDurationMs(
      Number.isFinite(parsedDuration) ? parsedDuration : defaultTargetDurationMs(pacingIntent)
    );

    const editReason = truncateText(
      typeof raw.editReason === 'string' ? raw.editReason : '',
      140
    );

    decisions.push({
      segmentIndex: segment.segmentIndex,
      source,
      preferredChunkId,
      targetCutDurationMs,
      pacingIntent,
      editReason: editReason || undefined,
    });
  }

  return {
    decisions,
    rawCount: rawBySegmentIndex.size,
    fallbackCount,
    correctedCount,
  };
}

// ==================== MAIN PROCESSOR ====================

export async function processCreativeEditPlan(bullJob: Job): Promise<void> {
  const data = bullJob.data as CreativeEditPlanJobData;
  const { jobId, episodeId, userId } = data;

  try {
    await updateProgress(jobId, 'processing', 5, 'Loading episode data');

    // ---------- 1. Load episode ----------
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      include: { template: true },
    });

    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    // ---------- 2. Check usage limits ----------
    const canProceed = await usageService.checkCanProceed(userId);
    if (!canProceed.allowed) {
      throw new Error(`Usage limit exceeded: ${canProceed.reason}`);
    }

    await updateProgress(jobId, 'processing', 10, 'Loading voiceover segments');

    // ---------- 3. Load voiceover segments with candidates ----------
    const segments = await prisma.voiceoverSegment.findMany({
      where: { episodeId },
      orderBy: { segmentIndex: 'asc' },
      select: {
        id: true,
        segmentIndex: true,
        text: true,
        startMs: true,
        endMs: true,
        durationMs: true,
        emotionalTone: true,
        keywords: true,
        metadata: true,
        matchedChunkId: true,
        matchScore: true,
      },
    });

    if (segments.length === 0) {
      logger.warn(`No voiceover segments found for episode ${episodeId}, skipping creative edit plan`);
      await updateProgress(jobId, 'done', 100, 'Skipped — no segments');
      await triggerCutPlanAfterCreativeEdit(episodeId, userId, data);
      return;
    }

    await updateProgress(jobId, 'processing', 20, 'Loading B-roll candidates');

    // ---------- 4. Load top candidates per segment ----------
    const candidateChunkIds = new Set<string>();
    for (const seg of segments) {
      const meta = seg.metadata as Record<string, unknown> | null;
      const candidates = (meta?.candidates || []) as Array<{ chunkId: string; score: number }>;
      for (const c of candidates.slice(0, MAX_CANDIDATES_PER_SEGMENT)) {
        candidateChunkIds.add(c.chunkId);
      }
      if (seg.matchedChunkId) {
        candidateChunkIds.add(seg.matchedChunkId);
      }
    }

    const chunks: CandidateChunk[] = candidateChunkIds.size > 0
      ? await prisma.brollChunk.findMany({
          where: { id: { in: Array.from(candidateChunkIds) } },
          select: {
            id: true,
            aiTags: true,
            aiSummary: true,
          },
        })
      : [];

    const chunkMap = new Map<string, CandidateChunk>(
      chunks.map((c: CandidateChunk): [string, CandidateChunk] => [c.id, c]),
    );

    await updateProgress(jobId, 'processing', 30, 'Building LLM prompt');

    // ---------- 5. Build prompt context ----------
    const enrichedSegments: EnrichedSegment[] = segments.map((seg: (typeof segments)[number]) => {
      const meta = seg.metadata as Record<string, unknown> | null;
      const rawCandidates = (meta?.candidates || []) as Array<{ chunkId: string; score: number }>;

      const candidates: EnrichedCandidate[] = rawCandidates
        .slice(0, MAX_CANDIDATES_PER_SEGMENT)
        .map((c: { chunkId: string; score: number }) => {
          const chunk = chunkMap.get(c.chunkId);
          return {
            chunkId: c.chunkId,
            aiTags: (chunk?.aiTags as string[]) || [],
            aiSummary: (chunk?.aiSummary as string) || null,
            matchScore: c.score || seg.matchScore || 0,
          };
        })
        .sort((a, b) => b.matchScore - a.matchScore);

      if (
        seg.matchedChunkId &&
        !candidates.some((candidate) => candidate.chunkId === seg.matchedChunkId)
      ) {
        const matchedChunk = chunkMap.get(seg.matchedChunkId);
        candidates.push({
          chunkId: seg.matchedChunkId,
          aiTags: (matchedChunk?.aiTags as string[]) || [],
          aiSummary: (matchedChunk?.aiSummary as string) || null,
          matchScore: seg.matchScore || 0,
        });
      }
      candidates.sort((a, b) => b.matchScore - a.matchScore);

      return {
        segmentIndex: seg.segmentIndex,
        text: collapseWhitespace(seg.text || ''),
        startMs: seg.startMs,
        endMs: seg.endMs,
        durationMs: seg.durationMs,
        emotionalTone: seg.emotionalTone,
        keywords: ((seg.keywords as string[]) || []).map((keyword) => collapseWhitespace(keyword)).filter(Boolean),
        candidates,
      };
    });

    const scriptBeats = (episode.scriptBeats as Array<Record<string, unknown>>) || null;
    const normalizedBeats: ScriptBeatContext[] | null = scriptBeats?.map((b) => ({
      beatType: (b.beatType as string) || (b.type as string) || 'content',
      energy: (b.energy as number) || undefined,
      emotion: (b.emotion as string) || undefined,
      text: (b.text as string) || undefined,
    })) || null;

    const isArollFirst = Boolean(
      (episode.template?.slotRequirements as { workflow?: string })?.workflow === 'aroll_clean_then_broll',
    );

    const totalDurationMs = (episode.cleanVoiceoverDuration || 60) * 1000;

    const promptBatches = buildCreativePromptBatches({
      scriptContent: episode.scriptContent || '',
      scriptBeats: normalizedBeats,
      segments: enrichedSegments,
      isArollFirst,
      totalDurationMs,
    });
    logger.info('[Phase 3.5] Creative Director batching plan', {
      episodeId,
      jobId,
      totalSegments: enrichedSegments.length,
      batchCount: promptBatches.length,
      batchSizes: promptBatches.map((batch) => batch.segments.length),
      promptCharsByBatch: promptBatches.map((batch) => batch.promptChars),
      estimatedInputTokensByBatch: promptBatches.map((batch) => Math.ceil(batch.promptChars / 4)),
      maxPromptCharsPerBatch: MAX_PROMPT_CHARS_PER_BATCH,
      maxSegmentsPerBatch: MAX_SEGMENTS_PER_BATCH,
    });

    await updateProgress(jobId, 'processing', 40, 'Calling Creative Director LLM');

    // ---------- 6. Call LLM with retry (per batch) ----------
    let creativeBrief: CreativeEditDecision[] | null = null;
    let fallbackReason: string | null = null;
    let parsedDecisionCount = 0;
    let fallbackDecisionCount = 0;
    let correctedDecisionCount = 0;
    let lastRawResponse = '';
    let llmProviderUsed: CreativeDirectorProvider | null = null;
    let llmModelUsed: string | null = null;
    let geminiCalls = 0;
    let openAiChatCalls = 0;
    let failedBatchCount = 0;
    const fallbackReasons: string[] = [];
    const collectedDecisions: CreativeEditDecision[] = [];
    const provider = resolveCreativeDirectorProvider();
    const requestedModel = getOpenAiCompatibleModel(config.openai.model, provider);
    const providerLogContext = getProviderLogContext(provider);
    llmProviderUsed = provider;

    for (const batch of promptBatches) {
      let batchCompleted = false;
      let batchLastError: string | null = null;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          logger.info('[Phase 3.5] Creative Director LLM request', {
            episodeId,
            jobId,
            batchIndex: batch.batchIndex,
            batchCount: batch.batchCount,
            segmentRange: [
              batch.segments[0]?.segmentIndex ?? null,
              batch.segments[batch.segments.length - 1]?.segmentIndex ?? null,
            ],
            segmentCount: batch.segments.length,
            attempt,
            maxRetries: MAX_RETRIES,
            provider,
            model: provider === 'gemini' ? config.ai.geminiModel : requestedModel,
            endpointHost: provider === 'runpod' ? providerLogContext.endpointHost : undefined,
            promptChars: batch.promptChars,
          });
          if (provider === 'runpod') {
            logger.info('[Runpod][creative-edit-plan] request', {
              ...providerLogContext,
              batchIndex: batch.batchIndex,
              batchCount: batch.batchCount,
              promptChars: batch.promptChars,
            });
          }
          logger.info('[Phase 3.5] Creative Director LLM prompt payload', {
            episodeId,
            jobId,
            batchIndex: batch.batchIndex,
            batchCount: batch.batchCount,
            attempt,
            provider,
            prompt: batch.prompt,
          });

          if (provider === 'openai' || provider === 'runpod') {
            openAiChatCalls += 1;
          } else {
            geminiCalls += 1;
          }

          const llmResult = await callCreativeDirectorLlm({ provider, prompt: batch.prompt });
          llmModelUsed = llmResult.model;
          const text = llmResult.rawText;
          lastRawResponse = text;

          logger.info('[Phase 3.5] Creative Director LLM response', {
            episodeId,
            jobId,
            batchIndex: batch.batchIndex,
            batchCount: batch.batchCount,
            attempt,
            provider,
            model: llmResult.model,
            responseChars: text.length,
            responseMeta: llmResult.responseMeta,
          });
          if (provider === 'runpod') {
            logger.info('[Runpod][creative-edit-plan] response', {
              ...providerLogContext,
              batchIndex: batch.batchIndex,
              batchCount: batch.batchCount,
              responseChars: text.length,
            });
          }
          logger.info('[Phase 3.5] Creative Director LLM raw response payload', {
            episodeId,
            jobId,
            batchIndex: batch.batchIndex,
            batchCount: batch.batchCount,
            attempt,
            provider,
            model: llmResult.model,
            responseText: text,
          });

          if (hasLikelyTruncatedResponse(text, llmResult.responseMeta)) {
            throw new Error('LLM response appears truncated (finish reason or JSON envelope incomplete)');
          }

          const parsedPayload = parseCreativeDirectorResponsePayload(text);
          const normalized = normalizeCreativeDecisionsForBatch({
            rawDecisions: parsedPayload.decisions,
            batchSegments: batch.segments,
            isArollFirst,
          });

          parsedDecisionCount += normalized.rawCount;
          fallbackDecisionCount += normalized.fallbackCount;
          correctedDecisionCount += normalized.correctedCount;
          collectedDecisions.push(...normalized.decisions);

          logger.info('[Phase 3.5] Creative Director batch normalization', {
            episodeId,
            jobId,
            batchIndex: batch.batchIndex,
            batchCount: batch.batchCount,
            expectedDecisions: batch.segments.length,
            rawDecisions: normalized.rawCount,
            fallbackDecisions: normalized.fallbackCount,
            correctedDecisions: normalized.correctedCount,
          });

          batchCompleted = true;
          break;
        } catch (error) {
          const msg = error instanceof Error ? error.message : String(error);
          batchLastError = msg;
          logger.warn(
            `[Phase 3.5] Creative Director LLM batch ${batch.batchIndex}/${batch.batchCount} ` +
              `attempt ${attempt}/${MAX_RETRIES} failed: ${msg}`
          );
          if (attempt < MAX_RETRIES) {
            await new Promise((r) => setTimeout(r, 2000 * attempt));
          }
        }
      }

      if (!batchCompleted) {
        failedBatchCount += 1;
        fallbackReasons.push(
          `batch ${batch.batchIndex}/${batch.batchCount}: ${batchLastError ?? 'unknown error'}`
        );
        const fallbackDecisions = batch.segments.map((segment) =>
          buildFallbackDecision(segment, isArollFirst, 'Auto fallback: batch failed')
        );
        fallbackDecisionCount += fallbackDecisions.length;
        collectedDecisions.push(...fallbackDecisions);
      }

      const batchProgress = 40 + Math.round((batch.batchIndex / promptBatches.length) * 35);
      await updateProgress(
        jobId,
        'processing',
        Math.min(79, batchProgress),
        `Creative Director batch ${batch.batchIndex}/${promptBatches.length}`
      );
    }

    const decisionsBySegmentIndex = new Map<number, CreativeEditDecision>();
    for (const decision of collectedDecisions) {
      if (!decisionsBySegmentIndex.has(decision.segmentIndex)) {
        decisionsBySegmentIndex.set(decision.segmentIndex, decision);
      }
    }

    const mergedDecisions = enrichedSegments.map((segment) => {
      const decision = decisionsBySegmentIndex.get(segment.segmentIndex);
      if (decision) return decision;
      fallbackDecisionCount += 1;
      return buildFallbackDecision(segment, isArollFirst, 'Auto fallback: missing merged decision');
    });

    creativeBrief = mergedDecisions;
    parsedDecisionCount = parsedDecisionCount || collectedDecisions.length;
    fallbackReason = fallbackReasons.length > 0 ? fallbackReasons.join(' | ') : null;

    logger.info(
      `Creative edit plan generated for episode ${episodeId}: ` +
      `${creativeBrief.filter((d) => d.source === 'a_roll').length} A-roll, ` +
      `${creativeBrief.filter((d) => d.source === 'b_roll').length} B-roll decisions`,
    );

    await updateProgress(jobId, 'processing', 80, 'Saving creative brief');

    // ---------- 7. Record usage ----------
    if (geminiCalls > 0 || openAiChatCalls > 0) {
      await usageService.recordUsage(userId, {
        geminiCalls,
        openAiChatCalls,
      });
    }

    logger.info('[Phase 3.5] Creative Director parse quality', {
      episodeId,
      jobId,
      provider: llmProviderUsed,
      model: llmModelUsed,
      batchCount: promptBatches.length,
      failedBatchCount,
      expectedDecisions: segments.length,
      parsedDecisions: parsedDecisionCount,
      fallbackDecisions: fallbackDecisionCount,
      correctedDecisions: correctedDecisionCount,
      fallbackReason,
      responseChars: lastRawResponse.length,
      usedFallbackMechanicalPolicy: fallbackDecisionCount > 0,
    });

    // ---------- 8. Save creative brief ----------
    await prisma.episode.update({
      where: { id: episodeId },
      data: { creativeBrief: creativeBrief as unknown as any } as any,
    });

    await updateProgress(jobId, 'processing', 90, 'Triggering cut plan generation');

    // ---------- 9. Trigger cut plan generation ----------
    await triggerCutPlanAfterCreativeEdit(episodeId, userId, data);

    await updateProgress(
      jobId,
      'done',
      100,
      fallbackDecisionCount > 0
        ? 'Creative brief generated (with fallback normalization)'
        : 'Creative brief generated'
    );

  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logger.error(`Creative edit plan job ${jobId} failed: ${msg}`);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'error',
        errorMessage: msg,
        stage: 'done',
        progress: 100,
      },
    });
    await progressPublisher.publish(jobId, 'error', 'done', 100, msg);

    // Even on total failure, try to trigger cut plan generation so the pipeline doesn't stall
    try {
      await prisma.episode.update({
        where: { id: episodeId },
        data: { creativeBrief: null } as any,
      });
      await triggerCutPlanAfterCreativeEdit(episodeId, userId, data);
      logger.info(`Cut plan generation triggered despite creative edit plan failure for episode ${episodeId}`);
    } catch (fallbackError) {
      logger.error(`Failed to trigger fallback cut plan generation: ${fallbackError}`);
    }

    throw error;
  }
}

// ==================== PIPELINE TRIGGER ====================

async function triggerCutPlanAfterCreativeEdit(
  episodeId: string,
  userId: string,
  data: CreativeEditPlanJobData,
): Promise<void> {
  const result = await triggerCutPlanGenerationSafely(episodeId, userId, {
    triggeredBy: 'creative_edit_plan',
    forceReplan: data.forceReplan,
  });

  if (result.triggered) {
    logger.info(`Cut plan generation triggered for episode ${episodeId} (job: ${result.jobId})`);
  } else {
    logger.warn(`Cut plan generation NOT triggered for episode ${episodeId}: ${result.reason}`);
  }
}
