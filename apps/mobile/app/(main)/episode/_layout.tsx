/**
 * Episode Layout
 *
 * Stack navigation for episode-related screens.
 */

import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';
import { headerPresets } from '@/lib/navigation/headerPresets';

export default function EpisodeLayout() {
  return (
    <Stack
      screenOptions={{
        ...headerPresets.default,
        headerShown: true,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="new" options={{ title: 'Create Episode' }} />
      <Stack.Screen name="[id]/index" options={{ title: 'Episode' }} />
      <Stack.Screen name="[id]/record" options={{ title: 'Voiceover' }} />
      <Stack.Screen name="[id]/upload" options={{ title: 'Bulk Import' }} />
      <Stack.Screen name="[id]/slots" options={{ title: 'Clip Slots' }} />
      <Stack.Screen name="[id]/slots/[slotId]/record" options={{ title: 'Record Slot' }} />
      <Stack.Screen name="[id]/slots/[slotId]/upload" options={{ title: 'Upload Slot' }} />
      <Stack.Screen name="[id]/processing" options={{ title: 'Processing' }} />
      <Stack.Screen name="[id]/preview" options={{ title: 'Preview' }} />
    </Stack>
  );
}
