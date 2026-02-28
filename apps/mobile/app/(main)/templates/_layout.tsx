/**
 * Templates Stack Layout
 *
 * Stack navigation for template detail screens.
 * Requirements: 8.6
 */

import { Stack } from 'expo-router';
import { colors } from '@/lib/theme';
import { headerPresets } from '@/lib/navigation/headerPresets';

export default function TemplatesLayout() {
  return (
    <Stack
      screenOptions={{
        ...headerPresets.default,
        headerShown: true,
        contentStyle: { backgroundColor: colors.background },
      }}
    >
      <Stack.Screen name="[id]" options={{ title: 'Template' }} />
    </Stack>
  );
}
