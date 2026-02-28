import { GoogleGenerativeAI } from '@google/generative-ai';
import { supportsOpenAiTemperature } from './openaiModelSupport.js';
import { callBedrockMistralChat } from './bedrockMistral.js';
import { config } from '../config.js';
import { logger as sharedLogger } from '@webl/shared';
import { usageService } from './usage.js';
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

export interface SegmentToRemove {
  startMs: number;
  endMs: number;
  type: 'script' | 'silence' | 'filler' | 'repeat';
  reason?: string;
}

export interface KeepSegment {
  startMs: number;
  endMs: number;
}

export interface VoiceoverRemovalVerificationDecision {
  id: number;
  action: 'keep' | 'remove';
  confidence: number;
  reason?: string;
  correctedText?: string;
}

export interface VoiceoverRemovalVerificationSummary {
  enabled: boolean;
  provider?: 'gemini' | 'openai' | 'runpod' | 'mistral';
  candidates: number;
  verified: number;
  rescued: number;
  keptConfidenceThreshold?: number;
}

export interface VerifyVoiceoverEditPlanRemovalsResult {
  keepSegmentsToAdd: KeepSegment[];
  decisions: VoiceoverRemovalVerificationDecision[];
  summary: VoiceoverRemovalVerificationSummary;
}

type Candidate = {
  id: number;
  startMs: number;
  endMs: number;
  durationMs: number;
  wordCount: number;
  avgConfidence: number;
  transcriptText: string;
  beforeText: string;
  afterText: string;
};

function normalizeText(text: string): string {
  return text
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 30))}\n\n[TRUNCATED ${text.length - maxChars} CHARS]`;
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

function wordsOverlappingRange(words: WordTimestamp[], startMs: number, endMs: number): WordTimestamp[] {
  if (endMs <= startMs) return [];
  return words.filter((w) => w.startMs < endMs && w.endMs > startMs);
}

function wordsBefore(words: WordTimestamp[], startMs: number, count: number): WordTimestamp[] {
  if (count <= 0) return [];
  const before = words.filter((w) => w.endMs <= startMs);
  return before.slice(Math.max(0, before.length - count));
}

function wordsAfter(words: WordTimestamp[], endMs: number, count: number): WordTimestamp[] {
  if (count <= 0) return [];
  const after = words.filter((w) => w.startMs >= endMs);
  return after.slice(0, count);
}

function wordsToText(words: WordTimestamp[]): string {
  return normalizeText(words.map((w) => w.word).join(' '));
}

function avgConfidence(words: WordTimestamp[]): number {
  if (words.length === 0) return 1;
  const sum = words.reduce((acc, w) => acc + (Number.isFinite(w.confidence) ? w.confidence : 1), 0);
  return sum / words.length;
}

function buildCandidates(
  transcriptWords: WordTimestamp[],
  segmentsToRemove: SegmentToRemove[],
  durationMs: number
): Candidate[] {
  const cfg = config.voiceover.removalVerification;
  const candidates: Omit<Candidate, 'id'>[] = [];

  for (let i = 0; i < segmentsToRemove.length; i += 1) {
    const seg = segmentsToRemove[i];
    if (!seg) continue;
    if (seg.type !== 'script') continue;

    const segDurationMs = seg.endMs - seg.startMs;
    if (segDurationMs < cfg.minDurationMs) continue;
    if (cfg.maxDurationMs > 0 && segDurationMs > cfg.maxDurationMs) continue;

    // We only "rescue" internal gaps; leading/trailing removals are more likely truly off-script.
    const isInternal = seg.startMs > 0 && seg.endMs < durationMs;
    if (!isInternal) continue;

    const segmentWords = wordsOverlappingRange(transcriptWords, seg.startMs, seg.endMs);
    if (segmentWords.length === 0) continue;

    const before = wordsBefore(transcriptWords, seg.startMs, cfg.contextWords);
    const after = wordsAfter(transcriptWords, seg.endMs, cfg.contextWords);

    candidates.push({
      startMs: seg.startMs,
      endMs: seg.endMs,
      durationMs: segDurationMs,
      wordCount: segmentWords.length,
      avgConfidence: Number(avgConfidence(segmentWords).toFixed(3)),
      transcriptText: wordsToText(segmentWords),
      beforeText: wordsToText(before),
      afterText: wordsToText(after),
    });
  }

  // Prioritize likely transcription-error gaps: low-confidence, short gaps.
  candidates.sort((a, b) => {
    if (a.avgConfidence !== b.avgConfidence) return a.avgConfidence - b.avgConfidence;
    return a.durationMs - b.durationMs;
  });

  return candidates
    .slice(0, cfg.maxSegments)
    .map((candidate, index) => ({ id: index, ...candidate }));
}

async function callVerificationLlm(
  userId: string,
  scriptContent: string,
  candidates: Candidate[],
  logger = sharedLogger
): Promise<VoiceoverRemovalVerificationDecision[]> {
  const provider = config.ai.provider as AiProvider;

  if (!isProviderConfigured(provider)) return [];
  if (candidates.length === 0) return [];

  const prompt = `You are verifying whether short audio gaps marked for removal are actually part of the script.

Context:
- A transcript is produced by ASR and can contain errors (e.g., "T so a" instead of "Tissot").
- An alignment step created "segmentsToRemove" for gaps that appear "not in script".
- Your job is to prevent wrong removals caused by ASR mistakes.

Instructions:
1) For each candidate segment, decide:
   - "keep": the segment should NOT be removed (likely in-script or a transcription error of the script)
   - "remove": the segment can be safely removed (off-script, repetition, filler/aside)
2) If you are unsure, choose "keep" (wrong removal is worse than leaving a tiny extra piece of audio).
3) Use the provided script + local transcript context (before/after) to judge meaning, flow, and phonetic/proper-noun likelihood.
4) The segments are short internal gaps; if the surrounding context is clearly in the script and the segment plausibly bridges it, prefer "keep".

Script:
${truncate(scriptContent, 12000)}

Candidates:
${JSON.stringify(candidates, null, 2)}

Return JSON only with this exact shape:
{
  "decisions": [
    { "id": 0, "action": "keep", "confidence": 0.0, "reason": "string", "correctedText": "string (optional)" }
  ]
}

Rules:
- confidence is 0.0 to 1.0
- include every candidate id exactly once
- If you pick "keep" due to uncertainty, use confidence around 0.55–0.7
- If you pick "remove", only do so when you're confident it is truly off-script/filler (confidence 0.7+)`;

  try {
    if (provider === 'mistral') {
      await usageService.recordUsage(userId, {
        openAiChatCalls: 1,
        voiceoverEditVerificationCalls: 1,
      });
      const text = await callBedrockMistralChat({
        systemPrompt: 'You verify transcript-vs-script alignment decisions. Return JSON only.',
        userPrompt: prompt,
        temperature: 0.2,
      });
      const parsed = parseAIJsonResponse<{ decisions?: VoiceoverRemovalVerificationDecision[] }>(text);
      return Array.isArray(parsed.decisions) ? parsed.decisions : [];
    }

    if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: config.voiceover.models.call3 || config.ai.geminiModel,
        generationConfig: { responseMimeType: 'application/json' },
      });
      await usageService.recordUsage(userId, {
        geminiCalls: 1,
        voiceoverEditVerificationCalls: 1,
      });
      const response = await model.generateContent(prompt);
      const text = response.response.text();
      const parsed = parseAIJsonResponse<{ decisions?: VoiceoverRemovalVerificationDecision[] }>(text);
      return Array.isArray(parsed.decisions) ? parsed.decisions : [];
    }

    const client = getOpenAiCompatibleClient(provider);
    const model = getOpenAiCompatibleModel(config.voiceover.models.call3, provider);
    if (provider === 'runpod') {
      logger.info('[Runpod][removal-verification] request', {
        ...getProviderLogContext(provider),
        candidateCount: candidates.length,
      });
    }
    await usageService.recordUsage(userId, {
      openAiChatCalls: 1,
      voiceoverEditVerificationCalls: 1,
    });
    const temperature = supportsOpenAiTemperature(model, null) ? 0.2 : undefined;
    const response = await client.chat.completions.create({
      model,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content: 'You verify transcript-vs-script alignment decisions. Return JSON only.',
        },
        { role: 'user', content: prompt },
      ],
      ...(temperature !== undefined ? { temperature } : {}),
    });
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = parseAIJsonResponse<{ decisions?: VoiceoverRemovalVerificationDecision[] }>(content);
    if (provider === 'runpod') {
      logger.info('[Runpod][removal-verification] response', {
        ...getProviderLogContext(provider),
        decisionCount: Array.isArray(parsed.decisions) ? parsed.decisions.length : 0,
      });
    }
    return Array.isArray(parsed.decisions) ? parsed.decisions : [];
  } catch (error) {
    logger.error('Voiceover removal verification LLM call failed', error);
    return [];
  }
}

export async function verifyVoiceoverEditPlanRemovals(args: {
  userId: string;
  scriptContent: string;
  transcriptWords: WordTimestamp[];
  segmentsToRemove: SegmentToRemove[];
  durationMs: number;
  logger?: typeof sharedLogger;
}): Promise<VerifyVoiceoverEditPlanRemovalsResult> {
  const logger = args.logger ?? sharedLogger;
  const cfg = config.voiceover.removalVerification;

  if (!cfg.enabled) {
    return {
      keepSegmentsToAdd: [],
      decisions: [],
      summary: { enabled: false, candidates: 0, verified: 0, rescued: 0 },
    };
  }

  const candidates = buildCandidates(args.transcriptWords, args.segmentsToRemove, args.durationMs);
  if (candidates.length === 0) {
    return {
      keepSegmentsToAdd: [],
      decisions: [],
      summary: {
        enabled: true,
        provider: config.ai.provider,
        candidates: 0,
        verified: 0,
        rescued: 0,
        keptConfidenceThreshold: cfg.keepConfidenceThreshold,
      },
    };
  }

  const decisions = await callVerificationLlm(args.userId, args.scriptContent, candidates, logger);
  const decisionById = new Map<number, VoiceoverRemovalVerificationDecision>();

  for (const decision of decisions) {
    if (!decision || typeof decision.id !== 'number') continue;
    if (decision.action !== 'keep' && decision.action !== 'remove') continue;
    const confidence = Number.isFinite(Number(decision.confidence)) ? Number(decision.confidence) : 0;
    decisionById.set(decision.id, { ...decision, confidence });
  }

  const keepSegmentsToAdd: KeepSegment[] = [];
  let rescued = 0;

  for (const candidate of candidates) {
    const decision = decisionById.get(candidate.id);
    if (!decision) continue;
    if (decision.action !== 'keep') continue;
    if (decision.confidence < cfg.keepConfidenceThreshold) continue;

    rescued += 1;
    keepSegmentsToAdd.push({
      startMs: Math.max(0, candidate.startMs - cfg.padMs),
      endMs: Math.min(args.durationMs, candidate.endMs + cfg.padMs),
    });
  }

  if (rescued > 0) {
    logger.warn('Voiceover removal verification rescued segments', {
      rescued,
      candidates: candidates.length,
      provider: config.ai.provider,
    });
  } else {
    logger.info('Voiceover removal verification found no segments to rescue', {
      candidates: candidates.length,
      provider: config.ai.provider,
    });
  }

  return {
    keepSegmentsToAdd,
    decisions: Array.from(decisionById.values()),
    summary: {
      enabled: true,
      provider: config.ai.provider,
      candidates: candidates.length,
      verified: decisionById.size,
      rescued,
      keptConfidenceThreshold: cfg.keepConfidenceThreshold,
    },
  };
}
