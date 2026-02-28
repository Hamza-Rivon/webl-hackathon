export function buildTranscriptCorrectionPrompt(args: {
  scriptContent: string;
  wordTranscript: unknown;
  durationMs: number;
  silenceGapMs?: number;
}): string {
  const { scriptContent, wordTranscript, durationMs, silenceGapMs } = args;
  const silenceThresholdMs = Number.isFinite(silenceGapMs)
    ? Math.max(0, Math.round(silenceGapMs as number))
    : 500;
  return `
Return JSON only. No markdown.

You receive:
- Script (authoritative)
- Deepgram word transcript with timings
- Total duration in ms

Tasks:
1) Correct the word transcript so the text matches the Script exactly.
2) Produce an edit plan:
   - segmentsToRemove: silence>=${silenceThresholdMs}ms, fillers, repeats, and non-script audio
   - keepSegments: everything else (must cover the script parts)

Constraints:
- Corrected text must equal Script text.
- Use Deepgram timestamps as anchors; keep timings aligned to the audio.
- When the speaker repeats or restarts a phrase, keep a single best take (clearest, most complete, more likely to be the last one) and align its words to the script; use the corresponding Deepgram timestamps for that take.
- Each word has startMs < endMs.
- 0 <= times <= durationMs.

Script:
${scriptContent}

DeepgramTranscriptWords:
${JSON.stringify(wordTranscript)}

durationMs: ${durationMs}
`.trim();
}

export function buildUnitBatchAnalysisPrompt(args: {
  scriptContent?: string | null;
  unitsDraft: Array<{
    unitIndex: number;
    unitText: string;
    unitWords: Array<{ word: string; startMs: number; endMs: number }>;
    startMs: number;
    endMs: number;
    prevUnitText?: string | null;
    nextUnitText?: string | null;
  }>;
}): string {
  const { scriptContent, unitsDraft } = args;
  return `
Return JSON only. No markdown.

You receive a list of voiceover units (each unit is <= 5 spoken words).
For each unit:
- produce 3-5 keywords
- produce a single-word emotional tone

Rules:
- Do NOT change unit boundaries or timing.
- Do NOT invent new entities or visuals not present in the transcript/script context.
- Keywords must be grounded in the transcript/script (no hallucinated nouns).
- Avoid filler or stopwords (e.g. "the", "and", "to", "for", "with", pronouns).
- Prefer concrete nouns, places, brands, and actions.
- We build embedding text deterministically in code (context window), so do NOT output embedding text.

Script (optional context):
${scriptContent || ''}

Units:
${JSON.stringify(unitsDraft)}
`.trim();
}
