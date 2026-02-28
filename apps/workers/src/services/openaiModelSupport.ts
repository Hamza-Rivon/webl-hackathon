export type ReasoningEffort = 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export function supportsOpenAiTemperature(model: string, reasoningEffort?: ReasoningEffort | null): boolean {
  const normalized = (model || '').toLowerCase();
  if (normalized.startsWith('gpt-5.2')) {
    return !reasoningEffort || reasoningEffort === 'none';
  }
  if (normalized.startsWith('gpt-5')) {
    return false;
  }
  return true;
}
