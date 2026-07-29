# Tiny Terrarium Works — Asset Credits

Owner: Subagent F. This file mirrors exactly what the in-game Credits panel
shows (`src/ui/creditsContent.ts` is the single source of truth both render
from — see `creditsSectionsToMarkdown()`), so the two can never drift.

## Art

- All Sprout, habitat, structure, path, scenery, particle and UI-icon
  artwork is original vector (SVG) work created for Tiny Terrarium Works —
  no third-party or stock art.
- Full palette, silhouette and provenance notes: docs/ART_DIRECTION.md.

Provenance statement from Subagent C (docs/ART_DIRECTION.md §6), reproduced
here in full: "100% original. Every asset in `public/assets/` was authored from
scratch for Tiny Terrarium Works as parametric SVG source (hand-designed
palettes, hand-designed silhouette/pose rules, procedurally-assembled
bezier/gradient geometry written for this project). No traced, downloaded,
AI-generated-from-reference-image, or copyrighted source material was used
at any point. No existing game, character, or franchise was referenced or
imitated."

## Music & sound

- All music and sound effects are original, synthesized in-repo using the
  Web Audio API (oscillators, filters, and envelopes) — no samples, no
  external audio files, no licensing to track.
- Ambient garden loop: a slow layered pad with sparse pentatonic sparkle
  plucks (`src/audio/music.ts`).
- Sound effects (`src/audio/sfx.ts`): UI click/hover, correct placement,
  friendly incorrect-placement bounce, Dewdrop collect chime, rare Star
  Sprout reveal shimmer, habitat-full chime, upgrade purchase blip,
  achievement fanfare.

## Engine & tools

- Built with Babylon.js, Vite, and TypeScript.

---

Generated from / kept in sync with `src/ui/creditsContent.ts`. If you edit
one, edit the other.
