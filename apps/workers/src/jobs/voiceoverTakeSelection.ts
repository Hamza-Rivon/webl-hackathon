/**
 * Phase 1.4: Voiceover Take Selection Job
 *
 * Purpose: Use LLM-assisted script alignment to select the best take per sentence.
 *
 * Pipeline Position: After voiceover_transcript_correction
 * Dependencies: voiceover_transcript_correction (must complete first)
 * Triggers: voiceover_silence_detection job
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { findScriptAlignedSegments } from '../services/scriptAlignment.js';
import { config } from '../config.js';

interface VoiceoverTakeSelectionJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

export async function processVoiceoverTakeSelection(
  bullJob: Job<VoiceoverTakeSelectionJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;

  logger.info(`[Phase 1.4] Starting voiceover take selection job ${jobId}`, {
    episodeId,
  });

  try {
    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'processing', stage: 'starting', progress: 0 },
    });

    await progressPublisher.publish(
      jobId,
      'processing',
      'starting',
      0,
      'Starting voiceover take selection'
    );

    if (!config.voiceover.takeSelection.enabled) {
      throw new Error('Voiceover take selection is disabled but required by pipeline');
    }

    await updateProgress(jobId, 'processing', 20, 'Loading script and transcript');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        scriptContent: true,
        wordTranscript: true,
        correctedWordTranscript: true,
      },
    });

    if (!episode?.scriptContent) {
      throw new Error(`Episode ${episodeId} has no script content`);
    }

    const words =
      (episode.correctedWordTranscript as any[])?.length > 0
        ? (episode.correctedWordTranscript as any[])
        : (episode.wordTranscript as any[]);

    if (!words || !Array.isArray(words) || words.length === 0) {
      throw new Error(`No transcript words found for episode ${episodeId}`);
    }
    const transcriptSource = (episode.correctedWordTranscript as any[])?.length > 0 ? 'correctedWordTranscript' : 'wordTranscript';
    logger.info('[Phase 1.4] RECEIVED: episode transcript (audio not altered)', {
      episodeId,
      wordCount: words.length,
      transcriptSource,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.4 step=RECEIVED_episode_transcript episodeId=${episodeId} wordCount=${words.length} transcriptSource=${transcriptSource} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        words.map((w: any) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
      )}`
    );

    await updateProgress(jobId, 'processing', 50, 'Selecting best takes');

    const alignment = await findScriptAlignedSegments(
      episode.scriptContent,
      words as any,
      userId,
      logger
    );

    if (!alignment || alignment.keepSegments.length === 0) {
      throw new Error('Take selection returned no keep segments');
    }
    logger.info('[Phase 1.4] RECEIVED: from take selection (keep segments only, no transcript change)', {
      episodeId,
      keepSegmentsCount: alignment.keepSegments.length,
    });

    await updateProgress(jobId, 'processing', 75, 'Persisting take selection');

    logger.info('[Phase 1.4] STORED: episode editPlan (keepSegments only; wordTranscript and correctedWordTranscript unchanged)', {
      episodeId,
      keepSegmentsCount: alignment.keepSegments.length,
    });
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        editPlan: {
          keepSegments: alignment.keepSegments,
          segmentsToRemove: [],
          source: 'take_selection',
          alignmentStats: alignment.stats,
        } as any,
      },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          keepSegments: alignment.keepSegments.length,
          usedLlm: alignment.stats.usedLlm,
          averageBestScore: alignment.stats.averageBestScore,
          repeatedSentencesDetected: alignment.stats.repeatedSentencesDetected,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Take selection complete (${alignment.keepSegments.length} keep segments)`
    );

    logger.info(`[Phase 1.4] Triggering voiceover_silence_detection for episode ${episodeId}`);

    const silenceJob = await prisma.job.create({
      data: {
        type: 'voiceover_silence_detection',
        status: 'pending',
        userId,
        episodeId,
        inputData: {
          keepSegments: alignment.keepSegments.length,
        },
      },
    });

    const { queues } = await import('../queue.js');
    await queues.voiceoverSilenceDetection.add('voiceover-silence-detection', {
      jobId: silenceJob.id,
      episodeId,
      userId,
    });
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 1.4] Voiceover take selection job ${jobId} failed:`, error);

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

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'downloading' | 'uploading' | 'processing' | 'analyzing' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress },
  });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
