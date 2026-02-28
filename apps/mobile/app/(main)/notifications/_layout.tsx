import { Stack } from 'expo-router';
import { headerPresets } from '@/lib/navigation/headerPresets';

export default function NotificationsLayout() {
  return (
    <Stack screenOptions={{ ...headerPresets.default, headerShown: true }}>
      <Stack.Screen name="index" options={{ title: 'Notifications' }} />
    </Stack>
  );
}
