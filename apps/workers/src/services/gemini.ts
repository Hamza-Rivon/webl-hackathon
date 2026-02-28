/**
 * AI Service (Gemini & OpenAI)
 *
 * Handles video understanding and content generation using Google Gemini or OpenAI.
 * Implements retry logic with exponential backoff for reliability.
 * 
 * CURRENT PIPELINE USAGE:
 * - selectChunksForSegment: Used in cut_plan_generation to intelligently order chunks
 * - analyzeVideoClips, analyzeClip, analyzeClipsWithVision: Available for clip analysis (if needed)
 * 
 * LEGACY FUNCTIONS (deprecated, not used):
 * - matchClipsToBeats: Old template-based pipeline
 * - generateEditPlan: Old template-based pipeline
 * - identifyMotionGraphicsGaps: Old template-based pipeline
 * 
 * Current pipeline flow:
 * semantic_matching → cut_plan_generation (uses selectChunksForSegment) → cut_plan_validation
 * 
 * Provider Selection:
 * - Set AI_PROVIDER=gemini, AI_PROVIDER=mistral, or AI_PROVIDER=runpod in environment variables
 * - Defaults to 'gemini' if not specified
 */

import { GoogleGenerativeAI, GenerativeModel, Part } from '@google/generative-ai';
import OpenAI from 'openai';
import { supportsOpenAiTemperature } from './openaiModelSupport.js';
import { readFile } from 'fs/promises';
import { config } from '../config.js';
import { logger } from '@webl/shared';
import {
  type AiProvider,
  getOpenAiCompatibleClient,
  getOpenAiCompatibleModel,
  getProviderLogContext,
} from './llmProvider.js';
import { callBedrockMistralChat } from './bedrockMistral.js';

// ==================== Types ====================

export interface ClipAnalysis {
  id: string;
  source: string;
  subjects: string[];
  actions: string[];
  emotions: string[];
  shotType: string;
  qualityScore: number;
  heroMoments: Array<{ timestamp: number; description: string }>;
  usableSegments: Array<{ start: number; end: number }>;
  tags: string[];
  duration: number;
}

export interface EditDecision {
  beatIndex: number;
  clipId: string | null;
  clipStartTime?: number;
  clipEndTime?: number;
  needsMotionGraphic: boolean;
  motionPrompt?: string;
  transition: string;
  duration: number;
  reason?: string;
}

export interface TemplateBeat {
  type: string;
  duration: number;
  description: string;
}

export interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

export interface ChunkSelectionInput {
  segment: {
    id: string;
    text: string;
    durationMs: number;
    keywords: string[];
    emotionalTone: string | null;
    startMs: number;
    endMs: number;
  };
  primaryChunk: {
    id: string;
    slotClipId: string;
    chunkIndex: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    aiTags: string[];
    aiSummary: string;
    matchScore: number;
  };
  candidateChunks: Array<{
    id: string;
    slotClipId: string;
    chunkIndex: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    aiTags: string[];
    aiSummary: string;
    matchScore?: number;
  }>;
  chunksNeeded: number;
  templateRequirements?: {
    targetDurationSeconds?: number;
    exactChunkCount?: number;
    chunkDurationSeconds?: number;
    preferDifferentClipsPerBeat?: boolean;
  };
  alternationPattern?: string[]; // Optional: alternation pattern for A-roll/B-roll selection
  candidatesByPosition?: Array<Array<{
    id: string;
    slotClipId: string;
    chunkIndex: number;
    startMs: number;
    endMs: number;
    durationMs: number;
    aiTags: string[];
    aiSummary: string;
    matchScore?: number;
  }>>; // Optional: Position-aware candidates (filtered by alternation pattern for each position)
  previousChunks?: Array<{
    slotClipId: string;
    chunkIndex: number;
  }>; // Optional: Previous chunks in sequence for visual continuity context
}

export interface ChunkSelectionResult {
  selectedChunks: Array<{
    chunkId: string;
    order: number;
    reason: string;
    score: number;
    visualContinuity: 'excellent' | 'good' | 'fair' | 'poor';
    semanticMatch: 'excellent' | 'good' | 'fair' | 'poor';
  }>;
  reasoning: string;
  totalScore: number;
  diversityScore: number;
  visualCoherence: 'excellent' | 'good' | 'fair' | 'poor';
}

// ==================== Prompts ====================

const VIDEO_UNDERSTANDING_DETAILED_PROMPT = (clipCount: number) => `
You are an expert video analyst for an AI video editing platform. 
Analyze ${clipCount} video clip(s) and provide detailed insights.

For EACH clip, extract:

## Visual Analysis
- **Subjects**: People, objects, locations visible (be specific - "man in blue shirt", not just "person")
- **Environment**: Indoor/outdoor, lighting conditions, background elements
- **Shot Composition**: Shot type (close-up/medium/wide/POV), camera movement, framing quality

## Content Analysis  
- **Actions**: What's happening in the scene (speaking to camera, demonstrating product, etc.)
- **Emotions**: Emotional tone of subjects and scene (energetic, calm, tense, joyful)
- **Story Elements**: Is this B-roll, talking head, demonstration, transition footage?

## Technical Quality (Score 1-10)
- Lighting quality
- Focus/sharpness
- Audio quality (if applicable)
- Stability/camera shake
- Overall production value

## Editing Insights
- **Hero Moments**: Specific timestamps (e.g., "0:05-0:08") of most engaging parts
- **Usable Segments**: Clean sections with good audio and visual quality
- **Cut Points**: Natural places where edits would work well
- **Tags**: Keywords for semantic search (minimum 10 tags per clip)

## CRITICAL OUTPUT FORMAT REQUIREMENTS
- Respond with ONLY valid JSON array matching ClipAnalysis[] schema
- Do NOT include markdown code blocks (no \`\`\`json or \`\`\`)
- Do NOT include any explanations, comments, or text before or after the JSON
- The response must be valid JSON that can be parsed directly
- Ensure all required fields are present and properly formatted
`;

// ==================== LEGACY PROMPTS (NOT USED IN CURRENT PIPELINE) ====================
// These prompts are kept for backward compatibility but are not used in the current pipeline.
// Current pipeline uses: selectChunksForSegment only
// Legacy functions: matchClipsToBeats, generateEditPlan, identifyMotionGraphicsGaps

// ==================== Configuration ====================

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

// Provider instances (lazy initialization)
let geminiModel: GenerativeModel | null = null;
let genAI: GoogleGenerativeAI | null = null;
let openaiClient: OpenAI | null = null;

function getGeminiModel(): GenerativeModel {
  if (!geminiModel) {
    if (!config.ai.geminiApiKey) {
      throw new Error('GEMINI_API_KEY is not configured. Set AI_PROVIDER=gemini and provide GEMINI_API_KEY in .env');
    }
    genAI = new GoogleGenerativeAI(config.ai.geminiApiKey);
    geminiModel = genAI.getGenerativeModel({ 
      model: config.ai.geminiModel,
      generationConfig: {
        responseMimeType: 'application/json',
      },
    });
    logger.info(`Gemini service initialized with model: ${config.ai.geminiModel}`);
  }
  return geminiModel;
}

function getOpenAIClient(): OpenAI {
  if (!openaiClient) {
    if (config.ai.provider !== 'openai' && config.ai.provider !== 'runpod') {
      throw new Error(
        `AI_PROVIDER=${config.ai.provider} does not support OpenAI-compatible client for chunk selection`
      );
    }
    openaiClient = getOpenAiCompatibleClient(config.ai.provider as AiProvider);
    const model = getOpenAiCompatibleModel(config.openai.model, config.ai.provider as AiProvider);
    logger.info(`${config.ai.provider.toUpperCase()} service initialized with model: ${model}`);
  }
  return openaiClient;
}

// Legacy function for backward compatibility
function getModel(): GenerativeModel {
  return getGeminiModel();
}

/**
 * Get a model instance for vision/video tasks
 * Uses Gemini for vision tasks (OpenAI vision support can be added later if needed)
 */
function getVisionModel(): GenerativeModel {
  return getGeminiModel();
}

// ==================== Retry Logic ====================

/**
 * Execute a function with exponential backoff retry
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  operationName: string
): Promise<T> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      
      if (attempt < MAX_RETRIES) {
        const delay = BASE_DELAY_MS * Math.pow(2, attempt - 1);
        logger.warn(
          `${operationName} failed (attempt ${attempt}/${MAX_RETRIES}), retrying in ${delay}ms:`,
          lastError.message
        );
        await sleep(delay);
      }
    }
  }

  logger.error(`${operationName} failed after ${MAX_RETRIES} attempts:`, lastError);
  throw lastError;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ==================== JSON Parsing ====================

/**
 * Parse JSON response from Gemini, handling markdown code blocks
 */
function parseJsonResponse<T>(text: string): T {
  // Remove markdown code blocks if present
  let cleaned = text
    .replace(/```json\s*/gi, '')
    .replace(/```\s*/g, '')
    .trim();

  // Try to find JSON array or object
  const jsonMatch = cleaned.match(/[\[{][\s\S]*[\]}]/);
  if (jsonMatch) {
    cleaned = jsonMatch[0];
  }

  return JSON.parse(cleaned);
}

// ==================== Video Analysis ====================

/**
 * Analyze video clips for content understanding (text-based descriptions)
 * Requirements: 8.1, 8.2, 8.3
 */
export async function analyzeVideoClips(
  clipDescriptions: Array<{ id: string; description: string; duration: number }>
): Promise<ClipAnalysis[]> {
  return withRetry(async () => {
    const genModel = getModel();
    const prompt = `${VIDEO_UNDERSTANDING_DETAILED_PROMPT(clipDescriptions.length)}

Clip Descriptions:
${clipDescriptions.map((c, i) => `${i + 1}. ID: ${c.id}, Duration: ${c.duration}s\n   ${c.description}`).join('\n\n')}

## CRITICAL OUTPUT FORMAT REQUIREMENTS
- Respond with ONLY valid JSON array of ClipAnalysis objects
- Do NOT include markdown code blocks (no \`\`\`json or \`\`\`)
- Do NOT include any explanations, comments, or text before or after the JSON
- The response must be valid JSON that can be parsed directly

Return a JSON array with this exact structure:
[
  {
    "id": "clip_id",
    "source": "source_path",
    "subjects": ["subject1", "subject2"],
    "actions": ["action1", "action2"],
    "emotions": ["emotion1"],
    "shotType": "close-up|medium|wide|POV",
    "qualityScore": 8,
    "heroMoments": [{"timestamp": 2.5, "description": "engaging moment"}],
    "usableSegments": [{"start": 0, "end": 10}],
    "tags": ["tag1", "tag2"],
    "duration": 15.5
  }
]`;

    const result = await genModel.generateContent(prompt);
    const text = result.response.text();
    
    const analyses = parseJsonResponse<ClipAnalysis[]>(text);
    
    // Merge with input data to ensure IDs are preserved
    return analyses.map((analysis, i) => ({
      ...analysis,
      id: clipDescriptions[i]?.id || analysis.id,
      duration: clipDescriptions[i]?.duration || analysis.duration,
    }));
  }, 'analyzeVideoClips');
}

// ==================== Video Vision Analysis ====================

/**
 * Prompt for analyzing a single video clip using Gemini Vision
 */
const CLIP_ANALYSIS_VISION_PROMPT = `
You are an expert video analyst for an AI video editing platform.
Analyze this video clip and provide detailed insights.

Extract the following information:

## Visual Analysis
- **Subjects**: People, objects, locations visible (be specific - "man in blue shirt", not just "person")
- **Environment**: Indoor/outdoor, lighting conditions, background elements
- **Shot Composition**: Shot type (close-up/medium/wide/POV), camera movement, framing quality

## Content Analysis  
- **Actions**: What's happening in the scene (speaking to camera, demonstrating product, etc.)
- **Emotions**: Emotional tone of subjects and scene (energetic, calm, tense, joyful)
- **Story Elements**: Is this B-roll, talking head, demonstration, transition footage?

## Technical Quality (Score 1-10)
- Lighting quality
- Focus/sharpness
- Audio quality (if applicable)
- Stability/camera shake
- Overall production value

## Editing Insights
- **Hero Moments**: Specific timestamps (in seconds, e.g., 5.2) of most engaging parts
- **Usable Segments**: Clean sections with good audio and visual quality (start/end in seconds)
- **Cut Points**: Natural places where edits would work well
- **Tags**: Keywords for semantic search (minimum 10 tags)

## CRITICAL OUTPUT FORMAT REQUIREMENTS
- Respond with ONLY valid JSON object
- Do NOT include markdown code blocks (no \`\`\`json or \`\`\`)
- Do NOT include any explanations, comments, or text before or after the JSON
- The response must be valid JSON that can be parsed directly

Return a JSON object with this exact structure:
{
  "subjects": ["subject1", "subject2"],
  "actions": ["action1", "action2"],
  "emotions": ["emotion1", "emotion2"],
  "shotType": "close-up|medium|wide|POV",
  "qualityScore": 8,
  "heroMoments": [{"timestamp": 2.5, "description": "engaging moment"}],
  "usableSegments": [{"start": 0, "end": 10}],
  "tags": ["tag1", "tag2", "tag3"]
}
`;

/**
 * Get MIME type from file extension
 */
function getMimeType(filePath: string): string {
  const ext = filePath.toLowerCase().split('.').pop();
  const mimeTypes: Record<string, string> = {
    mp4: 'video/mp4',
    webm: 'video/webm',
    mov: 'video/quicktime',
    avi: 'video/x-msvideo',
    mkv: 'video/x-matroska',
    m4v: 'video/x-m4v',
  };
  return mimeTypes[ext || ''] || 'video/mp4';
}

/**
 * Analyze a single video clip using Gemini Vision
 * Requirements: 8.1, 8.2, 8.3
 * 
 * @param clipId - Unique identifier for the clip
 * @param videoPath - Local file path to the video file
 * @param duration - Duration of the clip in seconds
 * @returns Structured clip analysis
 */
export async function analyzeClip(
  clipId: string,
  videoPath: string,
  duration: number
): Promise<ClipAnalysis> {
  return withRetry(async () => {
    const genModel = getVisionModel();
    
    // Read video file and encode as base64
    const videoBuffer = await readFile(videoPath);
    const base64Video = videoBuffer.toString('base64');
    const mimeType = getMimeType(videoPath);
    
    logger.debug(`Analyzing clip ${clipId} (${duration}s) with Gemini Vision`);
    
    // Create multimodal content with video and prompt
    const videoPart: Part = {
      inlineData: {
        mimeType,
        data: base64Video,
      },
    };
    
    const textPart: Part = {
      text: CLIP_ANALYSIS_VISION_PROMPT,
    };
    
    const result = await genModel.generateContent([videoPart, textPart]);
    const text = result.response.text();
    
    const analysis = parseJsonResponse<Omit<ClipAnalysis, 'id' | 'source' | 'duration'>>(text);
    
    // Return complete ClipAnalysis with provided metadata
    return {
      id: clipId,
      source: videoPath,
      duration,
      subjects: analysis.subjects || [],
      actions: analysis.actions || [],
      emotions: analysis.emotions || [],
      shotType: analysis.shotType || 'medium',
      qualityScore: analysis.qualityScore || 5,
      heroMoments: analysis.heroMoments || [],
      usableSegments: analysis.usableSegments || [{ start: 0, end: duration }],
      tags: analysis.tags || [],
    };
  }, `analyzeClip(${clipId})`);
}

/**
 * Analyze multiple video clips using Gemini Vision
 * Requirements: 8.1, 8.2, 8.3, 8.5
 * 
 * @param clips - Array of clips to analyze
 * @param onProgress - Optional callback for progress updates
 * @returns Array of clip analyses
 */
export async function analyzeClipsWithVision(
  clips: Array<{ id: string; videoPath: string; duration: number }>,
  onProgress?: (progress: number, message: string) => Promise<void>
): Promise<ClipAnalysis[]> {
  const results: ClipAnalysis[] = [];
  const totalClips = clips.length;
  
  for (let i = 0; i < totalClips; i++) {
    const clip = clips[i];
    if (!clip) continue;
    
    // Calculate progress percentage
    const progressPercent = Math.round(((i + 1) / totalClips) * 100);
    
    // Report progress at 25%, 50%, 75%, 100% as per Requirements 8.5
    if (onProgress && (progressPercent === 25 || progressPercent === 50 || progressPercent === 75 || progressPercent === 100 || i === 0)) {
      await onProgress(progressPercent, `Analyzing clip ${i + 1} of ${totalClips}`);
    }
    
    logger.info(`Analyzing clip ${i + 1}/${totalClips}: ${clip.id}`);
    
    const analysis = await analyzeClip(clip.id, clip.videoPath, clip.duration);
    results.push(analysis);
  }
  
  return results;
}

// ==================== LEGACY FUNCTIONS (NOT USED IN CURRENT PIPELINE) ====================
// These functions are kept for backward compatibility but are not used in the current pipeline.
// Current pipeline: semantic_matching → cut_plan_generation (uses selectChunksForSegment only)
// 
// Legacy functions below are from old template-based pipeline and are not called:
// - matchClipsToBeats: Used in old template-based pipeline
// - generateEditPlan: Used in old template-based pipeline  
// - identifyMotionGraphicsGaps: Used in old template-based pipeline

/**
 * @deprecated Legacy function - not used in current pipeline
 * Match clips to template beats using AI (old template-based pipeline)
 */
export async function matchClipsToBeats(
  _templateBeats: TemplateBeat[],
  _clipAnalyses: ClipAnalysis[],
  _transcript: string,
  _personaTone: string = 'professional'
): Promise<EditDecision[]> {
  throw new Error('matchClipsToBeats is deprecated and not used in current pipeline');
}

/**
 * @deprecated Legacy function - not used in current pipeline
 * Generate a complete edit plan from edit decisions (old template-based pipeline)
 */
export async function generateEditPlan(
  _editDecisions: EditDecision[],
  _clipAnalyses: ClipAnalysis[],
  _editingRecipe: {
    cutRhythm: string;
    captionStyle: string;
    musicType: string;
    transitions: string[];
  },
  _transcriptSegments: TranscriptSegment[]
): Promise<{
  items: Array<{
    type: 'clip' | 'motion';
    source: string;
    startTime: number;
    endTime?: number;
    duration: number;
    transition: string;
    effects: string[];
  }>;
  captions: Array<{
    text: string;
    startTime: number;
    endTime: number;
    style: string;
    position: string;
  }>;
  totalDuration: number;
}> {
  throw new Error('generateEditPlan is deprecated and not used in current pipeline');
}

// ==================== Intelligent Chunk Selection ====================

const CHUNK_SELECTION_PROMPT = `
You are an expert video editor selecting the best chunks for a voiceover segment.

## Your Task
Select and order chunks that will create the most visually coherent and semantically matched video sequence.

## Selection Criteria (in priority order):
1. **Semantic Match**: How well does the chunk match the voiceover content?
   - Keywords mentioned in voiceover (e.g., "skiing", "snow", "train")
   - Emotional tone alignment

2. **Visual Continuity**: When using multiple chunks from the same source video:
   - Prefer sequential order (chunkIndex 0 → 1 → 2) for smooth flow
   - Avoid reverse chronological order (middle → end → beginning)
   - Consider visual coherence (does the action flow naturally?)

3. **Diversity**: 
   - Prefer chunks from different source videos for visual variety
   - Only use same-video chunks if they significantly improve semantic match
   - Balance variety with coherence

4. **Template Requirements**:
   - Respect exactChunkCount if specified
   - Consider preferDifferentClipsPerBeat preference
   - **IMPORTANT**: All chunks are exactly 2 seconds (fixed duration). Select the number of chunks needed (chunksNeeded) - no duration matching required.

## CRITICAL OUTPUT FORMAT REQUIREMENTS
- Respond with ONLY valid JSON object
- Do NOT include markdown code blocks (no \`\`\`json or \`\`\`)
- Do NOT include any explanations, comments, or text before or after the JSON
- The response must be valid JSON that can be parsed directly
- Ensure all required fields are present and properly formatted

## Output Format
Return JSON with this exact structure:
{
  "selectedChunks": [
    {
      "chunkId": "chunk_id_string",
      "order": 1,
      "reason": "Detailed explanation of why this chunk was selected and its position",
      "score": 0.95,
      "visualContinuity": "excellent" | "good" | "fair" | "poor",
      "semanticMatch": "excellent" | "good" | "fair" | "poor"
    }
  ],
  "reasoning": "Overall explanation of the selection strategy and why this order creates the best video",
  "totalScore": 0.92,
  "diversityScore": 0.85,
  "visualCoherence": "excellent" | "good" | "fair" | "poor"
}

## Critical Rules:
- Order chunks from best to worst match
- If using chunks from same video, maintain chronological order (chunkIndex ascending)
- Always include the primary chunk (it's already matched)
- Provide detailed reasoning for each selection
- Score each chunk 0.0-1.0 based on overall quality
`;

/**
 * Select chunks using Gemini
 */
async function selectChunksForSegmentGemini(
  input: ChunkSelectionInput
): Promise<ChunkSelectionResult> {
  const model = getGeminiModel();
    
    // IMPROVEMENT 4: Add previous chunks context to prompt
    const previousChunksContext = input.previousChunks && input.previousChunks.length > 0
      ? `
## Previous Chunks in Sequence (for Visual Continuity)
${input.previousChunks.map((chunk, idx) => `
- Position ${input.previousChunks!.length - input.previousChunks!.length + idx}: Chunk ${chunk.chunkIndex} from Slot Clip ${chunk.slotClipId}
`).join('')}

**Visual Continuity Guidelines:**
- If previous chunks are from the same video (same Slot Clip ID), prefer continuing the sequence chronologically
- Consider visual flow: does this chunk naturally follow the previous ones?
- Balance semantic match with visual continuity
- If a sequence has started (2+ chunks from same video), prefer continuing it in chronological order
`
      : '';
    
    // Build position-aware candidates context if provided
    const positionAwareContext = input.candidatesByPosition
      ? `
## Position-Aware Candidates (IMPORTANT)
The following candidates have been pre-filtered to match the alternation pattern for each position:
${input.candidatesByPosition.map((positionCandidates, posIdx) => `
### Position ${posIdx + 1} (${positionCandidates.length} candidates matching pattern):
${positionCandidates.map((chunk, idx) => `
  ${idx + 1}. ID: ${chunk.id}, Slot Clip ${chunk.slotClipId}, Chunk ${chunk.chunkIndex}, Tags: ${chunk.aiTags.slice(0, 3).join(', ')}${chunk.matchScore ? `, Score: ${(chunk.matchScore * 100).toFixed(1)}%` : ''}
`).join('')}
`).join('')}

**Selection Strategy:**
- Each position has its own filtered candidate list that matches the alternation pattern
- You can select from any position's candidates, but respect the pattern requirements
- Prioritize semantic match and visual continuity while respecting pattern constraints
`
      : '';
    
    const prompt = `${CHUNK_SELECTION_PROMPT}

## Voiceover Segment
- Text: "${input.segment.text}"
- Duration: ${input.segment.durationMs}ms (${(input.segment.durationMs / 1000).toFixed(2)}s) - **Note: This determines how many 2-second chunks are needed, but each chunk is always exactly 2 seconds**
- Keywords: ${input.segment.keywords.join(', ')}
- Emotional Tone: ${input.segment.emotionalTone || 'neutral'}
${previousChunksContext}
## Primary Matched Chunk (MUST be included)
- ID: ${input.primaryChunk.id}
- Source: Slot Clip ${input.primaryChunk.slotClipId}
- Position in Source: Chunk ${input.primaryChunk.chunkIndex} (${(input.primaryChunk.startMs / 1000).toFixed(2)}s - ${(input.primaryChunk.endMs / 1000).toFixed(2)}s)
- **Duration**: 2 seconds (all chunks are fixed 2-second duration)
- AI Tags: ${input.primaryChunk.aiTags.join(', ')}
- Summary: ${input.primaryChunk.aiSummary}
- Match Score: ${(input.primaryChunk.matchScore * 100).toFixed(1)}%

${positionAwareContext || `## Candidate Chunks (Select ${input.chunksNeeded - 1} additional)
**Note**: All chunks are exactly 2 seconds in duration (fixed, no trimming or scaling)
${input.candidateChunks.map((chunk, idx) => `
### Candidate ${idx + 1}
- ID: ${chunk.id}
- Source: Slot Clip ${chunk.slotClipId}
- Position in Source: Chunk ${chunk.chunkIndex} (${(chunk.startMs / 1000).toFixed(2)}s - ${(chunk.endMs / 1000).toFixed(2)}s)
- Duration: 2 seconds (fixed)
- AI Tags: ${chunk.aiTags.join(', ')}
- Summary: ${chunk.aiSummary}
- Match Score: ${chunk.matchScore ? (chunk.matchScore * 100).toFixed(1) + '%' : 'N/A'}
`).join('\n')}`}

## Requirements
- **Chunks Needed**: ${input.chunksNeeded} total (1 primary + ${input.chunksNeeded - 1} additional)
- **Chunk Duration**: All chunks are exactly 2 seconds (fixed duration, no trimming or scaling)
- **Segment Duration**: ${(input.segment.durationMs / 1000).toFixed(2)}s (provided for context only - chunks are always 2s)
${input.templateRequirements ? `
- Template Target Duration: ${input.templateRequirements.targetDurationSeconds || 'N/A'}s (reference only)
- Exact Chunk Count: ${input.templateRequirements.exactChunkCount || 'N/A'}
- Prefer Different Clips: ${input.templateRequirements.preferDifferentClipsPerBeat ? 'Yes' : 'No'}
` : ''}
${input.alternationPattern ? `
## Alternation Pattern (IMPORTANT)
The template specifies an alternation pattern that controls chunk type (A-roll vs B-roll) for each position:
- Pattern: ${JSON.stringify(input.alternationPattern)}
- Pattern repeats cyclically for each chunk position
${input.candidatesByPosition ? '- Candidates have been pre-filtered by position to match the pattern' : '- All candidate chunks provided have already been filtered to match the pattern for at least one position'}
- You should select chunks that best match the voiceover while respecting the pattern requirements
` : ''}

Select the best ${input.chunksNeeded - 1} additional chunks and order ALL ${input.chunksNeeded} chunks (including primary) from best to worst match.
**Remember**: Each chunk is exactly 2 seconds - you're selecting which chunks to use and their order, not matching durations.
Consider visual continuity, semantic matching, and diversity.

## REMINDER: OUTPUT FORMAT
- Respond with ONLY valid JSON object matching the structure above
- Do NOT include markdown code blocks, explanations, or any text outside the JSON
- The response must be parseable JSON only`;

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    
    const selection = parseJsonResponse<ChunkSelectionResult>(text);
    
    // Validate that primary chunk is included
    const primaryIncluded = selection.selectedChunks.some(c => c.chunkId === input.primaryChunk.id);
    if (!primaryIncluded) {
      logger.warn('Primary chunk not in Gemini selection, adding it as first chunk');
      selection.selectedChunks.unshift({
        chunkId: input.primaryChunk.id,
        order: 1,
        reason: 'Primary semantic match',
        score: input.primaryChunk.matchScore,
        visualContinuity: 'good',
        semanticMatch: 'good',
      });
      // Reorder all chunks
      selection.selectedChunks.forEach((chunk, idx) => {
        chunk.order = idx + 1;
      });
    }
    
    // Ensure we have exactly chunksNeeded chunks
    if (selection.selectedChunks.length > input.chunksNeeded) {
      selection.selectedChunks = selection.selectedChunks.slice(0, input.chunksNeeded);
    }
    
    logger.info(
      `Gemini selected ${selection.selectedChunks.length} chunks with score ${(selection.totalScore * 100).toFixed(1)}% ` +
      `(diversity: ${(selection.diversityScore * 100).toFixed(1)}%, coherence: ${selection.visualCoherence})`
    );
    
    return selection;
}

/**
 * Select chunks using OpenAI
 */
async function selectChunksForSegmentOpenAI(
  input: ChunkSelectionInput
): Promise<ChunkSelectionResult> {
  const client = getOpenAIClient();
  const provider = config.ai.provider as AiProvider;
  const model = getOpenAiCompatibleModel(config.openai.model, provider);
  
  // Build the same prompt structure as Gemini
  const previousChunksContext = input.previousChunks && input.previousChunks.length > 0
    ? `
## Previous Chunks in Sequence (for Visual Continuity)
${input.previousChunks.map((chunk, idx) => `
- Position ${input.previousChunks!.length - input.previousChunks!.length + idx}: Chunk ${chunk.chunkIndex} from Slot Clip ${chunk.slotClipId}
`).join('')}

**Visual Continuity Guidelines:**
- If previous chunks are from the same video (same Slot Clip ID), prefer continuing the sequence chronologically
- Consider visual flow: does this chunk naturally follow the previous ones?
- Balance semantic match with visual continuity
- If a sequence has started (2+ chunks from same video), prefer continuing it in chronological order
`
    : '';
  
  const positionAwareContext = input.candidatesByPosition
    ? `
## Position-Aware Candidates (IMPORTANT)
The following candidates have been pre-filtered to match the alternation pattern for each position:
${input.candidatesByPosition.map((positionCandidates, posIdx) => `
### Position ${posIdx + 1} (${positionCandidates.length} candidates matching pattern):
${positionCandidates.map((chunk, idx) => `
  ${idx + 1}. ID: ${chunk.id}, Slot Clip ${chunk.slotClipId}, Chunk ${chunk.chunkIndex}, Tags: ${chunk.aiTags.slice(0, 3).join(', ')}${chunk.matchScore ? `, Score: ${(chunk.matchScore * 100).toFixed(1)}%` : ''}
`).join('')}
`).join('')}

**Selection Strategy:**
- Each position has its own filtered candidate list that matches the alternation pattern
- You can select from any position's candidates, but respect the pattern requirements
- Prioritize semantic match and visual continuity while respecting pattern constraints
`
    : '';
  
  const prompt = `${CHUNK_SELECTION_PROMPT}

## Voiceover Segment
- Text: "${input.segment.text}"
- Duration: ${input.segment.durationMs}ms (${(input.segment.durationMs / 1000).toFixed(2)}s) - **Note: This determines how many 2-second chunks are needed, but each chunk is always exactly 2 seconds**
- Keywords: ${input.segment.keywords.join(', ')}
- Emotional Tone: ${input.segment.emotionalTone || 'neutral'}
${previousChunksContext}
## Primary Matched Chunk (MUST be included)
- ID: ${input.primaryChunk.id}
- Source: Slot Clip ${input.primaryChunk.slotClipId}
- Position in Source: Chunk ${input.primaryChunk.chunkIndex} (${(input.primaryChunk.startMs / 1000).toFixed(2)}s - ${(input.primaryChunk.endMs / 1000).toFixed(2)}s)
- **Duration**: 2 seconds (all chunks are fixed 2-second duration)
- AI Tags: ${input.primaryChunk.aiTags.join(', ')}
- Summary: ${input.primaryChunk.aiSummary}
- Match Score: ${(input.primaryChunk.matchScore * 100).toFixed(1)}%

${positionAwareContext || `## Candidate Chunks (Select ${input.chunksNeeded - 1} additional)
**Note**: All chunks are exactly 2 seconds in duration (fixed, no trimming or scaling)
${input.candidateChunks.map((chunk, idx) => `
### Candidate ${idx + 1}
- ID: ${chunk.id}
- Source: Slot Clip ${chunk.slotClipId}
- Position in Source: Chunk ${chunk.chunkIndex} (${(chunk.startMs / 1000).toFixed(2)}s - ${(chunk.endMs / 1000).toFixed(2)}s)
- Duration: 2 seconds (fixed)
- AI Tags: ${chunk.aiTags.join(', ')}
- Summary: ${chunk.aiSummary}
- Match Score: ${chunk.matchScore ? (chunk.matchScore * 100).toFixed(1) + '%' : 'N/A'}
`).join('\n')}`}

## Requirements
- **Chunks Needed**: ${input.chunksNeeded} total (1 primary + ${input.chunksNeeded - 1} additional)
- **Chunk Duration**: All chunks are exactly 2 seconds (fixed duration, no trimming or scaling)
- **Segment Duration**: ${(input.segment.durationMs / 1000).toFixed(2)}s (provided for context only - chunks are always 2s)
${input.templateRequirements ? `
- Template Target Duration: ${input.templateRequirements.targetDurationSeconds || 'N/A'}s (reference only)
- Exact Chunk Count: ${input.templateRequirements.exactChunkCount || 'N/A'}
- Prefer Different Clips: ${input.templateRequirements.preferDifferentClipsPerBeat ? 'Yes' : 'No'}
` : ''}
${input.alternationPattern ? `
## Alternation Pattern (IMPORTANT)
The template specifies an alternation pattern that controls chunk type (A-roll vs B-roll) for each position:
- Pattern: ${JSON.stringify(input.alternationPattern)}
- Pattern repeats cyclically for each chunk position
${input.candidatesByPosition ? '- Candidates have been pre-filtered by position to match the pattern' : '- All candidate chunks provided have already been filtered to match the pattern for at least one position'}
- You should select chunks that best match the voiceover while respecting the pattern requirements
` : ''}

Select the best ${input.chunksNeeded - 1} additional chunks and order ALL ${input.chunksNeeded} chunks (including primary) from best to worst match.
**Remember**: Each chunk is exactly 2 seconds - you're selecting which chunks to use and their order, not matching durations.
Consider visual continuity, semantic matching, and diversity.

## REMINDER: OUTPUT FORMAT
- Respond with ONLY valid JSON object matching the structure above
- Do NOT include markdown code blocks, explanations, or any text outside the JSON
- The response must be parseable JSON only`;

  const temperature = supportsOpenAiTemperature(model, null) ? 0.7 : undefined;
  if (provider === 'runpod') {
    logger.info('[Runpod][chunk-selection] request', {
      ...getProviderLogContext(provider),
      chunksNeeded: input.chunksNeeded,
      candidateCount: input.candidateChunks.length,
      hasPositionAwareCandidates: Boolean(input.candidatesByPosition),
    });
  }
  const response = await client.chat.completions.create({
    model,
    messages: [
      {
        role: 'system',
        content: 'You are an expert video editor. Always respond with valid JSON only, no markdown code blocks or explanations.',
      },
      {
        role: 'user',
        content: prompt,
      },
    ],
    response_format: { type: 'json_object' },
    ...(temperature !== undefined ? { temperature } : {}),
  });

  const content = response.choices[0]?.message?.content;
  if (!content) {
    throw new Error(`${provider.toUpperCase()} returned empty response`);
  }

  const selection = parseJsonResponse<ChunkSelectionResult>(content);
  if (provider === 'runpod') {
    logger.info('[Runpod][chunk-selection] response', {
      ...getProviderLogContext(provider),
      selectedCount: Array.isArray(selection.selectedChunks) ? selection.selectedChunks.length : 0,
      totalScore: selection.totalScore,
      diversityScore: selection.diversityScore,
      visualCoherence: selection.visualCoherence,
    });
  }
  
  // Validate that primary chunk is included
  const primaryIncluded = selection.selectedChunks.some(c => c.chunkId === input.primaryChunk.id);
  if (!primaryIncluded) {
    logger.warn(`Primary chunk not in ${provider.toUpperCase()} selection, adding it as first chunk`);
    selection.selectedChunks.unshift({
      chunkId: input.primaryChunk.id,
      order: 1,
      reason: 'Primary semantic match',
      score: input.primaryChunk.matchScore,
      visualContinuity: 'good',
      semanticMatch: 'good',
    });
    // Reorder all chunks
    selection.selectedChunks.forEach((chunk, idx) => {
      chunk.order = idx + 1;
    });
  }
  
  // Ensure we have exactly chunksNeeded chunks
  if (selection.selectedChunks.length > input.chunksNeeded) {
    selection.selectedChunks = selection.selectedChunks.slice(0, input.chunksNeeded);
  }
  
  logger.info(
    `${provider.toUpperCase()} selected ${selection.selectedChunks.length} chunks with score ${(selection.totalScore * 100).toFixed(1)}% ` +
    `(diversity: ${(selection.diversityScore * 100).toFixed(1)}%, coherence: ${selection.visualCoherence})`
  );
  
  return selection;
}

/**
 * Select chunks using Bedrock Mistral
 */
async function selectChunksForSegmentMistral(
  input: ChunkSelectionInput
): Promise<ChunkSelectionResult> {
  // Build the same prompt structure as Gemini/OpenAI
  const previousChunksContext = input.previousChunks && input.previousChunks.length > 0
    ? `
## Previous Chunks in Sequence (for Visual Continuity)
${input.previousChunks.map((chunk, idx) => `
- Position ${input.previousChunks!.length - input.previousChunks!.length + idx}: Chunk ${chunk.chunkIndex} from Slot Clip ${chunk.slotClipId}
`).join('')}

**Visual Continuity Guidelines:**
- If previous chunks are from the same video (same Slot Clip ID), prefer continuing the sequence chronologically
- Consider visual flow: does this chunk naturally follow the previous ones?
- Balance semantic match with visual continuity
- If a sequence has started (2+ chunks from same video), prefer continuing it in chronological order
`
    : '';

  const positionAwareContext = input.candidatesByPosition
    ? `
## Position-Aware Candidates (IMPORTANT)
The following candidates have been pre-filtered to match the alternation pattern for each position:
${input.candidatesByPosition.map((positionCandidates, posIdx) => `
### Position ${posIdx + 1} (${positionCandidates.length} candidates matching pattern):
${positionCandidates.map((chunk, idx) => `
  ${idx + 1}. ID: ${chunk.id}, Slot Clip ${chunk.slotClipId}, Chunk ${chunk.chunkIndex}, Tags: ${chunk.aiTags.slice(0, 3).join(', ')}${chunk.matchScore ? `, Score: ${(chunk.matchScore * 100).toFixed(1)}%` : ''}
`).join('')}
`).join('')}

**Selection Strategy:**
- Each position has its own filtered candidate list that matches the alternation pattern
- You can select from any position's candidates, but respect the pattern requirements
- Prioritize semantic match and visual continuity while respecting pattern constraints
`
    : '';

  const prompt = `${CHUNK_SELECTION_PROMPT}

## Voiceover Segment
- Text: "${input.segment.text}"
- Duration: ${input.segment.durationMs}ms (${(input.segment.durationMs / 1000).toFixed(2)}s) - **Note: This determines how many 2-second chunks are needed, but each chunk is always exactly 2 seconds**
- Keywords: ${input.segment.keywords.join(', ')}
- Emotional Tone: ${input.segment.emotionalTone || 'neutral'}
${previousChunksContext}
## Primary Matched Chunk (MUST be included)
- ID: ${input.primaryChunk.id}
- Source: Slot Clip ${input.primaryChunk.slotClipId}
- Position in Source: Chunk ${input.primaryChunk.chunkIndex} (${(input.primaryChunk.startMs / 1000).toFixed(2)}s - ${(input.primaryChunk.endMs / 1000).toFixed(2)}s)
- **Duration**: 2 seconds (all chunks are fixed 2-second duration)
- AI Tags: ${input.primaryChunk.aiTags.join(', ')}
- Summary: ${input.primaryChunk.aiSummary}
- Match Score: ${(input.primaryChunk.matchScore * 100).toFixed(1)}%

${positionAwareContext || `## Candidate Chunks (Select ${input.chunksNeeded - 1} additional)
**Note**: All chunks are exactly 2 seconds in duration (fixed, no trimming or scaling)
${input.candidateChunks.map((chunk, idx) => `
### Candidate ${idx + 1}
- ID: ${chunk.id}
- Source: Slot Clip ${chunk.slotClipId}
- Position in Source: Chunk ${chunk.chunkIndex} (${(chunk.startMs / 1000).toFixed(2)}s - ${(chunk.endMs / 1000).toFixed(2)}s)
- Duration: 2 seconds (fixed)
- AI Tags: ${chunk.aiTags.join(', ')}
- Summary: ${chunk.aiSummary}
- Match Score: ${chunk.matchScore ? (chunk.matchScore * 100).toFixed(1) + '%' : 'N/A'}
`).join('\n')}`}

## Requirements
- **Chunks Needed**: ${input.chunksNeeded} total (1 primary + ${input.chunksNeeded - 1} additional)
- **Chunk Duration**: All chunks are exactly 2 seconds (fixed duration, no trimming or scaling)
- **Segment Duration**: ${(input.segment.durationMs / 1000).toFixed(2)}s (provided for context only - chunks are always 2s)
${input.templateRequirements ? `
- Template Target Duration: ${input.templateRequirements.targetDurationSeconds || 'N/A'}s (reference only)
- Exact Chunk Count: ${input.templateRequirements.exactChunkCount || 'N/A'}
- Prefer Different Clips: ${input.templateRequirements.preferDifferentClipsPerBeat ? 'Yes' : 'No'}
` : ''}
${input.alternationPattern ? `
## Alternation Pattern (IMPORTANT)
The template specifies an alternation pattern that controls chunk type (A-roll vs B-roll) for each position:
- Pattern: ${JSON.stringify(input.alternationPattern)}
- Pattern repeats cyclically for each chunk position
${input.candidatesByPosition ? '- Candidates have been pre-filtered by position to match the pattern' : '- All candidate chunks provided have already been filtered to match the pattern for at least one position'}
- You should select chunks that best match the voiceover while respecting the pattern requirements
` : ''}

Select the best ${input.chunksNeeded - 1} additional chunks and order ALL ${input.chunksNeeded} chunks (including primary) from best to worst match.
**Remember**: Each chunk is exactly 2 seconds - you're selecting which chunks to use and their order, not matching durations.
Consider visual continuity, semantic matching, and diversity.

## REMINDER: OUTPUT FORMAT
- Respond with ONLY valid JSON object matching the structure above
- Do NOT include markdown code blocks, explanations, or any text outside the JSON
- The response must be parseable JSON only`;

  const content = await callBedrockMistralChat({
    systemPrompt: 'You are an expert video editor. Always respond with valid JSON only, no markdown code blocks or explanations.',
    userPrompt: prompt,
    temperature: 0.7,
  });

  const selection = parseJsonResponse<ChunkSelectionResult>(content);

  // Validate that primary chunk is included
  const primaryIncluded = selection.selectedChunks.some(c => c.chunkId === input.primaryChunk.id);
  if (!primaryIncluded) {
    logger.warn('Primary chunk not in Mistral/Bedrock selection, adding it as first chunk');
    selection.selectedChunks.unshift({
      chunkId: input.primaryChunk.id,
      order: 1,
      reason: 'Primary semantic match',
      score: input.primaryChunk.matchScore,
      visualContinuity: 'good',
      semanticMatch: 'good',
    });
    // Reorder all chunks
    selection.selectedChunks.forEach((chunk, idx) => {
      chunk.order = idx + 1;
    });
  }

  // Ensure we have exactly chunksNeeded chunks
  if (selection.selectedChunks.length > input.chunksNeeded) {
    selection.selectedChunks = selection.selectedChunks.slice(0, input.chunksNeeded);
  }

  logger.info(
    `MISTRAL/BEDROCK selected ${selection.selectedChunks.length} chunks with score ${(selection.totalScore * 100).toFixed(1)}% ` +
    `(diversity: ${(selection.diversityScore * 100).toFixed(1)}%, coherence: ${selection.visualCoherence})`
  );

  return selection;
}

/**
 * Intelligently select and order chunks for a voiceover segment using AI
 *
 * IMPORTANT: Only ONE provider is used at a time based on AI_PROVIDER env var.
 * Set AI_PROVIDER=gemini, AI_PROVIDER=mistral, or AI_PROVIDER=runpod in .env.
 * 
 * @param input - Segment, primary chunk, candidate chunks, and requirements
 * @returns Structured selection result with ordered chunks and reasoning
 */
export async function selectChunksForSegment(
  input: ChunkSelectionInput
): Promise<ChunkSelectionResult> {
  const provider = config.ai.provider as AiProvider;
  
  // Validate provider is set correctly
  if (provider !== 'gemini' && provider !== 'openai' && provider !== 'runpod' && provider !== 'mistral') {
    throw new Error(
      `Invalid AI_PROVIDER="${provider}". Must be either "gemini", "openai", "runpod", or "mistral". ` +
      `Set AI_PROVIDER in .env to choose which provider to use.`
    );
  }
  
  logger.info(`Using ${provider.toUpperCase()} for chunk selection (only this provider will be used)`);
  
  // Only call the selected provider - never both
  if (provider === 'mistral') {
    return withRetry(
      () => selectChunksForSegmentMistral(input),
      'selectChunksForSegment (Mistral/Bedrock)'
    );
  }

  if (provider === 'openai' || provider === 'runpod') {
    return withRetry(
      () => selectChunksForSegmentOpenAI(input),
      `selectChunksForSegment (${provider.toUpperCase()})`
    );
  } else {
    // Default to Gemini if provider is 'gemini' or anything else
    return withRetry(
      () => selectChunksForSegmentGemini(input),
      'selectChunksForSegment (Gemini)'
    );
  }
}

// ==================== LEGACY GAP DETECTION (NOT USED) ====================

/**
 * @deprecated Legacy function - not used in current pipeline
 * Identify gaps in edit decisions that need motion graphics (old template-based pipeline)
 */
export function identifyMotionGraphicsGaps(
  _editDecisions: EditDecision[]
): Array<{
  beatIndex: number;
  duration: number;
  prompt: string;
}> {
  throw new Error('identifyMotionGraphicsGaps is deprecated and not used in current pipeline');
}
