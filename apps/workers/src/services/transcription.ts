/**
 * Transcription Service Facade
 *
 * Unified interface that delegates to either Deepgram or Voxtral (via AWS Bedrock)
 * based on the TRANSCRIPTION_PROVIDER env var (default: voxtral).
 *
 * Both providers return the same WordTimestamp format so downstream
 * pipeline steps (transcript correction, alignment, etc.) work unchanged.
 */

import { config } from '../config.js';
import { deepgramService, type WordTimestamp, type DeepgramTranscribeOptions } from './deepgram.js';
import { voxtralService } from './voxtral.js';
import { logger } from '@webl/shared';

export type TranscriptionProvider = 'deepgram' | 'voxtral';

export interface TranscriptionResult {
  words: WordTimestamp[];
  durationSeconds: number | null;
  transcript: string | null;
  provider: TranscriptionProvider;
  rawResponse?: unknown;
}

export const transcriptionService = {
  /** The active provider from config */
  get provider(): TranscriptionProvider {
    return config.transcription.provider;
  },

  /** Keyterm extraction (only relevant for Deepgram, no-op for Voxtral) */
  extractKeytermsFromScript: deepgramService.extractKeytermsFromScript,

  /**
   * Transcribe audio from a URL with word-level timestamps.
   *
   * Uses the provider configured via TRANSCRIPTION_PROVIDER env var (default: voxtral).
   * Options (keyterms/keywords) are forwarded only when using Deepgram.
   */
  async transcribeFromUrl(
    audioUrl: string,
    options?: DeepgramTranscribeOptions
  ): Promise<TranscriptionResult> {
    const provider = config.transcription.provider;
    logger.info(`[Transcription] ── Provider selected: ${provider.toUpperCase()} ──`, {
      provider,
      urlLength: audioUrl.length,
      urlPreview: audioUrl.slice(0, 80),
      hasKeyterms: (options?.keyterms ?? []).length > 0,
      hasKeywords: (options?.keywords ?? []).length > 0,
    });

    if (provider === 'voxtral') {
      logger.info('[Transcription] Delegating to Voxtral (AWS Bedrock) transcription service');
      const t0 = Date.now();
      const result = await voxtralService.transcribeFromUrl(audioUrl);
      const elapsed = Date.now() - t0;
      logger.info('[Transcription] Voxtral transcription returned', {
        wordCount: result.words.length,
        durationSeconds: result.durationSeconds,
        elapsedMs: elapsed,
        transcriptPreview: result.transcript?.slice(0, 100) ?? null,
      });
      return {
        words: result.words,
        durationSeconds: result.durationSeconds,
        transcript: result.transcript,
        provider: 'voxtral',
        rawResponse: result.rawResponse,
      };
    }

    // Deepgram
    logger.info('[Transcription] Delegating to Deepgram transcription service');
    const t0 = Date.now();
    const result = await deepgramService.transcribeFromUrl(audioUrl, options);
    const elapsed = Date.now() - t0;
    logger.info('[Transcription] Deepgram transcription returned', {
      wordCount: result.words.length,
      durationSeconds: result.durationSeconds,
      elapsedMs: elapsed,
      transcriptPreview: result.transcript?.slice(0, 100) ?? null,
    });
    return {
      words: result.words,
      durationSeconds: result.durationSeconds,
      transcript: result.transcript,
      provider: 'deepgram',
      rawResponse: result.rawResponse,
    };
  },
};
