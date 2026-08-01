# Reference Classification Summary

Generated: 2026-08-01 · Rules version 1.0
Method: every individual screenshot under `docs/reference-candidates/` was
inspected with image vision (CONTACT_SHEET.jpg files were not used as evidence;
filename, order, and source game were not used as classification evidence).

- **Candidates reviewed:** 48 (13 slime-rancher-2, 20 ooblets, 9 tiny-glade, 6 garden-galaxy)
- **Accepted:** 27
- **Rejected:** 21 (see `REJECTED.md`)

## Category selections

| Category | Selected images |
|---|---|
| creature-readability | slime-rancher-2-01, ooblets-04, ooblets-20 |
| habitat-density | slime-rancher-2-06, slime-rancher-2-12, ooblets-14 |
| reward-feedback | tiny-glade-01, slime-rancher-2-05, ooblets-11 |
| garden-composition | ooblets-01, garden-galaxy-04, garden-galaxy-06 |
| creature-personality | slime-rancher-2-02, ooblets-04, ooblets-02 |
| ui-readability | ooblets-09, ooblets-06, tiny-glade-03 |
| lighting-materials | slime-rancher-2-07, tiny-glade-09, ooblets-17 |
| tactile-geometry | tiny-glade-02, ooblets-03, tiny-glade-09 |
| scene-composition | slime-rancher-2-13, garden-galaxy-03, ooblets-13 |
| collection-density | garden-galaxy-04, ooblets-19 |
| decorative-progression | garden-galaxy-06, ooblets-07, slime-rancher-2-05 |

## Empty categories

None — every category found at least two strong candidates. However,
`collection-density` has only two selections and no strong candidate from its
preferred reference game beyond garden-galaxy-04; if the board grows, one more
clean collection-space frame would balance it.

## Five strongest accepted references

1. **ooblets-04** (creature-readability + creature-personality, 92) — eight-plus
   close-range creatures, each with a unique silhouette hook and readable
   expression; the single best Sprout-readability teacher in the set.
2. **tiny-glade-01** (reward-feedback, 90) — explicit cause-and-effect affection
   event (pet → heart) inside a three-layer dense habitat; the clearest
   feedback frame of all 48.
3. **garden-galaxy-06** (garden-composition + decorative-progression, 90) —
   fully dressed symmetrical courtyard where progression visibly *finishes* a
   space (softened edges, paired props, framing pergola).
4. **slime-rancher-2-06** (habitat-density, 90) — greenhouse divided into
   readable authored zones with a helper unit visibly working; the model for a
   "worked-in, not staged" terrarium.
5. **slime-rancher-2-02** (creature-personality, 90) — stacking/perching social
   behaviour plus props-turned-planters; the strongest behaviour-implying frame.

## Five clearest rejected examples

1. **tiny-glade-07** — photo-filter gallery of 8 near-identical thumbnails;
   pure redundancy with zero per-rubric information.
2. **tiny-glade-06** — long-distance painterly beauty shot; nothing inspectable,
   no interaction, no category.
3. **slime-rancher-2-11** — storm VFX blowout; materials flattened by
   filtering, creatures obscured.
4. **garden-galaxy-02** — small floating recipe UI over bare dirt tiles and
   empty margins; fails every bar it touches.
5. **ooblets-08** — dark branded-machine vignette with one small creature; no
   feedback, UI decision, or habitat layering.

## Bias and imbalance warnings

- **Source-game imbalance:** ooblets supplied 13 of 27 accepts; garden-galaxy
  only 3 (and 2 of its 6 candidates were rejected outright). The board skews
  toward ooblets' chunky-toy aesthetic.
- **Screenshot-type bias:** 5 of 9 tiny-glade candidates were photo-mode or
  filtered beauty shots and were rejected wholesale — the accepted tiny-glade
  frames all happen to be night scenes, so lighting reference skews dark/warm;
  there is no accepted bright-daylight PBR reference.
- **Creature coverage:** creature categories lean entirely on slime-rancher-2
  and ooblets; no tiny-glade/garden-galaxy frame showed a usable creature
  (creatures absent or statue-scale).
- **UI coverage:** all three ui-readability picks are in-world/HUD decision
  moments; there is no accepted inventory/collection-screen reference.

## Copyright confirmation

All reviewed images are copyrighted third-party materials held for **private,
internal analysis only**. They must never ship, be published, redistributed,
embedded, hotlinked, or used as runtime or training assets. Only the documented
transferable lessons may inform original Tiny Terrarium Works art, code, and
design. No screenshots were moved or copied during this review.
