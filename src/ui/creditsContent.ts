// Structured Credits content — the in-game Credits panel renders THIS data
// directly (not a link out), and docs/ASSET_CREDITS.md is generated to
// mirror it, per the brief ("Credits panel mirrors it in-game").
//
// Art provenance: docs/ART_DIRECTION.md (Subagent C) was not yet written
// when this was authored, so the art section below is a truthful
// placeholder — original-work claim only, no fabricated detail. Re-run
// `docs/ASSET_CREDITS.md` generation once ART_DIRECTION.md lands; see the
// integration note at the end of this file.

export interface CreditsSection {
  heading: string;
  items: string[];
}

export const CREDITS_SECTIONS: CreditsSection[] = [
  {
    heading: 'Art',
    items: [
      'All Sprout, habitat, structure, path, scenery, particle and UI-icon artwork is original vector (SVG) work created for Tiny Terrarium Works — no third-party or stock art.',
      'All 3D materials (soil, stone, wood, painted-metal, water) and the ambient-lighting environment texture are procedurally generated in-code (Canvas 2D noise/gradients) — no third-party textures or HDRIs.',
      'Full palette, silhouette and provenance notes: docs/ART_DIRECTION.md. Material recipes: docs/MATERIAL_LIBRARY.md.',
    ],
  },
  {
    heading: 'Music & sound',
    items: [
      'All music and sound effects are original, synthesized in-repo using the Web Audio API (oscillators, filters, and envelopes) — no samples, no external audio files, no licensing to track.',
      'Ambient garden loop: a slow layered pad with sparse pentatonic sparkle plucks.',
      'Sound effects: UI click/hover, correct placement, friendly incorrect-placement bounce, Dewdrop collect chime, rare Star Sprout reveal shimmer, habitat-full chime, upgrade purchase blip, achievement fanfare.',
    ],
  },
  {
    heading: 'Engine & tools',
    items: ['Built with Babylon.js, Vite, and TypeScript.'],
  },
];

/**
 * Renders CREDITS_SECTIONS as Markdown, so docs/ASSET_CREDITS.md can be
 * generated from (and stay identical to) what the in-game panel shows.
 */
export function creditsSectionsToMarkdown(sections: CreditsSection[] = CREDITS_SECTIONS): string {
  return sections
    .map((section) => `## ${section.heading}\n\n${section.items.map((item) => `- ${item}`).join('\n')}`)
    .join('\n\n');
}
