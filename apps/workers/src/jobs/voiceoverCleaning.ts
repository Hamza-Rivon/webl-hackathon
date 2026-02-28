/**
 * Phase 1.5: Voiceover Cleaning Job
 *
 * Purpose: Apply script-aligned removal segments to create clean audio
 *
 * Pipeline Position: After voiceover_silence_detection
 * Dependencies: voiceover_silence_detection (must complete first)
 * Triggers: voiceover_segmentation job
 *
 * Key Steps:
 * 1. Download raw audio from S3
 * 2. Calculate audible segments (inverse of segments to remove)
 * 3. Use FFmpeg to extract and concatenate audible segments
 * 4. Upload clean audio to S3 and Mux
 * 5. Recalculate word timestamps for clean audio
 * 6. Update episode with clean voiceover fields
 * 7. Trigger voiceover_segmentation job
 */

import { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { muxService } from '../services/mux.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { config } from '../config.js';
import { unlink } from 'fs/promises';

// ==================== TYPES ====================

interface VoiceoverCleaningJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

interface SegmentToRemove {
  startMs: number;
  endMs: number;
  type: 'script' | 'silence' | 'filler' | 'repeat';
  reason?: string;
}

interface AudibleSegment {
  startMs: number;
  endMs: number;
}

interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

interface ArollCleanPreviewResult {
  s3Key: string;
  muxAssetId: string;
  playbackId: string;
  durationSeconds: number;
}

type SlotRequirementsJson = {
  workflow?: string;
  slots?: Array<{ slotId?: string; slotType?: string; priority?: string }>;
} | null;

const WORD_PROTECTION_PAD_MS = 20;

// ==================== JOB PROCESSOR ====================

export async function processVoiceoverCleaning(
  bullJob: Job<VoiceoverCleaningJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;

  logger.info(`[Phase 1.5] Starting voiceover cleaning job ${jobId}`, {
    episodeId,
  });

  let tempRawPath: string | null = null;
  let tempCleanPath: string | null = null;
  let tempArollSourcePath: string | null = null;
  let tempArollPreviewPath: string | null = null;

  try {
    // Set episode status to 'voiceover_cleaning' when job starts
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: 'voiceover_cleaning',
      },
    });

    // Update job status to processing
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'processing',
        stage: 'starting',
        progress: 0,
      },
    });

    await progressPublisher.publish(
      jobId,
      'processing',
      'starting',
      0,
      'Starting voiceover cleaning'
    );

    // Get episode data
    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        rawVoiceoverS3Key: true,
        rawVoiceoverDuration: true,
        wordTranscript: true,
        correctedWordTranscript: true,
        editPlan: true,
        renderSpec: true,
        template: {
          select: {
            slotRequirements: true,
          },
        },
        slotClips: {
          select: {
            slotType: true,
            s3Key: true,
            createdAt: true,
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 20,
        },
      },
    });

    if (!episode?.rawVoiceoverS3Key) {
      throw new Error(`Missing raw voiceover data for episode ${episodeId}`);
    }

    const rawWords = ((episode.correctedWordTranscript ?? episode.wordTranscript) as any as WordTimestamp[]) ?? [];
    if (rawWords.length === 0) {
      throw new Error(`No word transcript found for episode ${episodeId}`);
    }
    const transcriptSource = (episode.correctedWordTranscript as any[])?.length > 0 ? 'correctedWordTranscript' : 'wordTranscript';
    const editPlan = (episode.editPlan as { segmentsToRemove?: SegmentToRemove[] } | null) ?? null;
    let segmentsToRemove = editPlan?.segmentsToRemove ?? [];

    logger.info('[Phase 1.5 cleaning] RECEIVED: episode transcript + edit plan (audio will be cut, transcript will be altered)', {
      episodeId,
      rawWordCount: rawWords.length,
      transcriptSource,
      segmentsToRemoveCount: segmentsToRemove.length,
      rawVoiceoverS3Key: episode.rawVoiceoverS3Key,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.5_cleaning step=RECEIVED_episode_transcript episodeId=${episodeId} wordCount=${rawWords.length} (next line = full words with timestamps, no truncation; before any drop)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        rawWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
      )}`
    );

    // Step 1: Download raw audio from S3 (10%)
    await updateProgress(jobId, 'downloading', 10, 'Downloading raw audio');

    tempRawPath = `/tmp/voiceover_raw_${episodeId}_${Date.now()}.mp3`;
    await s3Service.downloadFile(episode.rawVoiceoverS3Key, tempRawPath);

    logger.info(`Downloaded raw audio to ${tempRawPath}`);

    // Step 2: Calculate audible segments (20%)
    await updateProgress(jobId, 'processing', 20, 'Calculating segments to keep');

    const transcriptLastWord = rawWords[rawWords.length - 1];
    const transcriptDurationMs = transcriptLastWord?.endMs ?? 0;
    const rawDurationMs = Number.isFinite(episode.rawVoiceoverDuration)
      ? Math.round((episode.rawVoiceoverDuration ?? 0) * 1000)
      : 0;
    const durationMs = Math.max(rawDurationMs, transcriptDurationMs);

    if (config.voiceover.tailEnergy.enabled && tempRawPath) {
      const tailContainsSpeech = await tailHasSpeech({
        inputPath: tempRawPath,
        durationMs,
        windowMs: config.voiceover.tailEnergy.windowMs,
        threshold: config.voiceover.tailEnergy.threshold,
      });
      if (tailContainsSpeech) {
        const tailStartMs = Math.max(0, durationMs - config.voiceover.tailEnergy.windowMs);
        const before = segmentsToRemove.length;
        segmentsToRemove = segmentsToRemove.filter((seg) => {
          // Gap-based removals are the risky ones at the tail; never trim them if tail still has speech.
          if (seg.type !== 'silence' && seg.type !== 'script') return true;
          const overlapsTail = seg.startMs < durationMs && seg.endMs > tailStartMs;
          return !overlapsTail;
        });
        const removed = before - segmentsToRemove.length;
        if (removed > 0) {
          logger.warn('Tail energy check prevented trailing silence removal', {
            removedSegments: removed,
            tailStartMs,
            durationMs,
          });
        }
      }
    }

    if (transcriptSource === 'correctedWordTranscript') {
      const beforeProtection = segmentsToRemove.length;
      segmentsToRemove = protectTranscriptWordsFromGapRemovals(
        segmentsToRemove,
        rawWords,
        durationMs,
        WORD_PROTECTION_PAD_MS
      );
      const protectedDelta = beforeProtection - segmentsToRemove.length;
      if (protectedDelta > 0) {
        logger.warn('Word-protection reduced gap removals to avoid truncating corrected transcript', {
          episodeId,
          beforeProtection,
          afterProtection: segmentsToRemove.length,
          protectedDelta,
        });
      }
    }

    const sanitizedRemovals = sanitizeRemovalSegments(segmentsToRemove, durationMs);
    const audibleSegments = calculateAudibleSegments(durationMs, sanitizedRemovals);

    logger.info('[Phase 1.5 cleaning] DOING: calculated audible segments (audio will be cut to these)', {
      episodeId,
      audibleSegmentCount: audibleSegments.length,
      removalSegmentCount: sanitizedRemovals.length,
      durationMs,
    });

    if (audibleSegments.length === 0) {
      throw new Error('No audible segments found after cleaning');
    }

    // Step 3: Use FFmpeg to extract and concatenate segments (30-60%)
    await updateProgress(jobId, 'processing', 30, 'Extracting and concatenating audio');

    tempCleanPath = `/tmp/voiceover_clean_${episodeId}_${Date.now()}.mp3`;
    await extractAndConcatenateSegments(
      tempRawPath,
      tempCleanPath,
      audibleSegments,
      config.voiceover.cleaning.gapMs
    );

    logger.info(`Created clean audio at ${tempCleanPath}`);

    // Step 4: Upload clean audio to S3 (70%)
    await updateProgress(jobId, 'uploading', 70, 'Uploading clean audio to S3');

    const cleanS3Key = `voiceovers/${userId}/${episodeId}/clean_${Date.now()}.mp3`;
    await s3Service.uploadFile(tempCleanPath, cleanS3Key, 'audio/mpeg');

    logger.info(`Uploaded clean audio to S3: ${cleanS3Key}`);

    // Step 5: Upload clean audio to Mux (75%)
    await updateProgress(jobId, 'uploading', 75, 'Uploading clean audio to Mux');

    const signedUrl = await s3Service.getSignedDownloadUrl(cleanS3Key, 7200);
    const cleanMuxAsset = await muxService.createAssetFromUrl({
      inputUrl: signedUrl,
      passthrough: `episode:${episodeId}:voiceover:clean`,
      generateSubtitles: false,
      language: 'en',
    });

    const readyCleanAsset = await muxService.waitForAssetReady(cleanMuxAsset.id, 120, 3000);
    const cleanPlaybackId = readyCleanAsset.playbackIds?.[0]?.id ?? null;

    if (!cleanPlaybackId) {
      throw new Error(`No playback ID for clean Mux asset ${cleanMuxAsset.id}`);
    }

    logger.info(`Clean audio uploaded to Mux: ${cleanMuxAsset.id}`);

    // Step 6: Recalculate word timestamps for clean audio (85%)
    await updateProgress(jobId, 'analyzing', 85, 'Recalculating word timestamps');

    const { cleanWords, droppedWords } = recalculateWordTimestamps(
      rawWords,
      audibleSegments,
      config.voiceover.cleaning.gapMs
    );

    if (cleanWords.length === 0) {
      throw new Error('No words remain after cleaning');
    }

    logger.info('[Phase 1.5 cleaning] DOING: recalculated word timestamps (words outside keep segments dropped)', {
      episodeId,
      inputWordCount: rawWords.length,
      keptWordCount: cleanWords.length,
      droppedWordCount: droppedWords.length,
      firstKeptWord: cleanWords[0] ? { word: cleanWords[0].word, startMs: cleanWords[0].startMs, endMs: cleanWords[0].endMs } : null,
      lastKeptWord: cleanWords.length > 0 ? cleanWords[cleanWords.length - 1]! ? { word: cleanWords[cleanWords.length - 1]!.word, startMs: cleanWords[cleanWords.length - 1]!.startMs, endMs: cleanWords[cleanWords.length - 1]!.endMs } : null : null,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.5_cleaning step=AFTER_RECALC_kept_words episodeId=${episodeId} wordCount=${cleanWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        cleanWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
      )}`
    );
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.5_cleaning step=AFTER_RECALC_dropped_words episodeId=${episodeId} wordCount=${droppedWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        droppedWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
      )}`
    );
    if (droppedWords.length > 0) {
      logger.warn(
        `Dropped ${droppedWords.length} words during cleaning (likely removed segments).`
      );
    }

    // Use Mux duration as source of truth when available
    let cleanDurationSeconds: number;
    let normalizedWords = cleanWords;
    let arollCleanPreview: ArollCleanPreviewResult | null = null;

    if (readyCleanAsset.duration && readyCleanAsset.duration > 0) {
      cleanDurationSeconds = readyCleanAsset.duration;
      const lastWord = cleanWords[cleanWords.length - 1];
      const wordTimestampDuration = lastWord ? lastWord.endMs / 1000 : 0;
      const targetDurationMs = Math.round(cleanDurationSeconds * 1000);
      normalizedWords = normalizeWordsToTargetDuration(cleanWords, targetDurationMs);
      const normalizedLastWord = normalizedWords[normalizedWords.length - 1];
      const wordDurationAfter = normalizedLastWord ? normalizedLastWord.endMs / 1000 : 0;
      logger.info('[Phase 1.5 cleaning] DOING: normalized word timestamps to Mux clean duration', {
        episodeId,
        wordDurationBefore: wordTimestampDuration.toFixed(2),
        wordDurationAfter: wordDurationAfter.toFixed(2),
        muxCleanDuration: cleanDurationSeconds.toFixed(2),
      });
      logger.info(`[VOICEOVER_TRACE_FULL] phase=1.5_cleaning step=AFTER_SCALE episodeId=${episodeId} wordCount=${normalizedWords.length} (next line = full words with timestamps, no truncation)`);
      logger.info(
        `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
          normalizedWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
        )}`
      );
    } else {
      const lastWord = cleanWords[cleanWords.length - 1];
      cleanDurationSeconds = lastWord ? lastWord.endMs / 1000 : 0;
      logger.warn(`Mux duration not available, using word timestamp duration: ${cleanDurationSeconds.toFixed(2)}s`);
    }

    const templateSlotRequirements = (episode.template?.slotRequirements ??
      null) as SlotRequirementsJson;

    const isArollFirst = isArollFirstTemplate(templateSlotRequirements);
    if (isArollFirst && tempCleanPath) {
      const arollS3Key = resolveArollSourceS3Key(
        episode.slotClips as Array<{ slotType: string; s3Key: string; createdAt: Date }>,
        episode.rawVoiceoverS3Key
      );

      if (arollS3Key) {
        try {
          await updateProgress(jobId, 'processing', 92, 'Building cleaned A-roll preview video');
          const suffix = getFileSuffixFromS3Key(arollS3Key) || '.mov';
          tempArollSourcePath = `/tmp/aroll_source_${episodeId}_${Date.now()}${suffix}`;
          tempArollPreviewPath = `/tmp/aroll_clean_preview_${episodeId}_${Date.now()}.mp4`;

          await s3Service.downloadFile(arollS3Key, tempArollSourcePath);

          await buildArollCleanPreviewVideo({
            inputVideoPath: tempArollSourcePath,
            cleanAudioPath: tempCleanPath,
            outputPath: tempArollPreviewPath,
            audibleSegments,
            gapMs: config.voiceover.cleaning.gapMs,
          });

          const previewS3Key = `aroll-previews/${userId}/${episodeId}/clean_${Date.now()}.mp4`;
          await s3Service.uploadFile(tempArollPreviewPath, previewS3Key, 'video/mp4');

          const previewSignedUrl = await s3Service.getSignedDownloadUrl(previewS3Key, 7200);
          const previewMuxAsset = await muxService.createAssetFromUrl({
            inputUrl: previewSignedUrl,
            passthrough: `episode:${episodeId}:aroll:clean_preview`,
            generateSubtitles: false,
            language: 'en',
          });
          const readyPreviewAsset = await muxService.waitForAssetReady(previewMuxAsset.id, 120, 3000);
          const previewPlaybackId = readyPreviewAsset.playbackIds?.[0]?.id ?? null;

          if (!previewPlaybackId) {
            throw new Error(`No playback ID for cleaned A-roll preview asset ${previewMuxAsset.id}`);
          }

          arollCleanPreview = {
            s3Key: previewS3Key,
            muxAssetId: previewMuxAsset.id,
            playbackId: previewPlaybackId,
            durationSeconds: readyPreviewAsset.duration ?? cleanDurationSeconds,
          };

          logger.info('[Phase 1.5 cleaning] Built cleaned A-roll preview video', {
            episodeId,
            previewS3Key,
            previewMuxAssetId: previewMuxAsset.id,
            previewPlaybackId,
            previewDurationSeconds: arollCleanPreview.durationSeconds,
          });
        } catch (error) {
          logger.warn('[Phase 1.5 cleaning] Failed to build cleaned A-roll preview video (continuing)', {
            episodeId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // Step 7: Update episode (95%)
    await updateProgress(jobId, 'done', 95, 'Updating episode');

    logger.info('[Phase 1.5 cleaning] STORED: episode wordTranscript OVERWRITTEN with kept words only (original Deepgram transcript replaced)', {
      episodeId,
      wordTranscriptCountBefore: rawWords.length,
      wordTranscriptCountAfter: normalizedWords.length,
      cleanVoiceoverS3Key: cleanS3Key,
      cleanVoiceoverMuxAssetId: cleanMuxAsset.id,
      cleanVoiceoverDurationSeconds: cleanDurationSeconds,
      note: 'episode.rawDeepgramResponse and episode.correctedWordTranscript are unchanged',
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.5_cleaning step=STORED_episode_wordTranscript episodeId=${episodeId} wordCount=${normalizedWords.length} (next line = full words with timestamps, no truncation; this is new episode.wordTranscript)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        normalizedWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
      )}`
    );
    const episodeRenderSpec = ((episode.renderSpec ?? {}) as Record<string, unknown>);
    const renderSpecUpdate = arollCleanPreview
      ? {
          ...episodeRenderSpec,
          arollCleanPreviewS3Key: arollCleanPreview.s3Key,
          arollCleanPreviewMuxAssetId: arollCleanPreview.muxAssetId,
          arollCleanPreviewPlaybackId: arollCleanPreview.playbackId,
          arollCleanPreviewDuration: arollCleanPreview.durationSeconds,
          arollCleanPreviewGeneratedAt: new Date().toISOString(),
        }
      : episodeRenderSpec;

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        cleanVoiceoverS3Key: cleanS3Key,
        cleanVoiceoverMuxAssetId: cleanMuxAsset.id,
        cleanVoiceoverPlaybackId: cleanPlaybackId,
        cleanVoiceoverDuration: cleanDurationSeconds,
        wordTranscript: normalizedWords as any,
        status: 'voiceover_cleaned',
        renderSpec: renderSpecUpdate as any,
        revision: { increment: 1 },
        renderRequested: false,
      },
    });

    // Step 8: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          cleanS3Key,
          cleanMuxAssetId: cleanMuxAsset.id,
          cleanPlaybackId,
          cleanDurationSeconds,
          originalDurationSeconds: episode.rawVoiceoverDuration,
          timeSavedSeconds: (episode.rawVoiceoverDuration ?? 0) - cleanDurationSeconds,
          segmentsToRemoveCount: sanitizedRemovals.length,
          audibleSegmentCount: audibleSegments.length,
          droppedWordCount: droppedWords.length,
          droppedWordsPreview: droppedWords.slice(0, 5).map((word) => ({
            word: word.word,
            startMs: word.startMs,
            endMs: word.endMs,
          })),
          arollCleanPreview: arollCleanPreview
            ? {
                s3Key: arollCleanPreview.s3Key,
                muxAssetId: arollCleanPreview.muxAssetId,
                playbackId: arollCleanPreview.playbackId,
                durationSeconds: arollCleanPreview.durationSeconds,
              }
            : null,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Voiceover cleaned: ${cleanDurationSeconds.toFixed(1)}s (saved ${((episode.rawVoiceoverDuration ?? 0) - cleanDurationSeconds).toFixed(1)}s)`
    );

    // Step 9: Trigger next job - voiceover_segmentation
    logger.info(`[Phase 1.5] Triggering voiceover_segmentation job for episode ${episodeId}`);

    const segmentationJob = await prisma.job.create({
      data: {
        type: 'voiceover_segmentation',
        status: 'pending',
        userId,
        episodeId,
        inputData: {
          wordCount: normalizedWords.length,
        },
      },
    });

    const { queues } = await import('../queue.js');
    await queues.voiceoverSegmentation.add('voiceover-segmentation', {
      jobId: segmentationJob.id,
      episodeId,
      userId,
    });

    logger.info(`[Phase 1.5] Voiceover cleaning job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 1.5] Voiceover cleaning job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'error',
        errorMessage,
      },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  } finally {
    if (tempRawPath) {
      try {
        await unlink(tempRawPath);
        logger.debug(`Cleaned up temp file: ${tempRawPath}`);
      } catch (error) {
        logger.warn(`Failed to clean up temp file: ${tempRawPath}`, error);
      }
    }
    if (tempCleanPath) {
      try {
        await unlink(tempCleanPath);
        logger.debug(`Cleaned up temp file: ${tempCleanPath}`);
      } catch (error) {
        logger.warn(`Failed to clean up temp file: ${tempCleanPath}`, error);
      }
    }
    if (tempArollSourcePath) {
      try {
        await unlink(tempArollSourcePath);
        logger.debug(`Cleaned up temp file: ${tempArollSourcePath}`);
      } catch (error) {
        logger.warn(`Failed to clean up temp file: ${tempArollSourcePath}`, error);
      }
    }
    if (tempArollPreviewPath) {
      try {
        await unlink(tempArollPreviewPath);
        logger.debug(`Cleaned up temp file: ${tempArollPreviewPath}`);
      } catch (error) {
        logger.warn(`Failed to clean up temp file: ${tempArollPreviewPath}`, error);
      }
    }
  }
}

// ==================== HELPERS ====================

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

function sanitizeRemovalSegments(
  segments: SegmentToRemove[],
  durationMs: number
): SegmentToRemove[] {
  if (!Array.isArray(segments) || segments.length === 0) return [];

  return segments
    .map((seg) => ({
      startMs: Math.max(0, Math.min(durationMs, seg.startMs)),
      endMs: Math.max(0, Math.min(durationMs, seg.endMs)),
      type: seg.type,
      reason: seg.reason,
    }))
    .filter((seg) => seg.endMs > seg.startMs)
    .sort((a, b) => a.startMs - b.startMs);
}

function protectTranscriptWordsFromGapRemovals(
  segments: SegmentToRemove[],
  wordsToProtect: WordTimestamp[],
  durationMs: number,
  padMs: number
): SegmentToRemove[] {
  if (!Array.isArray(segments) || segments.length === 0 || wordsToProtect.length === 0) {
    return segments;
  }

  const protectedRanges = wordsToProtect
    .map((word) => ({
      startMs: Math.max(0, Math.min(durationMs, word.startMs - padMs)),
      endMs: Math.max(0, Math.min(durationMs, word.endMs + padMs)),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  if (protectedRanges.length === 0) {
    return segments;
  }

  const output: SegmentToRemove[] = [];

  for (const segment of segments) {
    if (segment.type !== 'script' && segment.type !== 'silence') {
      output.push(segment);
      continue;
    }

    let pending: Array<{ startMs: number; endMs: number }> = [
      { startMs: segment.startMs, endMs: segment.endMs },
    ];

    for (const range of protectedRanges) {
      if (pending.length === 0) break;
      const nextPending: Array<{ startMs: number; endMs: number }> = [];
      for (const part of pending) {
        if (range.endMs <= part.startMs || range.startMs >= part.endMs) {
          nextPending.push(part);
          continue;
        }
        if (range.startMs > part.startMs) {
          nextPending.push({
            startMs: part.startMs,
            endMs: Math.min(range.startMs, part.endMs),
          });
        }
        if (range.endMs < part.endMs) {
          nextPending.push({
            startMs: Math.max(range.endMs, part.startMs),
            endMs: part.endMs,
          });
        }
      }
      pending = nextPending.filter((part) => part.endMs > part.startMs);
    }

    for (const part of pending) {
      output.push({
        ...segment,
        startMs: part.startMs,
        endMs: part.endMs,
      });
    }
  }

  return output;
}

/**
 * Recalculate word timestamps based on kept segments
 *
 * Maps original word timestamps to their new positions in the clean audio.
 * The clean audio is created by concatenating audible segments with 150ms gaps between them.
 */
function recalculateWordTimestamps(
  rawWords: WordTimestamp[],
  audibleSegments: AudibleSegment[],
  gapMs: number
): { cleanWords: WordTimestamp[]; droppedWords: WordTimestamp[] } {
  const GAP_MS = Math.max(0, Math.round(gapMs));
  const cleanWords: WordTimestamp[] = [];
  const droppedWords: WordTimestamp[] = [];

  const segmentMappings = audibleSegments.map((segment, index) => {
    const previousSegmentsDuration = audibleSegments
      .slice(0, index)
      .reduce((sum, seg) => sum + (seg.endMs - seg.startMs), 0);

    const gapsBeforeThisSegment = index * GAP_MS;

    return {
      rawStart: segment.startMs,
      rawEnd: segment.endMs,
      cleanStart: previousSegmentsDuration + gapsBeforeThisSegment,
      cleanEnd: previousSegmentsDuration + gapsBeforeThisSegment + (segment.endMs - segment.startMs),
    };
  });

  for (const word of rawWords) {
    const wordStart = word.startMs;
    const wordEnd = word.endMs;

    const overlappingMappings = segmentMappings.filter(
      (m) => wordStart < m.rawEnd && wordEnd > m.rawStart
    );

    if (overlappingMappings.length === 0) {
      droppedWords.push(word);
      continue;
    }

    let bestMapping: typeof overlappingMappings[0] | null = null;
    let maxOverlap = 0;

    for (const mapping of overlappingMappings) {
      const overlapStart = Math.max(wordStart, mapping.rawStart);
      const overlapEnd = Math.min(wordEnd, mapping.rawEnd);
      const overlapDuration = overlapEnd - overlapStart;

      if (overlapDuration > maxOverlap) {
        maxOverlap = overlapDuration;
        bestMapping = mapping;
      }
    }

    if (!bestMapping) {
      continue;
    }

    const clampedWordStart = Math.max(wordStart, bestMapping.rawStart);
    const clampedWordEnd = Math.min(wordEnd, bestMapping.rawEnd);

    const offsetStart = clampedWordStart - bestMapping.rawStart;
    const offsetEnd = clampedWordEnd - bestMapping.rawStart;

    cleanWords.push({
      word: word.word,
      startMs: Math.round(bestMapping.cleanStart + offsetStart),
      endMs: Math.round(bestMapping.cleanStart + offsetEnd),
      confidence: word.confidence,
    });
  }

  return { cleanWords, droppedWords };
}

function normalizeWordsToTargetDuration(
  words: WordTimestamp[],
  targetDurationMs: number
): WordTimestamp[] {
  if (words.length === 0 || targetDurationMs <= 0) {
    return words;
  }

  const lastWord = words[words.length - 1];
  const currentDurationMs = lastWord?.endMs ?? 0;
  if (!Number.isFinite(currentDurationMs) || currentDurationMs <= 0) {
    return words;
  }

  const scaleFactor = targetDurationMs / currentDurationMs;
  const lastIndex = words.length - 1;
  let prevEnd = 0;

  return words.map((word, index) => {
    let startMs = Math.round(word.startMs * scaleFactor);
    let endMs = index === lastIndex
      ? targetDurationMs
      : Math.round(word.endMs * scaleFactor);

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
}

/**
 * Calculate audible segments (inverse of segments to remove)
 */
function calculateAudibleSegments(
  durationMs: number,
  segmentsToRemove: SegmentToRemove[]
): AudibleSegment[] {
  if (segmentsToRemove.length === 0) {
    return [{ startMs: 0, endMs: durationMs }];
  }

  const audibleSegments: AudibleSegment[] = [];
  let currentStart = 0;

  const sorted = [...segmentsToRemove].sort((a, b) => a.startMs - b.startMs);

  for (const segment of sorted) {
    if (currentStart < segment.startMs) {
      audibleSegments.push({
        startMs: currentStart,
        endMs: segment.startMs,
      });
    }
    currentStart = Math.max(currentStart, segment.endMs);
  }

  if (currentStart < durationMs) {
    audibleSegments.push({
      startMs: currentStart,
      endMs: durationMs,
    });
  }

  return audibleSegments;
}

/**
 * Extract and concatenate audio segments using FFmpeg
 * Adds 150ms silence between segments for natural transitions
 */
async function extractAndConcatenateSegments(
  inputPath: string,
  outputPath: string,
  segments: AudibleSegment[],
  gapMs: number
): Promise<void> {
  return new Promise((resolve, reject) => {
    const GAP_MS = Math.max(0, Math.round(gapMs));
    const GAP_SEC = GAP_MS / 1000;

    const filterParts: string[] = [];

    segments.forEach((seg, i) => {
      const startSec = seg.startMs / 1000;
      const endSec = seg.endMs / 1000;

      let segmentFilter = `[0:a]atrim=start=${startSec}:end=${endSec},asetpts=PTS-STARTPTS`;

      if (i < segments.length - 1) {
        segmentFilter += `,apad=pad_dur=${GAP_SEC}[seg${i}]`;
      } else {
        segmentFilter += `[seg${i}]`;
      }

      filterParts.push(segmentFilter);
    });

    const concatInputs = segments.map((_, i) => `[seg${i}]`).join('');

    const filterComplex = [
      ...filterParts,
      `${concatInputs}concat=n=${segments.length}:v=0:a=1[out]`,
    ].join(';');

    ffmpeg(inputPath)
      .complexFilter(filterComplex)
      .outputOptions(['-map', '[out]'])
      .audioCodec('libmp3lame')
      .audioBitrate('192k')
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .run();
  });
}

function isArollFirstTemplate(slotRequirements: SlotRequirementsJson): boolean {
  if (slotRequirements?.workflow === 'aroll_clean_then_broll') return true;

  const slots = slotRequirements?.slots;
  if (!Array.isArray(slots) || slots.length === 0) return false;
  const requiredSlots = slots.filter((slot) => slot.priority === 'required');
  if (requiredSlots.length === 0) return false;
  return requiredSlots[0]?.slotType === 'a_roll_face';
}

function hasVideoExtension(s3Key: string): boolean {
  return /\.(mp4|mov|m4v|webm)$/i.test(s3Key);
}

function getFileSuffixFromS3Key(s3Key: string): string | null {
  const match = s3Key.match(/(\.[a-zA-Z0-9]+)$/);
  return match ? match[1] || null : null;
}

function resolveArollSourceS3Key(
  slotClips: Array<{ slotType: string; s3Key: string; createdAt: Date }>,
  rawVoiceoverS3Key: string | null
): string | null {
  const arollClip = slotClips.find((clip) => clip.slotType === 'a_roll_face' && !!clip.s3Key);
  if (arollClip?.s3Key) return arollClip.s3Key;
  if (rawVoiceoverS3Key && hasVideoExtension(rawVoiceoverS3Key)) return rawVoiceoverS3Key;
  return null;
}

async function buildArollCleanPreviewVideo(args: {
  inputVideoPath: string;
  cleanAudioPath: string;
  outputPath: string;
  audibleSegments: AudibleSegment[];
  gapMs: number;
}): Promise<void> {
  const { inputVideoPath, cleanAudioPath, outputPath, audibleSegments, gapMs } = args;
  const GAP_SEC = Math.max(0, Math.round(gapMs)) / 1000;

  if (audibleSegments.length === 0) {
    throw new Error('No audible segments available to build cleaned A-roll preview');
  }

  return new Promise((resolve, reject) => {
    const filters: string[] = [];
    const concatInputs: string[] = [];

    audibleSegments.forEach((segment, index) => {
      const startSec = segment.startMs / 1000;
      const endSec = segment.endMs / 1000;
      const baseLabel = `vbase${index}`;
      const outLabel = `v${index}`;

      filters.push(
        `[0:v]trim=start=${startSec.toFixed(3)}:end=${endSec.toFixed(3)},setpts=PTS-STARTPTS,format=yuv420p[${baseLabel}]`
      );

      if (index < audibleSegments.length - 1 && GAP_SEC > 0) {
        filters.push(`[${baseLabel}]tpad=stop_mode=clone:stop_duration=${GAP_SEC.toFixed(3)}[${outLabel}]`);
      } else {
        filters.push(`[${baseLabel}]null[${outLabel}]`);
      }

      concatInputs.push(`[${outLabel}]`);
    });

    filters.push(`${concatInputs.join('')}concat=n=${audibleSegments.length}:v=1:a=0[vout]`);

    ffmpeg(inputVideoPath)
      .input(cleanAudioPath)
      .complexFilter(filters)
      .outputOptions(['-map', '[vout]', '-map', '1:a:0', '-shortest', '-movflags', '+faststart'])
      .videoCodec('libx264')
      .audioCodec('aac')
      .audioBitrate('192k')
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', (error) => reject(error))
      .run();
  });
}

async function tailHasSpeech(args: {
  inputPath: string;
  durationMs: number;
  windowMs: number;
  threshold: number;
}): Promise<boolean> {
  const { inputPath, durationMs, windowMs, threshold } = args;
  if (durationMs <= 0 || windowMs <= 0) return false;

  const windowSec = Math.min(windowMs, durationMs) / 1000;
  const startSec = Math.max(0, (durationMs - windowMs) / 1000);

  return new Promise((resolve) => {
    let meanDb: number | null = null;

    ffmpeg(inputPath)
      .seekInput(startSec)
      .duration(windowSec)
      .audioFilters('volumedetect')
      .outputOptions(['-f', 'null'])
      .output('/dev/null')
      .on('stderr', (line) => {
        const match = line.match(/mean_volume:\s*(-?inf|[-\d.]+)\s*dB/i);
        if (!match) return;
        const value = match[1];
        if (value === '-inf') {
          meanDb = -1000;
          return;
        }
        const parsed = Number(value);
        if (Number.isFinite(parsed)) {
          meanDb = parsed;
        }
      })
      .on('end', () => {
        if (meanDb == null) {
          resolve(false);
          return;
        }
        const linear = Math.pow(10, meanDb / 20);
        resolve(linear >= Math.max(0, Math.min(1, threshold)));
      })
      .on('error', () => resolve(false))
      .run();
  });
}
