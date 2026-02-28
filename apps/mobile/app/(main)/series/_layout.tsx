/**
 * Series Layout
 *
 * Stack navigation for series-related screens.
 */

import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';
import { headerPresets } from '@/lib/navigation/headerPresets';

export default function SeriesLayout() {
  return (
    <Stack
      screenOptions={{
        ...headerPresets.default,
        headerShown: true,
        contentStyle: { backgroundColor: colors.background },
        animation: 'slide_from_right',
      }}
    >
      <Stack.Screen name="new" options={{ title: 'New Series' }} />
      <Stack.Screen name="[id]/index" options={{ title: 'Series' }} />
      <Stack.Screen name="[id]/edit" options={{ title: 'Edit Series' }} />
    </Stack>
  );
}
