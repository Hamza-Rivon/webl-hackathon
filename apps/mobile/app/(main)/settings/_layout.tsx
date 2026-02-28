/**
 * Settings Layout
 *
 * Stack navigation for settings-related screens.
 */

import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';
import { headerPresets } from '@/lib/navigation/headerPresets';

export default function SettingsLayout() {
  return (
    <Stack
      screenOptions={{
        ...headerPresets.default,
        headerShown: true,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="elevenlabs-voice" options={{ title: 'ElevenLabs Voice' }} />
    </Stack>
  );
}
