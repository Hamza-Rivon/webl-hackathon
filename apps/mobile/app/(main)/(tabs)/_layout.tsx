import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { borderRadius, spacing, typography } from '@/lib/theme';
import { useTheme } from '@/contexts/ThemeContext';
import { triggerHaptic } from '@/lib/haptics';

function TabIcon({ focused, name, isDark }: { focused: boolean; name: keyof typeof Ionicons.glyphMap; isDark: boolean }) {
  const activeColor = isDark ? '#5CF6FF' : '#0EA5A8';
  const inactiveColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)';
  return (
    <View style={[styles.iconWrap, focused && { backgroundColor: isDark ? 'rgba(92,246,255,0.1)' : 'rgba(14,165,168,0.1)' }]}>
      <Ionicons name={name} size={20} color={focused ? activeColor : inactiveColor} />
    </View>
  );
}

export default function TabLayout() {
  const router = useRouter();
  const { isDark } = useTheme();

  const activeColor = isDark ? '#5CF6FF' : '#0EA5A8';
  const inactiveColor = isDark ? 'rgba(255,255,255,0.45)' : 'rgba(0,0,0,0.35)';

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarBackground: () => (
          <BlurView
            intensity={isDark ? 40 : 60}
            tint={isDark ? 'dark' : 'light'}
            style={[
              styles.tabBarGlass,
              {
                backgroundColor: isDark
                  ? 'rgba(10, 14, 20, 0.85)'
                  : 'rgba(255, 255, 255, 0.88)',
              },
            ]}
          />
        ),
        tabBarLabelStyle: styles.label,
        tabBarActiveTintColor: activeColor,
        tabBarInactiveTintColor: inactiveColor,
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="home-outline" isDark={isDark} />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="play-circle-outline" isDark={isDark} />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarButton: () => (
            <View style={styles.createButtonSlot} pointerEvents="box-none">
              <Pressable
                style={({ pressed }) => [
                  styles.createButton,
                  {
                    backgroundColor: isDark ? '#5CF6FF' : '#0EA5A8',
                    shadowColor: isDark ? '#5CF6FF' : '#0EA5A8',
                  },
                  pressed && styles.createButtonPressed,
                ]}
                onPress={() => {
                  triggerHaptic('medium');
                  router.push('/(main)/episode/new');
                }}
                accessibilityRole="button"
                accessibilityLabel="Create episode"
              >
                <Ionicons name="add" size={24} color={isDark ? '#000' : '#FFFFFF'} />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="pulse-outline" isDark={isDark} />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="person-outline" isDark={isDark} />,
        }}
      />
      <Tabs.Screen name="series" options={{ href: null }} />
      <Tabs.Screen name="templates" options={{ href: null }} />
    </Tabs>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    backgroundColor: 'transparent',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.04)',
    height: Platform.OS === 'ios' ? 88 : 72,
    paddingTop: spacing.xs,
    paddingBottom: Platform.OS === 'ios' ? spacing.sm : spacing.xs,
    paddingHorizontal: spacing.xs,
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    elevation: 0,
  },
  tabBarGlass: {
    ...StyleSheet.absoluteFillObject,
  },
  label: {
    fontFamily: typography.fontFamily.body,
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold as any,
    letterSpacing: 0.3,
  },
  tabItem: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 2,
  },
  iconWrap: {
    width: 36,
    height: 28,
    borderRadius: borderRadius.full,
    justifyContent: 'center',
    alignItems: 'center',
  },
  createButtonSlot: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -10,
  },
  createButton: {
    width: 54,
    height: 54,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  createButtonPressed: {
    transform: [{ scale: 0.92 }],
    opacity: 0.9,
  },
});
