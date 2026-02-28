/**
 * A-Roll Chunk Transcript Job
 *
 * Purpose: Extract word-level transcript from Mux for each A-roll chunk
 * 
 * Pipeline Position: After broll_chunk_ingest (for A-roll chunks only)
 * Dependencies: broll_chunk_ingest (must complete first, Mux asset must have subtitles)
 * Triggers: broll_chunk_enrichment (enrichment will use transcript)
 * 
 * Key Steps:
 * 1. Wait for Mux subtitles to be ready for the chunk asset
 * 2. Fetch WebVTT transcript from Mux
 * 3. Parse VTT to word-level timestamps
 * 4. Store transcript text and words in chunk metadata
 * 5. This enables exact wording per chunk for semantic matching
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { muxService } from '../services/mux.js';
import { progressPublisher } from '../services/progress.js';
import { logger, CHUNK_DURATION_MS } from '@webl/shared';
import { usageService } from '../services/usage.js';

// ==================== TYPES ====================

interface ArollChunkTranscriptJobData {
  jobId: string;
  episodeId: string;
  userId: string;
  slotClipId: string;
  chunkId: string;
  chunkIndex: number;
  muxAssetId: string;
  muxPlaybackId: string;
}

interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

// ==================== JOB PROCESSOR ====================

export async function processArollChunkTranscript(
  bullJob: Job<ArollChunkTranscriptJobData>
): Promise<void> {
  const { jobId, episodeId, slotClipId, chunkId, chunkIndex, muxAssetId, muxPlaybackId, userId } =
    bullJob.data;

  logger.info(`Starting A-roll chunk transcript job ${jobId} for chunk ${chunkIndex}`, {
    episodeId,
    slotClipId,
    chunkId,
    muxAssetId,
  });

  try {
    // Usage guard: check hard limits before Mux API calls
    const usageCheck = await usageService.checkCanProceed(userId);
    if (!usageCheck.allowed) {
      await prisma.job.update({ where: { id: jobId }, data: { status: 'error', errorMessage: `Usage limit exceeded: ${usageCheck.reason}` } });
      throw new Error(`Usage limit exceeded: ${usageCheck.reason}`);
    }

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
      `Starting transcript extraction for A-roll chunk ${chunkIndex}`
    );

    // Step 1: Try to get subtitles from Mux (10-40%)
    await updateProgress(jobId, 'processing', 10, 'Waiting for Mux subtitles');

    const textTrackId = await muxService.waitForSubtitlesReady(muxAssetId, 60, 5000);

    let words: WordTimestamp[] = [];

    if (textTrackId) {
      // Mux subtitles available - use them
      logger.info(`Mux subtitles ready for chunk ${chunkIndex}, track ID: ${textTrackId}`);

      // Step 2: Fetch VTT from Mux (50%)
      await updateProgress(jobId, 'downloading', 50, 'Fetching VTT transcript');

      const vttUrl = `https://stream.mux.com/${muxPlaybackId}/text/${textTrackId}.vtt`;
      await usageService.recordUsage(userId, {
        muxTranscriptFetches: 1,
      });
      const response = await fetch(vttUrl);

      if (!response.ok) {
        logger.warn(`Failed to fetch VTT for chunk ${chunkIndex}: ${response.status} ${response.statusText}, falling back to episode transcript`);
      } else {
        const vttContent = await response.text();
        logger.debug(`Fetched VTT content for chunk ${chunkIndex} (${vttContent.length} bytes)`);

        // Step 3: Parse VTT to word-level timestamps (60%)
        await updateProgress(jobId, 'processing', 60, 'Parsing word-level timestamps');

        words = parseVttToWords(vttContent);
        logger.info(`Parsed ${words.length} words from chunk ${chunkIndex} Mux transcript`);
      }
    }

    // Fallback: If Mux subtitles failed or are unavailable, use episode transcript
    if (words.length === 0) {
      logger.warn(
        `Mux subtitles unavailable for chunk ${chunkIndex} (asset ${muxAssetId}), falling back to episode transcript`
      );
      await updateProgress(jobId, 'processing', 50, 'Using episode transcript as fallback');

      // Get episode transcript
      const episode = await prisma.episode.findUnique({
        where: { id: episodeId },
        select: { wordTranscript: true },
      });

      if (!episode?.wordTranscript || !Array.isArray(episode.wordTranscript)) {
        logger.warn(`No episode transcript available for chunk ${chunkIndex}, chunk may be silent`);
        words = [];
      } else {
        // Map words from episode transcript to this chunk
        // Chunks are CHUNK_DURATION_SECONDS seconds each
        const chunkStartMs = chunkIndex * CHUNK_DURATION_MS;
        const chunkEndMs = (chunkIndex + 1) * CHUNK_DURATION_MS;

        words = ((episode.wordTranscript as unknown) as WordTimestamp[])
          .filter((word) => {
            // Include words that overlap with this chunk's time range
            const wordStart = word.startMs ?? 0;
            const wordEnd = word.endMs ?? wordStart + 300; // Default 300ms if no end time
            return wordStart < chunkEndMs && wordEnd > chunkStartMs;
          })
          .map((word) => {
            // Adjust timestamps to be relative to chunk start (0-CHUNK_DURATION_MS)
            const wordStart = word.startMs ?? 0;
            const wordEnd = word.endMs ?? wordStart + 300;
            return {
              word: word.word,
              startMs: Math.max(0, wordStart - chunkStartMs),
              endMs: Math.min(CHUNK_DURATION_MS, wordEnd - chunkStartMs),
              confidence: word.confidence ?? 1.0,
            };
          });

        logger.info(
          `Mapped ${words.length} words from episode transcript to chunk ${chunkIndex} (${chunkStartMs}ms - ${chunkEndMs}ms)`
        );
      }
    }

    if (words.length === 0) {
      logger.warn(`No words found in transcript for chunk ${chunkIndex} - chunk may be silent`);
    }

    const transcriptSource = textTrackId ? 'mux' : 'episode_fallback';

    // Step 4: Create transcript text and store in chunk metadata (80%)
    await updateProgress(jobId, 'processing', 80, 'Storing transcript in chunk');

    const transcriptText = words.map((w) => w.word).join(' ');

    // Get current chunk to preserve existing data
    const chunk = await prisma.brollChunk.findUnique({
      where: { id: chunkId },
    });

    const currentMetadata = ((chunk as any)?.metadata as Record<string, any>) || {};

    // Update chunk with transcript (using type assertion until Prisma client is regenerated)
    await prisma.brollChunk.update({
      where: { id: chunkId },
      data: {
        metadata: {
          ...currentMetadata,
          transcript: transcriptText,
          words: words,
          transcriptWordCount: words.length,
          transcriptExtractedAt: new Date().toISOString(),
          transcriptSource, // 'mux' or 'episode_fallback'
        },
      } as any, // Type assertion until Prisma client includes metadata field
    });

    logger.info(
      `Stored transcript for chunk ${chunkIndex}: "${transcriptText}" (${words.length} words)`
    );

    // Step 5: Complete job (100%)
    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          transcript: transcriptText,
          wordCount: words.length,
          textTrackId: textTrackId || null,
          transcriptSource,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `A-roll chunk ${chunkIndex} transcript extracted (${words.length} words)`
    );

    logger.info(`A-roll chunk transcript job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`A-roll chunk transcript job ${jobId} failed:`, error);

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

// ==================== HELPERS ====================

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'downloading' | 'processing' | 'analyzing' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress },
  });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}

/**
 * Parse WebVTT content to word timestamps
 * 
 * VTT format from Mux:
 * WEBVTT
 * 
 * 00:00:00.000 --> 00:00:02.500
 * Welcome to the video
 * 
 * 00:00:03.000 --> 00:00:05.000
 * This is the next caption
 */
function parseVttToWords(vttContent: string): WordTimestamp[] {
  const lines = vttContent.split('\n');
  const words: WordTimestamp[] = [];
  let i = 0;

  // Skip WEBVTT header and any metadata
  while (i < lines.length && !lines[i]?.includes('-->')) {
    i++;
  }

  while (i < lines.length) {
    const line = lines[i]?.trim() || '';

    // Look for timestamp line (e.g., "00:00:00.000 --> 00:00:02.500")
    if (line.includes('-->')) {
      const timestampParts = line.split('-->').map((s) => s.trim().split(' ')[0] || '');
      const startStr = timestampParts[0] || '00:00:00.000';
      const endStr = timestampParts[1] || '00:00:00.000';

      const startMs = parseVttTimestamp(startStr);
      const endMs = parseVttTimestamp(endStr);

      // Collect text lines until empty line or next timestamp
      const textLines: string[] = [];
      i++;
      while (i < lines.length && lines[i]?.trim() && !lines[i]?.includes('-->')) {
        textLines.push(lines[i]!.trim());
        i++;
      }

      const text = textLines.join(' ').trim();
      if (text) {
        // Split text into words and distribute timing evenly
        const wordList = text.split(/\s+/).filter((w) => w.length > 0);
        if (wordList.length > 0) {
          const durationPerWord = (endMs - startMs) / wordList.length;
          wordList.forEach((word, index) => {
            words.push({
              word: word.replace(/[.,!?;:]/g, ''), // Remove punctuation for cleaner matching
              startMs: startMs + index * durationPerWord,
              endMs: startMs + (index + 1) * durationPerWord,
              confidence: 1.0,
            });
          });
        }
      }
    } else {
      i++;
    }
  }

  return words;
}

/**
 * Parse VTT timestamp (HH:MM:SS.mmm or MM:SS.mmm) to milliseconds
 */
function parseVttTimestamp(timestamp: string): number {
  const parts = timestamp.split(':');
  if (parts.length === 3) {
    // HH:MM:SS.mmm
    const hours = parseInt(parts[0] || '0', 10);
    const minutes = parseInt(parts[1] || '0', 10);
    const secondsParts = (parts[2] || '0.000').split('.');
    const seconds = parseInt(secondsParts[0] || '0', 10);
    const milliseconds = parseInt(secondsParts[1] || '0', 10);
    return (hours * 3600 + minutes * 60 + seconds) * 1000 + milliseconds;
  } else if (parts.length === 2) {
    // MM:SS.mmm
    const minutes = parseInt(parts[0] || '0', 10);
    const secondsParts = (parts[1] || '0.000').split('.');
    const seconds = parseInt(secondsParts[0] || '0', 10);
    const milliseconds = parseInt(secondsParts[1] || '0', 10);
    return (minutes * 60 + seconds) * 1000 + milliseconds;
  }
  return 0;
}
