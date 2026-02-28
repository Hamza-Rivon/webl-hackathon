import { StyleProp, ViewStyle } from 'react-native';

export interface VideoPlaybackStatusSnapshot {
  status: 'idle' | 'loading' | 'readyToPlay' | 'error';
  isPlaying: boolean;
  isBuffering: boolean;
  currentTime: number;
  duration: number;
  error?: string;
}

export interface VideoPlayerProps {
  uri?: string;
  muxPlaybackId?: string;
  posterUri?: string;
  duration?: number;
  autoPlay?: boolean;
  loop?: boolean;
  showControls?: boolean;
  muted?: boolean;
  aspectRatio?: number;
  contentFit?: 'contain' | 'cover';
  enableThumbnailScrubbing?: boolean;
  enableQualitySelector?: boolean;
  enablePlaybackSpeed?: boolean;
  enableFullscreen?: boolean;
  enableCaptions?: boolean;
  chapters?: Array<{ time: number; title: string }>;
  onEnd?: () => void;
  onPlaybackStatusUpdate?: (status: VideoPlaybackStatusSnapshot) => void;
  onLoad?: (duration: number) => void;
  onError?: (error: string) => void;
  style?: StyleProp<ViewStyle>;
}

export interface VideoPlayerRef {
  play: () => Promise<void>;
  pause: () => Promise<void>;
  seekTo: (position: number) => Promise<void>;
  replay: () => Promise<void>;
}
