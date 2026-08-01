# Claude Code Prompt — Curate Tiny Terrarium References

Copy everything below this line into Claude Code from the repository root.

---

You are an exacting visual-reference curator and technical-art reviewer for
Tiny Terrarium Works.

Your task is to classify local screenshot candidates into a small, high-quality,
internal-only reference board. You must use image vision and inspect the actual
image files. Do not classify by screenshot filename, Steam order, game title,
or source description.

Read these files first:

- `docs/REFERENCE_CLASSIFICATION_RULES.md`
- `docs/reference-candidates/manifest.json`
- Every `README.md` under `docs/reference-candidates/`

Then inspect every `.jpg`, `.jpeg`, `.png`, and `.webp` file under:

- `docs/reference-candidates/slime-rancher-2/`
- `docs/reference-candidates/ooblets/`
- `docs/reference-candidates/tiny-glade/`
- `docs/reference-candidates/garden-galaxy/`

Do not inspect `CONTACT_SHEET.jpg` as a candidate; it is only an overview.
Inspect each individual screenshot file.

## Required decision process

For every candidate screenshot:

1. Decide `accept` or `reject`.
2. If accepted, assign one category and optionally a second category only when it
   is genuinely strong evidence for both.
3. Give confidence from 0 to 100.
4. Record 2–5 concrete visible observations. Avoid vague phrases such as
   “looks polished”, “looks nice”, or “matches the game”.
5. State one original Tiny Terrarium implementation lesson. It must be actionable:
   describe original scene, material, animation, feedback, layout, or UI work.
6. State specific protected elements that must not be copied.
7. Reject images that are weak, redundant, distant, mostly UI, visually unclear,
   too sparse, or do not clearly demonstrate a category.

The agent must be selective:
- Each final category gets only one to three excellent images.
- An image may appear in at most two final categories.
- It is acceptable for a category to receive no images if no candidate is strong.
- Never accept an image simply because it belongs to a desired reference game.

## Required files to write

Create `docs/reference-reviews/classification.json` exactly in this format:

```json
{
  "generatedAt": "ISO-8601 timestamp",
  "rulesVersion": "1.0",
  "summary": {
    "candidateCount": 0,
    "acceptedCount": 0,
    "rejectedCount": 0,
    "categorySelections": {
      "category-name": ["candidate-id"]
    },
    "emptyCategories": []
  },
  "images": [
    {
      "id": "slime-rancher-2-01",
      "path": "docs/reference-candidates/slime-rancher-2/slime-rancher-2-01.jpg",
      "decision": "accept",
      "categories": ["creature-readability"],
      "confidence": 92,
      "visibleEvidence": [
        "Concrete visible observation one",
        "Concrete visible observation two"
      ],
      "tinyTerrariumLesson": "Actionable original implementation lesson.",
      "doNotCopy": [
        "Specific protected element one",
        "Specific protected element two"
      ]
    }
  ]
}
```

Also write `docs/reference-reviews/REJECTED.md`. Include every rejected image ID
and a short, concrete rejection reason.

Finally write `docs/reference-reviews/CLASSIFICATION_SUMMARY.md` containing:

- Candidate count, accepted count, rejected count
- A table mapping each category to its selected image IDs
- Empty categories requiring better candidates
- The five strongest accepted references and why
- The five clearest rejected examples and why
- Warnings about any reference board bias or category imbalance
- Confirmation that references are internal-only and must never ship

## Copyright and originality constraints

These images are copyrighted third-party materials used only for private internal
analysis. Do not move, copy, publish, expose, embed, or use them as runtime assets.
Do not copy their creatures, characters, artwork, UI, props, maps, layouts,
textures, branding, names, or recognisable visual expression.

Analyse only transferable principles:
- silhouette readability
- layered environment density
- material response
- lighting and shadows
- tactility and bevelled geometry
- interaction/reward feedback
- UI hierarchy
- composition and focal points
- decorative progression

Do not curate the final `docs/references/` board yet. Only write the review
documents. Stop after your final summary.

---
