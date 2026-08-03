// Original, hand-authored inline SVG icons for the UI layer. Deliberately
// independent of assets/manifest.json (Subagent C's art pipeline) so UI
// chrome never blocks on asset delivery timing — these are small icon
// glyphs, not the game's sprout/habitat art.
//
// Accessibility: every sprout-type icon has a DISTINCT SILHOUETTE (flame /
// droplet / sun-rays / star), never relying on colour alone to distinguish
// them (docs/CONTRACTS.md + brief a11y requirements). `decorative()` wraps
// markup with aria-hidden so screen readers rely on the adjacent text label
// instead of trying to describe the glyph.

function decorative(svgInner: string, viewBox = '0 0 24 24'): string {
  return `<svg viewBox="${viewBox}" aria-hidden="true" focusable="false" xmlns="http://www.w3.org/2000/svg">${svgInner}</svg>`;
}

export const icons = {
  dewdrop: decorative(
    '<path d="M12 2C12 2 5 11 5 15.5C5 19.09 8.13 22 12 22C15.87 22 19 19.09 19 15.5C19 11 12 2 12 2Z" fill="currentColor"/>',
  ),

  // Sprout-type icons: shape is the primary signal, colour is secondary.
  sproutEmber: decorative(
    '<path d="M12 22c4 0 6.5-2.7 6.5-6.2 0-3.6-2.6-6-4-9.3-.4 1.6-1.3 2.7-2.5 3.6C10.6 8.7 9.5 7 9.8 4.5 6.9 6.8 5.5 9.9 5.5 13c0 5.4 3.2 9 6.5 9z" fill="currentColor"/>',
  ),
  sproutDew: decorative(
    '<path d="M12 2C12 2 5 11 5 15.5C5 19.09 8.13 22 12 22C15.87 22 19 19.09 19 15.5C19 11 12 2 12 2Z" fill="currentColor"/>',
  ),
  sproutSun: decorative(
    '<g fill="currentColor"><circle cx="12" cy="12" r="4.2"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="1.5" x2="12" y2="4.2"/><line x1="12" y1="19.8" x2="12" y2="22.5"/><line x1="1.5" y1="12" x2="4.2" y2="12"/><line x1="19.8" y1="12" x2="22.5" y2="12"/><line x1="4.4" y1="4.4" x2="6.3" y2="6.3"/><line x1="17.7" y1="17.7" x2="19.6" y2="19.6"/><line x1="4.4" y1="19.6" x2="6.3" y2="17.7"/><line x1="17.7" y1="6.3" x2="19.6" y2="4.4"/></g></g>',
  ),
  sproutStar: decorative(
    '<path d="M12 2.5l2.47 6.62 7.03.5-5.44 4.52 1.83 6.86L12 17.05l-6.89 3.95 1.83-6.86-5.44-4.52 7.03-.5L12 2.5z" fill="currentColor"/>',
  ),

  // Mood icons: shape is the primary signal (a sphere vs. a box in the 3D
  // scene — src/render/sprouts.ts), colour is secondary. These 2D glyphs
  // mirror that shape distinction (a filled circle vs. a filled square)
  // rather than relying on the sun/moon metaphor alone.
  moodSunny: decorative('<circle cx="12" cy="12" r="7" fill="currentColor"/>'),
  moodSleepy: decorative('<rect x="6" y="6" width="12" height="12" fill="currentColor"/>'),

  lockedSlot: decorative(
    '<path d="M6 10V8a6 6 0 0 1 12 0v2h.5A1.5 1.5 0 0 1 20 11.5v8A1.5 1.5 0 0 1 18.5 21h-13A1.5 1.5 0 0 1 4 19.5v-8A1.5 1.5 0 0 1 5.5 10H6zm2 0h8V8a4 4 0 0 0-8 0v2z" fill="currentColor"/>',
  ),

  gardenSlide: decorative(
    '<path d="M4 20 16 4h4l-9 12h5l-9 4-2-4H4z" fill="currentColor"/>',
  ),
  sproutConveyor: decorative(
    '<path d="M3 7h18v4H3zM3 14h18v4H3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="m8 9 3 0-1.5-1.5M15 16h-3l1.5 1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>',
  ),
  colourGate: decorative(
    '<path d="M4 21V6a2 2 0 0 1 2-2h2v17H4zm6 0V4h4v17h-4zm6 0V4h2a2 2 0 0 1 2 2v15h-4z" fill="currentColor"/>',
  ),
  moodBell: decorative(
    '<path d="M12 2a1.5 1.5 0 0 1 1.5 1.5v.6C16.6 4.8 19 7.6 19 11v4l2 3H3l2-3v-4c0-3.4 2.4-6.2 5.5-6.9v-.6A1.5 1.5 0 0 1 12 2z" fill="currentColor"/><path d="M9 20a3 3 0 0 0 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),

  journal: decorative(
    '<path d="M5 3h9a3 3 0 0 1 3 3v15H8a3 3 0 0 1-3-3V3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M17 6h1a2 2 0 0 1 2 2v13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),
  upgrades: decorative(
    '<path d="M12 3l7 7h-4v9h-6v-9H5l7-7z" fill="currentColor"/>',
  ),
  achievements: decorative(
    '<circle cx="12" cy="9" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 14 7 21l5-2.5L17 21l-1.5-7" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>',
  ),
  settings: decorative(
    '<path d="M12 8.5A3.5 3.5 0 1 0 12 15.5 3.5 3.5 0 0 0 12 8.5z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M19.4 13.5a7.6 7.6 0 0 0 0-3l1.9-1.5-2-3.4-2.3.7a7.7 7.7 0 0 0-2.6-1.5L14 2.5h-4l-.4 2.3a7.7 7.7 0 0 0-2.6 1.5l-2.3-.7-2 3.4L4.6 10.5a7.6 7.6 0 0 0 0 3L2.7 15l2 3.4 2.3-.7c.75.66 1.63 1.17 2.6 1.5l.4 2.3h4l.4-2.3a7.7 7.7 0 0 0 2.6-1.5l2.3.7 2-3.4-1.9-1.5z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
  ),
  credits: decorative(
    '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><line x1="12" y1="11" x2="12" y2="16.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="12" cy="7.7" r="1.15" fill="currentColor"/>',
  ),
  close: decorative(
    '<line x1="5" y1="5" x2="19" y2="19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/><line x1="19" y1="5" x2="5" y2="19" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>',
  ),
  speakerOn: decorative(
    '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><path d="M16.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),
  speakerOff: decorative(
    '<path d="M4 9v6h4l5 4V5L8 9H4z" fill="currentColor"/><line x1="16" y1="9" x2="21" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><line x1="21" y1="9" x2="16" y2="15" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  ),
  homeReturn: decorative(
    '<path d="M4 11 12 4l8 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 10v9a1 1 0 0 0 1 1h3v-6h4v6h3a1 1 0 0 0 1-1v-9" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>',
  ),
};

export type IconKey = keyof typeof icons;

export function iconMarkup(key: IconKey): string {
  return icons[key];
}
