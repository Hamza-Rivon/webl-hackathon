/**
 * Phase 1.5: Voiceover Edit Plan Job
 *
 * Purpose: Build a clean edit plan from Deepgram word timestamps + script.
 *
 * Pipeline Position: After voiceover_take_selection
 * Dependencies: voiceover_take_selection (must complete first)
 * Triggers: voiceover_cleaning job
 *
 * Key Steps:
 * 1. Load word-level transcript from the episode
 * 2. Build keep segments from corrected transcript (fallback to alignment)
 * 3. Convert keep segments to removal segments (silence + fillers + repeats)
 * 4. Store edit plan in job output
 * 5. Trigger voiceover_cleaning job
 */

import { Job } from 'bullmq';
import { prisma } from '../services/db.js';
import { progressPublisher } from '../services/progress.js';
import { logger } from '@webl/shared';
import { config } from '../config.js';
import { findScriptAlignedSegments } from '../services/scriptAlignment.js';
import {
  verifyVoiceoverEditPlanRemovals,
  type VoiceoverRemovalVerificationDecision,
  type VoiceoverRemovalVerificationSummary,
} from '../services/voiceoverEditPlanVerification.js';

// ==================== TYPES ====================

interface VoiceoverSilenceDetectionJobData {
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

interface KeepSegment {
  startMs: number;
  endMs: number;
}

interface WordTimestamp {
  word: string;
  startMs: number;
  endMs: number;
  confidence: number;
}

interface AlignmentSummary {
  source: 'take_selection' | 'corrected' | 'raw_transcript' | 'llm' | 'fallback';
  sentenceCount?: number;
  matchedCount?: number;
  usedLlm?: boolean;
}

// Script alignment thresholds
// KEEP_MERGE_GAP_MS: Merge keep segments if gap is ≤ this value
//   Higher = smoother audio (segments merge more easily)
//   Lower = more choppy (segments stay separate)
// MIN_REMOVAL_MS: Only remove segments ≥ this value
//   Higher = more small gaps stay in audio (natural pauses)
//   Lower = more aggressive removal (removes tiny gaps)
const KEEP_MERGE_GAP_MS = 250; // Increased from 200ms for smoother transitions
const MIN_SILENCE_REMOVAL_MS = 500; // Remove long silences when transcript is corrected
const WORD_PAD_MS = 80;
const WORD_PROTECTION_PAD_MS = 20;
const OVERLAP_TOLERANCE_MS = 120;
const REPEAT_GAP_MS = 300;
const MAX_SCRIPT_GAP_REMOVAL_MS = 2500;
const MAX_SILENCE_GAP_REMOVAL_MS = 6000;
const FILLER_WORDS = new Set([
  'um',
  'uh',
  'erm',
  'er',
  'ah',
  'hmm',
  'mm',
  'like',
]);
const FILLER_PHRASES: string[][] = [
  ['you', 'know'],
  ['i', 'mean'],
];

// ==================== JOB PROCESSOR ====================

export async function processVoiceoverSilenceDetection(
  bullJob: Job<VoiceoverSilenceDetectionJobData>
): Promise<void> {
  const { jobId, episodeId, userId } = bullJob.data;

  logger.info(`[Phase 1.5] Starting voiceover edit-plan job ${jobId}`, {
    episodeId,
  });

  try {
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
      'Starting edit plan generation'
    );

    // Step 1: Load episode transcript + script (20%)
    await updateProgress(jobId, 'processing', 20, 'Loading script and transcript');

    const episode = await prisma.episode.findUnique({
      where: { id: episodeId },
      select: {
        scriptContent: true,
        wordTranscript: true,
        correctedWordTranscript: true,
        rawVoiceoverDuration: true,
        editPlan: true,
      },
    });

    if (!episode) {
      throw new Error(`Episode ${episodeId} not found`);
    }

    const rawTranscriptWords = normalizeTranscriptWords(episode.wordTranscript);
    const correctedTranscriptWords = normalizeTranscriptWords(episode.correctedWordTranscript);
    const transcriptWords =
      correctedTranscriptWords.length > 0 ? correctedTranscriptWords : rawTranscriptWords;

    if (transcriptWords.length === 0) {
      throw new Error(`No word transcript found for episode ${episodeId}`);
    }
    const transcriptSource = correctedTranscriptWords.length > 0 ? 'correctedWordTranscript' : 'wordTranscript';
    logger.info('[Phase 1.5 silence_detection] RECEIVED: episode transcript (audio not altered yet)', {
      episodeId,
      transcriptWordCount: transcriptWords.length,
      transcriptSource,
      rawWordCount: rawTranscriptWords.length,
      correctedWordCount: correctedTranscriptWords.length,
    });
    logger.info(`[VOICEOVER_TRACE_FULL] phase=1.5_silence_detection step=RECEIVED_episode_transcript episodeId=${episodeId} wordCount=${transcriptWords.length} (next line = full words with timestamps, no truncation)`);
    logger.info(
      `[VOICEOVER_TRACE_WORDS_JSON] ${JSON.stringify(
        transcriptWords.map((w) => ({ word: w.word, startMs: w.startMs, endMs: w.endMs, confidence: w.confidence }))
      )}`
    );

    const durationSourceWords =
      rawTranscriptWords.length > 0 ? rawTranscriptWords : transcriptWords;
    const transcriptLastWord = durationSourceWords[durationSourceWords.length - 1];
    const transcriptDurationMs = transcriptLastWord?.endMs ?? 0;
    const rawDurationMs = Number.isFinite(episode.rawVoiceoverDuration)
      ? Math.round((episode.rawVoiceoverDuration ?? 0) * 1000)
      : 0;
    const durationMs = Math.max(rawDurationMs, transcriptDurationMs);

    // Step 2: Align script to transcript (50%)
    await updateProgress(jobId, 'analyzing', 50, 'Aligning script to transcript');

    let alignmentSource: AlignmentSummary['source'] = 'fallback';
    let alignmentSummary: AlignmentSummary | null = null;
    let keepSegments: KeepSegment[] = [];

    const existingEditPlan = episode.editPlan as any;
    const takeSelectionKeep = Array.isArray(existingEditPlan?.keepSegments)
      && existingEditPlan?.source === 'take_selection'
      ? (existingEditPlan.keepSegments as KeepSegment[])
      : null;

    if (config.voiceover.takeSelection.enabled && (!takeSelectionKeep || takeSelectionKeep.length === 0)) {
      throw new Error('Take selection keep segments missing; pipeline requires voiceover_take_selection');
    }

    const scriptSentenceCount = episode.scriptContent
      ? splitScriptSentences(episode.scriptContent, config.voiceover.takeSelection.scriptMinWords ?? 2).length
      : 0;
    const minCoverageRatio = config.voiceover.takeSelection.minCoverageRatio ?? 0.5;
    const minRequiredSegments = Math.max(2, Math.ceil(scriptSentenceCount * minCoverageRatio));
    const takeSelectionSufficient =
      takeSelectionKeep &&
      takeSelectionKeep.length > 0 &&
      takeSelectionKeep.length >= minRequiredSegments;

    if (takeSelectionKeep && takeSelectionKeep.length > 0 && takeSelectionSufficient) {
      alignmentSource = 'take_selection';
      alignmentSummary = {
        source: 'take_selection',
        matchedCount: takeSelectionKeep.length,
      };
      keepSegments = takeSelectionKeep;
    } else if (takeSelectionKeep && takeSelectionKeep.length > 0 && !takeSelectionSufficient) {
      logger.warn(
        `Take selection coverage low (${takeSelectionKeep.length} segments for ${scriptSentenceCount} sentences, min ${minRequiredSegments}); falling back to transcript-derived keep segments to avoid cutting valid audio`
      );
      alignmentSource = 'raw_transcript';
      const fallbackWords =
        correctedTranscriptWords.length > 0 ? correctedTranscriptWords : rawTranscriptWords;
      alignmentSummary = {
        source: 'raw_transcript',
        sentenceCount: scriptSentenceCount,
        matchedCount: fallbackWords.length,
      };
      keepSegments = buildKeepSegmentsFromWords(
        fallbackWords,
        durationMs,
        WORD_PAD_MS,
        KEEP_MERGE_GAP_MS
      );
    } else if (correctedTranscriptWords.length > 0) {
      alignmentSource = 'corrected';
      alignmentSummary = {
        source: 'corrected',
        matchedCount: correctedTranscriptWords.length,
      };
      keepSegments = buildKeepSegmentsFromWords(
        rawTranscriptWords.length > 0 ? rawTranscriptWords : correctedTranscriptWords,
        durationMs,
        WORD_PAD_MS,
        KEEP_MERGE_GAP_MS
      );
    } else if (episode.scriptContent) {
      await updateProgress(jobId, 'analyzing', 60, 'Aligning script to transcript (LLM)');
      const alignmentLlm = await findScriptAlignedSegments(
        episode.scriptContent,
        transcriptWords,
        userId,
        logger
      );
      if (alignmentLlm) {
        alignmentSource = 'llm';
        alignmentSummary = {
          source: 'llm',
          sentenceCount: alignmentLlm.stats.sentenceCount,
          matchedCount: alignmentLlm.stats.matchedCount,
          usedLlm: alignmentLlm.stats.usedLlm,
        };
        keepSegments = alignmentLlm.keepSegments;
      }
    } else {
      logger.warn(`Episode ${episodeId} has no script content; falling back to transcript bounds`);
    }

    if (keepSegments.length === 0) {
      alignmentSource = 'fallback';
      const firstWord = transcriptWords[0];
      const lastWord = transcriptWords[transcriptWords.length - 1];
      if (firstWord && lastWord) {
        keepSegments = [{ startMs: firstWord.startMs, endMs: lastWord.endMs }];
      } else if (durationMs > 0) {
        keepSegments = [{ startMs: 0, endMs: durationMs }];
      }
      alignmentSummary = alignmentSummary ?? { source: 'fallback', usedLlm: false };
    }

    const usingTakeSelection = alignmentSource === 'take_selection';
    let mergedKeepSegments = mergeKeepSegments(keepSegments, durationMs, KEEP_MERGE_GAP_MS);

    if (usingTakeSelection && correctedTranscriptWords.length > 0) {
      const uncoveredWordRuns = findUncoveredWordRuns(
        correctedTranscriptWords,
        mergedKeepSegments,
        durationMs,
        WORD_PAD_MS
      );
      if (uncoveredWordRuns.length > 0) {
        mergedKeepSegments = mergeKeepSegments(
          [...mergedKeepSegments, ...uncoveredWordRuns],
          durationMs,
          KEEP_MERGE_GAP_MS
        );
        logger.warn(
          'Take-selection missed corrected transcript words; preserving uncovered runs to prevent truncation',
          {
            episodeId,
            uncoveredRunCount: uncoveredWordRuns.length,
            uncoveredWordCount: countWordsInSegments(correctedTranscriptWords, uncoveredWordRuns),
            uncoveredRuns: uncoveredWordRuns,
          }
        );
      }
    }

    const configuredMinRemovalMs = usingTakeSelection
      ? config.voiceover.silenceRemoval.minGapMs
      : (config.voiceover.silenceRemoval.minGapMs ?? MIN_SILENCE_REMOVAL_MS);
    const maxAllowedMinRemovalMs = usingTakeSelection
      ? MAX_SCRIPT_GAP_REMOVAL_MS
      : MAX_SILENCE_GAP_REMOVAL_MS;
    const minRemovalMs = Math.min(configuredMinRemovalMs, maxAllowedMinRemovalMs);
    if (minRemovalMs !== configuredMinRemovalMs) {
      logger.warn('Clamped silence-removal min gap to avoid skipped cleaning', {
        episodeId,
        alignmentSource,
        configuredMinRemovalMs,
        effectiveMinRemovalMs: minRemovalMs,
        maxAllowedMinRemovalMs,
      });
    }
    const gapRemovalType: SegmentToRemove['type'] = usingTakeSelection ? 'script' : 'silence';
    let segmentsToRemove = buildRemovalSegments(
      mergedKeepSegments,
      durationMs,
      minRemovalMs,
      gapRemovalType,
      usingTakeSelection ? 'Not in script' : 'Silence gap'
    );

    if (rawTranscriptWords.length > 0) {
      const fillerSegments = buildFillerSegments(rawTranscriptWords, correctedTranscriptWords);
      const repeatSegments = buildRepeatSegments(rawTranscriptWords, correctedTranscriptWords);
      segmentsToRemove = mergeRemovalSegments(
        [...segmentsToRemove, ...fillerSegments, ...repeatSegments],
        durationMs
      );
    }

    if (correctedTranscriptWords.length > 0) {
      segmentsToRemove = protectTranscriptWordsFromGapRemovals(
        segmentsToRemove,
        correctedTranscriptWords,
        durationMs,
        WORD_PROTECTION_PAD_MS
      );
    }

    // Step 2.5: Optional LLM verification pass to prevent wrong removals (e.g., ASR errors on proper nouns)
    let verification:
      | {
          summary: VoiceoverRemovalVerificationSummary;
          decisions: VoiceoverRemovalVerificationDecision[];
        }
      | undefined;

    if (episode.scriptContent) {
      const verificationResult = await verifyVoiceoverEditPlanRemovals({
        userId,
        scriptContent: episode.scriptContent,
        transcriptWords,
        segmentsToRemove,
        durationMs,
        logger,
      });

      verification = {
        summary: verificationResult.summary,
        decisions: verificationResult.decisions,
      };

      if (verificationResult.keepSegmentsToAdd.length > 0) {
        mergedKeepSegments = mergeKeepSegments(
          [...mergedKeepSegments, ...verificationResult.keepSegmentsToAdd],
          durationMs,
          KEEP_MERGE_GAP_MS
        );
        segmentsToRemove = buildRemovalSegments(
          mergedKeepSegments,
          durationMs,
          minRemovalMs,
          gapRemovalType,
          usingTakeSelection ? 'Not in script' : 'Silence gap'
        );
        if (correctedTranscriptWords.length > 0) {
          segmentsToRemove = protectTranscriptWordsFromGapRemovals(
            segmentsToRemove,
            correctedTranscriptWords,
            durationMs,
            WORD_PROTECTION_PAD_MS
          );
        }
      }
    }

    const totalRemovalMs = segmentsToRemove.reduce(
      (sum, seg) => sum + (seg.endMs - seg.startMs),
      0
    );

    logger.info('Edit plan ready', {
      alignmentSource,
      keepSegments: mergedKeepSegments.length,
      removalSegments: segmentsToRemove.length,
      removalSeconds: Number((totalRemovalMs / 1000).toFixed(2)),
      verification: verification?.summary,
    });

    // Step 3: Store edit plan on episode (80%)
    await updateProgress(jobId, 'done', 80, 'Storing edit plan');

    logger.info('[Phase 1.5 silence_detection] STORED: episode editPlan (segmentsToRemove; wordTranscript and correctedWordTranscript unchanged)', {
      episodeId,
      keepSegmentsCount: mergedKeepSegments.length,
      segmentsToRemoveCount: segmentsToRemove.length,
      totalRemovalMs,
      note: 'cleaning job will overwrite episode.wordTranscript with kept words only',
    });
    logger.info(
      `[VOICEOVER_TRACE_FULL] phase=1.5_silence_detection step=STORED_editPlan episodeId=${episodeId} keepSegmentsCount=${mergedKeepSegments.length} segmentsToRemoveCount=${segmentsToRemove.length} (full keepSegments below)`
    );
    logger.info(`[VOICEOVER_TRACE_SEGMENTS_JSON] keepSegments=${JSON.stringify(mergedKeepSegments)}`);
    logger.info(`[VOICEOVER_TRACE_SEGMENTS_JSON] segmentsToRemove=${JSON.stringify(segmentsToRemove)}`);
    await prisma.episode.update({
      where: { id: episodeId },
      data: {
        editPlan: JSON.parse(JSON.stringify({
          keepSegments: mergedKeepSegments,
          segmentsToRemove,
          source: 'silence_detection',
          alignment: alignmentSummary,
          verification,
        })),
      },
    });

    await prisma.job.update({
      where: { id: jobId },
      data: {
        status: 'done',
        stage: 'done',
        progress: 100,
        outputData: JSON.parse(JSON.stringify({
          segmentsToRemove,
          keepSegments: mergedKeepSegments,
          alignment: alignmentSummary,
          verification,
          totalSegments: segmentsToRemove.length,
          keepSegmentCount: mergedKeepSegments.length,
          totalRemovalSeconds: totalRemovalMs / 1000,
          transcriptWordCount: transcriptWords.length,
          durationSeconds: durationMs / 1000,
        })),
      },
    });

    await progressPublisher.publish(
      jobId,
      'done',
      'done',
      100,
      `Edit plan ready (${segmentsToRemove.length} removals, ${Number((totalRemovalMs / 1000).toFixed(1))}s)`
    );

    // Step 4: Trigger next job - voiceover_cleaning
    logger.info(`[Phase 1.5] Triggering voiceover_cleaning job for episode ${episodeId}`);

    const cleaningJob = await prisma.job.create({
      data: {
        type: 'voiceover_cleaning',
        status: 'pending',
        userId,
        episodeId,
        inputData: JSON.parse(JSON.stringify({
          segmentsToRemove,
          totalRemovalSeconds: totalRemovalMs / 1000,
        })),
      },
    });

    const { queues } = await import('../queue.js');
    await queues.voiceoverCleaning.add('voiceover-cleaning', {
      jobId: cleaningJob.id,
      episodeId,
      userId,
      segmentsToRemove,
    });

    logger.info(`[Phase 1.5] Voiceover edit-plan job ${jobId} completed successfully`);
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error(`[Phase 1.5] Voiceover edit-plan job ${jobId} failed:`, error);

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

function splitScriptSentences(scriptContent: string, minWords: number): string[] {
  const normalized = scriptContent.replace(/\r\n/g, '\n').trim();
  const raw = normalized
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return raw.filter((s) => {
    const tokens = s
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    return tokens.length >= minWords;
  });
}

/**
 * Build one keep segment per script sentence by aligning script sentences
 * to corrected transcript words in order (by token count).
 */
export function buildKeepSegmentsFromCorrectedTranscriptBySentences(
  scriptContent: string,
  correctedWords: WordTimestamp[],
  durationMs: number
): KeepSegment[] {
  const scriptMinWords = config.voiceover.takeSelection.scriptMinWords ?? 2;
  const sentences = splitScriptSentences(scriptContent, scriptMinWords);
  if (sentences.length === 0 || correctedWords.length === 0) return [];

  const sentenceTokenCounts = sentences.map((s) => {
    const tokens = s
      .toLowerCase()
      .replace(/[^a-z0-9'\s]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .split(' ')
      .filter(Boolean);
    return tokens.length;
  });
  const totalScriptTokens = sentenceTokenCounts.reduce((a, b) => a + b, 0);
  if (totalScriptTokens === 0) return [];

  const segments: KeepSegment[] = [];
  let wordIndex = 0;

  for (let i = 0; i < sentences.length; i += 1) {
    const tokenCount = sentenceTokenCounts[i] ?? 0;
    const proportion = totalScriptTokens > 0 ? tokenCount / totalScriptTokens : 1 / sentences.length;
    const numWords = Math.max(
      1,
      i === sentences.length - 1
        ? correctedWords.length - wordIndex
        : Math.round(correctedWords.length * proportion)
    );
    const endIndex = Math.min(wordIndex + numWords, correctedWords.length);
    if (wordIndex >= correctedWords.length) break;
    const firstWord = correctedWords[wordIndex];
    const lastWord = correctedWords[endIndex - 1];
    if (firstWord && lastWord) {
      segments.push({
        startMs: Math.max(0, firstWord.startMs),
        endMs: Math.min(durationMs, lastWord.endMs),
      });
    }
    wordIndex = endIndex;
  }

  return segments;
}

function buildKeepSegmentsFromWords(
  words: WordTimestamp[],
  durationMs: number,
  padMs: number,
  mergeGapMs: number
): KeepSegment[] {
  if (words.length === 0) return [];
  const segments: KeepSegment[] = words.map((word) => ({
    startMs: Math.max(0, word.startMs - padMs),
    endMs: Math.min(durationMs, word.endMs + padMs),
  }));

  return mergeKeepSegments(segments, durationMs, mergeGapMs);
}

function isWordCoveredByKeepSegments(word: WordTimestamp, keepSegments: KeepSegment[]): boolean {
  return keepSegments.some((segment) => word.startMs < segment.endMs && word.endMs > segment.startMs);
}

function findUncoveredWordRuns(
  words: WordTimestamp[],
  keepSegments: KeepSegment[],
  durationMs: number,
  padMs: number
): KeepSegment[] {
  if (words.length === 0 || keepSegments.length === 0) return [];

  const uncoveredRuns: KeepSegment[] = [];
  let runStart: WordTimestamp | null = null;
  let runEnd: WordTimestamp | null = null;

  for (const word of words) {
    const covered = isWordCoveredByKeepSegments(word, keepSegments);
    if (!covered) {
      if (!runStart) {
        runStart = word;
      }
      runEnd = word;
      continue;
    }

    if (runStart && runEnd) {
      uncoveredRuns.push({
        startMs: Math.max(0, runStart.startMs - padMs),
        endMs: Math.min(durationMs, runEnd.endMs + padMs),
      });
      runStart = null;
      runEnd = null;
    }
  }

  if (runStart && runEnd) {
    uncoveredRuns.push({
      startMs: Math.max(0, runStart.startMs - padMs),
      endMs: Math.min(durationMs, runEnd.endMs + padMs),
    });
  }

  return mergeKeepSegments(uncoveredRuns, durationMs, KEEP_MERGE_GAP_MS);
}

function countWordsInSegments(words: WordTimestamp[], segments: KeepSegment[]): number {
  if (words.length === 0 || segments.length === 0) return 0;
  return words.filter((word) =>
    segments.some((segment) => word.startMs < segment.endMs && word.endMs > segment.startMs)
  ).length;
}

function mergeKeepSegments(
  segments: KeepSegment[],
  durationMs: number,
  maxGapMs: number
): KeepSegment[] {
  if (segments.length === 0) return [];

  const sanitized: KeepSegment[] = segments
    .map((seg) => ({
      startMs: Math.max(0, Math.min(durationMs, seg.startMs)),
      endMs: Math.max(0, Math.min(durationMs, seg.endMs)),
    }))
    .filter((seg): seg is KeepSegment => seg.endMs > seg.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  if (sanitized.length === 0) return [];

  const merged: KeepSegment[] = [];
  let current: KeepSegment = { ...sanitized[0]! };

  for (let i = 1; i < sanitized.length; i += 1) {
    const next: KeepSegment = sanitized[i]!;
    if (next.startMs <= current.endMs + maxGapMs) {
      current.endMs = Math.max(current.endMs, next.endMs);
    } else {
      merged.push(current);
      current = { ...next };
    }
  }

  merged.push(current);
  return merged;
}

function buildRemovalSegments(
  keepSegments: KeepSegment[],
  durationMs: number,
  minRemovalMs: number,
  type: SegmentToRemove['type'],
  reason: string
): SegmentToRemove[] {
  if (keepSegments.length === 0 || durationMs <= 0) return [];

  const removals: SegmentToRemove[] = [];
  let cursor = 0;

  for (const keep of keepSegments) {
    const gap = keep.startMs - cursor;
    if (gap >= minRemovalMs) {
      removals.push({
        startMs: cursor,
        endMs: keep.startMs,
        type,
        reason,
      });
    }
    cursor = Math.max(cursor, keep.endMs);
  }

  if (durationMs - cursor >= minRemovalMs) {
    removals.push({
      startMs: cursor,
      endMs: durationMs,
      type,
      reason,
    });
  }

  return removals;
}

function protectTranscriptWordsFromGapRemovals(
  segments: SegmentToRemove[],
  wordsToProtect: WordTimestamp[],
  durationMs: number,
  padMs: number
): SegmentToRemove[] {
  if (segments.length === 0 || wordsToProtect.length === 0) {
    return mergeRemovalSegments(segments, durationMs);
  }

  const protectedRanges = wordsToProtect
    .map((word) => ({
      startMs: Math.max(0, word.startMs - padMs),
      endMs: Math.min(durationMs, word.endMs + padMs),
    }))
    .filter((range) => range.endMs > range.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  if (protectedRanges.length === 0) {
    return mergeRemovalSegments(segments, durationMs);
  }

  const protectedSegments: SegmentToRemove[] = [];

  for (const segment of segments) {
    if (segment.type !== 'script' && segment.type !== 'silence') {
      protectedSegments.push(segment);
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
      protectedSegments.push({
        ...segment,
        startMs: part.startMs,
        endMs: part.endMs,
      });
    }
  }

  return mergeRemovalSegments(protectedSegments, durationMs);
}

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[^a-z0-9'\-]/g, '');
}

function hasOverlappingCorrectedWord(
  word: WordTimestamp,
  correctedWords: WordTimestamp[],
  requireSameWord: boolean
): boolean {
  const normalized = normalizeToken(word.word);
  return correctedWords.some((candidate) => {
    const overlap =
      candidate.startMs - OVERLAP_TOLERANCE_MS < word.endMs &&
      candidate.endMs + OVERLAP_TOLERANCE_MS > word.startMs;
    if (!overlap) return false;
    if (!requireSameWord) return true;
    return normalizeToken(candidate.word) === normalized;
  });
}

function buildFillerSegments(
  rawWords: WordTimestamp[],
  correctedWords: WordTimestamp[]
): SegmentToRemove[] {
  const segments: SegmentToRemove[] = [];

  for (const word of rawWords) {
    const normalized = normalizeToken(word.word);
    if (!FILLER_WORDS.has(normalized)) continue;
    if (hasOverlappingCorrectedWord(word, correctedWords, true)) continue;
    segments.push({
      startMs: word.startMs,
      endMs: word.endMs,
      type: 'filler',
      reason: 'Filler word',
    });
  }

  for (let i = 0; i < rawWords.length - 1; i += 1) {
    const first = rawWords[i];
    const second = rawWords[i + 1];
    if (!first || !second) continue;

    const normalizedPair = [normalizeToken(first.word), normalizeToken(second.word)];
    const isPhrase = FILLER_PHRASES.some(
      (phrase) => phrase[0] === normalizedPair[0] && phrase[1] === normalizedPair[1]
    );
    if (!isPhrase) continue;

    const phraseWord: WordTimestamp = {
      word: `${first.word} ${second.word}`,
      startMs: first.startMs,
      endMs: second.endMs,
      confidence: Math.min(first.confidence, second.confidence),
    };
    if (hasOverlappingCorrectedWord(phraseWord, correctedWords, false)) continue;

    segments.push({
      startMs: first.startMs,
      endMs: second.endMs,
      type: 'filler',
      reason: 'Filler phrase',
    });
  }

  return segments;
}

function buildRepeatSegments(
  rawWords: WordTimestamp[],
  correctedWords: WordTimestamp[]
): SegmentToRemove[] {
  const segments: SegmentToRemove[] = [];

  for (let i = 1; i < rawWords.length; i += 1) {
    const prev = rawWords[i - 1];
    const current = rawWords[i];
    if (!prev || !current) continue;

    const gap = current.startMs - prev.endMs;
    if (gap > REPEAT_GAP_MS) continue;
    if (normalizeToken(prev.word) !== normalizeToken(current.word)) continue;

    const prevOverlaps = hasOverlappingCorrectedWord(prev, correctedWords, true);
    const currentOverlaps = hasOverlappingCorrectedWord(current, correctedWords, true);

    if (prevOverlaps && !currentOverlaps) {
      segments.push({
        startMs: current.startMs,
        endMs: current.endMs,
        type: 'repeat',
        reason: 'Repeated word',
      });
    } else if (!prevOverlaps && currentOverlaps) {
      segments.push({
        startMs: prev.startMs,
        endMs: prev.endMs,
        type: 'repeat',
        reason: 'Repeated word',
      });
    } else if (!prevOverlaps && !currentOverlaps) {
      segments.push({
        startMs: current.startMs,
        endMs: current.endMs,
        type: 'repeat',
        reason: 'Repeated word',
      });
    }
  }

  return segments;
}

function mergeRemovalSegments(
  segments: SegmentToRemove[],
  durationMs: number
): SegmentToRemove[] {
  if (segments.length === 0) return [];

  const sanitized = segments
    .map((seg) => ({
      ...seg,
      startMs: Math.max(0, Math.min(durationMs, seg.startMs)),
      endMs: Math.max(0, Math.min(durationMs, seg.endMs)),
    }))
    .filter((seg) => seg.endMs > seg.startMs)
    .sort((a, b) => a.startMs - b.startMs);

  const merged: SegmentToRemove[] = [];
  let current = sanitized[0];

  for (let i = 1; i < sanitized.length; i += 1) {
    const next = sanitized[i];
    if (!next || !current) continue;
    if (next.startMs <= current.endMs) {
      current = {
        ...current,
        endMs: Math.max(current.endMs, next.endMs),
      };
    } else {
      merged.push(current);
      current = next;
    }
  }

  if (current) {
    merged.push(current);
  }

  return merged;
}
