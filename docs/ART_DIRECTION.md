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
- **Five** path segment keys are now provided: `path.segment.straight`,
  `.corner`, `.tee`, `.cross` and `.end` (all 160×160). See §10 below — the
  original two were authored grass-bordered with a vertical gradient, which
  cannot survive being rotated; all five were re-authored this pass with a
  transparent surround and a rotation-invariant flat tread so a piece can be
  turned to any of four orientations without mismatching its neighbours.
- `ui.icon.mute` and `ui.icon.volume` are two separate icons (not one
  icon with a toggle state baked in) so F can swap between them driven
  by the mute boolean.
- Upgrade icon keys use the exact `UpgradeId` strings from
  CONTRACTS.md: `ui.icon.upgrade.podRhythm`,
  `ui.icon.upgrade.habitatCapacity`, `ui.icon.upgrade.gardenSlideSpeed`,
  `ui.icon.upgrade.dewdropMultiplier`,
  `ui.icon.upgrade.decorativeExpansion1`,
  `ui.icon.upgrade.colourGateUnlock`.

## 8. Standee presentation fix (owner: E, this pass)

The Nursery/habitat/automation "painted card" illustrations in §1/§5/§7 are
authored as **top-down decals** — a wide, short ellipse (roughly 2:1) with a
baked ground shadow, offset toward the bottom of their square canvas,
designed to be viewed lying flat on a surface. When `src/render/flatArt.ts`
converted these from flat ground-parallel cards to upright billboarded
standees (matching Sprouts' presentation), that top-down composition became
a problem: rasterized as-is onto a vertical card, the artwork's content only
occupied the lower ~60% of the card's height, in a wide low shape, reading
as "a flat colored blob barely bigger than the drum it stands on" rather
than a legible standee — confirmed as a real rendering defect via browser
QA, not a geometry/billboard bug (the billboard math itself was verified
correct via world-matrix inspection during this pass).

**Fix**: `src/render/assets.ts` now computes each rasterized texture's tight
opaque-content bounding box once (`getManifestContentBBox` /
`onManifestContentBBoxReady`), and `attachStandee` crops the standee's UV to
that box and resizes/re-anchors the card to the content's real aspect ratio
— so the card is sized to what the art actually draws, sitting flush on the
surface it stands on, instead of showing a mostly-empty square with the
illustration crammed in one corner. This is a **render-side presentation
fix**, not a change to the source SVGs — C's art is untouched; it's simply
framed correctly when displayed upright. See `docs/MATERIAL_LIBRARY.md` and
`docs/ART_QA_REPORT.md` for the full before/after investigation.

Habitat standee maximum footprint was also reduced from `topRadius * 1.5` to
`topRadius * 0.9` (`src/render/habitats.ts`) so a fully-content-filled card
can't grow tall enough to visually compete with or occlude a settled Sprout
resting on top of the habitat (`SPROUT_FLOAT_HEIGHT`/settle offset,
`src/render/sprouts.ts`).

## 9. Lighting and PBR material plan

Every major world material is `PBRMetallicRoughnessMaterial` — see
`docs/MATERIAL_LIBRARY.md` for the per-material recipe (albedo variation,
normal/bump, roughness, AO, metallic, emissive) and performance notes
(shared procedural texture families, not one texture per object; 256×256
two-octave textures as of this pass, up from an original 128×128
single-octave pass — see MATERIAL_LIBRARY.md's "Resolution and detail
increase").

- **Key light**: warm directional light simulating sun through conservatory
  glass (`src/render/lighting.ts`).
- **Fill light**: cool hemispheric light for colour-separated shadow sides.
- **Environment/IBL**: a procedural cube-map environment texture
  (`src/render/environment.ts`) — six flat-shaded canvas gradients (warm sky
  above, cool soil-bounce below), assembled entirely in-code, no third-party
  HDRI. Provenance recorded in `docs/ASSET_CREDITS.md`.
  - **Known limitation, re-investigated this pass**: assigning this texture
    to `scene.environmentTexture` causes a full black-screen render failure
    specifically on this project's WebGPU backend. A prior pass found this
    and gated it to WebGL only; this pass re-investigated with a much
    sharper bisection (six live-browser probes against the actual running
    scene) to see if a different construction path could avoid it. Result:
    it can't, currently. The precise trigger — confirmed empirically, not
    guessed — is that **the cube texture must be perfectly uniform (the
    same single color on literally every texel, every face) to avoid the
    crash**. `RawCubeTexture` (raw pixel upload, bypassing the loader/
    ImageBitmap/extension-lookup path entirely — the most different
    construction path this Babylon version offers) does NOT avoid it: fed
    the exact same content as `CubeTexture`, it crashes identically. Even a
    cube where each face is internally flat but a DIFFERENT flat color
    per-face (no gradient, no within-face variation at all) still crashes.
    Only a single color across the entire cube survives — and that carries
    zero directional information over the existing HemisphericLight fill,
    so shipping it wouldn't add anything real. `EquiRectangularCubeTexture`
    was considered and ruled out BY INFERENCE (not a live test — it
    re-derives 6 faces via a similar path, and the probes already showed
    the trigger is content-uniformity, not construction path, so it's
    expected but not confirmed to hit the same wall). `CreateFromPrefilteredData`
    was ruled out on a different, harder constraint: it needs a pre-baked
    `.env` file, which conflicts with the "original, procedurally
    generated" asset constraint regardless of whether it would work. Full
    probe-by-probe results in
    `docs/ART_QA_REPORT.md` and the complete writeup in
    `src/render/environment.ts`'s doc comment. It remains wired up on the
    WebGL fallback path only (`!scene.getEngine().isWebGPU`) until Babylon
    fixes the underlying spherical-harmonics/irradiance computation this
    points to. The directional key + hemispheric fill remain the dominant,
    WebGPU-safe lighting read.
- **Shadows**: soft blurred exponential shadow map, with `bias`/
  `normalBias` tuned so contact points (Sprouts/habitats meeting the
  ground) read as grounded soft contact shadows.
- **Sprouts stay lit, not unlit-disableLighting**, per the brief's rule
  against unlit planes for interactive focal assets — see the doc comment in
  `src/render/sprouts.ts` for why this is safe here specifically (the
  garden camera's yaw never rotates at runtime, so a Y-billboarded sprite's
  lit response to the fixed key light is constant, not per-frame-varying).
- **Metallic response audited this pass**: only `paintedMetal` (automation
  site bodies) uses non-zero metallic, and it's now a sparse accent (0.03
  base, up to 0.4 inside a small radial mask covering a handful of pixels)
  rather than a flat scalar applied to the whole surface. Every other
  material family (soil, stone, wood, water, path, foliage) stays at
  metallic 0. The peak was kept conservative and is NOT confirmed to read
  as a positive "warm glint" — browser QA on the default WebGPU backend
  (no IBL/specular environment response, see the known limitation above)
  showed a higher peak reading as faint dark speckling instead; see
  `docs/MATERIAL_LIBRARY.md`'s "Metallic is a true accent" section for the
  full caveat.
- **Emissive response audited this pass**: confirmed reserved to Sprouts
  (always-on, modest, readability-driven) and transient interaction
  feedback (habitat correct/incorrect placement glow pulses, automation
  placement-preview tint) — no procedural PBR material family sets a
  resting-state emissive color. See `docs/MATERIAL_LIBRARY.md`'s "Emissive
  audit" section.

## 10. Garden path: piece variety, orientation, and conveyor flow (owner: E)

### 10.1 The road has to turn

`GARDEN_PATH_TILES` (`src/render/layout.ts`) is the UNION of
`pathBetween(NURSERY_TILE, habitatTile)` for all three habitats, so the network
genuinely contains corners, a junction and dead ends. The first render pass drew
**every** tile with the single `path.segment.straight` key at zero rotation, so
corners, the Nursery junction and the three dead ends all rendered as straight
runs pointing the same way — the road visually ignored every turn it made.

Piece type and orientation are now DERIVED per tile from its four neighbours
(`classifyPathTile` / `GARDEN_PATH_PIECES`) and the tile mesh is rotated by whole
quarter turns. For the shipped layout that yields 1 tee (under the Nursery),
2 corners, 3 end caps (one under each habitat) and 16 straights. The `cross`
piece is authored but unused by this layout; it exists so a future layout that
crosses itself does not silently fall back to a wrong piece.

### 10.2 Rotation-invariant tread art

Five original SVGs in `public/assets/paths/`, all sharing ONE tread band —
**68/160 of the tile, centred** — so arms line up across every tile boundary at
any rotation. Three rules make them rotation-safe:

- **No directional gradient.** The tread is a flat `#D9BD8B` fill. A vertical
  linear gradient (what the original pair used) rotates with the tile and
  mismatches its neighbour across a corner join. Depth comes instead from a
  clipped inner-edge contact shade, scattered grit/pebble specks, and the shared
  procedural normal/AO/roughness pass in `pbrMaterials.ts` — none of which need
  to line up.
- **No grass surround.** The surround is transparent, so the tread sits on the
  real procedural soil instead of pasting a lighter green square over it (which
  is what made the path read as a row of separated stepping stones).
- **Open arm ends overhang the viewBox** to -10/170. The crisp outer edge stroke
  is therefore clipped away at an arm END, so a tile join never shows a stroke
  drawn straight across the road, while the tread FILL still reaches the tile
  edge exactly. Path tiles are a full 1.0 tile wide (was 0.92) so adjacent
  treads abut with no gap.

### 10.3 Art→world orientation (measured, not assumed)

The mapping from a source SVG's own edges to world axes is:
**art right → world +X, art top → world −Z.**

The +X half follows from `groundBuilder.js`. The other half depends on whether
texture v = 0 samples the canvas top or bottom row, and it was **measured in the
running scene** (render a corner, project known tile centres to screen, see which
way the arms point) after being derived incorrectly once — the first attempt
produced mirrored corners with one arm pointing off the road. It is corroborated
independently: `assets.ts` uploads with `texture.update(false)` (invertY = false),
so v = 0 is the canvas's top row.

Consequence: because art-right is +X and art-top is −Z, a +90° mesh rotation
advances art directions **counter-clockwise** (up → left → down → right), which is
why `PATH_DIRECTION_OFFSETS` is ordered `[-Z, -X, +Z, +X]`.
`tests/unit/render.pathPieces.test.ts` pins the resulting classification and
rotation for the real layout so this cannot silently regress.

### 10.4 Conveyor flow direction rule

**Flow always points away from the Nursery, toward a habitat.** That is the
direction gameplay transport actually moves, so the visuals cannot contradict the
simulation. It is computed by breadth-first search outward from `NURSERY_TILE`
over the path graph: a tile's flow points at whichever neighbour is FURTHER from
the Nursery. Two special cases:

- A **dead end** (a habitat tile) has no neighbour further out, so it keeps
  travelling in the direction it was already heading — the conveyor points INTO
  the habitat rather than turning back.
- A **fan-out junction** has several outward neighbours and one overlay, so it
  takes the first deterministically. In the shipped layout that tile is the
  Nursery's own, entirely hidden under the mound.

Nothing scrolls in a global screen direction. Each tile carries HALF-tile overlay
segments — one for the half traffic arrives across, one for the half it leaves
across — each rotated so its own local +X is the travel direction. A single
shared scrolling material therefore animates the whole network correctly,
including round both corners and through the junction. Half-tiles rather than one
full-tile quad because a corner has no tread in the quadrant opposite its bend;
a full-tile quad spilled chevrons onto bare soil past every corner (caught in
browser QA).

### 10.5 Conveyor reduced-motion behaviour

The chevrons are directional by **shape** as well as by motion. That is what
makes the accessibility path honest: under reduced motion the scroll **stops
completely** (not "slows slightly") and the arrows still tell the player which
way traffic goes — the information survives, only the animation goes.

Implementation: `world.update` multiplies the scroll rate by
`MotionConfig.backgroundMotion`, which `getMotionConfig` sets to exactly `0`
under reduced motion. Verified in-browser: two screenshots two seconds apart with
the setting on are pixel-identical.

**Also fixed this pass:** the renderer only ever read the OS
`prefers-reduced-motion` media query, so the Settings panel's own "Reduced
motion" toggle changed the CSS but never reached ANY world animation — Sprout
bob, background drift and now the conveyor all kept moving for a player who had
explicitly asked them not to. `prefersReducedMotion()` now resolves
`<html data-reduced-motion>` (which `src/ui/prefs.ts` already wrote for exactly
this purpose, per its own doc comment) with the media query as fallback, and
`watchReducedMotion()` observes both sources so the toggle takes effect live.

## 11. Bevelled geometry pass (owner: E)

The player reported the models as "too low poly / extremely blocky", and the
source agreed: habitat drums were `MeshBuilder.CreateCylinder` at
**tessellation 6** (Ember Nook) and **8** (Sunflower Meadow) — visibly faceted
hexagonal and octagonal prisms with razor-sharp unbevelled vertical edges — and
the automation build sites were plain `CreateBox` cubes.

Every drum, mound and plinth is now built by one shared generator,
`createRoundedPrism` (`src/render/geometry.ts`):

- **Cross-section**: a rounded rectangle with a corner radius. Setting
  `cornerRadius === halfWidth === halfDepth` degenerates it to a true circle
  (habitat drums, Nursery mound at 48–56 segments); a smaller radius gives the
  soft-cornered garden-equipment plinth the automation sites want.
- **Vertical silhouette**: a ring profile (`drumProfile`) with a rounded top rim,
  a chamfered base, an optional taper, and an optional **wider foot with a shelf
  step** — a two-tier "pot with a foot" read in a single mesh and a single draw
  call. One mesh deliberately: automation site markers are semi-transparent until
  built, and stacked tier meshes would double-darken through the alpha blend.
- **Winding and normals are not guessed.** Both were read off Babylon's own
  `cylinderBuilder.js`/`mesh.vertexData.js`. Normals are supplied ANALYTICALLY
  rather than via `ComputeNormals`, because the side wall needs a duplicated seam
  column for a full 0..1 u and `ComputeNormals` would give those two seam
  vertices half their neighbouring facets each — a visible vertical shading seam
  down every drum.

**Heights and outer radii were deliberately held constant** (Ember Nook top
0.45, Dew Pond 0.325, Sunflower Meadow 0.40, Nursery 0.70, automation 0.50) so
every dependent measurement — standee anchors, Sprout settle heights, reaction
effect heights — kept its existing relationship. Confirmed by browser-measured
bounding boxes after the change.

**Asset scale rule (new):** any prop's dimensions live ONCE, in
`src/render/propDims.ts`, and both the mesh and everything that sits on top of it
are derived from that entry. Nothing may re-declare a prop's height, radius or
top-surface Y locally.

---

## 12. Procedural world generation (owner: E, this pass)

Before this pass the decorative layer was a fixed, hand-listed
`SCENERY_PLACEMENTS` array of 22 tiles, rendered as flat billboard cards on a
flat single-colour ground plane. The world is now GENERATED: terrain form,
water basins, the scatter of stone/foliage/ground-cover/fungi, all per-instance
material variation, and the entire first-expansion layer.

### 12.1 The determinism contract

**The same garden must appear on every reload, every machine and every
backend.** The previous hand-listed scatter got this for free; a generator has
to earn it. Five rules, enforced by `tests/unit/render.procgen.test.ts`:

1. **One seed.** `GARDEN_SEED` in `src/render/layout.ts` is a fixed literal.
   Layers derive sub-seeds by XOR from it, so changing the one constant
   re-rolls the whole garden coherently and nothing else can.
2. **No ambient entropy.** Nothing in the generator reads `Math.random`,
   `Date.now`, `performance.now`, the sim's PRNG (whose seed is sim state, not
   render's to read) or any per-session value.
3. **Positional hashing, not a stream PRNG.** Every decision is
   `rand01(seed, cellX, cellZ, channel)`. A sequential PRNG makes each draw
   depend on how many draws preceded it, so adding one shrub at the start
   silently reshuffles the entire garden and every *rejected* candidate
   perturbs everything after it. Positional hashing makes generation
   order-independent and locally stable: rejection sampling is free, and layers
   can be added, removed or retuned without disturbing their neighbours.
4. **Integer math** (`Math.imul`, `>>> 0`) so the hash is bit-exact across
   engines rather than dependent on float rounding.
5. **Generated once, at module load**, and frozen into exported arrays. The
   renderer cannot re-roll anything per frame or per session because it never
   holds the generator.

The unit test pins an order-independent digest of each layer, so re-rolling the
garden is a deliberate act (update the expected numbers) rather than a silent
regression.

### 12.2 Reserved space is a continuous field, not a tile flag

`isReservedTile` answers a TILE question — the right granularity for automation
placement, too coarse for decoration. A habitat drum is 2.6 world units across
(`src/render/propDims.ts`), i.e. it overhangs its own tile by more than a whole
tile in every direction, so a tile-only check was free to drop a rock halfway
inside the Dew Pond.

`reservedClearance(x, z)` returns the distance to the nearest reserved zone's
EDGE, where each zone's radius is the prop's real footprint plus breathing room
(habitats 1.6, Nursery 1.25, automation sites 0.85, path tiles 0.55). It is the
single gate used by terrain flattening AND every scatter layer, so "decoration
never lands on or deforms gameplay space" is one rule in one place.

Path clearance is deliberately only a little wider than the 0.2125 tread
half-width, which lets planting hug the verge — the look we want — without
landing on the tread.

### 12.3 Terrain

- **Two scales, not one.** A broad bank field (long wavelength, 72% of the
  amplitude) gives the garden readable large-scale form at the iso camera's
  shallow angle; a finer crumble rides on top. A single mid-scale octave set
  read as uniform noise — present in the vertex data, invisible on screen.
- **Amplitude is tiny (0.18 world units).** This is "loose soil that was raked,
  not levelled", not landscape relief. Anything larger starts occluding Sprouts
  at the garden camera's angle, trading readability for texture.
- **Flattened to exactly 0 under gameplay surfaces**, smoothly over a 0.9-unit
  band outside each reserved zone. Props, path tiles and contact shadows all
  assume the datum they were authored against; the undulation is decoration and
  is not allowed to move it. Asserted in the unit test.
- **Per-vertex tint** from the same height field: dry crests go warm ochre,
  damp hollows go deep moss, with an independent low-frequency patch field so
  the colour is not a pure function of the shape. Sized to stay inside a
  ~0.78–1.28 multiplier — the ground is the largest surface on screen and must
  gain material variety WITHOUT becoming a second saturated palette competing
  with the Sprouts.
- The soil base colour was changed from lawn green to **olive earth**. A flat
  mid-green plane read as a billiard table and gave the (green) foliage nothing
  to sit against. The green now comes from the moss drift in the vertex tint,
  so the ground reads as soil with moss growing on it — which is what it is.

### 12.4 Water basins

Basins are generated FIRST and are an input to the height field, so the
ordering is basins → terrain → everything standing on terrain.

**The waterline is derived, not chosen.** The bowl profile is
`-depth * (cos(pi*d/R)/2 + 0.5)`, so a water plane at height `S` meets the
floor where that expression equals `S`. Pond width and surface height are
therefore ONE parameter, not two. An earlier attempt in this pass picked them
independently (0.85R wide, 0.6 of depth above the floor); they described
inconsistent geometry, the water plane intersected the rising bowl well before
its own edge, the disc rim was buried in soil, and lily pads generated on that
plane ended up under the ground they floated over. `WATER_RADIUS_FRACTION`
now fixes both, and `basinSurfaceHeight()` is the single definition shared by
the lily generator and the water mesh.

The general terrain swell is **suppressed inside a basin** so the bowl is a
clean radially-symmetric dish. With the swell left in, one bank sits higher
than the other and a flat water plane pokes out of the high side.

Rim stones **straddle the waterline** rather than ringing it from dry land, so
the water's outline is physically interrupted by geometry from every angle.
This is the fix for the flat blue ellipse the water accents used to be.

### 12.5 Scatter

Jittered sub-grid per layer: one hashed roll decides whether a cell places
anything, further channels decide where inside the cell, which variant, size,
tilt and tint. Layers carry **density fields** so planting reads as responding
to its environment rather than as uniform noise:

| Layer | Density field |
|---|---|
| Pebbles | drier rises + basin shores |
| Boulders | flat (large, sparse) |
| Grass tufts | damp ground + path verge |
| Bushes | flat |
| Ferns | damp ground |
| Mushrooms | damp, shaded hollows; avoids dry rises |
| Lily pads | polar, per-basin (a rectangular cell grid over a 1.1-unit disc gives two pads or none) |

### 12.6 Visual subordination

GameRules §4.1 requires interactive elements to stay instantly distinguishable
from decoration. Concretely, and asserted in the unit test:

- Per-instance tint is a MULTIPLIER in [0.7, 1.35] with channel spread < 0.35 —
  variety without any single shrub becoming a saturated focal object.
- Decoration carries **no resting emissive** except lantern glass, which is the
  one decorative element that is meant to be a light source.
- Scenery stone is deliberately DARKER than a "correct" pebble grey. Browser QA
  showed a lighter stone reading brighter than the soil it sits on, pulling the
  eye onto decoration and away from the habitats.
- Blossoms are pastels, not focal colours.

### 12.7 Ambient motion

Foliage sway is a small root-pivoted lean (peak 0.085 rad) driven by rewriting
the thin-instance matrix buffer. It is gated on `MotionConfig.ambientIntensity`,
so reduced motion freezes it at the true rest pose — written exactly once on the
frame motion is disabled, not every frame. Rigid kinds (stone, kerb, lanterns,
mushrooms) never sway at all. Lantern fireflies scale with
`backgroundMotion * particleDensity`; lantern glow flicker freezes at its
resting brightness.

### 12.8 First expansion — "Decorative Expansion I" (GameRules §6.6)

§6.6 requires the first expansion to "make the world feel larger and more
personal, not merely increase capacity invisibly", and §2.3 requires every
meaningful unlock to produce a visible change. Buying it previously changed
nothing at all in the world.

It now reveals a second generated layer designed around three distinct reads:

1. **A larger world** — a low stone kerb rings the garden OUTSIDE the 16x16
   play grid, on apron the base garden never uses. The plot gains a defined
   edge, which reads as the garden having been extended out to it. Walked as a
   perimeter (not scattered) so the ring is unbroken, with per-block jitter so
   it reads as laid stones rather than extruded fence.
2. **A more personal world** — lanterns along the path verge, the first warm
   light sources the player owns rather than the ambient sun, with their own
   drifting fireflies.
3. **More life** — flowering blossoms and a denser moss carpet threaded through
   the existing planting, so the interior visibly fills in too.

The layer is generated deterministically at module load like everything else;
purchase only decides WHEN it becomes visible. That is what makes reload safe:
restoring a save rebuilds an identical garden, just without replaying the
celebration.

**Reveal choreography.** Staggered scale-in running OUTWARD from the garden
centre, so the layer reads as the garden growing rather than everything popping
at once, plus a sparkle burst at each new lantern to take the player's eye to
the change. Reduced motion still gets a reveal — §2.3's visible change is
information, not decoration — but a short, calm, non-overshooting one.

**Restoration is belt-and-braces, on purpose.** `src/main.ts` starts the sim
immediately and emits `save:loaded` after one IndexedDB read, while the renderer
is still behind `bootstrap()` and `loadManifest()`. The event has therefore
already been emitted and discarded (the bus has no replay) by the time
`world.ts` subscribes — verified in the browser, not assumed: after buying and
reloading, the Upgrades panel showed "Level 1 / 1" while the garden showed no
expansion meshes. `world.ts` keeps the subscription for the live path and ALSO
does a read-only `loadGame()` query; `revealExpansion` is idempotent so
whichever arrives first wins.

### 12.9 Geometry rules for generated scenery

- **Nothing is a single flat quad.** Even a blade of grass is a folded ribbon
  (three columns, raised midrib) so it has a cross-section and catches the key
  light differently along its length.
- Stones are **lobed, not noise-displaced**. High-frequency noise on a
  120-triangle mesh reads as faceting; a few large lobes read as a genuinely
  irregular boulder silhouette at gameplay distance.
- Normals are computed then **welded** across coincident vertices. Without the
  weld every revolved shape shows a shading seam down its duplicated UV seam
  column and every merged part shows a hard crease at its boundary.
- Multi-part objects merge into ONE master mesh where they share a material,
  and split into exactly as many masters as they need distinct materials
  (a lantern is two: opaque frame, emissive glass).
- Fronds **arch** — rise then bend over — rather than being pitched steeply
  downward. An earlier value rotated whole fronds ~70° below horizontal and
  buried their tips 0.46 units under the soil; caught by measuring bounding
  boxes in the browser, not by looking at a screenshot.

### 12.10 Retired assets

The five `scenery.*` SVGs (`rockSmall`, `rockLarge`, `fern`, `bush`,
`waterAccent`) are **no longer used by the renderer**. They were top-down
painted decals shown on flat billboard cards; the last art QA lowered the
Polish score specifically because those cards had become the placeholder
element in frame. The source art remains in `public/assets/scenery/` and in the
manifest, unreferenced. Nothing else changed about C's art.
