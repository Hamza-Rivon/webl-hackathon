/**
 * Database Seed Script - SIMPLIFIED
 *
 * Seeds the database with the current template library (ffmpeg microcut v2).
 */

import { PrismaClient, Platform, Prisma } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const prisma = new PrismaClient();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const TEMPLATES_JSON_PATH = path.resolve(__dirname, '../../templates/data/templates.json');
const RECIPES_DIR = path.resolve(__dirname, '../../templates/data/editing_recipes');

// ==================== TYPES ====================

interface SimpleTemplate {
  id: string;
  name: string;
  description: string;
  platform: string;
  language?: string;
  durationTarget: number;
  editingRecipe: string;
  defaultArchetype?: string;
  canonicalScript?: string;
  scriptStructure?: {
    beats: Array<{
      type: string;
      duration: number;
      description: string;
    }>;
    totalDuration?: number;
  };
  slotRequirements?: {
    workflow?: string;
    slots: Array<{
      slotId: string;
      slotType: string;
      priority: string;
      description: string;
      duration: { min: number; target: number; max: number };
    }>;
  };
  personaTags?: string[];
  niche?: string;
  tone?: string;
}

interface TemplatesFile {
  version: string;
  templates: SimpleTemplate[];
}

interface EditingRecipe {
  cutRhythm: string;
  captionStyle: string | Record<string, unknown>;
  musicType: string;
  transitions: string[] | Record<string, string>;
  musicGuidance?: {
    type: string;
    bpm?: string;
    mood?: string;
    fadeIn?: boolean;
    fadeInDuration?: number;
    fadeOut?: boolean;
    fadeOutDuration?: number;
    duckOnVoice?: boolean;
    volume?: number;
  };
  colorGrading?: {
    contrast?: number;
    saturation?: number;
    temperature?: string;
  };
}

// ==================== SIMPLE SPEC BUILDERS ====================

function buildSimpleTimelineSpec(template: SimpleTemplate): Prisma.InputJsonValue {
  const beats = template.scriptStructure?.beats ?? [
    { type: 'main', duration: template.durationTarget, description: 'Main content' }
  ];

  let currentTime = 0;
  const timelineBeats = beats.map((beat, index) => {
    const startTime = currentTime;
    const endTime = currentTime + beat.duration;
    currentTime = endTime;
    return {
      index,
      type: beat.type,
      startTime,
      endTime,
      duration: beat.duration,
      pacing: 'medium',
    };
  });

  return {
    totalDuration: template.durationTarget,
    beats: timelineBeats,
    pacingCurve: 'moderate',
  };
}

function buildSimpleLayoutSpec(template: SimpleTemplate, recipe: EditingRecipe | null): Prisma.InputJsonValue {
  const isSplitScreen = template.name.toLowerCase().includes('split');
  
  const beatLayout = {
    beatIndex: 0,
    layout: isSplitScreen ? 'split_screen' : 'fullscreen_b_roll',
    splitConfig: isSplitScreen ? {
      top: 'b_roll',
      bottom: 'a_roll',
      ratio: 0.5,
    } : undefined,
    safeArea: { top: 120, bottom: 150, left: 40, right: 40 },
  };

  return {
    beats: [beatLayout],
    aspectRatio: '9:16',
    resolution: { width: 1080, height: 1920 },
  };
}

function buildSimpleSlotRequirements(template: SimpleTemplate): Prisma.InputJsonValue {
  // Use template's slotRequirements if provided
  if (template.slotRequirements) {
    return {
      ...(template.slotRequirements.workflow ? { workflow: template.slotRequirements.workflow } : {}),
      slots: template.slotRequirements.slots.map(slot => ({
        slotId: slot.slotId,
        slotType: slot.slotType,
        priority: slot.priority,
        duration: slot.duration,
        allowedSources: ['recorded', 'uploaded'],
        description: slot.description,
        examples: [],
        layoutUsage: {
          beatIndices: [0],
          position: slot.slotId.startsWith('B') ? 'top' : 'bottom',
        },
      })),
    };
  }

  // Default: simple B-roll only
  return {
    slots: [{
      slotId: 'B1',
      slotType: 'b_roll_illustration',
      priority: 'required',
      duration: { min: 5, target: 30, max: 120 },
      allowedSources: ['recorded', 'uploaded'],
      description: 'Your video clip',
      examples: [],
      layoutUsage: { beatIndices: [0], position: 'fullscreen' },
    }],
  };
}

function buildSimpleStyleSpec(): Prisma.InputJsonValue {
  return {
    captions: {
      fontFamily: 'Inter',
      fontSize: 48,
      fontWeight: 'bold',
      color: '#FFFFFF',
      backgroundColor: 'rgba(0,0,0,0.5)',
      position: 'center',
      animation: 'typewriter',
      highlightWords: true,
      highlightColor: '#FFFF00',
    },
    transitions: [],
    overlays: [],
  };
}

function buildSimpleMotionSpec(): Prisma.InputJsonValue {
  return {
    textAnimations: [{ beatIndex: 0, animation: 'slide_in', timing: 0.3 }],
    backgroundEffects: [{ beatIndex: 0, effect: 'none' }],
  };
}

// ==================== FILE LOADING ====================

function loadTemplatesJson(): TemplatesFile | null {
  try {
    if (!fs.existsSync(TEMPLATES_JSON_PATH)) {
      console.error(`Templates file not found: ${TEMPLATES_JSON_PATH}`);
      return null;
    }
    const data = fs.readFileSync(TEMPLATES_JSON_PATH, 'utf-8');
    return JSON.parse(data) as TemplatesFile;
  } catch (error) {
    console.error('Error loading templates.json:', error);
    return null;
  }
}

function loadEditingRecipe(filename: string): EditingRecipe | null {
  try {
    const recipePath = path.join(RECIPES_DIR, filename);
    if (!fs.existsSync(recipePath)) {
      console.warn(`  Recipe not found: ${filename}`);
      return null;
    }
    const data = fs.readFileSync(recipePath, 'utf-8');
    return JSON.parse(data) as EditingRecipe;
  } catch (error) {
    console.warn(`  Error loading recipe ${filename}:`, error);
    return null;
  }
}

function mapPlatform(platform: string): Platform {
  const mapping: Record<string, Platform> = {
    tiktok: 'tiktok',
    reels: 'reels',
    shorts: 'shorts',
    all: 'all',
  };
  return mapping[platform.toLowerCase()] ?? 'all';
}

// ==================== SEEDING ====================

async function seedTemplate(template: SimpleTemplate, recipe: EditingRecipe | null): Promise<boolean> {
  try {
    await prisma.template.upsert({
      where: { name: template.name },
      update: {
        description: template.description,
        platform: mapPlatform(template.platform),
        language: template.language ?? 'en',
        durationTarget: template.durationTarget,
        templatePackageVersion: '2.0.0',
        renderEngine: 'ffmpeg_microcut_v2',
        timelineSpec: buildSimpleTimelineSpec(template),
        layoutSpec: buildSimpleLayoutSpec(template, recipe),
        slotRequirements: buildSimpleSlotRequirements(template),
        styleSpec: buildSimpleStyleSpec(),
        motionSpec: buildSimpleMotionSpec(),
        canonicalScript: template.canonicalScript ?? null,
        scriptStructure: {
          ...(template.scriptStructure as Record<string, unknown> ?? {}),
          ...(template.defaultArchetype ? { defaultArchetype: template.defaultArchetype } : {}),
        } as Prisma.InputJsonValue,
        editingRecipe: recipe as unknown as Prisma.InputJsonValue ?? null,
        personaTags: template.personaTags ?? [],
        niche: template.niche ?? 'general',
        tone: template.tone ?? 'casual',
      },
      create: {
        name: template.name,
        description: template.description,
        platform: mapPlatform(template.platform),
        language: template.language ?? 'en',
        durationTarget: template.durationTarget,
        templatePackageVersion: '2.0.0',
        renderEngine: 'ffmpeg_microcut_v2',
        timelineSpec: buildSimpleTimelineSpec(template),
        layoutSpec: buildSimpleLayoutSpec(template, recipe),
        slotRequirements: buildSimpleSlotRequirements(template),
        styleSpec: buildSimpleStyleSpec(),
        motionSpec: buildSimpleMotionSpec(),
        canonicalScript: template.canonicalScript ?? null,
        scriptStructure: {
          ...(template.scriptStructure as Record<string, unknown> ?? {}),
          ...(template.defaultArchetype ? { defaultArchetype: template.defaultArchetype } : {}),
        } as Prisma.InputJsonValue,
        editingRecipe: recipe as unknown as Prisma.InputJsonValue ?? null,
        personaTags: template.personaTags ?? [],
        niche: template.niche ?? 'general',
        tone: template.tone ?? 'casual',
      },
    });

    return true;
  } catch (error) {
    console.error(`  ❌ Error seeding ${template.name}:`, error);
    return false;
  }
}

async function main(): Promise<void> {
  console.log('🌱 Starting simplified template seeding...\n');

  const templatesFile = loadTemplatesJson();
  if (!templatesFile) {
    console.log('❌ Failed to load templates file');
    process.exit(1);
  }

  console.log(`📦 Found ${templatesFile.templates.length} templates`);
  console.log(`📋 Version: ${templatesFile.version}\n`);

  let seeded = 0;
  let failed = 0;

  for (const template of templatesFile.templates) {
    console.log(`📝 Processing: ${template.name}`);
    
    const recipe = loadEditingRecipe(template.editingRecipe);
    if (recipe) {
      console.log(`   ✓ Loaded recipe: ${template.editingRecipe}`);
    }

    const success = await seedTemplate(template, recipe);
    if (success) {
      console.log(`   ✅ Seeded: ${template.name}`);
      seeded++;
    } else {
      failed++;
    }
  }

  console.log('\n' + '='.repeat(50));
  console.log('🎉 Seeding complete!');
  console.log('='.repeat(50));
  console.log(`   ✅ Seeded: ${seeded}`);
  console.log(`   ❌ Failed: ${failed}`);

  await prisma.$disconnect();
}

main();
