/**
 * App notification service.
 * Stores persistent in-app notifications and surfaces immediate native feedback.
 */

import { Alert, Platform, ToastAndroid } from 'react-native';
import { triggerHaptic } from './haptics';
import { useNotificationStore, type AppNotificationType } from '@/stores/notifications';

export type NotificationType = AppNotificationType;

export interface NotificationOptions {
  title: string;
  body: string;
  type?: NotificationType;
  route?: string;
  category?: 'job' | 'pipeline' | 'system' | 'export';
  immediate?: boolean;
  metadata?: Record<string, unknown>;
}

export async function requestNotificationPermissions(): Promise<boolean> {
  return true;
}

function normalizeImmediate(options: NotificationOptions): boolean {
  return options.immediate !== false;
}

function notifyNative(title: string, body: string) {
  if (Platform.OS === 'android') {
    ToastAndroid.showWithGravity(`${title}: ${body}`, ToastAndroid.LONG, ToastAndroid.TOP);
    return;
  }
  Alert.alert(title, body, [{ text: 'OK', style: 'default' }]);
}

async function notifyHaptic(type: NotificationType) {
  if (type === 'success') {
    await triggerHaptic('success');
    return;
  }
  if (type === 'error') {
    await triggerHaptic('error');
    return;
  }
  if (type === 'warning') {
    await triggerHaptic('warning');
    return;
  }
  await triggerHaptic('light');
}

export async function showNotification(options: NotificationOptions): Promise<void> {
  const type = options.type || 'info';

  useNotificationStore.getState().add({
    type,
    title: options.title,
    body: options.body,
    route: options.route,
    category: options.category,
    metadata: options.metadata,
  });

  await notifyHaptic(type);

  if (normalizeImmediate(options)) {
    notifyNative(options.title, options.body);
  }
}

export async function showJobCompletionNotification(
  jobType: string,
  success: boolean,
  episodeTitle?: string,
  route?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  const jobLabels: Record<string, string> = {
    voiceover_ingest: 'Voiceover Upload',
    voiceover_transcript: 'Voiceover Transcription',
    voiceover_transcript_correction: 'Transcript Correction',
    voiceover_take_selection: 'Take Selection',
    voiceover_silence_detection: 'Silence Detection',
    voiceover_cleaning: 'Audio Cleaning',
    voiceover_segmentation: 'Voiceover Segmentation',
    broll_ingest: 'Clip Processing',
    broll_chunking: 'Chunking Clips',
    broll_chunk_ingest: 'Chunk Upload',
    slot_clip_enrichment: 'Clip Enrichment',
    broll_chunk_enrichment: 'Chunk Enrichment',
    broll_chunk_embedding: 'Chunk Embedding',
    aroll_chunk_transcript: 'A-Roll Transcription',
    chunk_refinement: 'Chunk Refinement',
    semantic_matching: 'Matching Clips',
    creative_edit_plan: 'Creative Edit Plan',
    cut_plan_generation: 'Cut Plan Generation',
    cut_plan_validation: 'Cut Plan Validation',
    ffmpeg_render_microcut_v2: 'Final Render',
    mux_publish: 'Publishing Video',
  };

  const jobLabel = jobLabels[jobType] || jobType.replaceAll('_', ' ');
  const episodeSuffix = episodeTitle ? ` for "${episodeTitle}"` : '';

  if (success) {
    await showNotification({
      title: `${jobLabel} complete`,
      body: `Your ${jobLabel.toLowerCase()}${episodeSuffix} finished successfully.`,
      type: 'success',
      route,
      category: 'job',
      metadata: { jobType, success, ...metadata },
      immediate: false,
    });
    return;
  }

  await showNotification({
    title: `${jobLabel} failed`,
    body: `Your ${jobLabel.toLowerCase()}${episodeSuffix} failed. Tap to inspect and retry.`,
    type: 'error',
    route,
    category: 'job',
    metadata: { jobType, success, ...metadata },
    immediate: false,
  });
}

export async function showVideoReadyNotification(
  episodeTitle: string,
  route?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  await showNotification({
    title: 'Video ready',
    body: `"${episodeTitle}" is rendered and ready to preview.`,
    type: 'success',
    route,
    category: 'pipeline',
    metadata,
    immediate: false,
  });
}

export async function cancelAllNotifications(): Promise<void> {
  useNotificationStore.getState().clear();
}

export async function getBadgeCount(): Promise<number> {
  return useNotificationStore.getState().unreadCount;
}

export async function setBadgeCount(_count: number): Promise<void> {
  // no-op for now, system app badges are not wired.
}

export function useNotificationListeners(
  _onNotificationReceived?: (notification: unknown) => void,
  _onNotificationResponse?: (response: unknown) => void
) {
  // no-op placeholder for push integration.
}

export default {
  requestNotificationPermissions,
  showNotification,
  showJobCompletionNotification,
  showVideoReadyNotification,
  cancelAllNotifications,
  getBadgeCount,
  setBadgeCount,
  useNotificationListeners,
};
