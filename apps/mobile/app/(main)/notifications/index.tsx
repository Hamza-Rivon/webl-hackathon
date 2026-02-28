import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FlashList } from '@shopify/flash-list';
import { useNavigation, useRouter } from 'expo-router';
import { AdaptiveGlass, Button, Card, EmptyState, Screen, StickyActionBar } from '@/components/ui';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { useNotificationStore, type AppNotification } from '@/stores/notifications';
import { colors, spacing, typography, borderRadius } from '@/lib/theme';
import { trackPrimaryAction, trackScreenView } from '@/lib/analytics';

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  const deltaMs = Date.now() - date.getTime();
  const deltaMinutes = Math.floor(deltaMs / 60000);

  if (deltaMinutes < 1) return 'just now';
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`;

  const deltaHours = Math.floor(deltaMinutes / 60);
  if (deltaHours < 24) return `${deltaHours}h ago`;

  const deltaDays = Math.floor(deltaHours / 24);
  if (deltaDays < 7) return `${deltaDays}d ago`;

  return date.toLocaleDateString();
}

function typeIcon(type: AppNotification['type']) {
  if (type === 'success') return 'checkmark-circle-outline';
  if (type === 'error') return 'alert-circle-outline';
  if (type === 'warning') return 'warning-outline';
  return 'notifications-outline';
}

function typeColor(type: AppNotification['type']) {
  if (type === 'success') return colors.success;
  if (type === 'error') return colors.error;
  if (type === 'warning') return colors.warning;
  return colors.info;
}

function normalizeRoute(route: string): string {
  const trimmed = route.trim();
  if (!trimmed) return '/(main)/(tabs)/home';
  if (/^[a-z]+:\/\//i.test(trimmed)) {
    return '/(main)/(tabs)/home';
  }
  return trimmed.startsWith('/') ? trimmed : `/${trimmed}`;
}

export default function NotificationsScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const { items, unreadCount, markRead, markAllRead, remove, clear } = useNotificationStore();

  const handleClose = () => {
    if (navigation.canGoBack()) {
      router.back();
      return;
    }
    router.replace('/(main)/(tabs)/home');
  };
  const handleHome = () => {
    router.replace('/(main)/(tabs)/home');
  };

  useEffect(() => {
    trackScreenView('notifications');
  }, []);

  const renderItem = ({ item }: { item: AppNotification }) => {
    const onOpen = () => {
      markRead(item.id);
      trackPrimaryAction('open_notification', { id: item.id, route: item.route, type: item.type });
      if (item.route) {
        router.push(normalizeRoute(item.route) as never);
      }
    };

    return (
      <Pressable onPress={onOpen} style={({ pressed }) => [pressed && styles.pressed]}>
        <Card variant={item.read ? 'default' : 'pastelBlue'} style={styles.notificationCard}>
          <View style={styles.notificationTopRow}>
            <View style={styles.iconWrap}>
              <Ionicons name={typeIcon(item.type) as any} size={18} color={typeColor(item.type)} />
            </View>
            <View style={styles.contentWrap}>
              <Text style={styles.titleText}>{item.title}</Text>
              <Text style={styles.bodyText}>{item.body}</Text>
              <Text style={styles.metaText}>{formatTimestamp(item.createdAt)}</Text>
            </View>
            {!item.read ? <View style={styles.unreadDot} /> : null}
          </View>
          <View style={styles.cardActions}>
            <Button variant="ghost" size="sm" onPress={() => remove(item.id)} style={styles.actionButton}>
              Dismiss
            </Button>
            {item.route ? (
              <Button variant="outline" size="sm" onPress={onOpen} style={styles.actionButton}>
                Open
              </Button>
            ) : null}
          </View>
        </Card>
      </Pressable>
    );
  };

  const header = (
    <AdaptiveGlass style={styles.headerGlass} blurIntensity={18} tintColor="#FFFFFFB8">
      <View style={styles.headerRow}>
        <View>
          <Text style={styles.title}>Notifications</Text>
          <Text style={styles.subtitle}>{unreadCount} unread</Text>
        </View>
        <View style={styles.headerActions}>
          <Button variant="outline" size="sm" fullWidth={false} onPress={() => markAllRead()} style={styles.markAllButton}>
            Mark all read
          </Button>
          <Button
            variant="ghost"
            size="sm"
            fullWidth={false}
            onPress={() => {
              trackPrimaryAction('notifications_dismiss_all');
              clear();
            }}
            style={styles.dismissAllButton}
          >
            Dismiss all
          </Button>
        </View>
      </View>
    </AdaptiveGlass>
  );

  return (
    <View style={styles.root}>
      <Screen scroll={false} topInset={false}>
        {items.length === 0 ? (
          <View style={styles.content}>
            {header}
            <EmptyState
              title="No notifications"
              description="Pipeline updates, failures, and export updates will appear here."
              icon={<Ionicons name="notifications-outline" size={44} color={colors.primary.DEFAULT} />}
            />
          </View>
        ) : (
          <FlashList
            data={items}
            renderItem={renderItem}
            keyExtractor={(item) => item.id}
            ListHeaderComponent={header}
            contentContainerStyle={[styles.content, styles.listContent]}
            showsVerticalScrollIndicator={false}
          />
        )}
      </Screen>
      <StickyActionBar>
        <Button variant="ghost" onPress={handleClose}>
          Back
        </Button>
        <Button onPress={handleHome}>
          Home
        </Button>
      </StickyActionBar>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: colors.background,
  },
  content: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.lg,
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.md,
  },
  headerGlass: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: borderRadius.lg,
    padding: spacing.md,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    marginTop: spacing.xs,
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    flexShrink: 0,
  },
  markAllButton: {
    width: 'auto',
    minWidth: 124,
  },
  dismissAllButton: {
    width: 'auto',
    minWidth: 116,
  },
  listContent: {
    gap: spacing.sm,
    paddingBottom: spacing['6xl'],
  },
  notificationCard: {
    padding: spacing.md,
  },
  notificationTopRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  iconWrap: {
    width: 26,
    height: 26,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 2,
  },
  contentWrap: {
    flex: 1,
    gap: 3,
  },
  titleText: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    fontWeight: typography.fontWeight.semibold,
  },
  bodyText: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    lineHeight: 19,
  },
  metaText: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.xs,
  },
  unreadDot: {
    width: 8,
    height: 8,
    borderRadius: 999,
    backgroundColor: colors.primary.DEFAULT,
    marginTop: spacing.xs,
  },
  cardActions: {
    marginTop: spacing.sm,
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  actionButton: {
    minWidth: 82,
    width: 'auto',
  },
  pressed: {
    opacity: 0.9,
  },
});
