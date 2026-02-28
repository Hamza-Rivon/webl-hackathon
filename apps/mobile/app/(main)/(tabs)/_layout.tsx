import { Tabs, useRouter } from 'expo-router';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { Platform, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { borderRadius, spacing, typography } from '@/lib/theme';
import { triggerHaptic } from '@/lib/haptics';

function TabIcon({ focused, name }: { focused: boolean; name: keyof typeof Ionicons.glyphMap }) {
  return (
    <View style={[styles.iconWrap, focused && styles.iconWrapActive]}>
      <Ionicons name={name} size={20} color={focused ? '#5CF6FF' : 'rgba(255,255,255,0.45)'} />
    </View>
  );
}

export default function TabLayout() {
  const router = useRouter();

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabItem,
        tabBarBackground: () => (
          <BlurView intensity={40} tint="dark" style={styles.tabBarGlass} />
        ),
        tabBarLabelStyle: styles.label,
        tabBarActiveTintColor: '#5CF6FF',
        tabBarInactiveTintColor: 'rgba(255,255,255,0.45)',
        tabBarHideOnKeyboard: true,
      }}
    >
      <Tabs.Screen
        name="home"
        options={{
          title: 'Home',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="home-outline" />,
        }}
      />
      <Tabs.Screen
        name="feed"
        options={{
          title: 'Feed',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="play-circle-outline" />,
        }}
      />
      <Tabs.Screen
        name="create"
        options={{
          title: 'Create',
          tabBarButton: () => (
            <View style={styles.createButtonSlot} pointerEvents="box-none">
              <Pressable
                style={({ pressed }) => [styles.createButton, pressed && styles.createButtonPressed]}
                onPress={() => {
                  triggerHaptic('medium');
                  router.push('/(main)/episode/new');
                }}
                accessibilityRole="button"
                accessibilityLabel="Create episode"
              >
                <Ionicons name="add" size={24} color="#000" />
              </Pressable>
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="jobs"
        options={{
          title: 'Activity',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="pulse-outline" />,
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profile',
          tabBarIcon: ({ focused }) => <TabIcon focused={focused} name="person-outline" />,
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
    borderTopColor: 'rgba(255,255,255,0.06)',
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
    backgroundColor: 'rgba(10, 14, 20, 0.85)',
  },
  label: {
    fontFamily: typography.fontFamily.body,
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
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
  iconWrapActive: {
    backgroundColor: 'rgba(92,246,255,0.1)',
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
    backgroundColor: '#5CF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5CF6FF',
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
