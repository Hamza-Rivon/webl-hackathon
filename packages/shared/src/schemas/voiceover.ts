/**
 * Voiceover & Microcut Schemas
 */

import { z } from 'zod';

export const WordTimestampSchema = z
  .object({
    word: z.string(),
    startMs: z.number().int().nonnegative(),
    endMs: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
  })
  .strict();

export const TranscriptCorrectionAndEditPlanSchema = z
  .object({
    correctedTranscript: z.array(WordTimestampSchema),
    segmentsToRemove: z.array(
      z
        .object({
          startMs: z.number().int().nonnegative(),
          endMs: z.number().int().nonnegative(),
          type: z.enum(['script', 'silence', 'filler', 'repeat']),
          reason: z.string(),
        })
        .strict()
    ),
    keepSegments: z.array(
      z
        .object({
          startMs: z.number().int().nonnegative(),
          endMs: z.number().int().nonnegative(),
        })
        .strict()
    ),
  })
  .strict();

export type TranscriptCorrectionAndEditPlan = z.infer<
  typeof TranscriptCorrectionAndEditPlanSchema
>;

export const TranscriptCorrectionAndEditPlanJsonSchema = {
  name: 'TranscriptCorrectionAndEditPlan',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['correctedTranscript', 'segmentsToRemove', 'keepSegments'],
    properties: {
      correctedTranscript: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['word', 'startMs', 'endMs', 'confidence'],
          properties: {
            word: { type: 'string' },
            startMs: { type: 'integer' },
            endMs: { type: 'integer' },
            confidence: { type: 'number' },
          },
        },
      },
      segmentsToRemove: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['startMs', 'endMs', 'type', 'reason'],
          properties: {
            startMs: { type: 'integer' },
            endMs: { type: 'integer' },
            type: { type: 'string', enum: ['script', 'silence', 'filler', 'repeat'] },
            reason: { type: 'string' },
          },
        },
      },
      keepSegments: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['startMs', 'endMs'],
          properties: {
            startMs: { type: 'integer' },
            endMs: { type: 'integer' },
          },
        },
      },
    },
  },
} as const;

export const UnitBatchAnalysisSchema = z
  .object({
    units: z.array(
      z
        .object({
          unitIndex: z.number().int().nonnegative(),
          keywords: z.array(z.string()).min(3).max(5),
          emotionalTone: z.string().min(1).max(40),
        })
        .strict()
    ),
  })
  .strict();

export type UnitBatchAnalysis = z.infer<typeof UnitBatchAnalysisSchema>;

export const UnitBatchAnalysisJsonSchema = {
  name: 'UnitBatchAnalysis',
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['units'],
    properties: {
      units: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['unitIndex', 'keywords', 'emotionalTone'],
          properties: {
            unitIndex: { type: 'integer' },
            keywords: {
              type: 'array',
              minItems: 3,
              maxItems: 5,
              items: { type: 'string' },
            },
            emotionalTone: { type: 'string' },
          },
        },
      },
    },
  },
} as const;

export const VoiceoverCandidateSchema = z
  .object({
    chunkId: z.string(),
    totalScore: z.number(),
    semanticScore: z.number(),
    keywordScore: z.number(),
    continuityScore: z.number(),
  })
  .strict();

export type VoiceoverCandidate = z.infer<typeof VoiceoverCandidateSchema>;

export const VoiceoverSegmentMetadataSchema = z
  .object({
    candidates: z.array(VoiceoverCandidateSchema),
  })
  .strict();

export type VoiceoverSegmentMetadata = z.infer<typeof VoiceoverSegmentMetadataSchema>;

export const MicroCutPlanV2Schema = z
  .object({
    version: z.literal('microcut_v2'),
    episodeId: z.string(),
    revision: z.number().int().nonnegative(),
    createdAt: z.string(),
    totalDurationMs: z.number().int().nonnegative(),
    fps: z.number().int().positive(),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    aspectRatio: z.enum(['9:16', '16:9', '1:1']),
    cuts: z.array(
      z
        .object({
          cutIndex: z.number().int().nonnegative(),
          startMs: z.number().int().nonnegative(),
          endMs: z.number().int().nonnegative(),
          durationMs: z.number().int().nonnegative(),
          voiceoverStartMs: z.number().int().nonnegative(),
          voiceoverEndMs: z.number().int().nonnegative(),
          chunkId: z.string(),
          chunkS3Key: z.string(),
          clipStartMs: z.number().int().nonnegative(),
          clipEndMs: z.number().int().nonnegative(),
          unitIndices: z.array(z.number().int().nonnegative()),
          matchScore: z.number(),
        })
        .strict()
    ),
    audio: z
      .object({
        voiceover: z
          .object({
            s3Key: z.string(),
            durationMs: z.number().int().nonnegative(),
            volume: z.number(),
          })
          .strict(),
      })
      .strict(),
  })
  .strict();

export type MicroCutPlanV2 = z.infer<typeof MicroCutPlanV2Schema>;
