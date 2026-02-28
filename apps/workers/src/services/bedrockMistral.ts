/**
 * Bedrock Mistral LLM service
 *
 * Wraps AWS Bedrock Converse API for Mistral Large 3 (mistral.magistral-small-2509).
 * Used when AI_PROVIDER=mistral. Same client pattern as voxtral.ts.
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { config } from '../config.js';
import { logger } from '@webl/shared';

let _client: BedrockRuntimeClient | null = null;

function getClient(): BedrockRuntimeClient {
  if (_client) return _client;

  if (config.bedrock.bearerToken) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = config.bedrock.bearerToken;
    _client = new BedrockRuntimeClient({ region: config.bedrock.region });
  } else {
    _client = new BedrockRuntimeClient({
      region: config.bedrock.region,
      credentials: {
        accessKeyId: config.bedrock.accessKeyId,
        secretAccessKey: config.bedrock.secretAccessKey,
      },
    });
  }
  return _client;
}

export async function callBedrockMistralChat(options: {
  systemPrompt?: string;
  userPrompt: string;
  temperature?: number;
  maxTokens?: number;
}): Promise<string> {
  const modelId = config.bedrock.mistralModel;
  const client = getClient();

  const command = new ConverseCommand({
    modelId,
    messages: [{ role: 'user', content: [{ text: options.userPrompt }] }],
    ...(options.systemPrompt ? { system: [{ text: options.systemPrompt }] } : {}),
    inferenceConfig: {
      maxTokens: options.maxTokens ?? 16384,
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    },
  });

  const t0 = Date.now();
  const response = await client.send(command);
  const elapsedMs = Date.now() - t0;

  const text = response.output?.message?.content?.[0]?.text;
  if (!text) throw new Error('Bedrock Mistral returned empty response');

  logger.info('[Mistral][Bedrock] response', {
    modelId,
    elapsedMs,
    inputTokens: response.usage?.inputTokens,
    outputTokens: response.usage?.outputTokens,
    responseChars: text.length,
  });

  return text;
}

export function getMistralModel(): string {
  return config.bedrock.mistralModel;
}
