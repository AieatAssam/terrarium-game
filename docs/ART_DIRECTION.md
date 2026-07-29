# Tiny Terrarium Works — Art Direction

Owner: Subagent C. This is the art bible for `public/assets/`. Any agent
touching rendering (E) or UI (F) should treat palette/scale/timing notes
here as authoritative for how the source SVGs are meant to be interpreted.

## 1. Look & feel

Premium, colourful, cosy, toy-like magical terrarium. Isometric/2.5D
feel via soft radial "glossy toy" gradients (light upper-left, dark
lower-right), warm rim highlights, and soft blurred ground-contact
shadows under every creature/structure/scenery piece. Line weight is a
consistent `stroke-width` in the 2–4px range at each category's native
viewBox scale, colour `stroke` always a darker shade of the fill it
outlines (never pure black) — this is what keeps the whole set feeling
like one hand-built toy set instead of stock clipart.

Nothing here traces, copies, or imitates any identifiable commercial
game, character, or franchise. Every shape is built from primitive
vector geometry (beziers, radial point rings, rounded polygons)
authored specifically for this project — see provenance statement in
§6.

## 2. Sprouts — construction system

All four Sprout types share one construction rig so they read as one
family, but each gets a distinct outer silhouette layer so the family
members are never confused:

- **Ground shadow** (soft blurred ellipse, idle/walk/happy/reveal only —
  omitted on the `icon` variant for a cleaner small-scale mark)
- **Outer silhouette layer** — this is where each type's identity
  lives (see §3)
- **Inner glossy body** (`radialGradient` light→primary→dark, 3px dark
  outline) — carries the face
- **Rim highlight** — a soft white ellipse, upper-left of the body
- **Face** — ink `#4A3728` eyes/mouth (never pure black), blush
  ellipses in the type's `accent` colour
- **Stub limbs** — thick round-capped strokes, no articulated
  hands/feet, posed per state

### Palette per Sprout type (exact hex)

| Type | primary | dark (outline/shadow) | light (highlight) | accent |
|---|---|---|---|---|
| Ember (`ember`) | `#FF6B45` | `#D8452A` (shadow `#B23A22`) | `#FFC169` | `#FFE3A3` |
| Dew (`dew`) | `#4FA8E0` | `#2C74B3` (shadow `#215E92`) | `#BFE8FF` | `#E8FBFF` |
| Sun (`sun`) | `#FFC93C` | `#E89A1C` (shadow `#C97A0E`) | `#FFF1B8` | `#FFF8E1` |
| Star (`star`, rare) | `#B98CFF` | `#7C4FD1` (shadow `#5E37A8`) | `#FDE8FF` | `#FFD9F5` |

Ink/face colour (all types): `#4A3728`.

Star intentionally uses a **violet/magenta hue family** completely
outside the red/blue/yellow trio the three common types occupy, so a
rare pull reads as special at a glance even before the sparkle aura
renders.

## 3. Silhouette rules (colour-blind / grayscale safe)

Required by the brief: the three basic types must be distinguishable
by **shape alone**. Each type's outer silhouette layer is structurally
different, not just recoloured:

- **Ember** — round-ish blob body with **3 asymmetric flame tufts on
  top only** (torch silhouette). The only type with top-only,
  non-radially-symmetric accents.
- **Dew** — a single smooth **teardrop** curve, point-up / round-bottom.
  No separate accent shapes at all — the smoothest, simplest silhouette
  in the set, deliberately so it never gets confused with the spiky
  others.
- **Sun** — body fully ringed by **8 rounded petals** (radially
  symmetric, soft/blunt tips). Reads as a flower/sun disc.
- **Star** — body ringed by **5 long, sharp points** (classic star
  polygon, deep concave valleys). Fewer, longer, sharper points than
  Sun's 8 short round petals — the two radially-symmetric types stay
  distinct from each other as well as from Ember/Dew.

This was spot-checked at 240×240 and at the 96×96 icon size; silhouettes
stay distinguishable at both. Subagent D (Art QA) should re-verify with
an actual grayscale/desaturated pass over rendered screenshots.

## 4. Animation timing notes (for Subagent E)

Each Sprout state is a static pose; E interpolates/tweens between them.
Suggested interpretation:

- **idle** — gentle vertical bob, ~2s ease-in-out loop, ±4px amplitude.
  No rotation.
- **walk** — 4-frame implied cycle: alternate mirroring/repeating the
  single `walk` pose (which is already skewed −6° with a forward/back
  arm and leg swing) left-right, ~0.6s per step, slight squash/stretch
  already baked into the art (`scale 1.04×0.95`).
- **happy** — quick bounce: scale from 1.0 up to the `happy` art's
  baked squash (`0.94×1.12`, bob −14) and back over ~350ms, plus the
  sparkle burst already in the art fading out over ~600ms.
- **reveal** — scale up from 0 → the `reveal` art's baked 1.16 scale
  over ~500ms with an overshoot/settle (back-ease), synced with the
  Pod `opening` → crack-glow. For the Star Sprout specifically, layer
  `sprout.star.reveal.aura.svg` (burst rays + extra sparkle ring,
  transparent background, same 240×240 viewBox) behind/over the main
  reveal art and fade it in slightly ahead of the body for an
  "unmistakably rare" flourish.
- **icon** — static, no animation; used in the Garden Journal / habitat
  markers / UI at small scale.

## 5. Scale & export conventions

Every SVG has explicit `width`, `height`, and matching `viewBox` on the
root element, is fully self-contained (inline gradients/filters only,
no external `<image>` href, no external fonts, no `<text>`), and uses a
**consistent artboard size per category** so E never has to guess a
scale factor:

| Category | viewBox | Notes |
|---|---|---|
| Sprout idle/walk/happy/reveal | `0 0 240 240` | same 240×240 for all 4 types × 4 states |
| Sprout icon | `0 0 96 96` | same small mark size across all 4 types |
| Sprout star reveal aura overlay | `0 0 240 240` | matches main reveal canvas exactly, drop-in overlay |
| Habitat base/full | `0 0 320 320` | same for all 3 habitats × 2 states |
| Structure (nursery, pod) | `0 0 300 300` | |
| Structure (gardenSlide, colourGate — wide automation footprint) | `0 0 400 260` | |
| Path segment | `0 0 160 160` | tileable square, edge-to-edge grass border |
| Scenery piece | `0 0 160 160` | includes its own ground shadow, transparent surround |
| Particle sprite | `0 0 96 96` | transparent background, no ground shadow — meant as a billboard/texture |
| UI icon | `0 0 64 64` | circular cream badge background baked in |

## 6. Provenance statement

**100% original.** Every asset in `public/assets/` was authored from scratch
for Tiny Terrarium Works as parametric SVG source (hand-designed
palettes, hand-designed silhouette/pose rules, procedurally-assembled
bezier/gradient geometry written for this project). No traced,
downloaded, AI-generated-from-reference-image, or copyrighted source
material was used at any point. No existing game, character, or
franchise was referenced or imitated. All 55 files are static vector
source committed directly under `public/assets/` and are free of external
network references (fonts, images, hrefs) — Subagent E rasterizes them
to Babylon textures at runtime with no separate build-time step.

Subagent F: please mirror this statement (or a shortened form of it)
into `docs/ASSET_CREDITS.md` and the in-game Credits panel, e.g. "All
visual art original, hand-authored as SVG source for this project — no
third-party or AI-referenced assets."

## 7. Asset manifest / integration notes for Subagent E & F

- `public/assets/manifest.json` maps every stable string key to its SVG path,
  exactly per `docs/CONTRACTS.md` §"Asset manifest". 55 keys total.
- Habitat "filled/reactive" variant is keyed `habitat.<id>.full` (not
  `.happy`) — chosen to match the existing `habitat:full` event name in
  the `GameEvent` union in CONTRACTS.md, so the renderer can map the
  event straight to the asset key with no translation table.
- Star Sprout has one extra, non-required key:
  `sprout.star.reveal.aura` — a transparent-background overlay (burst
  rays + sparkles, same 240×240 canvas as `sprout.star.reveal`) that E
  can optionally composite on top of/behind the main reveal art for
  extra "rare" flourish. Not required — `sprout.star.reveal` alone is a
  complete, correct reveal asset on its own.
- Two path segment keys are provided: `path.segment.straight` and
  `path.segment.corner` (both 160×160, tileable, grass-bordered) —
  the brief asked for at least one; both are provided since corners are
  needed the moment a path bends and the marginal cost was low.
- `ui.icon.mute` and `ui.icon.volume` are two separate icons (not one
  icon with a toggle state baked in) so F can swap between them driven
  by the mute boolean.
- Upgrade icon keys use the exact `UpgradeId` strings from
  CONTRACTS.md: `ui.icon.upgrade.podRhythm`,
  `ui.icon.upgrade.habitatCapacity`, `ui.icon.upgrade.gardenSlideSpeed`,
  `ui.icon.upgrade.dewdropMultiplier`,
  `ui.icon.upgrade.decorativeExpansion1`,
  `ui.icon.upgrade.colourGateUnlock`.
