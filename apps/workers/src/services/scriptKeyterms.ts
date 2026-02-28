import { GoogleGenerativeAI } from '@google/generative-ai';
import OpenAI from 'openai';
import { supportsOpenAiTemperature } from './openaiModelSupport.js';
import { prisma } from './db.js';
import { usageService } from './usage.js';
import { config } from '../config.js';
import { logger as sharedLogger, extractNormalizedKeytermCandidatesFromScript, normalizeKeytermTerm } from '@webl/shared';

const KEYTERM_CATEGORIES = [
  'company',
  'product',
  'jargon',
  'non_english',
  'person',
  'location',
  'other',
] as const;

type KeytermCategory = (typeof KEYTERM_CATEGORIES)[number];

type KeytermSource = 'user' | 'llm';
type EpisodeKeytermSource = 'user' | 'matched' | 'llm';

type LlmKeyterm = {
  term: string;
  category: KeytermCategory;
  language?: string;
  confidence?: number;
  reason?: string;
};

function parseAIJsonResponse<T>(text: string): T {
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();
  const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }
  return JSON.parse(cleaned);
}

function safeCategory(value: unknown): KeytermCategory {
  if (typeof value !== 'string') return 'other';
  return (KEYTERM_CATEGORIES as readonly string[]).includes(value) ? (value as KeytermCategory) : 'other';
}

function truncate(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 30))}\n\n[TRUNCATED ${text.length - maxChars} CHARS]`;
}

async function extractKeytermsWithLlm(args: {
  userId: string;
  scriptContent: string;
  maxKeyterms: number;
  logger?: typeof sharedLogger;
}): Promise<LlmKeyterm[]> {
  const logger = args.logger ?? sharedLogger;
  const provider = config.ai.provider;

  if (provider === 'gemini' && !config.ai.geminiApiKey) return [];
  if (provider === 'openai' && !config.openai.apiKey) return [];

  const prompt = `You extract important "keyterms" from a video script so an ASR model can transcribe them correctly.

Goal:
- Identify uncommon or error-prone words/phrases (brands, products, company names, people, locations, jargon, non-English terms).
- Return keyterms exactly as they should appear (capitalization ok).
- Prefer short phrases (1-4 tokens) when they are meaningful (e.g. "New York", "T-Race").

Script:
${truncate(args.scriptContent, 14000)}

Return JSON only with this exact shape:
{
  "keyterms": [
    { "term": "Tissot", "category": "company", "language": "en", "confidence": 0.95, "reason": "Brand name" }
  ]
}

Rules:
- Maximum ${args.maxKeyterms} keyterms.
- "category" must be one of: ${KEYTERM_CATEGORIES.join(', ')}.
- Do not include common filler words (e.g. "the", "and").
- If the script is simple and has no special terms, return an empty list.`;

  try {
    if (provider === 'gemini') {
      const genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
      const model = genAI.getGenerativeModel({
        model: config.ai.geminiModel,
        generationConfig: { responseMimeType: 'application/json' },
      });
      await usageService.recordUsage(args.userId, {
        geminiCalls: 1,
        keytermExtractionCalls: 1,
      });
      const response = await model.generateContent(prompt);
      const text = response.response.text();
      const parsed = parseAIJsonResponse<{ keyterms?: LlmKeyterm[] }>(text);
      return Array.isArray(parsed.keyterms) ? parsed.keyterms : [];
    }

    const client = new OpenAI({ apiKey: config.openai.apiKey });
    await usageService.recordUsage(args.userId, {
      openAiChatCalls: 1,
      keytermExtractionCalls: 1,
    });
    const temperature = supportsOpenAiTemperature(config.openai.model, null) ? 0.2 : undefined;
    const response = await client.chat.completions.create({
      model: config.openai.model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Extract keyterms for ASR. Return JSON only.' },
        { role: 'user', content: prompt },
      ],
      ...(temperature !== undefined ? { temperature } : {}),
    });
    const content = response.choices[0]?.message?.content ?? '{}';
    const parsed = parseAIJsonResponse<{ keyterms?: LlmKeyterm[] }>(content);
    return Array.isArray(parsed.keyterms) ? parsed.keyterms : [];
  } catch (error) {
    logger.error('Keyterm extraction LLM call failed', error);
    return [];
  }
}

async function upsertKeyterms(args: {
  userId: string;
  keyterms: Array<{
    term: string;
    normalizedTerm: string;
    category: KeytermCategory;
    language?: string;
    source: KeytermSource;
  }>;
}): Promise<Array<{ id: string; term: string; normalizedTerm: string }>> {
  const created: Array<{ id: string; term: string; normalizedTerm: string }> = [];

  for (const item of args.keyterms) {
    const record = await prisma.keyterm.upsert({
      where: {
        userId_normalizedTerm: {
          userId: args.userId,
          normalizedTerm: item.normalizedTerm,
        },
      },
      create: {
        userId: args.userId,
        term: item.term,
        normalizedTerm: item.normalizedTerm,
        category: item.category,
        language: item.language,
        source: item.source,
      },
      update: {
        // Keep the existing term unless it's empty; always keep normalizedTerm stable.
        term: item.term,
        category: item.category,
        language: item.language ?? undefined,
      },
      select: { id: true, term: true, normalizedTerm: true },
    });
    created.push(record);
  }

  return created;
}

async function linkEpisodeKeyterms(args: {
  episodeId: string;
  keytermIds: string[];
  source: EpisodeKeytermSource;
  confirmed: boolean;
}): Promise<void> {
  for (const keytermId of args.keytermIds) {
    await prisma.episodeKeyterm.upsert({
      where: {
        episodeId_keytermId: {
          episodeId: args.episodeId,
          keytermId,
        },
      },
      create: {
        episodeId: args.episodeId,
        keytermId,
        source: args.source,
        confirmed: args.confirmed,
      },
      update: {
        // Never downgrade user-confirmed links.
        confirmed: args.confirmed ? true : undefined,
      },
    });
  }
}

async function bumpUsage(args: { userId: string; keytermIds: string[] }): Promise<void> {
  if (args.keytermIds.length === 0) return;
  await prisma.keyterm.updateMany({
    where: { userId: args.userId, id: { in: args.keytermIds } },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
}

export async function getDeepgramKeytermsForEpisode(args: {
  episodeId: string;
  userId: string;
  scriptContent: string;
  logger?: typeof sharedLogger;
}): Promise<{
  keyterms: string[];
  source: 'episode_user' | 'episode_existing' | 'library_match' | 'llm' | 'none';
  keytermCount: number;
}> {
  const logger = args.logger ?? sharedLogger;

  const maxKeyterms = config.voiceover.deepgramKeytermPrompting.maxKeyterms;
  if (maxKeyterms <= 0) {
    return { keyterms: [], source: 'none', keytermCount: 0 };
  }

  const existingEpisodeKeyterms = await prisma.episodeKeyterm.findMany({
    where: { episodeId: args.episodeId },
    include: { keyterm: true },
  });

  const userConfirmed = existingEpisodeKeyterms.filter(
    (ek: { source: string; confirmed: boolean }) => ek.source === 'user' && ek.confirmed
  );
  if (userConfirmed.length > 0) {
    const terms = userConfirmed
      .map((ek: { keyterm: { term: string } }) => ek.keyterm.term)
      .filter(Boolean)
      .slice(0, maxKeyterms);
    await bumpUsage({
      userId: args.userId,
      keytermIds: userConfirmed.map((ek: { keytermId: string }) => ek.keytermId),
    });
    return { keyterms: terms, source: 'episode_user', keytermCount: terms.length };
  }

  // If episode already has any auto keyterms, reuse them and avoid re-triggering LLM.
  if (existingEpisodeKeyterms.length > 0) {
    const terms = existingEpisodeKeyterms
      .map((ek: { keyterm: { term: string } }) => ek.keyterm.term)
      .filter(Boolean)
      .slice(0, maxKeyterms);
    await bumpUsage({
      userId: args.userId,
      keytermIds: existingEpisodeKeyterms.map((ek: { keytermId: string }) => ek.keytermId),
    });
    return { keyterms: terms, source: 'episode_existing', keytermCount: terms.length };
  }

  // Try to match against the user's existing keyterm library (scales via (userId, normalizedTerm) index).
  const candidates = extractNormalizedKeytermCandidatesFromScript(args.scriptContent, {
    maxPhraseLen: 4,
    maxCandidates: 6000,
  });

  const matched = candidates.length
    ? await prisma.keyterm.findMany({
        where: {
          userId: args.userId,
          normalizedTerm: { in: candidates },
        },
        orderBy: [{ usageCount: 'desc' }, { updatedAt: 'desc' }],
        take: maxKeyterms,
        select: { id: true, term: true },
      })
    : [];

  if (matched.length > 0) {
    await linkEpisodeKeyterms({
      episodeId: args.episodeId,
      keytermIds: matched.map((m: { id: string }) => m.id),
      source: 'matched',
      confirmed: true,
    });
    await bumpUsage({
      userId: args.userId,
      keytermIds: matched.map((m: { id: string }) => m.id),
    });
    return {
      keyterms: matched.map((m: { term: string }) => m.term),
      source: 'library_match',
      keytermCount: matched.length,
    };
  }

  // No matches and no user-confirmed selection: trigger LLM to extract keyterms.
  const llmKeyterms = await extractKeytermsWithLlm({
    userId: args.userId,
    scriptContent: args.scriptContent,
    maxKeyterms,
    logger,
  });

  const cleaned: Array<{
    term: string;
    normalizedTerm: string;
    category: KeytermCategory;
    language?: string;
    source: KeytermSource;
  }> = [];

  for (const item of llmKeyterms) {
    if (!item || typeof item.term !== 'string') continue;
    const term = item.term.trim();
    if (!term) continue;
    const normalized = normalizeKeytermTerm(term);
    if (!normalized || normalized.length < 3) continue;
    cleaned.push({
      term,
      normalizedTerm: normalized,
      category: safeCategory((item as any).category),
      language: typeof item.language === 'string' ? item.language : undefined,
      source: 'llm',
    });
  }

  const deduped = new Map<string, (typeof cleaned)[number]>();
  for (const item of cleaned) {
    if (!deduped.has(item.normalizedTerm)) deduped.set(item.normalizedTerm, item);
  }

  const unique = Array.from(deduped.values()).slice(0, maxKeyterms);
  if (unique.length === 0) {
    logger.info('LLM keyterm extraction returned no usable keyterms', { episodeId: args.episodeId });
    return { keyterms: [], source: 'none', keytermCount: 0 };
  }

  const upserted = await upsertKeyterms({ userId: args.userId, keyterms: unique });
  await linkEpisodeKeyterms({
    episodeId: args.episodeId,
    keytermIds: upserted.map((k) => k.id),
    source: 'llm',
    confirmed: false,
  });
  await bumpUsage({ userId: args.userId, keytermIds: upserted.map((k) => k.id) });

  logger.info('LLM keyterms stored for episode', {
    episodeId: args.episodeId,
    keytermCount: upserted.length,
  });

  return {
    keyterms: upserted.map((k) => k.term),
    source: 'llm',
    keytermCount: upserted.length,
  };
}
