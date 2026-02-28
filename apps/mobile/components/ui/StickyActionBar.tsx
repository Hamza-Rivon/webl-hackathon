import React, { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { usePathname, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@/components/ui/SymbolIcon';
import { borderRadius, colors, spacing, typography } from '@/lib/theme';
import { AdaptiveGlass } from './AdaptiveGlass';
import { Button } from './Button';

interface StickyActionBarProps {
  children: React.ReactNode;
  showQuickNav?: boolean;
  maxInlineActions?: number;
}

const QUICK_NAV_ITEMS = [
  { key: 'home', label: 'Home', icon: 'home-outline', href: '/(main)/(tabs)/home' },
  { key: 'feed', label: 'Feed', icon: 'play-circle-outline', href: '/(main)/(tabs)/feed' },
  { key: 'create', label: 'Create', icon: 'add', href: '/(main)/episode/new' },
  { key: 'activity', label: 'Activity', icon: 'pulse-outline', href: '/(main)/(tabs)/jobs' },
  { key: 'profile', label: 'Profile', icon: 'person-outline', href: '/(main)/(tabs)/profile' },
] as const;

function getActiveQuickNavKey(pathname: string) {
  if (pathname.includes('/(tabs)/home') || pathname === '/home' || pathname === '/') return 'home';
  if (pathname.includes('/(tabs)/feed') || pathname === '/feed') return 'feed';
  if (pathname.includes('/episode/new')) return 'create';
  if (pathname.includes('/(tabs)/jobs') || pathname.includes('/jobs')) return 'activity';
  if (pathname.includes('/(tabs)/profile') || pathname.includes('/settings') || pathname.includes('/onboarding')) return 'profile';
  return null;
}

function isButtonElement(element: React.ReactElement): boolean {
  const maybeType = element.type as { displayName?: string; name?: string };
  return maybeType?.displayName === 'Button' || maybeType?.name === 'Button';
}

export function StickyActionBar({
  children,
  showQuickNav = true,
  maxInlineActions = 2,
}: StickyActionBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const insets = useSafeAreaInsets();
  const activeKey = getActiveQuickNavKey(pathname);
  const [overflowOpen, setOverflowOpen] = useState(false);

  const actions = useMemo(
    () =>
      React.Children.toArray(children).filter((child): child is React.ReactElement =>
        React.isValidElement(child)
      ),
    [children]
  );

  const safeInlineCount = Math.max(1, maxInlineActions);
  const inlineActions = actions.slice(0, safeInlineCount);
  const overflowActions = actions.slice(safeInlineCount);

  return (
    <>
      <AdaptiveGlass
        style={[
          styles.container,
          {
            paddingBottom: Math.max(insets.bottom, spacing.sm),
          },
        ]}
        glassEffectStyle="regular"
        tintColor="#FFFFFFB5"
        blurIntensity={26}
      >
        <View style={styles.row}>
          {inlineActions.map((action, index) => {
            if (isButtonElement(action)) {
              const actionElement = action as React.ReactElement<any>;
              const actionProps = actionElement.props as {
                style?: unknown;
                onPress?: (...args: unknown[]) => void;
                size?: 'sm' | 'md' | 'lg';
              };
              return React.cloneElement(actionElement, {
                key: action.key ?? `inline-action-${index}`,
                fullWidth: false,
                size: actionProps.size ?? 'sm',
                style: [styles.inlineActionButton, actionProps.style],
              });
            }

            return (
              <View key={action.key ?? `inline-generic-${index}`} style={styles.inlineActionButton}>
                {action}
              </View>
            );
          })}

          {overflowActions.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              fullWidth={false}
              style={styles.moreButton}
              leftIcon={<Ionicons name="ellipsis-horizontal" size={16} color={colors.text.DEFAULT} />}
              onPress={() => setOverflowOpen(true)}
            >
              More
            </Button>
          ) : null}
        </View>

        {showQuickNav ? (
          <>
            <View style={styles.divider} />
            <View style={styles.quickNavRow}>
              {QUICK_NAV_ITEMS.map((item) => {
                const active = activeKey === item.key;
                const isCreate = item.key === 'create';
                return (
                  <Pressable
                    key={item.key}
                    onPress={() => {
                      if (isCreate) {
                        router.push(item.href as never);
                        return;
                      }
                      router.replace(item.href as never);
                    }}
                    style={[
                      styles.quickNavButton,
                      active && !isCreate && styles.quickNavButtonActive,
                      isCreate && styles.quickNavCreate,
                    ]}
                    accessibilityRole="button"
                    accessibilityLabel={item.label}
                  >
                    <Ionicons
                      name={item.icon as any}
                      size={isCreate ? 18 : 17}
                      color={
                        isCreate
                          ? colors.text.inverse
                          : active
                            ? colors.primary.DEFAULT
                            : colors.text.light
                      }
                    />
                    <Text
                      style={[
                        styles.quickNavLabel,
                        active && styles.quickNavLabelActive,
                        isCreate && styles.quickNavLabelCreate,
                      ]}
                    >
                      {item.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}
      </AdaptiveGlass>

      <Modal visible={overflowOpen} transparent animationType="fade" onRequestClose={() => setOverflowOpen(false)}>
        <View style={styles.modalRoot}>
          <Pressable style={styles.modalBackdrop} onPress={() => setOverflowOpen(false)} />
          <View style={[styles.modalSheet, { paddingBottom: Math.max(insets.bottom, spacing.lg) }]}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>More Actions</Text>
              <Pressable onPress={() => setOverflowOpen(false)} style={styles.modalClose}>
                <Ionicons name="close" size={18} color={colors.text.DEFAULT} />
              </Pressable>
            </View>

            <View style={styles.modalActions}>
              {overflowActions.map((action, index) => {
                if (isButtonElement(action)) {
                  const actionElement = action as React.ReactElement<any>;
                  const actionProps = actionElement.props as {
                    style?: unknown;
                    onPress?: (...args: unknown[]) => void;
                    size?: 'sm' | 'md' | 'lg';
                  };
                  return React.cloneElement(actionElement, {
                    key: action.key ?? `overflow-action-${index}`,
                    fullWidth: true,
                    size: actionProps.size ?? 'sm',
                    style: [styles.modalActionButton, actionProps.style],
                    onPress: (...args: unknown[]) => {
                      setOverflowOpen(false);
                      actionProps.onPress?.(...args);
                    },
                  });
                }

                return (
                  <View key={action.key ?? `overflow-generic-${index}`} style={styles.modalActionButton}>
                    {action}
                  </View>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'nowrap',
    gap: spacing.sm,
  },
  inlineActionButton: {
    flex: 1,
    minWidth: 0,
  },
  moreButton: {
    width: 'auto',
    minWidth: 96,
  },
  divider: {
    marginTop: spacing.sm,
    marginBottom: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  quickNavRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'space-between',
    gap: spacing.xs,
  },
  quickNavButton: {
    flex: 1,
    minHeight: 40,
    borderRadius: borderRadius.md,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    paddingHorizontal: spacing.xs,
  },
  quickNavButtonActive: {
    backgroundColor: 'rgba(92,246,255,0.08)',
  },
  quickNavCreate: {
    flex: 0,
    width: 78,
    minHeight: 44,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.primary.dark,
    backgroundColor: colors.primary.DEFAULT,
    marginHorizontal: spacing.xs,
  },
  quickNavLabel: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: 10,
    fontWeight: typography.fontWeight.semibold,
  },
  quickNavLabelActive: {
    color: colors.primary.DEFAULT,
  },
  quickNavLabelCreate: {
    color: colors.text.inverse,
    fontWeight: typography.fontWeight.bold,
    textTransform: 'uppercase',
    letterSpacing: 0.35,
  },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalBackdrop: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(4, 8, 12, 0.42)',
  },
  modalSheet: {
    borderTopLeftRadius: borderRadius.xl,
    borderTopRightRadius: borderRadius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    paddingTop: spacing.md,
    paddingHorizontal: spacing.lg,
    gap: spacing.sm,
  },
  modalHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
  },
  modalClose: {
    width: 32,
    height: 32,
    borderRadius: borderRadius.full,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.panelAlt,
  },
  modalActions: {
    gap: spacing.sm,
  },
  modalActionButton: {
    width: '100%',
  },
});

export default StickyActionBar;
