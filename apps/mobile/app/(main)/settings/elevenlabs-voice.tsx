import { useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { Button, Card, Input, Screen, StickyActionBar } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import { useUpdateElevenLabsSettings, useUserSettings } from '@/hooks/useUserSettings';
import { colors, spacing, typography } from '@/lib/theme';

export default function ElevenLabsVoiceSettingsScreen() {
  const router = useRouter();
  const { showToast } = useToast();

  const settingsQuery = useUserSettings();
  const updateSettings = useUpdateElevenLabsSettings();

  const [voiceId, setVoiceId] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  useEffect(() => {
    if (!settingsQuery.data) return;
    setVoiceId(settingsQuery.data.elevenLabsVoiceId || '');
    setApiKey('');
  }, [settingsQuery.data]);

  const hasChanges = useMemo(() => {
    const initialVoiceId = settingsQuery.data?.elevenLabsVoiceId || '';
    return voiceId !== initialVoiceId || apiKey.trim().length > 0;
  }, [apiKey, settingsQuery.data?.elevenLabsVoiceId, voiceId]);

  const onSave = async () => {
    if (!hasChanges || updateSettings.isPending) return;

    try {
      await updateSettings.mutateAsync({
        voiceId: voiceId.trim() || null,
        apiKey: apiKey.trim() || null,
      });

      showToast({
        type: 'success',
        title: 'Settings saved',
        message: 'Your ElevenLabs credentials were updated.',
      });

      router.back();
    } catch (error) {
      showToast({
        type: 'error',
        title: 'Save failed',
        message: error instanceof Error ? error.message : 'Could not save settings.',
      });
    }
  };

  return (
    <View style={styles.root}>
      <Screen contentContainerStyle={styles.content}>
        <View style={styles.header}>
          <Text style={styles.title}>ElevenLabs Voice</Text>
          <Text style={styles.subtitle}>Attach your personal API key and preferred voice for TTS generation.</Text>
        </View>

        <Card>
          <Text style={styles.sectionTitle}>Credentials</Text>
          <View style={styles.stack}>
            <Input
              label="API key"
              placeholder="Optional: sk_..."
              value={apiKey}
              onChangeText={setApiKey}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry={!showApiKey}
              helperText="Leave blank to keep using platform-managed credentials."
            />
            <View style={styles.inlineActions}>
              <Button variant="ghost" size="sm" style={styles.inlineButton} onPress={() => setShowApiKey((value) => !value)}>
                {showApiKey ? 'Hide key' : 'Show key'}
              </Button>
              {apiKey.length > 0 ? (
                <Button variant="ghost" size="sm" style={styles.inlineButton} onPress={() => setApiKey('')}>
                  Clear key
                </Button>
              ) : null}
            </View>

            <Input
              label="Voice ID"
              placeholder="Optional: your ElevenLabs voice ID"
              value={voiceId}
              onChangeText={setVoiceId}
              autoCapitalize="none"
              autoCorrect={false}
              helperText="If empty, WEBL uses ELEVENLABS_DEFAULT_VOICE_ID from the server .env."
            />
          </View>
        </Card>

        <Card variant="pastelBlue">
          <Text style={styles.sectionTitle}>Current Behavior</Text>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>Active voice</Text>
            <Text style={styles.metaValue}>{voiceId || 'Workspace default (.env)'}</Text>
          </View>
          <View style={styles.metaRow}>
            <Text style={styles.metaKey}>API key source</Text>
            <Text style={styles.metaValue}>{apiKey ? 'Will update on save' : 'Existing secure value'}</Text>
          </View>
        </Card>
      </Screen>

      <StickyActionBar>
        <Button variant="ghost" onPress={() => router.back()}>
          Cancel
        </Button>
        <Button onPress={onSave} disabled={!hasChanges || updateSettings.isPending || settingsQuery.isLoading}>
          {updateSettings.isPending ? 'Saving...' : 'Save Settings'}
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
    paddingTop: spacing['2xl'],
    paddingBottom: spacing['4xl'],
    gap: spacing.md,
  },
  header: {
    gap: spacing.xs,
  },
  title: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize['2xl'],
    fontWeight: typography.fontWeight.bold,
  },
  subtitle: {
    color: colors.text.muted,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.base,
    lineHeight: 22,
  },
  sectionTitle: {
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.heading,
    fontSize: typography.fontSize.lg,
    fontWeight: typography.fontWeight.bold,
    marginBottom: spacing.sm,
  },
  stack: {
    gap: spacing.md,
  },
  inlineActions: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  inlineButton: {
    width: 'auto',
    minWidth: 96,
  },
  metaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  metaKey: {
    color: colors.text.light,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  metaValue: {
    flex: 1,
    textAlign: 'right',
    color: colors.text.DEFAULT,
    fontFamily: typography.fontFamily.body,
    fontSize: typography.fontSize.sm,
    fontWeight: typography.fontWeight.semibold,
  },
});
