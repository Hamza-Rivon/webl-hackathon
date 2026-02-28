/**
 * Phase 1.2: Voiceover Transcript Job
 *
 * Purpose: Extract word-level timestamps from Deepgram transcription
 * 
 * Pipeline Position: After voiceover_ingest
 * Dependencies: voiceover_ingest (must complete first)
 * Triggers: voiceover_transcript_correction job
 * 
 * Key Steps:
 * 1. Generate a signed URL for the raw voiceover audio
 * 2. Request Deepgram word-level transcription
 * 3. Normalize word timestamps and store in episode.wordTranscript
 * 4. Calculate and store rawVoiceoverDuration (if available)
 * 5. Trigger voiceover_transcript_correction job
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { deepgramService } from '../services/deepgram.js';
import { progressPublisher } from '../services/progress.js';
import { usageService } from '../services/usage.js';
import { logger } from '@webl/shared';

// ==================== TYPES ====================

interface VoiceoverTranscriptJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  s3Key?: string;
}


// ==================== JOB PROCESSOR ====================

export async function processVoiceoverTranscript(
  bullJob: Job<VoiceoverTranscriptJobData>
): Promise<void> {
  const { jobId, episodeId, userId, s3Key } = bullJob.data;
  let deepgramCallMade = false;
  let deepgramUsageLogged = false;

  logger.info(`[Phase 1.2] Starting voiceover transcript job ${jobId}`, {
    episodeId,
    s3Key,
  });
  logger.info('[Phase 1.2] RECEIVED: job data', { jobId, episodeId, userId, s3Key: s3Key ?? '(from episode)' });

  try {
    // Usage guard: check hard limits before external API calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await safeUpdateJob(jobId, { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

    // Update job status to processing
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
      'Starting transcript extraction'
    );

    // Step 1: Load voiceover metadata (10%)
    await updateProgress(jobId, 'processing', 10, 'Loading voiceover metadata');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        rawVoiceoverS3Key: true,
        scriptContent: true,
      },
    });

    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    const voiceoverS3Key = s3Key ?? episode?.rawVoiceoverS3Key ?? null;

    if (!voiceoverS3Key) {
      throw new Error(`No raw voiceover S3 key found for episode ${episodeId}`);
    }
    logger.info('[Phase 1.2] RECEIVED: episode state', { rawVoiceoverS3Key: voiceoverS3Key, hasScript: Boolean(episode?.scriptContent) });

    // Step 2: Generate signed URL for Deepgram (20%)
    await updateProgress(jobId, 'downloading', 20, 'Generating signed URL for Deepgram');

    const signedUrl = await s3Service.getSignedDownloadUrl(voiceoverS3Key, 7200);
    logger.info('[Phase 1.2] DOING: calling Deepgram with signed URL (audio not altered)', { urlLength: signedUrl.length });

    // Step 3: Transcribe with Deepgram (50%)
    await updateProgress(jobId, 'processing', 50, 'Transcribing with Deepgram');

    deepgramCallMade = true;
    const { words, durationSeconds: deepgramDurationSeconds, rawResponse: rawDeepgramResponse } =
      await deepgramService.transcribeFromUrl(signedUrl);
    const transcriptionSeconds =
      deepgramDurationSeconds ?? (words.length > 0 ? words[words.length - 1]!.endMs / 1000 : 0);
    await usageService.recordUsage(userId, {
      deepgramTranscriptions: 1,
      deepgramAudioSeconds: transcriptionSeconds > 0 ? transcriptionSeconds : 0,
    });
    deepgramUsageLogged = true;

    logger.info('[Phase 1.2] RECEIVED: from Deepgram (normalized by service)', {
      episodeId,
      wordCount: words.length,
      durationSeconds: deepgramDurationSeconds ?? (words.length > 0 ? words[words.length - 1]!.endMs / 1000 : null),
      firstWord: words[0] ? { word: words[0].word, startMs: words[0].startMs, endMs: words[0].endMs } : null,
      lastWord: words.length > 0 ? words[words.length - 1]! ? { word: words[words.length - 1]!.word, startMs: words[words.length - 1]!.startMs, endMs: words[words.length - 1]!.endMs } : null : null,
      rawDeepgramResponseStored: Boolean(rawDeepgramResponse),
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.2 step=RECEIVED_FROM_DEEPGRAM episodeId=${episodeId} wordCount=${words.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(words.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence })))}`
    );

    if (words.length === 0) {
      throw new Error('No words found in transcript');
    }

    // Step 4: Store in episode (80%)
    await updateProgress(jobId, 'analyzing', 80, 'Storing word transcript');

    const lastWord = words[words.length - 1];
    const durationSeconds =
      deepgramDurationSeconds ?? (lastWord ? lastWord.endMs / 1000 : 0);

    const episodeUpdate: {
      wordTranscript: any;
      rawVoiceoverDuration?: number;
      rawVoiceoverS3Key?: string;
      rawDeepgramResponse?: any;
    } = {
      wordTranscript: words as any, // Store as JSON
      rawDeepgramResponse: rawDeepgramResponse ?? undefined, // Exact API response for debugging
    };

    if (!episode?.rawVoiceoverS3Key && voiceoverS3Key) {
      episodeUpdate.rawVoiceoverS3Key = voiceoverS3Key;
    }

    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
      episodeUpdate.rawVoiceoverDuration = durationSeconds;
    }

    await prisma.episode.update({
      where: { id: episodeId },
      data: episodeUpdate,
    });

    logger.info('[Phase 1.2] STORED: episode updated (transcript not altered yet)', {
      episodeId,
      wordTranscriptCount: words.length,
      rawVoiceoverDuration: episodeUpdate.rawVoiceoverDuration,
      rawDeepgramResponsePresent: Boolean(episodeUpdate.rawDeepgramResponse),
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.2 step=STORED_episode_wordTranscript episodeId=${episodeId} wordCount=${words.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(words.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence })))}`
    );

    // Step 5: Complete job (100%)
    await safeUpdateJob(jobId, {
      status: 'done',
      stage: 'done',
      progress: 100,
      outputData: {
        wordCount: words.length,
        durationSeconds,
        transcriptSource: 'deepgram',
        keytermPrompting: {
          enabled: false,
          source: 'disabled',
          keytermCount: 0,
          preview: [],
        },
        /** Raw Deepgram API response exactly as received (no alteration) */
        rawDeepgramResponse: rawDeepgramResponse ?? undefined,
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      'Transcript extraction complete'
    );

    // Step 6: Trigger next job - voiceover_transcript_correction
    logger.info(
      `[Phase 1.2] Triggering voiceover_transcript_correction job for episode ${episodeId}`
    );

    const correctionJob = await prisma.job.create({
      data: {
        type: 'voiceover_transcript_correction',
        status: 'pending',
        userId,
        episodeId,
        inputData: {
          wordCount: words.length,
        },
      },
    });

    const { queues } = await import('../queue.js');
    await queues.voiceoverTranscriptCorrection.add('voiceover-transcript-correction', {
      jobId: correctionJob.id,
      episodeId,
      userId,
    });

    logger.info(`[Phase 1.2] Voiceover transcript job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 1.2] Voiceover transcript job ${jobId} failed:`, error);

    if (deepgramCallMade && !deepgramUsageLogged) {
      await usageService.recordUsage(userId, {
        deepgramTranscriptions: 1,
      });
    }

    // Try to update job status, but don't fail if job doesn't exist
    const jobExists = await safeUpdateJob(jobId, {
      status: 'error',
      errorMessage,
    });

    if (!jobExists) {
      logger.warn(`Job ${jobId} does not exist in database, cannot update error status`, {
        jobId,
        episodeId,
        errorMessage,
      });
    }

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  }
}

// ==================== HELPERS ====================

/**
 * Safely update a job record, handling cases where the job doesn't exist
 */
async function safeUpdateJob(
  jobId: string,
  data: {
    status?: 'pending' | 'processing' | 'done' | 'error' | 'cancelled';
    stage?: 'starting' | 'downloading' | 'uploading' | 'processing' | 'analyzing' | 'building' | 'rendering' | 'publishing' | 'done';
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
    // P2025 is Prisma's "Record not found" error
    if (error?.code === 'P2025') {
      logger.warn(`Job ${jobId} not found in database, skipping update`, {
        jobId,
        data,
      });
      return false;
    }
    // Re-throw other errors
    throw error;
  }
}

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'downloading' | 'processing' | 'analyzing' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await safeUpdateJob(jobId, { stage, progress });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
