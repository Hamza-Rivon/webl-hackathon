/**
 * Canonical episode navigation flows.
 */

export const EPISODE_FLOWS = {
  CREATE: ['episode/[id]/index', 'episode/[id]/record', 'episode/[id]/slots', 'episode/[id]/processing', 'episode/[id]/preview'],
  VOICEOVER: ['episode/[id]/index', 'episode/[id]/record', 'episode/[id]/index'],
  SLOTS: ['episode/[id]/index', 'episode/[id]/slots', 'episode/[id]/slots/[slotId]/record', 'episode/[id]/slots/[slotId]/upload'],
  PROCESSING: ['episode/[id]/index', 'episode/[id]/processing', 'episode/[id]/preview'],
} as const;

export type FlowName = keyof typeof EPISODE_FLOWS;

export function getFlowSteps(flowName: FlowName): readonly string[] {
  return EPISODE_FLOWS[flowName];
}

export function normalizeScreenName(screen: string): string {
  return screen
    .replace(/^\//, '')
    .replace(/^\(main\)\//, '')
    .replace(/episode\/[^/]+/g, 'episode/[id]')
    .replace(/slots\/[^/]+/g, 'slots/[slotId]');
}

export function isScreenInFlow(screen: string, flowName: FlowName): boolean {
  const normalized = normalizeScreenName(screen);
  return EPISODE_FLOWS[flowName].some((flowScreen) => normalized.startsWith(flowScreen));
}

export function getFlowStepIndex(screen: string, flowName: FlowName): number {
  const normalized = normalizeScreenName(screen);
  return EPISODE_FLOWS[flowName].findIndex((flowScreen) => normalized.startsWith(flowScreen));
}

export function getNextFlowStep(screen: string, flowName: FlowName): string | null {
  const currentIndex = getFlowStepIndex(screen, flowName);
  if (currentIndex === -1) return null;
  const nextIndex = currentIndex + 1;
  if (nextIndex >= EPISODE_FLOWS[flowName].length) return null;
  return EPISODE_FLOWS[flowName][nextIndex] ?? null;
}

export function getPreviousFlowStep(screen: string, flowName: FlowName): string | null {
  const currentIndex = getFlowStepIndex(screen, flowName);
  if (currentIndex <= 0) return null;
  return EPISODE_FLOWS[flowName][currentIndex - 1] ?? null;
}

export default EPISODE_FLOWS;
