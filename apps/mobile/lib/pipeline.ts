/**
 * Pipeline source-of-truth helpers for mobile UI.
 * Keep enum values aligned with ARCHITECTURE.md / Prisma schema.
 */

export const EPISODE_STATUS = [
  'draft',
  'voiceover_uploaded',
  'voiceover_cleaning',
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'rendering',
  'ready',
  'published',
  'failed',
] as const;

export type EpisodeStatus = (typeof EPISODE_STATUS)[number];

export const JOB_STATUS = ['pending', 'processing', 'done', 'error', 'cancelled'] as const;
export type JobStatus = (typeof JOB_STATUS)[number];

export const JOB_STAGE = [
  'starting',
  'downloading',
  'uploading',
  'processing',
  'analyzing',
  'building',
  'rendering',
  'publishing',
  'done',
] as const;
export type JobStage = (typeof JOB_STAGE)[number];

export const PIPELINE_JOB_ORDER = [
  'voiceover_ingest',
  'voiceover_transcript',
  'voiceover_transcript_correction',
  'voiceover_take_selection',
  'voiceover_silence_detection',
  'voiceover_cleaning',
  'voiceover_segmentation',
  'broll_ingest',
  'broll_chunking',
  'broll_chunk_ingest',
  'slot_clip_enrichment',
  'broll_chunk_enrichment',
  'broll_chunk_embedding',
  'aroll_chunk_transcript',
  'chunk_refinement',
  'semantic_matching',
  'creative_edit_plan',
  'cut_plan_generation',
  'cut_plan_validation',
  'ffmpeg_render_microcut_v2',
  'mux_publish',
] as const;

export type PipelineJobType = (typeof PIPELINE_JOB_ORDER)[number];

export type JourneyStep = 'script' | 'voiceover' | 'clips' | 'processing' | 'final' | 'recovery';
export type PipelinePhase = 1 | 2 | 3 | 4 | 5;

export const VOICEOVER_CAPTURE_STATUSES: ReadonlyArray<EpisodeStatus> = [
  'draft',
  'voiceover_uploaded',
  'voiceover_cleaning',
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'rendering',
  'ready',
  'failed',
];

export const SLOT_COLLECTION_STATUSES: ReadonlyArray<EpisodeStatus> = [
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'failed',
];

export const START_PROCESSING_STATUSES: ReadonlyArray<EpisodeStatus> = [
  'voiceover_cleaned',
  'collecting_clips',
  'needs_more_clips',
  'failed',
];

export const PROCESSING_TIMELINE_STATUSES: ReadonlyArray<EpisodeStatus> = [
  'chunking_clips',
  'enriching_chunks',
  'matching',
  'cut_plan_ready',
  'rendering',
  'ready',
  'published',
  'failed',
];

export const FINAL_STATUSES: ReadonlyArray<EpisodeStatus> = ['ready', 'published'];

export const STATUS_TO_STEP: Record<EpisodeStatus, JourneyStep> = {
  draft: 'script',
  voiceover_uploaded: 'voiceover',
  voiceover_cleaning: 'voiceover',
  voiceover_cleaned: 'clips',
  collecting_clips: 'clips',
  needs_more_clips: 'clips',
  chunking_clips: 'processing',
  enriching_chunks: 'processing',
  matching: 'processing',
  cut_plan_ready: 'processing',
  rendering: 'processing',
  ready: 'final',
  published: 'final',
  failed: 'recovery',
};

export const STATUS_LABELS: Record<EpisodeStatus, string> = {
  draft: 'Script Draft',
  voiceover_uploaded: 'Voiceover Uploaded',
  voiceover_cleaning: 'Cleaning Voiceover',
  voiceover_cleaned: 'Voiceover Cleaned',
  collecting_clips: 'Collecting Clips',
  needs_more_clips: 'Needs More Clips',
  chunking_clips: 'Chunking Clips',
  enriching_chunks: 'Enriching Chunks',
  matching: 'Matching',
  cut_plan_ready: 'Cut Plan Ready',
  rendering: 'Rendering',
  ready: 'Ready',
  published: 'Published',
  failed: 'Failed',
};

export function getPhaseResultRoute(params: {
  episodeId: string;
  phase: PipelinePhase;
  hasPlayback?: boolean;
}): string {
  const { episodeId, phase, hasPlayback = false } = params;

  switch (phase) {
    case 1:
      return `/(main)/episode/${episodeId}?focus=voiceover`;
    case 2:
      return `/(main)/episode/${episodeId}/slots`;
    case 3:
    case 4:
      return `/(main)/episode/${episodeId}/processing`;
    case 5:
      return hasPlayback
        ? `/(main)/episode/${episodeId}/preview`
        : `/(main)/episode/${episodeId}/processing`;
    default:
      return `/(main)/episode/${episodeId}`;
  }
}

export const STAGE_LABELS: Record<JobStage, string> = {
  starting: 'Starting',
  downloading: 'Downloading',
  uploading: 'Uploading',
  processing: 'Processing',
  analyzing: 'Analyzing',
  building: 'Building',
  rendering: 'Rendering',
  publishing: 'Publishing',
  done: 'Done',
};

export interface GuardResult {
  allowed: boolean;
  disabledReason: string | null;
}

export type EpisodeActionId =
  | 'edit_script'
  | 'generate_script'
  | 'voiceover_capture'
  | 'slot_collection'
  | 'start_processing'
  | 'request_render'
  | 'processing_timeline'
  | 'preview';

export interface EpisodeActionContext {
  status: string;
  slotsComplete?: boolean;
  hasPlayback?: boolean;
  hasActiveJobs?: boolean;
}

function normalizeStatus(status: string): EpisodeStatus | null {
  return EPISODE_STATUS.includes(status as EpisodeStatus) ? (status as EpisodeStatus) : null;
}

function allow(): GuardResult {
  return { allowed: true, disabledReason: null };
}

function deny(reason: string): GuardResult {
  return { allowed: false, disabledReason: reason };
}

export function getEpisodeActionState(action: EpisodeActionId, context: EpisodeActionContext): GuardResult {
  const status = normalizeStatus(context.status);
  if (!status) {
    return deny('Episode status is unknown. Please refresh.');
  }

  const hasPlayback = Boolean(context.hasPlayback);
  const slotsComplete = Boolean(context.slotsComplete);
  const hasActiveJobs = Boolean(context.hasActiveJobs);

  switch (action) {
    case 'edit_script':
    case 'generate_script':
      if (status === 'draft' || status === 'voiceover_uploaded' || status === 'voiceover_cleaning') {
        return allow();
      }
      return deny('Script editing is locked after voiceover cleanup starts.');

    case 'voiceover_capture':
      if (VOICEOVER_CAPTURE_STATUSES.includes(status)) {
        if (FINAL_STATUSES.includes(status)) {
          return deny('Voiceover actions are disabled after an episode is ready or published.');
        }
        return allow();
      }
      return deny('Voiceover actions are not available in the current pipeline stage.');

    case 'slot_collection':
      if (SLOT_COLLECTION_STATUSES.includes(status)) {
        if (hasActiveJobs) {
          return deny('Background processing is running. Wait for jobs to finish before editing slots.');
        }
        return allow();
      }
      return deny('Clip slots unlock after voiceover cleanup and before processing.');

    case 'start_processing':
      if (!START_PROCESSING_STATUSES.includes(status)) {
        return deny('Processing starts only after voiceover cleanup and clip collection.');
      }
      if (!slotsComplete) {
        return deny('Complete required clip slots before starting processing.');
      }
      if (hasActiveJobs) {
        return deny('Processing is already running for this episode.');
      }
      return allow();

    case 'request_render':
      if (status !== 'cut_plan_ready') {
        return deny('Render can be requested only when the cut plan is ready.');
      }
      if (hasActiveJobs) {
        return deny('Wait for active jobs to finish before requesting render.');
      }
      return allow();

    case 'processing_timeline':
      if (hasActiveJobs) {
        return allow();
      }
      if (PROCESSING_TIMELINE_STATUSES.includes(status)) {
        return allow();
      }
      return deny('Processing timeline appears once processing begins.');

    case 'preview':
      if (!FINAL_STATUSES.includes(status)) {
        return deny('Preview is available only when the episode is ready or published.');
      }
      if (!hasPlayback) {
        return deny('Final playback URL is not available yet.');
      }
      return allow();

    default:
      return deny('Action unavailable.');
  }
}

export function getEpisodeActionMatrix(context: EpisodeActionContext): Record<EpisodeActionId, GuardResult> {
  return {
    edit_script: getEpisodeActionState('edit_script', context),
    generate_script: getEpisodeActionState('generate_script', context),
    voiceover_capture: getEpisodeActionState('voiceover_capture', context),
    slot_collection: getEpisodeActionState('slot_collection', context),
    start_processing: getEpisodeActionState('start_processing', context),
    request_render: getEpisodeActionState('request_render', context),
    processing_timeline: getEpisodeActionState('processing_timeline', context),
    preview: getEpisodeActionState('preview', context),
  };
}

export function canStartProcessing(status: string, slotsComplete: boolean, hasActiveJobs = false): GuardResult {
  return getEpisodeActionState('start_processing', { status, slotsComplete, hasActiveJobs });
}

export function canRequestRender(status: string, hasActiveJobs = false): GuardResult {
  return getEpisodeActionState('request_render', { status, hasActiveJobs });
}

export function canViewFinal(status: string, hasPlayback: boolean): GuardResult {
  return getEpisodeActionState('preview', { status, hasPlayback });
}

export function isTerminalEpisodeStatus(status: string): boolean {
  return status === 'ready' || status === 'published' || status === 'failed';
}

export function sortJobsByPipelineOrder<T extends { type: string }>(jobs: T[]): T[] {
  return [...jobs].sort((a, b) => {
    const aIndex = PIPELINE_JOB_ORDER.indexOf(a.type as PipelineJobType);
    const bIndex = PIPELINE_JOB_ORDER.indexOf(b.type as PipelineJobType);

    if (aIndex === -1 && bIndex === -1) return 0;
    if (aIndex === -1) return 1;
    if (bIndex === -1) return -1;
    return aIndex - bIndex;
  });
}

/**
 * Determines which UI sections should be visible based on current pipeline step.
 * Used by the episode detail screen to show only relevant sections.
 */
export interface VisibleSections {
  script: boolean;
  voiceover: boolean;
  voiceoverPreview: boolean;
  clips: boolean;
  processing: boolean;
  render: boolean;
  finalPreview: boolean;
  recovery: boolean;
  phaseIndicator: boolean;
}

export function getVisibleSections(status: EpisodeStatus): VisibleSections {
  const step = STATUS_TO_STEP[status] || 'script';

  return {
    // Script editing: only in draft
    script: step === 'script',
    // Voiceover actions: only in script phase (to record) — not after voiceover is done
    voiceover: step === 'script',
    // Voiceover preview (read-only player): after voiceover exists through clips phase
    voiceoverPreview: step === 'voiceover' || step === 'clips',
    // Clip management: only in clips phase
    clips: step === 'clips',
    // Processing view: during processing
    processing: step === 'processing',
    // Render button: during processing (specifically at cut_plan_ready)
    render: status === 'cut_plan_ready',
    // Final preview: when ready/published
    finalPreview: step === 'final',
    // Recovery actions: when failed
    recovery: step === 'recovery',
    // Phase indicator: during voiceover processing, clip processing, matching, rendering
    phaseIndicator: step === 'voiceover' || step === 'clips' || step === 'processing' || step === 'final',
  };
}

// ─── Phase grouping utilities for clean UI ────────────────────────────

export const PHASE_LABELS: Record<number, string> = {
  1: 'Voiceover',
  2: 'Clips & Chunks',
  3: 'Matching',
  4: 'Cut Plan',
  5: 'Render & Publish',
};

export const PHASE_COLORS: Record<number, string> = {
  1: '#0EA5A8',
  2: '#2E76C9',
  3: '#665BCB',
  4: '#2F8E38',
  5: '#CC7A00',
};

const JOB_TYPE_TO_PHASE: Record<string, number> = {
  voiceover_ingest: 1,
  voiceover_transcript: 1,
  voiceover_transcript_correction: 1,
  voiceover_take_selection: 1,
  voiceover_silence_detection: 1,
  voiceover_cleaning: 1,
  voiceover_segmentation: 1,
  broll_ingest: 2,
  broll_chunking: 2,
  broll_chunk_ingest: 2,
  slot_clip_enrichment: 2,
  broll_chunk_enrichment: 2,
  broll_chunk_embedding: 2,
  aroll_chunk_transcript: 2,
  chunk_refinement: 2,
  semantic_matching: 3,
  creative_edit_plan: 4,
  cut_plan_generation: 4,
  cut_plan_validation: 4,
  ffmpeg_render_microcut_v2: 5,
  mux_publish: 5,
};

export function getJobPhase(jobType: string): number {
  return JOB_TYPE_TO_PHASE[jobType] ?? 0;
}

export interface PhaseJobSummary {
  phase: number;
  label: string;
  color: string;
  latestJob: { type: string; status: string; progress: number; errorMessage?: string | null; updatedAt: string } | null;
  status: 'idle' | 'active' | 'done' | 'error';
  totalJobs: number;
  activeCount: number;
  failedCount: number;
  doneCount: number;
}

export function groupJobsByPhase<
  T extends { type: string; status: string; progress: number; updatedAt: string; errorMessage?: string | null },
>(jobs: T[]): PhaseJobSummary[] {
  const phases: PhaseJobSummary[] = [1, 2, 3, 4, 5].map((p) => ({
    phase: p,
    label: PHASE_LABELS[p],
    color: PHASE_COLORS[p],
    latestJob: null,
    status: 'idle' as const,
    totalJobs: 0,
    activeCount: 0,
    failedCount: 0,
    doneCount: 0,
  }));

  for (const job of jobs) {
    const phaseNum = getJobPhase(job.type);
    if (phaseNum < 1 || phaseNum > 5) continue;
    const s = phases[phaseNum - 1];
    s.totalJobs++;
    if (job.status === 'pending' || job.status === 'processing') s.activeCount++;
    else if (job.status === 'error') s.failedCount++;
    else if (job.status === 'done') s.doneCount++;
    if (!s.latestJob || new Date(job.updatedAt) > new Date(s.latestJob.updatedAt)) {
      s.latestJob = job;
    }
  }

  for (const s of phases) {
    if (s.failedCount > 0) s.status = 'error';
    else if (s.activeCount > 0) s.status = 'active';
    else if (s.totalJobs > 0 && s.doneCount === s.totalJobs) s.status = 'done';
    else if (s.totalJobs > 0) s.status = 'active';
  }

  return phases;
}
