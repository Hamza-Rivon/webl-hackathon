/**
 * Phase 1.3: Voiceover Transcript Correction Job
 *
 * Purpose: Use an LLM to correct Deepgram transcript and create an edit plan.
 *
 * Pipeline Position: After voiceover_transcript
 * Dependencies: voiceover_transcript (must complete first)
 * Triggers: voiceover_take_selection job
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { config } from '../config.js';
import { usageService } from '../services/usage.js';
import { reconstructTranscriptWithLlm } from '../services/voiceoverTranscriptCorrection.js';

// ==================== TYPES ====================

interface VoiceoverTranscriptCorrectionJobData {
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

// ==================== JOB PROCESSOR ====================

export async function processVoiceoverTranscriptCorrection(
  bullJob: Job<VoiceoverTranscriptCorrectionJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;

  logger.info(`[Phase 1.3] Starting voiceover transcript correction job ${jobId}`, {
    episodeId,
  });

  try {
    // Usage guard: check hard limits before LLM calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await safeUpdateJob(jobId, { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    const jobExists = await safeUpdateJob(jobId, {
      status: 'processing',
      stage: 'starting',
      progress: 0,
    });

    if (!jobExists) {
      logger.warn(`Job ${jobId} does not exist in database, but continuing processing`, {
        jobId,
        episodeId,
      });
    }

    await progressPublisher.publish(
      jobId,
      'processing',
      'starting',
      0,
      'Starting transcript correction'
    );

    await updateProgress(jobId, 'processing', 10, 'Loading script and transcript');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        scriptContent: true,
        wordTranscript: true,
        rawVoiceoverDuration: true,
      },
    });

    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    if (!episode.scriptContent) {
      throw new Error(`Episode ${episodeId} has no script content`);
    }

    const rawWords = normalizeTranscriptWords(episode.wordTranscript);
    if (rawWords.length === 0) {
      throw new Error(`No word transcript found for episode ${episodeId}`);
    }
    logger.info('[Phase 1.3] RECEIVED: episode transcript (from Phase 1.2, not altered yet)', {
      episodeId,
      wordTranscriptCount: rawWords.length,
      scriptLength: episode.scriptContent?.length ?? 0,
      firstWord: rawWords[0] ? { word: rawWords[0].word, startMs: rawWords[0].startMs, endMs: rawWords[0].endMs } : null,
      lastWord: rawWords.length > 0 ? rawWords[rawWords.length - 1]! ? { word: rawWords[rawWords.length - 1]!.word, startMs: rawWords[rawWords.length - 1]!.startMs, endMs: rawWords[rawWords.length - 1]!.endMs } : null : null,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.3 step=RECEIVED_episode_wordTranscript episodeId=${episodeId} wordCount=${rawWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(rawWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence })))}`
    );

    await updateProgress(jobId, 'processing', 40, 'Correcting transcript');

    logger.info('[Phase 1.3] DOING: reconstructing corrected transcript using chunked aligner', {
      episodeId,
    });

    const { correctedWords, stats } = await reconstructTranscriptWithLlm({
      scriptContent: episode.scriptContent,
      transcriptWords: rawWords,
      logger,
    });

    if (correctedWords.length === 0) {
      throw new Error('Transcript correction returned empty corrected transcript');
    }

    const provider = config.ai.provider;
    if (stats.llmCallCount > 0) {
      await usageService.recordUsage(userId, {
        ...(provider === 'openai' ? { openAiChatCalls: stats.llmCallCount } : {}),
        ...(provider === 'gemini' ? { geminiCalls: stats.llmCallCount } : {}),
        transcriptCorrectionCalls: 1,
      });
    } else {
      await usageService.recordUsage(userId, {
        transcriptCorrectionCalls: 1,
      });
    }

    logger.info('[Phase 1.3] RECEIVED: from transcript correction (corrected transcript only)', {
      episodeId,
      correctedTranscriptWordCount: correctedWords.length,
      usedLlm: stats.usedLlm,
      llmCallCount: stats.llmCallCount,
      fallbackChunks: stats.fallbackChunks,
      skipped: stats.skipped,
      skipReason: stats.skipReason,
    });

    await updateProgress(jobId, 'processing', 70, 'Saving corrected transcript');

    logger.info('[Phase 1.3] STORED: episode correctedWordTranscript (wordTranscript unchanged)', {
      episodeId,
      correctedWordTranscriptCount: correctedWords.length,
      note: 'episode.wordTranscript still holds Phase 1.2 raw Deepgram output',
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.3 step=STORED_episode_correctedWordTranscript episodeId=${episodeId} wordCount=${correctedWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(correctedWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence })))}`
    );
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        correctedWordTranscript: correctedWords as any,
      },
    });

    await safeUpdateJob(jobId, {
      status: 'done',
      stage: 'done',
      progress: 100,
      outputData: {
        correctedWordCount: correctedWords.length,
        usedLlm: stats.usedLlm,
        llmCallCount: stats.llmCallCount,
        fallbackChunks: stats.fallbackChunks,
        skipped: stats.skipped,
        skipReason: stats.skipReason,
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Transcript correction complete (${correctedWords.length} words)`
    );

    logger.info(`[Phase 1.3] Triggering voiceover_take_selection job for episode ${episodeId}`);

    const takeSelectionJob = await prisma.job.create({
      data: {
        type: 'voiceover_take_selection',
        status: 'pending',
        userId,
        episodeId,
        inputData: {
          correctedWordCount: correctedWords.length,
        },
      },
    });

    const { queues } = await import('../queue.js');
    await queues.voiceoverTakeSelection.add('voiceover-take-selection', {
      jobId: takeSelectionJob.id,
      episodeId,
      userId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 1.3] Voiceover transcript correction job ${jobId} failed:`, error);

    await safeUpdateJob(jobId, {
      status: 'error',
      errorMessage,
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  }
}

// ==================== HELPERS ====================

function normalizeTranscriptWords(rawTranscript: unknown): WordTimestamp[] {
  if (!Array.isArray(rawTranscript)) {
    return [];
  }

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

async function safeUpdateJob(
  jobId: string,
  data: {
    status?: 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
    stage?:
      | 'starting'
      | 'downloading'
      | 'uploading'
      | 'processing'
      | 'analyzing'
      | 'building'
      | 'rendering'
      | 'publishing'
      | 'done';
    progress?: number;
    errorMessage?: string | null;
    outputData?: any;
    [key: string]: any;
  }
): Promise<boolean> {
  try {
    await prisma.job.update({
      where: { id: jobId },
      data,
    });
    return true;
  } catch (error: any) {
    if (error?.code === 'P2025') {
      logger.warn(`Job ${jobId} not found in database, skipping update`, {
        jobId,
        data,
      });
      return false;
    }
    throw error;
  }
}

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'processing' | 'analyzing' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await safeUpdateJob(jobId, { stage, progress });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
