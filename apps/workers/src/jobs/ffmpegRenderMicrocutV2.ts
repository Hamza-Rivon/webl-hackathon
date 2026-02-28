/**
 * Phase 5: FFmpeg Render (Microcut V2)
 *
 * Renders MicroCutPlanV2 to MP4 using FFmpeg and uploads to S3.
 */

import { Job } from 'bullmq';
import ffmpeg from 'fluent-ffmpeg';
import { prisma } from '../services/db.js';
import { s3Service } from '../services/s3.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { MicroCutPlanV2Schema } from '@webl/shared';
import { incrementUsage, usageService } from '../services/usage.js';
import { queues } from '../queue.js';
import { writeFile, unlink } from 'fs/promises';

const DURATION_TOLERANCE_FRAMES = 2;
const CAPTION_MAX_WORDS = 5;
const CAPTION_TARGET_WORDS = 4;
const CAPTION_BREAK_GAP_MS = 260;
const CAPTION_MIN_DURATION_MS = 250;
const CAPTION_MAX_LINES = 2;

interface TranscriptWord {
  word: string;
  startMs: number;
  endMs: number;
}

interface CaptionCue {
  text: string;
  startMs: number;
  endMs: number;
}

interface FfmpegRenderJobData {
  jobId: string;
  episodeId: string;
  userId: string;
}

export async function processFfmpegRenderMicrocutV2(
  bullJob: Job<FfmpegRenderJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;

  logger.info(`[Phase 5] Starting FFmpeg render job ${jobId}`, { episodeId });

  const tempPaths: string[] = [];
  const chunkCache = new Map<string, string>();

  try {
    // Usage guard: check hard limits before render
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
      'Starting FFmpeg render'
    );

    await updateProgress(jobId, 'processing', 10, 'Loading cut plan');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        cutPlan: true,
        cleanVoiceoverS3Key: true,
        cleanVoiceoverDuration: true,
        wordTranscript: true,
        renderSpec: true,
      },
    });

    if (!episode?.cutPlan || !episode.cleanVoiceoverS3Key || !episode.cleanVoiceoverDuration) {
      throw new Error('Episode is missing cut plan or clean voiceover');
    }

    const cutPlan = MicroCutPlanV2Schema.parse(episode.cutPlan);
    const targetDurationMs = Math.round(episode.cleanVoiceoverDuration * 1000);
    const targetDurationSec = targetDurationMs / 1000;
    const existingRenderSpec = (episode.renderSpec as Record<string, unknown> | null) ?? {};
    const captionsEnabled = existingRenderSpec.captionsEnabled !== false;
    const transcriptWords = normalizeTranscriptWords(episode.wordTranscript, targetDurationMs);
    const captionCues = captionsEnabled
      ? buildCaptionCues(transcriptWords, targetDurationMs)
      : [];
    const captionFilters = captionsEnabled
      ? buildCaptionDrawtextFilters(captionCues, cutPlan.width, cutPlan.height)
      : [];
    logger.info('[Phase 5.2] RECEIVED: render inputs', {
      episodeId,
      cutCount: cutPlan.cuts.length,
      targetDurationMs,
      cleanVoiceoverS3Key: episode.cleanVoiceoverS3Key,
      transcriptWordCount: transcriptWords.length,
      captionsEnabled,
      captionCueCount: captionCues.length,
    });

    await updateProgress(jobId, 'processing', 20, 'Downloading voiceover');

    const voiceoverPath = `/tmp/voiceover_${episodeId}_${Date.now()}.mp3`;
    tempPaths.push(voiceoverPath);
    await s3Service.downloadFile(episode.cleanVoiceoverS3Key, voiceoverPath);

    await updateProgress(jobId, 'processing', 30, 'Preparing clips');

    const clipPaths: string[] = [];

    for (let i = 0; i < cutPlan.cuts.length; i += 1) {
      const cut = cutPlan.cuts[i]!;
      const chunkPath = await getChunkPath(
        cut.chunkId,
        cut.chunkS3Key,
        chunkCache,
        tempPaths
      );

      const clipPath = `/tmp/clip_${episodeId}_${cut.cutIndex}_${Date.now()}.mp4`;
      tempPaths.push(clipPath);

      await renderClip({
        inputPath: chunkPath,
        outputPath: clipPath,
        clipStartMs: cut.clipStartMs,
        clipEndMs: cut.clipEndMs,
        width: cutPlan.width,
        height: cutPlan.height,
        fps: cutPlan.fps,
      });

      clipPaths.push(clipPath);

      const progress = 30 + Math.round(((i + 1) / cutPlan.cuts.length) * 40);
      await updateProgress(jobId, 'processing', progress, `Rendering clip ${i + 1}/${cutPlan.cuts.length}`);
    }

    await updateProgress(jobId, 'processing', 75, 'Concatenating clips');

    const concatListPath = `/tmp/concat_${episodeId}_${Date.now()}.txt`;
    const concatOutputPath = `/tmp/concat_${episodeId}_${Date.now()}.mp4`;
    tempPaths.push(concatListPath, concatOutputPath);

    await writeFile(
      concatListPath,
      clipPaths.map((path) => `file '${path}'`).join('\n')
    );

    await concatClips(concatListPath, concatOutputPath, cutPlan.fps);

    await updateProgress(jobId, 'processing', 85, 'Muxing audio');

    const finalOutputPath = `/tmp/final_${episodeId}_${Date.now()}.mp4`;
    tempPaths.push(finalOutputPath);

    await muxAudio({
      videoPath: concatOutputPath,
      audioPath: voiceoverPath,
      outputPath: finalOutputPath,
      durationSec: targetDurationSec,
      fps: cutPlan.fps,
      captionFilters,
    });

    const finalDurationMs = await probeDurationMs(finalOutputPath);
    const durationDeltaMs = Math.abs(finalDurationMs - targetDurationMs);
    const maxDurationDeltaMs = Math.ceil((1000 / Math.max(1, cutPlan.fps)) * DURATION_TOLERANCE_FRAMES);

    if (durationDeltaMs > maxDurationDeltaMs) {
      throw new Error(
        `Rendered duration mismatch: ${finalDurationMs}ms vs ${targetDurationMs}ms (delta ${durationDeltaMs}ms, tolerance ${maxDurationDeltaMs}ms)`
      );
    }

    await updateProgress(jobId, 'uploading', 90, 'Uploading render');

    const outputFileName = `ffmpeg_microcut_v2_${Date.now()}.mp4`;
    const finalS3Key = `users/${userId}/renders/${episodeId}/${outputFileName}`;
    await s3Service.uploadFile(finalOutputPath, finalS3Key, 'video/mp4');

    await incrementUsage(userId, 'renders', 1);

    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        status: 'rendering',
        finalS3Key: finalS3Key,
        renderSpec: {
          ...existingRenderSpec,
          finalS3Key,
          finalRenderedAt: new Date().toISOString(),
          outputWidth: cutPlan.width,
          outputHeight: cutPlan.height,
          captionsEnabled,
          captions: {
            source: 'cleaned_word_transcript',
            burntIn: captionsEnabled && captionCues.length > 0,
            cueCount: captionCues.length,
            maxWordsPerCue: CAPTION_MAX_WORDS,
          },
        },
      },
    });
    logger.info('[Phase 5.2] STORED: render output in episode and queued mux publish', {
      episodeId,
      finalS3Key,
      finalDurationMs,
      targetDurationMs,
    });

    await updateProgress(jobId, 'processing', 95, 'Scheduling Mux upload');

    const muxPublishJob = await prisma.job.create({
      data: {
        type: 'mux_publish',
        status: 'pending',
        episodeId,
        userId,
        inputData: {
          finalS3Key,
        },
      },
    });

    await queues.muxPublish.add('mux_publish', {
      jobId: muxPublishJob.id,
      episodeId,
      userId,
      finalS3Key,
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: {
          finalS3Key,
          durationMs: finalDurationMs,
          captionsEnabled,
          captionCueCount: captionCues.length,
        },
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      'FFmpeg render complete'
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 5] FFmpeg render job ${jobId} failed:`, error);

    await prisma.job.update({
      where: { id: jobId },
      data: { status: 'error', errorMessage },
    });

    await progressPublisher.publish(jobId, 'error', 'processing', 0, errorMessage);

    throw error;
  } finally {
    for (const path of tempPaths) {
      try {
        await unlink(path);
      } catch {
        // ignore
      }
    }
  }
}

async function getChunkPath(
  chunkId: string,
  chunkS3Key: string,
  chunkCache: Map<string, string>,
  tempPaths: string[]
): Promise<string> {
  const cached = chunkCache.get(chunkId);
  if (cached) return cached;

  const chunkPath = `/tmp/chunk_${chunkId}.mp4`;
  tempPaths.push(chunkPath);
  await s3Service.downloadFile(chunkS3Key, chunkPath);
  chunkCache.set(chunkId, chunkPath);
  return chunkPath;
}

function renderClip(args: {
  inputPath: string;
  outputPath: string;
  clipStartMs: number;
  clipEndMs: number;
  width: number;
  height: number;
  fps: number;
}): Promise<void> {
  const durationSec = Math.max(0.01, (args.clipEndMs - args.clipStartMs) / 1000);
  const startSec = Math.max(0, args.clipStartMs / 1000);

  return new Promise((resolve, reject) => {
    ffmpeg(args.inputPath)
      .setStartTime(startSec)
      .duration(durationSec)
      .videoFilters([
        `scale=${args.width}:${args.height}:force_original_aspect_ratio=decrease`,
        `pad=${args.width}:${args.height}:(ow-iw)/2:(oh-ih)/2`,
      ])
      .outputOptions([
        `-r ${args.fps}`,
        '-an',
        '-c:v libx264',
        '-pix_fmt yuv420p',
        '-preset veryfast',
      ])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(args.outputPath);
  });
}

function concatClips(listPath: string, outputPath: string, fps: number): Promise<void> {
  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(listPath)
      .inputOptions(['-f concat', '-safe 0'])
      .outputOptions([
        `-r ${fps}`,
        '-vsync cfr',
        '-an',
        '-c:v libx264',
        '-preset veryfast',
        '-pix_fmt yuv420p',
      ])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(outputPath);
  });
}

function muxAudio(args: {
  videoPath: string;
  audioPath: string;
  outputPath: string;
  durationSec: number;
  fps: number;
  captionFilters: string[];
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const command = ffmpeg()
      .input(args.videoPath)
      .input(args.audioPath)
      .audioFilters([`apad=pad_dur=${args.durationSec}`]);

    if (args.captionFilters.length > 0) {
      command.videoFilters(args.captionFilters);
    }

    command
      .outputOptions([
        '-map 0:v:0',
        '-map 1:a:0',
        `-t ${args.durationSec}`,
        `-r ${args.fps}`,
        '-vsync cfr',
        '-c:v libx264',
        '-preset veryfast',
        '-pix_fmt yuv420p',
        '-c:a aac',
        '-movflags +faststart',
      ])
      .on('end', () => resolve())
      .on('error', (err) => reject(err))
      .save(args.outputPath);
  });
}

function normalizeTranscriptWords(rawTranscript: unknown, maxDurationMs: number): TranscriptWord[] {
  if (!Array.isArray(rawTranscript)) return [];

  return rawTranscript
    .map((entry) => {
      const word = typeof entry?.word === 'string' ? entry.word.trim() : '';
      const startMs = Number(entry?.startMs);
      const endMs = Number(entry?.endMs);

      if (!word || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
        return null;
      }

      const clampedStartMs = Math.max(0, Math.min(maxDurationMs, Math.round(startMs)));
      const clampedEndMs = Math.max(clampedStartMs, Math.min(maxDurationMs, Math.round(endMs)));

      return {
        word,
        startMs: clampedStartMs,
        endMs: clampedEndMs,
      };
    })
    .filter((entry): entry is TranscriptWord => Boolean(entry))
    .sort((a, b) => a.startMs - b.startMs);
}

function buildCaptionCues(words: TranscriptWord[], maxDurationMs: number): CaptionCue[] {
  if (words.length === 0) return [];

  const cues: CaptionCue[] = [];
  let index = 0;

  while (index < words.length) {
    const bucket: TranscriptWord[] = [];
    let bucketStartMs = words[index]!.startMs;
    let bucketEndMs = words[index]!.endMs;

    while (index < words.length) {
      const current = words[index]!;
      const next = words[index + 1];
      bucket.push(current);
      bucketEndMs = current.endMs;

      const reachedTarget = bucket.length >= CAPTION_TARGET_WORDS;
      const reachedMax = bucket.length >= CAPTION_MAX_WORDS;
      const punctuationBreak = /[.!?;:,]$/.test(current.word);
      const gapToNextMs = next ? Math.max(0, next.startMs - current.endMs) : Number.POSITIVE_INFINITY;
      const pauseBreak = gapToNextMs >= CAPTION_BREAK_GAP_MS;
      const durationMs = bucketEndMs - bucketStartMs;
      const shouldHoldForReadability =
        !reachedMax &&
        !pauseBreak &&
        !punctuationBreak &&
        durationMs < CAPTION_MIN_DURATION_MS &&
        Boolean(next);

      index += 1;

      if (shouldHoldForReadability) {
        continue;
      }

      if (reachedMax || (reachedTarget && (pauseBreak || punctuationBreak)) || !next) {
        break;
      }
    }

    const text = bucket
      .map((word) => word.word.replace(/\s+/g, ' ').trim())
      .filter(Boolean)
      .join(' ');

    const startMs = Math.max(0, Math.min(maxDurationMs, bucketStartMs));
    const endMs = Math.max(startMs, Math.min(maxDurationMs, bucketEndMs));

    if (text.length > 0 && endMs > startMs) {
      cues.push({ text, startMs, endMs });
    }
  }

  return cues;
}

function buildCaptionDrawtextFilters(
  cues: CaptionCue[],
  width: number,
  height: number
): string[] {
  if (cues.length === 0) return [];

  const fontSize = Math.max(28, Math.round(width * 0.042));
  const bottomMargin = Math.max(140, Math.round(height * 0.11));
  const borderWidth = Math.max(2, Math.round(width * 0.0025));
  const lineSpacing = Math.max(8, Math.round(fontSize * 0.2));
  const maxCharsPerLine = Math.max(16, Math.round(width / 48));

  return cues.map((cue) => {
    const startSec = (cue.startMs / 1000).toFixed(3);
    const endSec = (cue.endMs / 1000).toFixed(3);
    const wrappedText = wrapCaptionText(cue.text, maxCharsPerLine, CAPTION_MAX_LINES);
    const escapedText = escapeDrawtextText(wrappedText);

    // Modern caption style: text outline + shadow instead of solid black box.
    // Looks cleaner on mobile and matches current viral video aesthetics.
    return [
      `drawtext=text='${escapedText}'`,
      `fontsize=${fontSize}`,
      'fontcolor=white',
      'x=(w-text_w)/2',
      `y=h-text_h-${bottomMargin}`,
      `borderw=${borderWidth}`,
      'bordercolor=black',
      'shadowcolor=black@0.7',
      'shadowx=2',
      'shadowy=2',
      `line_spacing=${lineSpacing}`,
      `enable='between(t\\,${startSec}\\,${endSec})'`,
      'fix_bounds=1',
    ].join(':');
  });
}

function wrapCaptionText(text: string, maxCharsPerLine: number, maxLines: number): string {
  const words = text
    .split(/\s+/)
    .map((word) => word.trim())
    .filter(Boolean)
    .flatMap((word) => splitLongWord(word, maxCharsPerLine));

  if (words.length === 0) return '';

  const lines: string[] = [];
  let current = '';

  for (let index = 0; index < words.length; index += 1) {
    const word = words[index]!;
    const next = current ? `${current} ${word}` : word;

    if (next.length <= maxCharsPerLine) {
      current = next;
      continue;
    }

    if (lines.length >= maxLines - 1) {
      current = `${current}${current.endsWith('...') ? '' : '...'}`;
      break;
    }

    if (current.length > 0) {
      lines.push(current);
    }
    current = word;
  }

  if (current.length > 0 && lines.length < maxLines) {
    lines.push(current);
  }

  if (lines.length > maxLines) {
    const visible = lines.slice(0, maxLines);
    visible[maxLines - 1] = `${visible[maxLines - 1]}...`;
    return visible.join('\n');
  }

  return lines.join('\n');
}

function splitLongWord(word: string, maxCharsPerLine: number): string[] {
  if (word.length <= maxCharsPerLine) {
    return [word];
  }

  const result: string[] = [];
  let start = 0;

  while (start < word.length) {
    const end = Math.min(word.length, start + maxCharsPerLine - 1);
    result.push(word.slice(start, end));
    start = end;
  }

  return result;
}

function escapeDrawtextText(text: string): string {
  return text
    .split('\n')
    .map((line) =>
      line
        .replace(/\\/g, '\\\\')
        .replace(/:/g, '\\:')
        .replace(/'/g, "\\'")
        .replace(/,/g, '\\,')
        .replace(/;/g, '\\;')
        .replace(/\[/g, '\\[')
        .replace(/\]/g, '\\]')
        .replace(/%/g, '\\%')
        .trim()
    )
    .join('\\n')
    .trim();
}

function probeDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }
      const durationSec = metadata.format?.duration ?? 0;
      resolve(Math.round(durationSec * 1000));
    });
  });
}

async function updateProgress(
  jobId: string,
  stage: 'starting' | 'processing' | 'uploading' | 'done',
  progress: number,
  message: string
): Promise<void> {
  await prisma.job.update({
    where: { id: jobId },
    data: { stage, progress },
  });
  await progressPublisher.publish(jobId, 'processing', stage, progress, message);
}
