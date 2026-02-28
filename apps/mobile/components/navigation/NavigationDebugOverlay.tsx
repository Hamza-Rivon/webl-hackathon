/**
 * Navigation Debug Overlay
 *
 * Development-only component that displays navigation state, metrics, and debugging information.
 * Can be toggled via environment variable or dev menu.
 *
 * Requirements: 13.6
 */

import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { useNavigationService } from '@/lib/navigation/NavigationServiceProvider';
import { useScreenContext } from '@/contexts/ScreenContext';
import { useNavigationStore } from '@/stores/navigation';
import { colors } from '@/lib/theme';

/**
 * Props for NavigationDebugOverlay
 */
interface NavigationDebugOverlayProps {
  /** Whether the overlay is visible */
  visible?: boolean;
  /** Callback when close button is pressed */
  onClose?: () => void;
}

/**
 * Navigation Debug Overlay Component
 *
 * Displays:
 * - Current screen
 * - Navigation stack
 * - Queue status
 * - isNavigating flag
 * - Performance metrics
 * - Recent conflicts
 * - Navigation history
 *
 * Requirements: 13.6
 */
export function NavigationDebugOverlay({
  visible = false,
  onClose,
}: NavigationDebugOverlayProps): React.ReactElement | null {
  const navigationService = useNavigationService();
  const screenContext = useScreenContext();
  const navigationStore = useNavigationStore();

  const [debugInfo, setDebugInfo] = useState(navigationService.getDebugInfo());
  const [metrics, setMetrics] = useState(navigationService.getMetrics());
  const [conflicts, setConflicts] = useState(navigationService.getConflicts());
  const [history, setHistory] = useState(navigationService.getNavigationHistory());

  // Update debug info periodically
  useEffect(() => {
    if (!visible) return;

    const interval = setInterval(() => {
      setDebugInfo(navigationService.getDebugInfo());
      setMetrics(navigationService.getMetrics());
      setConflicts(navigationService.getConflicts());
      setHistory(navigationService.getNavigationHistory());
    }, 500); // Update every 500ms

    return () => clearInterval(interval);
  }, [visible, navigationService]);

  if (!visible || !__DEV__) {
    return null;
  }

  return (
    <View style={styles.overlay}>
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.title}>Navigation Debug</Text>
          {onClose && (
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>✕</Text>
            </TouchableOpacity>
          )}
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator>
          {/* Current State */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Current State</Text>
            <DebugRow label="Current Screen" value={debugInfo.currentScreen || 'null'} />
            <DebugRow label="Is Navigating" value={debugInfo.isNavigating ? 'Yes' : 'No'} />
            <DebugRow label="Stack Size" value={String(debugInfo.stackSize)} />
            <DebugRow label="Queue Size" value={String(debugInfo.queueSize)} />
            <DebugRow label="User Active" value={screenContext.isUserActive ? 'Yes' : 'No'} />
            <DebugRow label="Can Navigate" value={screenContext.canNavigate ? 'Yes' : 'No'} />
            {screenContext.blockedReason && (
              <DebugRow label="Blocked Reason" value={screenContext.blockedReason} />
            )}
            {debugInfo.pendingAction && (
              <View style={styles.subSection}>
                <Text style={styles.subSectionTitle}>Pending Action</Text>
                <DebugRow label="Type" value={debugInfo.pendingAction.type} />
                <DebugRow label="Route" value={debugInfo.pendingAction.route} />
                <DebugRow label="Priority" value={debugInfo.pendingAction.priority} />
              </View>
            )}
          </View>

          {/* Performance Metrics */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Performance Metrics</Text>
            <DebugRow label="Total Navigations" value={String(metrics.totalNavigations)} />
            <DebugRow label="Successful" value={String(metrics.successfulNavigations)} />
            <DebugRow label="Failed" value={String(metrics.failedNavigations)} />
            <DebugRow label="Error Rate" value={`${metrics.errorRate.toFixed(2)}%`} />
            <DebugRow
              label="Avg Navigation Time"
              value={`${metrics.averageNavigationTime.toFixed(2)}ms`}
            />
            <DebugRow
              label="Avg Queue Wait Time"
              value={`${metrics.averageQueueWaitTime.toFixed(2)}ms`}
            />
            <DebugRow label="Conflicts" value={String(metrics.conflicts)} />
          </View>

          {/* Common Errors */}
          {metrics.commonErrors.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Common Errors</Text>
              {metrics.commonErrors.map((error, index) => (
                <View key={index} style={styles.errorItem}>
                  <Text style={styles.errorText}>{error.error}</Text>
                  <Text style={styles.errorCount}>×{error.count}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Recent Conflicts */}
          {conflicts.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent Conflicts ({conflicts.length})</Text>
              {conflicts.slice(-5).map((conflict, index) => (
                <View key={index} style={styles.conflictItem}>
                  <Text style={styles.conflictTime}>
                    {new Date(conflict.timestamp).toLocaleTimeString()}
                  </Text>
                  <Text style={styles.conflictReason}>{conflict.reason}</Text>
                </View>
              ))}
            </View>
          )}

          {/* Navigation Stack */}
          {debugInfo.stackSize > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Navigation Stack ({debugInfo.stackSize})</Text>
              {navigationStore.navigationStack.map((screen, index) => (
                <Text key={index} style={styles.stackItem}>
                  {index + 1}. {screen}
                </Text>
              ))}
            </View>
          )}

          {/* Recent History */}
          {history.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Recent History ({history.length})</Text>
              {history.slice(-10).map((event, index) => (
                <View key={index} style={styles.historyItem}>
                  <View style={styles.historyHeader}>
                    <Text
                      style={[
                        styles.historyType,
                        event.success ? styles.success : styles.error,
                      ]}
                    >
                      {event.type.toUpperCase()}
                    </Text>
                    <Text style={styles.historyTime}>
                      {new Date(event.timestamp).toLocaleTimeString()}
                    </Text>
                  </View>
                  <Text style={styles.historyRoute}>{event.route}</Text>
                  {event.duration !== undefined && (
                    <Text style={styles.historyMetrics}>
                      Duration: {event.duration}ms
                      {event.queueWaitTime !== undefined
                        ? ` | Queue wait: ${event.queueWaitTime}ms`
                        : ''}
                    </Text>
                  )}
                  {event.error && <Text style={styles.historyError}>Error: {event.error}</Text>}
                </View>
              ))}
            </View>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

/**
 * Debug row component for displaying key-value pairs
 */
function DebugRow({ label, value }: { label: string; value: string }): React.ReactElement {
  return (
    <View style={styles.debugRow}>
      <Text style={styles.debugLabel}>{label}:</Text>
      <Text style={styles.debugValue}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    zIndex: 9999,
    justifyContent: 'center',
    alignItems: 'center',
  },
  container: {
    width: '90%',
    maxWidth: 600,
    maxHeight: '80%',
    backgroundColor: colors.background,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 3.84,
    elevation: 5,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: colors.text.DEFAULT,
  },
  closeButton: {
    width: 32,
    height: 32,
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: 16,
    backgroundColor: colors.background,
  },
  closeButtonText: {
    fontSize: 18,
    color: colors.text.DEFAULT,
    fontWeight: 'bold',
  },
  content: {
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: colors.text.DEFAULT,
    marginBottom: 12,
  },
  subSection: {
    marginTop: 8,
    marginLeft: 16,
    paddingLeft: 12,
    borderLeftWidth: 2,
    borderLeftColor: colors.primary.DEFAULT,
  },
  subSectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.text.DEFAULT,
    marginBottom: 8,
  },
  debugRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  debugLabel: {
    fontSize: 14,
    color: colors.text.muted,
    flex: 1,
  },
  debugValue: {
    fontSize: 14,
    color: colors.text.DEFAULT,
    fontWeight: '500',
    flex: 2,
    textAlign: 'right',
  },
  errorItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.pastel.pink,
    borderRadius: 6,
    marginBottom: 4,
  },
  errorText: {
    fontSize: 12,
    color: colors.error,
    flex: 1,
  },
  errorCount: {
    fontSize: 12,
    color: colors.error,
    fontWeight: 'bold',
  },
  conflictItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.pastel.yellow,
    borderRadius: 6,
    marginBottom: 4,
  },
  conflictTime: {
    fontSize: 11,
    color: colors.text.muted,
    marginBottom: 4,
  },
  conflictReason: {
    fontSize: 12,
    color: colors.warning,
  },
  stackItem: {
    fontSize: 12,
    color: colors.text.DEFAULT,
    paddingVertical: 4,
    paddingLeft: 12,
  },
  historyItem: {
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: colors.background,
    borderRadius: 6,
    marginBottom: 4,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 4,
  },
  historyType: {
    fontSize: 11,
    fontWeight: 'bold',
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
  },
  success: {
    backgroundColor: colors.pastel.green,
    color: colors.success,
  },
  error: {
    backgroundColor: colors.pastel.pink,
    color: colors.error,
  },
  historyTime: {
    fontSize: 11,
    color: colors.text.muted,
  },
  historyRoute: {
    fontSize: 12,
    color: colors.text.DEFAULT,
    marginBottom: 2,
  },
  historyMetrics: {
    fontSize: 11,
    color: colors.text.muted,
    marginTop: 2,
  },
  historyError: {
    fontSize: 11,
    color: colors.error,
    marginTop: 4,
  },
});

export default NavigationDebugOverlay;
