# Art QA Report — Tiny Terrarium Works, Phase 1

Reviewed against docs/ART_DIRECTION.md and the product brief's "AA browser-game quality" bar. This report reflects the game as actually rendered in-browser after integration, not the source SVGs in isolation (Subagent C separately verified those — see docs/ART_DIRECTION.md's own provenance/QA notes).

Screenshots referenced below live in `docs/qa-screenshots/`.

## Context: a real rendering defect was found and fixed during this pass

The first integrated build showed every "flat, top-down illustration" asset (Nursery, all three Habitats, both automation site markers, and every scenery piece) wrapped or smeared around a 3D volume mesh instead of reading as a picture sitting on top of it. Root cause: Babylon's `MeshBuilder.CreateCylinder`/`CreateBox` apply one UV rect across every face by default, so a single flat illustration gets stretched around drum sides and cube faces rather than shown top-down.

Fix (`src/render/flatArt.ts`): every such structure now has a plain untextured "volume" mesh (drum/box body) plus a separate flat disc/plane child mesh at the top carrying the actual manifest-keyed texture. A flat disc/plane's default UV is a clean, unwrapped 0..1 rect — exactly how the art was authored to be viewed. Applied to `src/render/world.ts` (Nursery, rocks, foliage), `src/render/habitats.ts` (all three habitats), and `src/render/automation.ts` (both site markers). See `docs/qa-screenshots/01-initial-garden-fresh.png` and `02-star-sprout-reveal.png` for the corrected result.

A second, related fix: the SVG-to-texture rasterizer (`src/render/assets.ts`) forced every asset into a **square** canvas regardless of source aspect ratio, stretching the 400×260 automation art. Fixed to letterbox (preserve aspect ratio, pad transparently) instead.

A third fix: the default camera framing (`src/render/camera.ts`) put Ember Nook close enough to the bottom HUD nav bar to be visually cramped and harder to target. Widened the default zoom (`DEFAULT_RADIUS` 16→19) and lowered the angle (`ISO_BETA` ~53°→~62° from vertical) so all three habitats sit comfortably in frame.

## Findings by criterion

| Criterion | Verdict | Notes |
|---|---|---|
| Readability at normal zoom | **Pass** | All three common Sprouts and the Star variant are clearly identifiable at the default camera distance once rendered via the flat-cap fix. See `02-star-sprout-reveal.png`. |
| Shape-based type distinction (not colour alone) | **Pass** | Verified at the source-SVG level by Subagent C (grayscale/96px check) and confirmed here in the rendered scene: Ember (flame-tuft crown), Dew (teardrop), Sun (radiating petals), Star (5-point aura) read as distinct silhouettes even before considering colour. |
| Consistent line weight / scale / lighting / shadow / proportion | **Pass** | All habitat and structure caps share the same flat-card treatment and sit at consistent scale relative to the grid; shadows come from one shared `ShadowGenerator` so lighting direction is consistent across the scene. |
| Habitat-match clarity | **Pass** | Each habitat's colour + distinct shape (hexagon/octagon/disc) + its own reactive glow on correct placement makes the "which Sprout goes where" relationship legible without reading text. |
| No broken transparent edges | **Pass** | No hard-edged artifacts observed on any asset at default or zoomed-in view; SVG alpha channels rasterize cleanly through the `<img>` → canvas path. |
| No blurry / stretched scaling | **Pass** (after fix) | The 400×260 automation art no longer stretches into a square; verified by inspecting both site markers post-fix. |
| No unreadable UI | **Pass** | HUD, nav, and panel text all meet a comfortable size at both desktop and the tested 390×844 mobile viewport (`07-mobile-viewport.png`). One caveat below. |
| No placeholder feel | **Pass** | Every gameplay-relevant object (Nursery, habitats, automations, scenery) now shows real illustrated art, not a flat-colour or default-material placeholder. |

## Minor items noted, not blocking

- **Dev-only debug panel obstructs a meaningful fraction of the mobile viewport** (`07-mobile-viewport.png`). This panel is `isDev`-gated and absent from production builds (verified separately by the automated QA suite), so it has no bearing on the shipped experience — noted for anyone doing future dev-mode mobile testing, not a product defect.
- **Mobile nav bar labels are visually tight** at 390px width (icons remain clear; text is small but present). Acceptable for Phase 1; a candidate for a follow-up pass if mobile becomes a primary target.
- **Ground/terrain plane is a flat solid colour**, not an illustrated texture — this is intentional per scope (Subagent C's asset list covers creatures/habitats/structures/scenery, not a separate ground texture) rather than a missing-asset bug, and reads acceptably as "soil/lawn" given the scenery scattered across it.

## Final acceptance

**Accepted.** Every required criterion passes as actually rendered in-browser, after the fixes described above. This is a genuine "AA browser-game quality" bar for a Phase 1 vertical slice: cohesive palette, readable silhouettes at default zoom, consistent lighting/shadow treatment, and no placeholder-looking surfaces — not a claim of AAA/photorealistic fidelity, which was explicitly descoped in favour of this cosy 2.5D vector style earlier in the session.
