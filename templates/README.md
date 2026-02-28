# WEBL Template Library

This directory contains the viral video template definitions.

## Structure

```
templates/
├── data/
│   ├── templates.json        # Template definitions
│   └── editing_recipes/      # Per-template editing rules
│       ├── top-3-tips.json
│       ├── story-hook.json
│       ├── myth-buster.json
│       └── ...
└── scripts/
    └── import-templates.ts   # Import script
```

## Template Schema

Each template includes:

- **name**: Display name
- **description**: Brief description
- **platform**: Target platform (tiktok, reels, shorts, all)
- **durationTarget**: Target video length in seconds
- **canonicalScript**: Original viral script
- **scriptStructure**: Beat breakdown
- **editingRecipe**: Editing rules (cuts, captions, music)
- **personaTags**: Matching persona tags
- **niche**: Content niche
- **tone**: Content tone

## Adding Templates

1. Create a new JSON file in `editing_recipes/`
2. Add entry to `templates.json`
3. Run `pnpm template:import` to import to database
