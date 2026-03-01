/**
 * Bedrock Video Analysis service
 *
 * Wraps AWS Bedrock Converse API with model fallback chain:
 *   1. TwelveLabs Pegasus (inference profile, e.g. us.twelvelabs.pegasus-1-2-v1:0)
 *   2. Amazon Nova Premier (amazon.nova-premier-v1:0)
 *   3. Amazon Nova Pro (amazon.nova-pro-v1:0)
 *
 * Sends video via S3 location — no download needed.
 * Returns the same VideoAnalysisResult interface as runpodVideoAnalysis.ts.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ContentBlock,
  type VideoFormat,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config.js';
import { logger } from '@webl/shared';
import type { VideoAnalysisResult, VideoModerationScores } from './runpodVideoAnalysis.js';

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (_client) return _client;

  const region = config.videoAnalysis.bedrockPegasusRegion;

  if (config.bedrock.bearerToken) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = config.bedrock.bearerToken;
    _client = new BedrockRuntimeClient({ region });
  } else {
    _client = new BedrockRuntimeClient({
      region,
      credentials: {
        accessKeyId: config.bedrock.accessKeyId,
        secretAccessKey: config.bedrock.secretAccessKey,
      },
    });
  }
  return _client;
}

function detectVideoFormat(s3Key: string): VideoFormat {
  const ext = s3Key.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mov':
      return 'mov';
    case 'mkv':
      return 'mkv';
    case 'webm':
      return 'webm';
    case 'flv':
      return 'flv';
    case 'mpeg':
    case 'mpg':
      return 'mpeg';
    case 'wmv':
      return 'wmv';
    case 'three_gp':
    case '3gp':
      return 'three_gp';
    default:
      return 'mp4';
  }
}

function clamp01(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.max(0, Math.min(1, parsed));
}

function parseJsonEnvelope(raw: string): Record<string, unknown> {
  const cleaned = raw
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]}]/);
  const candidate = jsonMatch ? jsonMatch[0] : cleaned;
  return JSON.parse(candidate) as Record<string, unknown>;
}

function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return [];

  const deduped = new Set<string>();
  const tags: string[] = [];

  for (const entry of value) {
    if (typeof entry !== 'string') continue;
    const tag = entry.trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (deduped.has(key)) continue;
    deduped.add(key);
    tags.push(tag);
    if (tags.length >= 20) break;
  }

  return tags;
}

function normalizeModerationScores(value: unknown): VideoModerationScores {
  const input = (value ?? {}) as Record<string, unknown>;

  return {
    sexual: clamp01(input.sexual),
    violence: clamp01(input.violence),
    hate: clamp01(input.hate),
    harassment: clamp01(input.harassment),
    selfHarm: clamp01(input.selfHarm ?? input.self_harm ?? input.selfharm),
  };
}

function buildPrompt(args: {
  transcript?: string | null;
  minTags?: number;
  maxTags?: number;
}): string {
  const minTags = Math.max(3, args.minTags ?? 5);
  const maxTags = Math.max(minTags, args.maxTags ?? 15);
  const transcriptContext = args.transcript?.trim()
    ? `\nTranscript context (may contain ASR noise, use only if helpful):\n${args.transcript.trim().slice(0, 1200)}\n`
    : '';

  return [
    'You are a video analysis assistant.',
    'Analyze this short video clip and return JSON only.',
    transcriptContext,
    'Return ONLY a valid JSON object with exactly these keys:',
    '{',
    '  "tags": ["tag1", "tag2"],',
    '  "description": "One-sentence summary of visual content.",',
    '  "moderationScores": {',
    '    "sexual": 0.0,',
    '    "violence": 0.0,',
    '    "hate": 0.0,',
    '    "harassment": 0.0,',
    '    "selfHarm": 0.0',
    '  }',
    '}',
    `Tags must be descriptive visual keywords (${minTags}-${maxTags} tags).`,
    'Moderation scores must be numbers from 0.0 to 1.0.',
    'No markdown, no commentary, no extra keys.',
  ].join('\n');
}

function isRetryableModelError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const name = (error as any).name as string | undefined;
  const message = error.message;
  return (
    name === 'ValidationException' ||
    name === 'AccessDeniedException' ||
    name === 'ModelNotReadyException' ||
    name === 'ServiceUnavailableException' ||
    message.includes('inference profile') ||
    message.includes('on-demand throughput isn\'t supported') ||
    message.includes('is not authorized to perform') ||
    message.includes('model is not available')
  );
}

async function invokeModel(
  client: BedrockRuntimeClient,
  modelId: string,
  contentBlocks: ContentBlock[],
): Promise<{ rawContent: string; inputTokens?: number; outputTokens?: number }> {
  const command = new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: contentBlocks }],
    inferenceConfig: { maxTokens: 4096, temperature: 0 },
  });

  const response = await client.send(command);
  const rawContent = response.output?.message?.content?.[0]?.text;
  if (!rawContent || typeof rawContent !== 'string') {
    throw new Error(`Bedrock model ${modelId} returned empty response`);
  }
  return {
    rawContent,
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
  };
}

export async function analyzeVideoWithBedrock(args: {
  s3Key: string;
  transcript?: string | null;
  minTags?: number;
  maxTags?: number;
}): Promise<VideoAnalysisResult> {
  const primaryModel = config.videoAnalysis.bedrockPegasusModel;
  const fallbackModels = config.videoAnalysis.bedrockFallbackModels;
  const modelsToTry = [primaryModel, ...fallbackModels];

  const bucketName = config.s3.bucketName;
  const s3Uri = `s3://${bucketName}/${args.s3Key}`;
  const videoFormat = detectVideoFormat(args.s3Key);

  logger.info('[Bedrock][video-analysis] request', {
    primaryModel,
    fallbackModels,
    region: config.videoAnalysis.bedrockPegasusRegion,
    s3Uri,
    videoFormat,
    hasTranscriptContext: Boolean(args.transcript?.trim()),
    minTags: args.minTags ?? 5,
    maxTags: args.maxTags ?? 15,
  });

  const client = getClient();

  const promptText = buildPrompt({
    transcript: args.transcript,
    minTags: args.minTags,
    maxTags: args.maxTags,
  });

  const contentBlocks: ContentBlock[] = [
    { text: promptText },
    {
      video: {
        format: videoFormat,
        source: { s3Location: { uri: s3Uri } },
      },
    },
  ];

  let lastError: Error | null = null;

  for (let i = 0; i < modelsToTry.length; i++) {
    const modelId = modelsToTry[i]!;
    const isLast = i === modelsToTry.length - 1;

    try {
      logger.info(`[Bedrock][video-analysis] trying model ${i + 1}/${modelsToTry.length}`, {
        modelId,
      });

      const t0 = Date.now();
      const { rawContent, inputTokens, outputTokens } = await invokeModel(
        client,
        modelId,
        contentBlocks,
      );
      const elapsedMs = Date.now() - t0;

      const parsed = parseJsonEnvelope(rawContent);
      const tags = normalizeTags(parsed.tags);
      const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
      const moderationScores = normalizeModerationScores(parsed.moderationScores);

      logger.info('[Bedrock][video-analysis] response', {
        modelId,
        elapsedMs,
        inputTokens,
        outputTokens,
        tagCount: tags.length,
        descriptionLength: description.length,
        moderationScores,
        ...(i > 0 ? { fallbackIndex: i } : {}),
      });

      return { tags, description, moderationScores };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      if (!isLast && isRetryableModelError(error)) {
        logger.warn(`[Bedrock][video-analysis] model ${modelId} failed, trying next fallback`, {
          modelId,
          error: lastError.message,
          nextModel: modelsToTry[i + 1],
        });
        continue;
      }

      throw lastError;
    }
  }

  throw lastError ?? new Error('No Bedrock models available for video analysis');
}
