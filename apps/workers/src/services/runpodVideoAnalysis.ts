import { config } from '../config.js';
import { logger } from '@webl/shared';

export interface VideoModerationScores {
  sexual: number;
  violence: number;
  hate: number;
  harassment: number;
  selfHarm: number;
}

export interface VideoAnalysisResult {
  tags: string[];
  description: string;
  moderationScores: VideoModerationScores;
}

interface RunpodChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
}

function normalizeBaseUrl(url: string): string {
  return (url || '').replace(/\/+$/, '');
}

function getChatCompletionsUrl(): string {
  const base = normalizeBaseUrl(config.vllm.baseUrl);
  if (!base) {
    throw new Error('VLLM_BASE_URL is not configured.');
  }
  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
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

export async function analyzeVideoWithRunpod(args: {
  videoUrl: string;
  transcript?: string | null;
  minTags?: number;
  maxTags?: number;
  timeoutMs?: number;
}): Promise<VideoAnalysisResult> {
  const url = getChatCompletionsUrl();
  logger.info('[Runpod][video-analysis] request', {
    model: config.vllm.model,
    endpointHost: (() => {
      try {
        return new URL(url).host;
      } catch {
        return url;
      }
    })(),
    hasTranscriptContext: Boolean(args.transcript?.trim()),
    minTags: args.minTags ?? 5,
    maxTags: args.maxTags ?? 15,
  });

  const body = {
    model: config.vllm.model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: buildPrompt({
              transcript: args.transcript,
              minTags: args.minTags,
              maxTags: args.maxTags,
            }),
          },
          {
            type: 'video_url',
            video_url: {
              url: args.videoUrl,
            },
          },
        ],
      },
    ],
    temperature: 0,
    max_tokens: 16000,
    max_completion_tokens: 16000,
    response_format: { type: 'json_object' as const },
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.vllm.apiKey) {
    headers.Authorization = `Bearer ${config.vllm.apiKey}`;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), args.timeoutMs ?? 300_000);

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeout));

  if (!response.ok) {
    const errorBody = await response.text();
    throw new Error(`Runpod video analysis failed (${response.status}): ${errorBody.slice(0, 1000)}`);
  }

  const payload = (await response.json()) as RunpodChatCompletionResponse;
  const rawContent = payload.choices?.[0]?.message?.content;

  if (!rawContent || typeof rawContent !== 'string') {
    throw new Error('Runpod video analysis returned empty content');
  }

  const parsed = parseJsonEnvelope(rawContent);
  const tags = normalizeTags(parsed.tags);
  const description = typeof parsed.description === 'string' ? parsed.description.trim() : '';
  const moderationScores = normalizeModerationScores(parsed.moderationScores);

  logger.info('[Runpod][video-analysis] response', {
    model: config.vllm.model,
    tagCount: tags.length,
    descriptionLength: description.length,
    moderationScores,
  });

  return {
    tags,
    description,
    moderationScores,
  };
}
