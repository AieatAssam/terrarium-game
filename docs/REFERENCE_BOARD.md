# Tiny Terrarium Works — Curated Quality Reference Board

## Status

This board contains copyrighted third-party screenshots for private internal
quality analysis only. They are never runtime assets and must never be included
in `src/`, `public/`, `assets/`, `dist/`, releases, marketing, or deployment.

The game must remain visually and mechanically original. Use references only to
study measurable principles: readability, material depth, environmental layers,
animation, feedback, composition, UI hierarchy, and decorative progression.

## Reference use protocol

Before a player-facing visual or gameplay change:

1. Read this document and the relevant `docs/_scratch/GameRules.md` section.
2. Open only the relevant approved image(s) in `docs/references/`.
3. Read the adjacent `.md` rationale for every image used.
4. Convert its transferable lesson into an original, concrete acceptance criterion.
5. Implement and validate at the actual gameplay camera distance.
6. Record screenshot evidence and a score in `docs/visual-qa/improvement-log.md`.

Never use a screenshot as permission to copy its visual expression.

## Required reference mapping

| Work area | Read first | Judge by |
|---|---|---|
| Sprout redesign | `slime-rancher-2/creature-readability/` and `ooblets/creature-personality/` | Distinct silhouette, volume, readable face, animated personality, habitat reaction |
| Habitat/world improvement | `slime-rancher-2/habitat-density/` and `ooblets/garden-composition/` | Foreground/midground/background, visual density, readable interaction targets, habitat identity |
| Babylon material/lighting pass | `tiny-glade/lighting-materials/` and `tiny-glade/tactile-geometry/` | Bevels, PBR response, normal detail, roughness variation, AO, contact shadows, warm/cool light |
| Garden decoration/unlocks | `garden-galaxy/collection-density/` and `garden-galaxy/decorative-progression/` | Each unlock makes the space visibly more personal, rich, and complete |
| Reward/UI pass | `slime-rancher-2/reward-feedback/` and `ooblets/ui-readability/` | Player action causes immediate readable world/UI/audio response |

## Non-negotiable visual acceptance

A player-facing visual pass is incomplete if any apply:

- Sprouts appear as flat icons, featureless spheres, or recoloured duplicates.
- Terrain is a mostly empty plane or a repeated texture with no layers.
- Habitats look like generic props rather than distinct living homes.
- Buildings appear to float, have no contact depth, or use default materials.
- The scene depends on bloom to look magical.
- Correct placement only changes a number rather than visibly transforming the world.
- A rare Sprout is only a palette swap.
- The screenshot looks like a prototype or debug build at normal camera distance.

## Scoring rubric

Score every changed area 1–5:

| Score | Meaning |
|---|---|
| 1 | Placeholder/prototype; not fit for player-facing build |
| 2 | Functional but flat, sparse, generic, or weakly readable |
| 3 | Coherent baseline; still lacks strong material, animation, or scene polish |
| 4 | Polished, tactile, expressive, and comparable to the intended quality principles |
| 5 | Exceptional, distinctive, highly appealing, and ready to be a reference itself |

Minimum required score is 4 for:
- Creature appeal and readability
- Immediate interaction/reward satisfaction
- Material richness and tactile depth
- Garden density and environmental storytelling
- Lighting and atmosphere
- Animation quality
- Automation readability
- UI polish
- Accessibility
- Browser performance

A score of 3 is not “done”; it is a documented next improvement.
