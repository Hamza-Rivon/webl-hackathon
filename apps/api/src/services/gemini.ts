/**
 * Gemini AI Service
 *
 * Handles interactions with Google Gemini for script generation.
 */

import { GoogleGenerativeAI, GenerativeModel } from '@google/generative-ai';
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

// Use stable model - preview models like gemini-3-flash-preview are unstable and return 500 errors
// Recommended stable models:
// - gemini-3-pro-preview: Latest stable with multimodal support (video, image, text)
// - gemini-1.5-flash: Previous stable version (fallback)
// Do NOT use preview models in production!
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3-pro-preview';

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
  // 1. Explicit param
  if (archetypeId) {
    const found = getArchetype(archetypeId);
    if (found) return found;
    logger.warn(`Archetype "${archetypeId}" not found, falling back`);
  }

  // 2. Template default
  const templateDefault = (templateStructure as { defaultArchetype?: string })?.defaultArchetype;
  if (templateDefault) {
    const found = getArchetype(templateDefault);
    if (found) return found;
  }

  // 3. Fallback
  const fallback = getArchetype('vulnerable_storyteller') ?? SCRIPT_ARCHETYPES[0];
  if (!fallback) {
    throw new Error('No script archetypes configured');
  }
  return fallback;
}

export const geminiService = {
  /**
   * Generate a script based on template, persona, and archetype.
   *
   * The prompt enforces:
   * - Simple 6th-grade vocabulary
   * - Emotional arcs via energy levels and emotion tags per beat
   * - Strict pacing constraints tied to the archetype structure
   * - A canonical example script for style reference
   */
  async generateScript(input: ScriptGenerationInput): Promise<GeneratedScript> {
    const model = getModel();
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
      const result = await model.generateContent(prompt);
      const text = result.response.text();

      // Parse JSON from response
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        throw new Error('Failed to parse script response — no JSON object found');
      }

      const parsed = JSON.parse(jsonMatch[0]) as GeneratedScript;

      // Validate basic structure
      if (!parsed.content || !Array.isArray(parsed.beats) || parsed.beats.length === 0) {
        throw new Error('Script response missing content or beats');
      }

      // Ensure backward-compatible fields exist on every beat
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
    } catch (error) {
      logger.error('Gemini script generation failed:', error);
      throw error;
    }
  },
};
