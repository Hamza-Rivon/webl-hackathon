/**
 * Jobs Layout
 *
 * Stack layout for job progress screens.
 */

import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';
import { headerPresets } from '@/lib/navigation/headerPresets';

export default function JobsLayout() {
  return (
    <Stack
      screenOptions={{
        ...headerPresets.default,
        headerShown: true,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="index" options={{ title: 'Activity' }} />
    </Stack>
  );
}
