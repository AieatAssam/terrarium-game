#!/usr/bin/env python3
"""
Tiny Terrarium Works — Internal Screenshot Reference Board

Pipeline:
1. Download official public Steam storefront screenshot candidates.
2. Store them in docs/reference-candidates/<game>/.
3. Generate contact sheets and candidate manifests.
4. Generate classification rules and a Claude Code review prompt.
5. After Claude writes docs/reference-reviews/classification.json:
   copy accepted images into docs/references/<game>/<category>/.

IMPORTANT:
- Downloaded screenshots remain copyrighted third-party material.
- They are internal visual-analysis references only.
- Never place them in src/assets, public, dist, or any shipped build directory.
- Never ship, publish, embed, hotlink, train on, redistribute, or use them as
  game assets.
- The purpose is to study observable quality principles, never to copy protected
  characters, artwork, props, UI, layouts, branding, names, or textures.

Usage:
  python3 scripts/build-reference-board.py download
  python3 scripts/build-reference-board.py prompt
  python3 scripts/build-reference-board.py curate
  python3 scripts/build-reference-board.py all

Optional:
  python3 scripts/build-reference-board.py download --max 14
  python3 scripts/build-reference-board.py clean-candidates
  python3 scripts/build-reference-board.py clean-curated

Requirements:
  python3 -m pip install Pillow
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import sys
import textwrap
import time
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

try:
    from PIL import Image, ImageDraw, ImageFont, ImageOps
except ImportError:
    print("Missing dependency: Pillow", file=sys.stderr)
    print("Install it with: python3 -m pip install Pillow", file=sys.stderr)
    raise SystemExit(1)


# ---------------------------------------------------------------------------
# Project paths
# ---------------------------------------------------------------------------

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
CANDIDATES = DOCS / "reference-candidates"
REFERENCES = DOCS / "references"
REVIEWS = DOCS / "reference-reviews"
SCRIPTS = ROOT / "scripts"

CANDIDATE_MANIFEST = CANDIDATES / "manifest.json"
CLASSIFICATION_RULES = DOCS / "REFERENCE_CLASSIFICATION_RULES.md"
CLAUDE_PROMPT = DOCS / "CLAUDE_REFERENCE_CLASSIFICATION_PROMPT.md"
CLASSIFICATION = REVIEWS / "classification.json"
REJECTED_REPORT = REVIEWS / "REJECTED.md"
CURATION_REPORT = REVIEWS / "CURATION_REPORT.md"

USER_AGENT = "TinyTerrariumWorksInternalReferenceBoard/1.0 (+local-internal-use)"
DEFAULT_MAX_IMAGES = 14
DOWNLOAD_DELAY_SECONDS = 0.20

# Official Steam App IDs. Images come from Steam's public store metadata API.
# This is a candidate feed only. No gallery index is treated as a quality ranking.
GAMES: dict[str, dict[str, Any]] = {
    "slime-rancher-2": {
        "title": "Slime Rancher 2",
        "steam_app_id": 1657630,
        "official_store_page": "https://store.steampowered.com/app/1657630/Slime_Rancher_2/",
        "official_media_page": "https://www.slimerancher.com/media/",
        "candidate_purpose": [
            "Creature silhouette and creature appeal",
            "Creature-to-environment contrast",
            "Colourful habitat density",
            "Physical material richness and world depth",
            "Satisfying collection/care feedback",
        ],
        "do_not_copy": [
            "Slime shapes, faces, names, colour combinations, UI, world design",
            "Props, technology, ranch layouts, textures, music, branding",
        ],
        "recommended_categories": [
            "creature-readability",
            "habitat-density",
            "reward-feedback",
        ],
    },
    "ooblets": {
        "title": "Ooblets",
        "steam_app_id": 593150,
        "official_store_page": "https://store.steampowered.com/app/593150/Ooblets/",
        "official_media_page": "https://ooblets.com/media",
        "candidate_purpose": [
            "Cheerful garden composition",
            "Creature personality and friendly context",
            "Chunky prop density",
            "Accessible visual hierarchy and UI",
        ],
        "do_not_copy": [
            "Ooblet designs, character designs, farming layouts, UI, dance systems",
            "Artwork, colour palettes as a whole, props, branding, names",
        ],
        "recommended_categories": [
            "garden-composition",
            "creature-personality",
            "ui-readability",
        ],
    },
    "tiny-glade": {
        "title": "Tiny Glade",
        "steam_app_id": 2198150,
        "official_store_page": "https://store.steampowered.com/app/2198150/Tiny_Glade/",
        "official_media_page": "https://pouncelight.games/tiny-glade/",
        "candidate_purpose": [
            "Soft lighting and form separation",
            "Tactile bevelled geometry",
            "Material depth and contact shadows",
            "Miniature scene composition and visual transformation",
        ],
        "do_not_copy": [
            "Buildings, castle/cottage forms, layouts, iconography, textures, UI",
            "Artwork, branding, names, or identifiable visual motifs",
        ],
        "recommended_categories": [
            "lighting-materials",
            "tactile-geometry",
            "scene-composition",
        ],
    },
    "garden-galaxy": {
        "title": "Garden Galaxy",
        "steam_app_id": 1970460,
        "official_store_page": "https://store.steampowered.com/app/1970460/Garden_Galaxy/",
        "official_media_page": "https://store.steampowered.com/app/1970460/Garden_Galaxy/",
        "candidate_purpose": [
            "Collectible decorative density",
            "Player-authored miniature garden composition",
            "Visible decorative progression",
            "A personal space improving through distinct objects",
        ],
        "do_not_copy": [
            "Item art, bubble mechanic, UI, props, layouts, branding, names",
            "Textures, exact collectable designs, or any game assets",
        ],
        "recommended_categories": [
            "collection-density",
            "decorative-progression",
        ],
    },
}

CATEGORIES: dict[str, dict[str, Any]] = {
    "creature-readability": {
        "game": "slime-rancher-2",
        "accept_if": [
            "A creature is large enough to inspect at ordinary gameplay distance",
            "Its silhouette is identifiable without relying only on colour",
            "Its form has volume, lighting, or material response",
            "It separates clearly from background scenery",
            "The frame can teach original Sprout readability or character appeal",
        ],
        "reject_if": [
            "The creature is distant, obscured, peripheral, or tiny",
            "The frame is mainly empty landscape, UI, or visual clutter",
        ],
    },
    "habitat-density": {
        "game": "slime-rancher-2",
        "accept_if": [
            "Foreground, midground, and background are visibly present",
            "Terrain includes layered detail such as plants, rocks, paths, water, props, or elevation",
            "The scene feels rich but key objects remain readable",
            "The frame can teach construction of an inviting Sprout habitat",
        ],
        "reject_if": [
            "The environment is mostly empty sky, fog, flat land, or unrelated UI",
        ],
    },
    "reward-feedback": {
        "game": "slime-rancher-2",
        "accept_if": [
            "A reward, collection, creature reaction, satisfying action, or clear feedback event is visible",
            "The cause-and-effect relationship can be reasonably inferred from the frame",
        ],
        "reject_if": [
            "The image is only an idle landscape or static beauty shot",
        ],
    },
    "garden-composition": {
        "game": "ooblets",
        "accept_if": [
            "Paths, plants, structures, props, and open space feel deliberately composed",
            "The space feels colourful, approachable, and authored",
            "The image teaches a garden that is full without becoming confusing",
        ],
        "reject_if": [
            "The frame is too sparse, too UI-dominated, or lacks a garden-space composition",
        ],
    },
    "creature-personality": {
        "game": "ooblets",
        "accept_if": [
            "Pose, grouping, expression, animation implication, or context strongly conveys creature personality",
            "The frame can guide original Sprout animation, idles, or habitat reactions",
        ],
        "reject_if": [
            "The creature is too small or the frame cannot communicate behaviour/personality",
        ],
    },
    "ui-readability": {
        "game": "ooblets",
        "accept_if": [
            "The UI clearly communicates a player decision, collection, reward, build interaction, or progress",
            "Hierarchy, labelling, colour, and layout read at normal scale",
        ],
        "reject_if": [
            "The UI is too small, transient, obscured, or unrelated to game decisions",
        ],
    },
    "lighting-materials": {
        "game": "tiny-glade",
        "accept_if": [
            "Lighting clearly reveals depth, material contrast, contact shadows, or form",
            "Surface response or tactile geometry is visible enough to inspect",
            "The frame can guide Babylon PBR, normal map, roughness, AO, or lighting work",
        ],
        "reject_if": [
            "The image is too dark, blown out, filtered, or too distant to inspect form",
        ],
    },
    "tactile-geometry": {
        "game": "tiny-glade",
        "accept_if": [
            "Key objects visibly use bevels, layered construction, rounded forms, or intentional silhouette complexity",
            "The frame can teach 'not blocky / not flat' construction",
        ],
        "reject_if": [
            "Important forms are too distant or cannot be distinguished from flat surfaces",
        ],
    },
    "scene-composition": {
        "game": "tiny-glade",
        "accept_if": [
            "There is a focal point, depth layers, foreground framing, and a readable visual route through the scene",
            "The image can guide camera framing and environment storytelling",
        ],
        "reject_if": [
            "The frame lacks a focal point or is too visually empty to teach composition",
        ],
    },
    "collection-density": {
        "game": "garden-galaxy",
        "accept_if": [
            "A personal space gains charm from many distinct collectible objects",
            "Items form a readable composition rather than random clutter",
            "The frame demonstrates 'one more unlock improves my garden'",
        ],
        "reject_if": [
            "Objects are too sparse, repetitive, or do not visibly form a personal collection space",
        ],
    },
    "decorative-progression": {
        "game": "garden-galaxy",
        "accept_if": [
            "The frame suggests an intentionally personalised and increasingly complete space",
            "The image can guide decorative unlocks that visibly improve world appearance",
        ],
        "reject_if": [
            "The frame does not make decoration/progression visually legible",
        ],
    },
}


# ---------------------------------------------------------------------------
# Utility functions
# ---------------------------------------------------------------------------

def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def ensure_dir(path: Path) -> None:
    path.mkdir(parents=True, exist_ok=True)


def fetch_bytes(url: str) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": USER_AGENT,
            "Accept": "application/json,image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
        },
    )
    try:
        with urlopen(request, timeout=45) as response:
            return response.read()
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code} fetching {url}") from exc
    except URLError as exc:
        raise RuntimeError(f"Network error fetching {url}: {exc.reason}") from exc


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    ensure_dir(path.parent)
    path.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def delete_directory(path: Path) -> None:
    if path.exists():
        shutil.rmtree(path)
        print(f"Deleted: {path.relative_to(ROOT)}")
    else:
        print(f"Nothing to delete: {path.relative_to(ROOT)}")


def font(size: int) -> ImageFont.ImageFont:
    candidates = [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/Supplemental/Helvetica.ttf",
        "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
        "C:\\Windows\\Fonts\\arial.ttf",
    ]
    for candidate in candidates:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size=size)
    return ImageFont.load_default()


def clean_image(data: bytes, max_dimension: int = 1920) -> Image.Image:
    image = Image.open(BytesIO(data))
    image = ImageOps.exif_transpose(image).convert("RGB")
    image.thumbnail((max_dimension, max_dimension), Image.Resampling.LANCZOS)
    return image


def image_extension(image: Image.Image) -> str:
    return ".jpg"


# ---------------------------------------------------------------------------
# Steam candidate download
# ---------------------------------------------------------------------------

def get_steam_screenshots(app_id: int) -> list[dict[str, Any]]:
    url = f"https://store.steampowered.com/api/appdetails?appids={app_id}&l=en&cc=gb"
    payload = json.loads(fetch_bytes(url).decode("utf-8"))
    app = payload.get(str(app_id))

    if not app or not app.get("success"):
        raise RuntimeError(f"Steam app details request failed for app ID {app_id}")

    screenshots = app.get("data", {}).get("screenshots", [])
    if not screenshots:
        raise RuntimeError(f"No public Steam screenshots returned for app ID {app_id}")

    return screenshots


def write_candidate_readme(game_slug: str, records: list[dict[str, Any]]) -> None:
    game = GAMES[game_slug]
    destination = CANDIDATES / game_slug / "README.md"

    candidate_lines: list[str] = []

    for record in records:
        candidate_lines.append(
            f"- `{record['id']}` — `{record['file']}`"
        )
        candidate_lines.append(
            f"  - Official Steam screenshot: "
            f"{record['official_screenshot_url']}"
        )

    text = f"""# {game['title']} — Screenshot Candidate Review Queue

## Internal-only copyright notice

These are copyrighted third-party screenshots downloaded from the official public
Steam storefront metadata for internal visual and UX analysis only.

They must never be shipped, embedded, published, redistributed, hotlinked,
included in a build, or used as game assets. Do not copy characters, props,
worlds, UI, layouts, artwork, textures, names, branding, or other protected
expression.

## Why these files exist

This folder is a **candidate queue**, not an approved reference board.
Steam gallery order is not a quality ranking. Claude must inspect visible
evidence and reject images that do not demonstrate a useful criterion.

## Official sources

- Official Steam store page: {game['official_store_page']}
- Official media/press page: {game['official_media_page']}
- Steam metadata endpoint:
  `https://store.steampowered.com/api/appdetails?appids={game['steam_app_id']}&l=en&cc=gb`

## Intended evaluation themes

{chr(10).join(f"- {item}" for item in game['candidate_purpose'])}

## Protected content never to copy

{chr(10).join(f"- {item}" for item in game['do_not_copy'])}

## Candidate files

{chr(10).join(candidate_lines)}
"""
    destination.write_text(text, encoding="utf-8")


def write_candidate_readme_bad(game_slug: str, records: list[dict[str, Any]]) -> None:
    game = GAMES[game_slug]
    destination = CANDIDATES / game_slug / "README.md"

    candidate_lines = [
        f"- `{record['id']}` — `{record['file']}`",
        *[
            f"  - Official Steam screenshot: {record['official_screenshot_url']}"
            for record in records
        ],
    ]

    text = f"""# {game['title']} — Screenshot Candidate Review Queue

## Internal-only copyright notice

These are copyrighted third-party screenshots downloaded from the official public
Steam storefront metadata for internal visual and UX analysis only.

They must never be shipped, embedded, published, redistributed, hotlinked,
included in a build, or used as game assets. Do not copy characters, props,
worlds, UI, layouts, artwork, textures, names, branding, or other protected
expression.

## Why these files exist

This folder is a **candidate queue**, not an approved reference board.
Steam gallery order is not a quality ranking. Claude must inspect visible
evidence and reject images that do not demonstrate a useful criterion.

## Official sources

- Official Steam store page: {game['official_store_page']}
- Official media/press page: {game['official_media_page']}
- Steam metadata endpoint:
  `https://store.steampowered.com/api/appdetails?appids={game['steam_app_id']}&l=en&cc=gb`

## Intended evaluation themes

{chr(10).join(f"- {item}" for item in game['candidate_purpose'])}

## Protected content never to copy

{chr(10).join(f"- {item}" for item in game['do_not_copy'])}

## Candidate files

{chr(10).join(candidate_lines)}
"""
    destination.write_text(text, encoding="utf-8")


def create_contact_sheet(game_slug: str, records: list[dict[str, Any]]) -> None:
    game_dir = CANDIDATES / game_slug
    out = game_dir / "CONTACT_SHEET.jpg"

    thumb_width = 360
    thumb_height = 220
    label_height = 58
    padding = 16
    columns = 3
    rows = math.ceil(len(records) / columns)

    canvas_width = padding + columns * (thumb_width + padding)
    canvas_height = padding + rows * (thumb_height + label_height + padding)
    canvas = Image.new("RGB", (canvas_width, canvas_height), "#111723")
    draw = ImageDraw.Draw(canvas)

    title_font = font(22)
    metadata_font = font(14)

    for index, record in enumerate(records):
        x = padding + (index % columns) * (thumb_width + padding)
        y = padding + (index // columns) * (thumb_height + label_height + padding)

        image = Image.open(ROOT / record["file"]).convert("RGB")
        image.thumbnail((thumb_width, thumb_height), Image.Resampling.LANCZOS)

        frame = Image.new("RGB", (thumb_width, thumb_height), "#273044")
        frame.paste(
            image,
            ((thumb_width - image.width) // 2, (thumb_height - image.height) // 2),
        )
        canvas.paste(frame, (x, y))

        draw.rectangle(
            (x, y + thumb_height, x + thumb_width, y + thumb_height + label_height),
            fill="#20293a",
        )
        draw.text(
            (x + 10, y + thumb_height + 7),
            record["id"],
            fill="#ffffff",
            font=title_font,
        )
        draw.text(
            (x + 10, y + thumb_height + 34),
            f"Steam screenshot ID: {record.get('steam_screenshot_id', 'unknown')}",
            fill="#b9c7dd",
            font=metadata_font,
        )

    canvas.save(out, quality=92)
    print(f"Created contact sheet: {out.relative_to(ROOT)}")


def download_candidates(max_images: int) -> None:
    ensure_dir(CANDIDATES)

    manifest: dict[str, Any] = {
        "generated_at": now_iso(),
        "purpose": "Internal-only candidate screenshots for human/Claude visual review.",
        "copyright_notice": (
            "Third-party copyrighted screenshots. Never ship, publish, redistribute, "
            "embed, hotlink, or use as game assets."
        ),
        "max_images_per_game": max_images,
        "games": {},
    }

    for game_slug, game in GAMES.items():
        print(f"\nFetching official Steam screenshot metadata: {game['title']}")
        game_dir = CANDIDATES / game_slug
        ensure_dir(game_dir)

        screenshots = get_steam_screenshots(game["steam_app_id"])
        selected = screenshots[:max_images]
        records: list[dict[str, Any]] = []

        for index, screenshot in enumerate(selected, start=1):
            image_id = f"{game_slug}-{index:02d}"
            filename = f"{image_id}.jpg"
            output = game_dir / filename
            source_url = screenshot["path_full"]

            if output.exists() and output.stat().st_size > 0:
                print(f"  Exists: {output.relative_to(ROOT)}")
            else:
                print(f"  Downloading: {image_id}")
                try:
                    data = fetch_bytes(source_url)
                    image = clean_image(data)
                    image.save(output, quality=92, optimize=True)
                except Exception as exc:
                    print(f"  WARNING: skipped {image_id}: {exc}", file=sys.stderr)
                    continue
                time.sleep(DOWNLOAD_DELAY_SECONDS)

            records.append(
                {
                    "id": image_id,
                    "file": str(output.relative_to(ROOT)),
                    "official_screenshot_url": source_url,
                    "official_store_page": game["official_store_page"],
                    "steam_app_id": game["steam_app_id"],
                    "steam_screenshot_id": screenshot.get("id"),
                    "width": screenshot.get("path_full", ""),
                    "candidate_status": "unreviewed",
                }
            )

        write_candidate_readme(game_slug, records)
        create_contact_sheet(game_slug, records)

        manifest["games"][game_slug] = {
            "title": game["title"],
            "steam_app_id": game["steam_app_id"],
            "official_store_page": game["official_store_page"],
            "official_media_page": game["official_media_page"],
            "recommended_categories": game["recommended_categories"],
            "records": records,
        }

    write_json(CANDIDATE_MANIFEST, manifest)
    print(f"\nCandidate queue ready: {CANDIDATES.relative_to(ROOT)}")
    print("Next: python3 scripts/build-reference-board.py prompt")


# ---------------------------------------------------------------------------
# Prompt and policy generation
# ---------------------------------------------------------------------------

def write_classification_rules() -> None:
    ensure_dir(DOCS)

    category_text = []
    for category, spec in CATEGORIES.items():
        category_text.append(
            f"""### `{category}`

**Preferred reference game:** `{spec['game']}`

**Accept only if**
{chr(10).join(f"- {item}" for item in spec['accept_if'])}

**Reject if**
{chr(10).join(f"- {item}" for item in spec['reject_if'])}
"""
        )

    content = f"""# Tiny Terrarium Works — Screenshot Classification Rules

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

{chr(10).join(category_text)}

## Required analysis output for every image

- Image ID and local file path
- `accept` or `reject`
- One or two assigned categories, if accepted
- Confidence from 0 to 100
- Two to five specific visible observations
- One original Tiny Terrarium implementation lesson
- Protected elements that must not be copied
"""
    CLASSIFICATION_RULES.write_text(content, encoding="utf-8")
    print(f"Wrote: {CLASSIFICATION_RULES.relative_to(ROOT)}")


def write_claude_prompt() -> None:
    content = """# Claude Code Prompt — Curate Tiny Terrarium References

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
"""
    CLAUDE_PROMPT.write_text(content, encoding="utf-8")
    print(f"Wrote: {CLAUDE_PROMPT.relative_to(ROOT)}")


def create_prompt_files() -> None:
    if not CANDIDATE_MANIFEST.exists():
        raise RuntimeError(
            "Candidate manifest missing. Run `download` before generating the review prompt."
        )
    write_classification_rules()
    write_claude_prompt()
    print("\nOpen docs/CLAUDE_REFERENCE_CLASSIFICATION_PROMPT.md and paste its prompt into Claude Code.")


# ---------------------------------------------------------------------------
# Curate Claude's accepted decisions
# ---------------------------------------------------------------------------

def validate_classification(data: dict[str, Any]) -> list[str]:
    errors: list[str] = []

    if not isinstance(data.get("images"), list):
        return ["classification.json must contain an `images` array"]

    candidate_manifest = read_json(CANDIDATE_MANIFEST)
    candidate_ids = {
        record["id"]
        for game in candidate_manifest["games"].values()
        for record in game["records"]
    }

    category_counts: dict[str, int] = {name: 0 for name in CATEGORIES}
    seen_ids: set[str] = set()

    for image in data["images"]:
        image_id = image.get("id")
        if not image_id or image_id not in candidate_ids:
            errors.append(f"Unknown or missing candidate ID: {image_id!r}")
            continue

        if image_id in seen_ids:
            errors.append(f"Duplicate classification record for: {image_id}")
        seen_ids.add(image_id)

        decision = image.get("decision")
        if decision not in {"accept", "reject"}:
            errors.append(f"{image_id}: decision must be accept or reject")

        categories = image.get("categories", [])
        if decision == "accept":
            if not categories or len(categories) > 2:
                errors.append(f"{image_id}: accepted image needs one or two categories")
            for category in categories:
                if category not in CATEGORIES:
                    errors.append(f"{image_id}: unknown category {category}")
                else:
                    category_counts[category] += 1

            confidence = image.get("confidence")
            if not isinstance(confidence, int) or confidence < 0 or confidence > 100:
                errors.append(f"{image_id}: confidence must be an integer 0–100")

            evidence = image.get("visibleEvidence")
            if not isinstance(evidence, list) or not (2 <= len(evidence) <= 5):
                errors.append(f"{image_id}: requires 2–5 visibleEvidence items")

            if not image.get("tinyTerrariumLesson"):
                errors.append(f"{image_id}: missing tinyTerrariumLesson")

            if not image.get("doNotCopy"):
                errors.append(f"{image_id}: missing doNotCopy")

        if decision == "reject" and categories:
            errors.append(f"{image_id}: rejected image must not have categories")

    missing = candidate_ids - seen_ids
    if missing:
        errors.append(
            f"Missing classifications for {len(missing)} candidate(s): "
            + ", ".join(sorted(missing))
        )

    for category, count in category_counts.items():
        if count > 3:
            errors.append(
                f"{category}: {count} selected images; maximum is 3. "
                "Keep only the strongest references."
            )

    return errors


def write_reference_note(
    destination: Path,
    image: dict[str, Any],
    source_info: dict[str, Any],
    category: str,
) -> None:
    note = destination.with_suffix(".md")
    note.write_text(
        f"""# {image['id']}

## Internal-only copyright status

This is a copyrighted third-party screenshot used solely for private,
internal visual-quality analysis. Never ship, publish, embed, hotlink,
redistribute, train on, or use it as a game asset.

## Provenance

- Official Steam store page: {source_info['official_store_page']}
- Official Steam screenshot URL: {source_info['official_screenshot_url']}
- Steam app ID: `{source_info['steam_app_id']}`
- Steam screenshot ID: `{source_info.get('steam_screenshot_id', 'unknown')}`

## Curated category

`{category}`

## Visible evidence

{chr(10).join(f"- {item}" for item in image['visibleEvidence'])}

## Original Tiny Terrarium application

{image['tinyTerrariumLesson']}

## Protected elements never to copy

{chr(10).join(f"- {item}" for item in image['doNotCopy'])}
""",
        encoding="utf-8",
    )


def curate_approved_images() -> None:
    if not CANDIDATE_MANIFEST.exists():
        raise RuntimeError("Missing candidate manifest. Run `download` first.")
    if not CLASSIFICATION.exists():
        raise RuntimeError(
            "Missing classification.json. Ask Claude Code to complete the review first."
        )

    data = read_json(CLASSIFICATION)
    errors = validate_classification(data)
    if errors:
        print("classification.json failed validation:\n", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        raise SystemExit(2)

    manifest = read_json(CANDIDATE_MANIFEST)
    source_by_id: dict[str, dict[str, Any]] = {
        record["id"]: record
        for game in manifest["games"].values()
        for record in game["records"]
    }

    ensure_dir(REFERENCES)
    accepted = [
        image
        for image in data["images"]
        if image["decision"] == "accept" and image.get("categories")
    ]

    curated_records: list[dict[str, Any]] = []

    for image in accepted:
        source_info = source_by_id[image["id"]]
        source = ROOT / source_info["file"]
        if not source.exists():
            raise RuntimeError(f"Missing candidate image: {source}")

        game_slug = source.parent.name

        for category in image["categories"]:
            target_dir = REFERENCES / game_slug / category
            ensure_dir(target_dir)

            target_image = target_dir / source.name
            shutil.copy2(source, target_image)
            write_reference_note(target_image, image, source_info, category)

            curated_records.append(
                {
                    "id": image["id"],
                    "category": category,
                    "source": str(source.relative_to(ROOT)),
                    "curated_image": str(target_image.relative_to(ROOT)),
                    "note": str(target_image.with_suffix(".md").relative_to(ROOT)),
                }
            )

    report_lines = [
        "# Reference Board Curation Report",
        "",
        f"Generated: `{now_iso()}`",
        "",
        "## Internal-only notice",
        "",
        "All copied screenshots remain copyrighted third-party materials for private",
        "visual analysis only. They must never be shipped, published, embedded,",
        "redistributed, hotlinked, or used as game assets.",
        "",
        "## Curated files",
        "",
    ]
    report_lines.extend(
        f"- `{record['id']}` -> `{record['category']}` -> `{record['curated_image']}`"
        for record in curated_records
    )
    report_lines.extend(
        [
            "",
            "## Next step",
            "",
            "Use only the accompanying Markdown notes as implementation guidance. ",
            "Evaluate transferable qualities, not protected visual expression.",
            "",
        ]
    )
    CURATION_REPORT.write_text("\n".join(report_lines), encoding="utf-8")

    print(f"Curated {len(curated_records)} image/category assignments.")
    print(f"Final reference board: {REFERENCES.relative_to(ROOT)}")
    print(f"Report: {CURATION_REPORT.relative_to(ROOT)}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build and curate an internal Tiny Terrarium screenshot reference board."
    )
    parser.add_argument(
        "command",
        choices=[
            "download",
            "prompt",
            "curate",
            "all",
            "clean-candidates",
            "clean-curated",
        ],
        help="Pipeline command to run",
    )
    parser.add_argument(
        "--max",
        type=int,
        default=DEFAULT_MAX_IMAGES,
        help=f"Maximum official Steam screenshots per game (default: {DEFAULT_MAX_IMAGES})",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()

    if args.max < 4 or args.max > 30:
        raise SystemExit("--max must be between 4 and 30")

    if args.command == "clean-candidates":
        delete_directory(CANDIDATES)
        return

    if args.command == "clean-curated":
        delete_directory(REFERENCES)
        delete_directory(REVIEWS)
        return

    if args.command == "download":
        download_candidates(args.max)
        return

    if args.command == "prompt":
        create_prompt_files()
        return

    if args.command == "curate":
        curate_approved_images()
        return

    if args.command == "all":
        download_candidates(args.max)
        create_prompt_files()
        print(
            "\nCandidate download and prompt generation complete.\n"
            "Next, paste docs/CLAUDE_REFERENCE_CLASSIFICATION_PROMPT.md into Claude Code.\n"
            "After Claude writes classification.json, run:\n"
            "  python3 scripts/build-reference-board.py curate"
        )
        return


if __name__ == "__main__":
    main()
