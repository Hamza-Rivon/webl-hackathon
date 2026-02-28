/**
 * Script generation service.
 *
 * Supports Gemini (default), Runpod vLLM (AI_PROVIDER=runpod),
 * and Mistral via AWS Bedrock (AI_PROVIDER=mistral).
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config/index.js';
import {
  logger,
  getArchetype,
  formatSectionsForPrompt,
  SCRIPT_ARCHETYPES,
  type ScriptArchetype,
} from '@webl/shared';

let genAI: GoogleGenerativeAI | null = null;
let model: GenerativeModel | null = null;

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';

type ScriptGenerationProvider = 'gemini' | 'runpod' | 'mistral';

function getModel(): GenerativeModel {
  if (!model) {
    if (!config.ai.geminiApiKey) {
      throw new Error('GEMINI_API_KEY not configured. Set GEMINI_API_KEY in your environment.');
    }
    genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
    model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
    logger.info(`Gemini initialized with model: ${GEMINI_MODEL}`);
  }
  return model;
}

function resolveProvider(): ScriptGenerationProvider {
  if (config.ai.provider === 'mistral') {
    if (
      !config.bedrock.bearerToken &&
      !(config.bedrock.accessKeyId && config.bedrock.secretAccessKey)
    ) {
      throw new Error(
        'AI_PROVIDER is set to mistral but no Bedrock credentials configured (set bearer token or IAM key+secret).'
      );
    }
    return 'mistral';
  }
  if (config.ai.provider === 'runpod') {
    if (!config.vllm.baseUrl) {
      throw new Error('AI_PROVIDER is set to runpod but VLLM_BASE_URL is missing.');
    }
    return 'runpod';
  }
  return 'gemini';
}

function getRunpodChatCompletionsUrl(): string {
  const base = (config.vllm.baseUrl || '').replace(/\/+$/, '');
  if (!base) {
    throw new Error('VLLM_BASE_URL is not configured.');
  }
  if (base.endsWith('/v1')) {
    return `${base}/chat/completions`;
  }
  return `${base}/v1/chat/completions`;
}

function extractJsonObject(text: string): string {
  const cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Failed to parse script response — no JSON object found');
  }
  return jsonMatch[0]!;
}

async function callRunpodForScript(prompt: string): Promise<string> {
  logger.info('[Runpod][script-generation] request', {
    model: config.vllm.model,
    endpointHost: (() => {
      try {
        return new URL(getRunpodChatCompletionsUrl()).host;
      } catch {
        return config.vllm.baseUrl || null;
      }
    })(),
    promptChars: prompt.length,
  });

  const body = {
    model: config.vllm.model,
    messages: [
      {
        role: 'system',
        content: 'You are a script writing assistant. Return valid JSON only.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' as const },
    temperature: 0.2,
    max_tokens: 2200,
    max_completion_tokens: 2200,
  };

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (config.vllm.apiKey) {
    headers.Authorization = `Bearer ${config.vllm.apiKey}`;
  }

  const response = await fetch(getRunpodChatCompletionsUrl(), {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Runpod script generation failed (${response.status}): ${text.slice(0, 1000)}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const content = payload.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Runpod script generation returned empty content');
  }

  logger.info('[Runpod][script-generation] response', {
    model: config.vllm.model,
    responseChars: content.length,
  });

  return content;
}

async function callBedrockMistralForScript(prompt: string): Promise<string> {
  const modelId = config.bedrock.mistralModel;

  logger.info('[Mistral][script-generation] request', {
    model: modelId,
    region: config.bedrock.region,
    promptChars: prompt.length,
  });

  let client: BedrockRuntimeClient;
  if (config.bedrock.bearerToken) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = config.bedrock.bearerToken;
    client = new BedrockRuntimeClient({ region: config.bedrock.region });
  } else {
    client = new BedrockRuntimeClient({
      region: config.bedrock.region,
      credentials: {
        accessKeyId: config.bedrock.accessKeyId,
        secretAccessKey: config.bedrock.secretAccessKey,
      },
    });
  }

  const command = new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: [{ text: prompt }] }],
    system: [{ text: 'You are a script writing assistant. Return valid JSON only.' }],
    inferenceConfig: {
      maxTokens: 2200,
      temperature: 0.2,
    },
  });

  const response = await client.send(command);
  const content = response.output?.message?.content?.[0]?.text;
  if (!content) {
    throw new Error('Bedrock Mistral script generation returned empty response');
  }

  logger.info('[Mistral][script-generation] response', {
    model: modelId,
    responseChars: content.length,
  });

  return content;
}

function normalizeGeneratedScript(parsed: GeneratedScript): GeneratedScript {
  if (!parsed.content || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
    throw new Error('Script response missing content or beats');
  }

  parsed.beats = parsed.beats.map((beat, i) => ({
    index: beat.index ?? i,
    beatType: beat.beatType || beat.type || 'content',
    type: beat.type || beat.beatType || 'content',
    text: beat.text || '',
    duration: beat.duration || 5,
    energy: beat.energy || 3,
    emotion: beat.emotion || 'neutral',
  }));

  return parsed;
}

export interface ScriptGenerationInput {
  templateScript: string;
  templateStructure: Record<string, unknown>;
  persona: {
    niche: string;
    tone: string;
    targetAudience: string;
  };
  topic?: string;
  archetype?: string;
}

export interface GeneratedBeat {
  index: number;
  beatType: string;
  type: string;
  text: string;
  duration: number;
  startTime?: number;
  endTime?: number;
  energy: number;
  emotion: string;
}

export interface GeneratedScript {
  content: string;
  beats: GeneratedBeat[];
}

/**
 * Resolve the archetype to use for script generation.
 * Priority: explicit archetype param > template default > vulnerable_storyteller fallback.
 */
function resolveArchetype(
  archetypeId?: string,
  templateStructure?: Record<string, unknown>,
): ScriptArchetype {
  if (archetypeId) {
    const found = getArchetype(archetypeId);
    if (found) return found;
    logger.warn(`Archetype "${archetypeId}" not found, falling back`);
  }

  const templateDefault = (templateStructure as { defaultArchetype?: string })?.defaultArchetype;
  if (templateDefault) {
    const found = getArchetype(templateDefault);
    if (found) return found;
  }

  const fallback = getArchetype('vulnerable_storyteller') ?? SCRIPT_ARCHETYPES[0];
  if (!fallback) {
    throw new Error('No script archetypes configured');
  }
  return fallback;
}

export const geminiService = {
  resolveProvider,

  async generateScriptWithMeta(input: ScriptGenerationInput): Promise<{
    script: GeneratedScript;
    provider: ScriptGenerationProvider;
    model: string;
  }> {
    const provider = resolveProvider();
    const archetype = resolveArchetype(input.archetype, input.templateStructure);
    const targetDuration = (input.templateStructure as { totalDuration?: number })?.totalDuration || 60;

    const sectionsText = formatSectionsForPrompt(archetype.sections, targetDuration);
    const totalWords = Math.round(targetDuration * 2.5);

    const prompt = `You are a viral short-form content writer who creates scripts people cannot stop listening to. You write like you talk to a close friend.

ARCHETYPE: ${archetype.name}
${archetype.description}

LANGUAGE RULES (STRICT — violating these will make the script fail):
${archetype.languageRules}

SCRIPT STRUCTURE — follow this exactly:
${sectionsText}

PACING RULES:
${archetype.pacingRules}
- Target total duration: ${targetDuration} seconds (~${totalWords} words at 2.5 words/second).
- Each section's word count must be proportional to its percentage.

CREATOR CONTEXT:
- Niche: ${input.persona.niche}
- Tone: ${input.persona.tone}
- Target Audience: ${input.persona.targetAudience}
${input.topic ? `- Topic: ${input.topic}` : '- Topic: Choose the most compelling topic for this niche and audience.'}

STYLE REFERENCE (for tone and pacing only — do NOT copy content):
---
${archetype.canonicalScript.slice(0, 600)}
---

Return a single JSON object with exactly this shape:
{
  "content": "The full script as a single string. Every spoken word, in order.",
  "beats": [
    {
      "index": 0,
      "beatType": "hook",
      "type": "hook",
      "text": "The spoken text for this beat.",
      "duration": 3,
      "energy": 4,
      "emotion": "confident"
    }
  ]
}

Rules for the beats array:
- One beat per section in the structure above, in the same order.
- "beatType" must match the section's beatType exactly.
- "type" should equal "beatType" (kept for backward compatibility).
- "duration" is the estimated seconds for that beat (must sum to ~${targetDuration}).
- "energy" is the section's energy level (1-5).
- "emotion" is the section's emotional tone (single word).
- "text" must be a substring of "content" (the spoken words for that beat).`;

    try {
      if (provider === 'mistral') {
        const raw = await callBedrockMistralForScript(prompt);
        const parsed = JSON.parse(extractJsonObject(raw)) as GeneratedScript;
        return {
          script: normalizeGeneratedScript(parsed),
          provider,
          model: config.bedrock.mistralModel,
        };
      }

      if (provider === 'runpod') {
        const raw = await callRunpodForScript(prompt);
        const parsed = JSON.parse(extractJsonObject(raw)) as GeneratedScript;
        return {
          script: normalizeGeneratedScript(parsed),
          provider,
          model: config.vllm.model,
        };
      }

      const geminiModel = getModel();
      const result = await geminiModel.generateContent(prompt);
      const text = result.response.text();
      const parsed = JSON.parse(extractJsonObject(text)) as GeneratedScript;
      return {
        script: normalizeGeneratedScript(parsed),
        provider,
        model: GEMINI_MODEL,
      };
    } catch (error) {
      logger.error('Script generation failed:', error);
      throw error;
    }
  },

  async generateScript(input: ScriptGenerationInput): Promise<GeneratedScript> {
    const result = await this.generateScriptWithMeta(input);
    return result.script;
  },
};
