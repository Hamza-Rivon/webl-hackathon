/**
 * Expo App Configuration
 *
 * This file extends app.json with dynamic configuration.
 * Use this for environment-specific settings.
 */

import { ExpoConfig, ConfigContext } from 'expo/config';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'WEBL',
  slug: 'webl',
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/AppIcons/appstore-flat.png',
  scheme: 'webl',
  userInterfaceStyle: 'automatic',
  splash: {
    image: './assets/webl-logo.png',
    resizeMode: 'contain',
    backgroundColor: '#050507',
  },
  ios: {
    icon: './assets/AppIcons/appstore-flat.png',
    supportsTablet: false,
    bundleIdentifier: 'com.webl.ai',
    infoPlist: {
      NSCameraUsageDescription:
        'WEBL needs camera access to record videos for your content',
      NSMicrophoneUsageDescription:
        'WEBL needs microphone access to record voiceovers and audio',
      NSPhotoLibraryUsageDescription:
        'WEBL needs photo library access to import your video clips',
      NSPhotoLibraryAddUsageDescription:
        'WEBL needs permission to save your exported videos',
      ITSAppUsesNonExemptEncryption: false,
      NSAppTransportSecurity: {
        // Dev-only behavior: allow HTTP API calls to non-TLS endpoints.
        // Move API to HTTPS and set this back to false for production.
        NSAllowsArbitraryLoads: true,
      },
    },
  },
  android: {
    adaptiveIcon: {
      foregroundImage: './assets/AppIcons/playstore.png',
      backgroundColor: '#050507',
    },
    package: 'com.webl.ai',
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_EXTERNAL_STORAGE',
      'android.permission.WRITE_EXTERNAL_STORAGE',
    ],
  },
  web: {
    bundler: 'metro',
    output: 'static',
    favicon: './assets/AppIcons/appstore-flat.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/webl-logo.png',
        imageWidth: 220,
        resizeMode: 'contain',
        backgroundColor: '#050507',
      },
    ],
    'expo-asset',
    'expo-secure-store',
    [
      'expo-camera',
      {
        cameraPermission: 'Allow WEBL to access your camera to record videos.',
      },
    ],
    [
      'expo-audio',
      {
        microphonePermission:
          'Allow WEBL to access your microphone to record audio.',
      },
    ],
    [
      'expo-video',
      {
        supportsPictureInPicture: true,
        supportsBackgroundPlayback: true,
      },
    ],
    [
      'expo-image-picker',
      {
        photosPermission:
          'Allow WEBL to access your photos to import video clips.',
      },
    ],
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    apiUrl: process.env.EXPO_PUBLIC_API_URL || process.env.API_URL || 'http://localhost:3000',
    eas: {
      projectId: process.env.EAS_PROJECT_ID || 'c8d5d1b1-539d-4a89-89df-6a6dcd7e2ef7',
    },
  },
});
