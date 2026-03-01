import OpenAI from 'openai';
import { config } from '../config.js';

export type AiProvider = 'gemini' | 'openai' | 'runpod' | 'mistral';
export type VideoAnalysisProvider = 'runpod' | 'bedrock-pegasus' | 'mux';

function normalizeBaseUrl(url: string): string {
  return (url || '').replace(/\/+$/, '');
}

function toHostOnly(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.host;
  } catch {
    return url;
  }
}

export function isRunpodProvider(provider: AiProvider = config.ai.provider): boolean {
  return provider === 'runpod';
}

export function getRunpodBaseUrl(): string {
  return normalizeBaseUrl(config.vllm.baseUrl);
}

export function getRunpodV1BaseUrl(): string {
  const base = getRunpodBaseUrl();
  if (!base) return '';
  return base.endsWith('/v1') ? base : `${base}/v1`;
}

export function getProviderLogContext(provider: AiProvider = config.ai.provider): {
  provider: AiProvider;
  model: string;
  endpointHost: string | null;
} {
  if (provider === 'runpod') {
    const baseUrl = getRunpodV1BaseUrl();
    return {
      provider,
      model: config.vllm.model,
      endpointHost: baseUrl ? toHostOnly(baseUrl) : null,
    };
  }

  if (provider === 'mistral') {
    return {
      provider,
      model: config.bedrock.mistralModel,
      endpointHost: `bedrock.${config.bedrock.region}`,
    };
  }

  return {
    provider,
    model: provider === 'gemini' ? config.ai.geminiModel : config.openai.model,
    endpointHost: null,
  };
}

export function isProviderConfigured(provider: AiProvider = config.ai.provider): boolean {
  if (provider === 'gemini') {
    return Boolean(config.ai.geminiApiKey);
  }
  if (provider === 'openai') {
    return Boolean(config.openai.apiKey);
  }
  if (provider === 'mistral') {
    return Boolean(
      config.bedrock.bearerToken ||
      (config.bedrock.accessKeyId && config.bedrock.secretAccessKey)
    );
  }
  return Boolean(getRunpodBaseUrl());
}

export function getOpenAiCompatibleModel(
  preferredModel: string | undefined,
  provider: AiProvider = config.ai.provider
): string {
  if (provider === 'runpod') {
    return config.vllm.model;
  }
  if (provider === 'mistral') {
    return config.bedrock.mistralModel;
  }
  return preferredModel || config.openai.model;
}

export function getOpenAiCompatibleClient(
  provider: AiProvider = config.ai.provider
): OpenAI {
  if (provider === 'runpod') {
    const baseURL = getRunpodV1BaseUrl();
    if (!baseURL) {
      throw new Error(
        'AI_PROVIDER is set to "runpod" but VLLM_BASE_URL is not configured. Please set VLLM_BASE_URL in .env.'
      );
    }
    return new OpenAI({
      apiKey: config.vllm.apiKey || 'not-required',
      baseURL,
    });
  }

  if (!config.openai.apiKey) {
    throw new Error(
      'AI_PROVIDER is set to "openai" but OPENAI_API_KEY is not configured. Please set OPENAI_API_KEY in .env.'
    );
  }

  return new OpenAI({ apiKey: config.openai.apiKey });
}

export function getVideoAnalysisProvider(): VideoAnalysisProvider {
  return config.videoAnalysis.provider;
}

export function getVideoAnalysisLogContext(): {
  provider: VideoAnalysisProvider;
  model: string;
  endpointHost: string | null;
} {
  const provider = config.videoAnalysis.provider;
  if (provider === 'runpod') {
    const baseUrl = getRunpodV1BaseUrl();
    return {
      provider,
      model: config.vllm.model,
      endpointHost: baseUrl ? toHostOnly(baseUrl) : null,
    };
  }
  if (provider === 'bedrock-pegasus') {
    return {
      provider,
      model: config.videoAnalysis.bedrockPegasusModel,
      endpointHost: `bedrock.${config.videoAnalysis.bedrockPegasusRegion}`,
    };
  }
  return {
    provider,
    model: 'mux-ai',
    endpointHost: null,
  };
}
