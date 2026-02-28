/**
 * Template workflow helpers.
 *
 * Determines whether a template uses the A-roll-first workflow:
 * - at least one required A-roll slot
 * - no required non-A-roll slots
 */

interface SlotRequirementLike {
  slotId: string;
  slotType: string;
  priority?: 'required' | 'optional' | string;
}

interface SlotRequirementsLike {
  workflow?: string;
  slots?: SlotRequirementLike[];
}

function getRequiredSlots(slotRequirements: SlotRequirementsLike | null | undefined): SlotRequirementLike[] {
  if (!slotRequirements?.slots || !Array.isArray(slotRequirements.slots)) return [];
  return slotRequirements.slots.filter((slot) => slot.priority === 'required');
}

export function isARollFirstTemplate(slotRequirements: SlotRequirementsLike | null | undefined): boolean {
  if (slotRequirements?.workflow === 'aroll_clean_then_broll') {
    return true;
  }

  const requiredSlots = getRequiredSlots(slotRequirements);
  if (requiredSlots.length === 0) return false;
  return requiredSlots[0]?.slotType === 'a_roll_face';
}

export function isARollFirstTemplateWithFallback(
  slotRequirements: SlotRequirementsLike | null | undefined,
  templateName?: string | null
): boolean {
  if (isARollFirstTemplate(slotRequirements)) {
    return true;
  }

  const normalizedName = (templateName ?? '').trim().toLowerCase();
  if (normalizedName === 'a-roll clean then b-roll') {
    return true;
  }

  return false;
}

export function getPrimaryARollSlotId(
  slotRequirements: SlotRequirementsLike | null | undefined
): string | null {
  const requiredSlots = getRequiredSlots(slotRequirements);
  const arollSlot = requiredSlots.find((slot) => slot.slotType === 'a_roll_face');
  return arollSlot?.slotId ?? null;
}
