const MUX_STREAM_BASE = 'https://stream.mux.com';
const MUX_IMAGE_BASE = 'https://image.mux.com';

export const QUALITY_OPTIONS = ['auto', '1080p', '720p', '480p', '360p'] as const;
export const PLAYBACK_SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

export type QualityValue = (typeof QUALITY_OPTIONS)[number];

export function getMuxStreamUrl(playbackId: string): string {
  if (playbackId.startsWith('http://') || playbackId.startsWith('https://') || playbackId.startsWith('file://')) {
    return playbackId;
  }
  return `${MUX_STREAM_BASE}/${playbackId}.m3u8`;
}

export function getMuxThumbnailUrl(
  playbackId: string,
  options?: { width?: number; height?: number; time?: number; fit?: 'preserve' | 'crop' | 'smartcrop' }
): string {
  if (!playbackId) return '';
  if (playbackId.startsWith('http://') || playbackId.startsWith('https://') || playbackId.startsWith('file://')) {
    return playbackId;
  }

  const params = new URLSearchParams();
  if (options?.width) params.append('width', options.width.toString());
  if (options?.height) params.append('height', options.height.toString());
  if (options?.time !== undefined) params.append('time', options.time.toString());
  if (options?.fit) params.append('fit', options.fit);

  const query = params.toString();
  return `${MUX_IMAGE_BASE}/${playbackId}/thumbnail.jpg${query ? `?${query}` : ''}`;
}

export function getMuxGifUrl(
  playbackId: string,
  options?: { width?: number; fps?: number; start?: number; end?: number }
): string {
  if (!playbackId) return '';
  if (playbackId.startsWith('http://') || playbackId.startsWith('https://') || playbackId.startsWith('file://')) {
    return playbackId;
  }

  const params = new URLSearchParams();
  if (options?.width) params.append('width', options.width.toString());
  if (options?.fps) params.append('fps', options.fps.toString());
  if (options?.start !== undefined) params.append('start', options.start.toString());
  if (options?.end !== undefined) params.append('end', options.end.toString());

  const query = params.toString();
  return `${MUX_IMAGE_BASE}/${playbackId}/animated.gif${query ? `?${query}` : ''}`;
}

export function formatPlaybackTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function applyMuxQuality(streamUrl: string, quality: QualityValue): string {
  if (quality === 'auto') return streamUrl;
  if (!streamUrl.includes('stream.mux.com') || !streamUrl.includes('.m3u8')) return streamUrl;

  try {
    const parsed = new URL(streamUrl);
    parsed.searchParams.set('max_resolution', quality);
    return parsed.toString();
  } catch {
    const joiner = streamUrl.includes('?') ? '&' : '?';
    return `${streamUrl}${joiner}max_resolution=${quality}`;
  }
}
