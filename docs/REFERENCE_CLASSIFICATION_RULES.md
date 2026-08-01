# Tiny Terrarium Works — Screenshot Classification Rules

## Purpose

Classify internal-only screenshot candidates by the **observable visual or gameplay
quality principle** that they demonstrate for Tiny Terrarium Works.

This is not a style-copy exercise. The agent must evaluate original, measurable
qualities such as creature silhouette, material depth, scene composition, lighting,
feedback, visual hierarchy, and decoration density.

## Copyright and originality rule

Every image in `docs/reference-candidates/` is copyrighted third-party material.

- Never ship, embed, publish, redistribute, hotlink, train on, or use these images
  as game assets.
- Never copy characters, creature forms, faces, props, world layouts, UI, names,
  logos, textures, music, or branded visual motifs.
- Use only the documented observable lesson to improve original Tiny Terrarium work.

## Selection standard

- Inspect actual visible screenshot evidence, not filename, screenshot position,
  game title, or source description.
- Accept only images that strongly demonstrate a named category.
- Reject weak, distant, redundant, UI-dominated, empty, low-information, or
  category-mismatched frames.
- Assign at most **two** categories to an image. Prefer one strong assignment.
- Limit each final category to **one to three** excellent references.
- It is valid for a category to have no selected image if no candidate meets the
  standard. Report this honestly.

## Categories

### `creature-readability`

**Preferred reference game:** `slime-rancher-2`

**Accept only if**
- A creature is large enough to inspect at ordinary gameplay distance
- Its silhouette is identifiable without relying only on colour
- Its form has volume, lighting, or material response
- It separates clearly from background scenery
- The frame can teach original Sprout readability or character appeal

**Reject if**
- The creature is distant, obscured, peripheral, or tiny
- The frame is mainly empty landscape, UI, or visual clutter

### `habitat-density`

**Preferred reference game:** `slime-rancher-2`

**Accept only if**
- Foreground, midground, and background are visibly present
- Terrain includes layered detail such as plants, rocks, paths, water, props, or elevation
- The scene feels rich but key objects remain readable
- The frame can teach construction of an inviting Sprout habitat

**Reject if**
- The environment is mostly empty sky, fog, flat land, or unrelated UI

### `reward-feedback`

**Preferred reference game:** `slime-rancher-2`

**Accept only if**
- A reward, collection, creature reaction, satisfying action, or clear feedback event is visible
- The cause-and-effect relationship can be reasonably inferred from the frame

**Reject if**
- The image is only an idle landscape or static beauty shot

### `garden-composition`

**Preferred reference game:** `ooblets`

**Accept only if**
- Paths, plants, structures, props, and open space feel deliberately composed
- The space feels colourful, approachable, and authored
- The image teaches a garden that is full without becoming confusing

**Reject if**
- The frame is too sparse, too UI-dominated, or lacks a garden-space composition

### `creature-personality`

**Preferred reference game:** `ooblets`

**Accept only if**
- Pose, grouping, expression, animation implication, or context strongly conveys creature personality
- The frame can guide original Sprout animation, idles, or habitat reactions

**Reject if**
- The creature is too small or the frame cannot communicate behaviour/personality

### `ui-readability`

**Preferred reference game:** `ooblets`

**Accept only if**
- The UI clearly communicates a player decision, collection, reward, build interaction, or progress
- Hierarchy, labelling, colour, and layout read at normal scale

**Reject if**
- The UI is too small, transient, obscured, or unrelated to game decisions

### `lighting-materials`

**Preferred reference game:** `tiny-glade`

**Accept only if**
- Lighting clearly reveals depth, material contrast, contact shadows, or form
- Surface response or tactile geometry is visible enough to inspect
- The frame can guide Babylon PBR, normal map, roughness, AO, or lighting work

**Reject if**
- The image is too dark, blown out, filtered, or too distant to inspect form

### `tactile-geometry`

**Preferred reference game:** `tiny-glade`

**Accept only if**
- Key objects visibly use bevels, layered construction, rounded forms, or intentional silhouette complexity
- The frame can teach 'not blocky / not flat' construction

**Reject if**
- Important forms are too distant or cannot be distinguished from flat surfaces

### `scene-composition`

**Preferred reference game:** `tiny-glade`

**Accept only if**
- There is a focal point, depth layers, foreground framing, and a readable visual route through the scene
- The image can guide camera framing and environment storytelling

**Reject if**
- The frame lacks a focal point or is too visually empty to teach composition

### `collection-density`

**Preferred reference game:** `garden-galaxy`

**Accept only if**
- A personal space gains charm from many distinct collectible objects
- Items form a readable composition rather than random clutter
- The frame demonstrates 'one more unlock improves my garden'

**Reject if**
- Objects are too sparse, repetitive, or do not visibly form a personal collection space

### `decorative-progression`

**Preferred reference game:** `garden-galaxy`

**Accept only if**
- The frame suggests an intentionally personalised and increasingly complete space
- The image can guide decorative unlocks that visibly improve world appearance

**Reject if**
- The frame does not make decoration/progression visually legible


## Required analysis output for every image

- Image ID and local file path
- `accept` or `reject`
- One or two assigned categories, if accepted
- Confidence from 0 to 100
- Two to five specific visible observations
- One original Tiny Terrarium implementation lesson
- Protected elements that must not be copied
