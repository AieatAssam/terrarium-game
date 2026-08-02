#!/usr/bin/env python3
"""
Tiny Terrarium Works — Reference Board Image Downloader

Downloads the already-classified, already-accepted reference screenshots
directly into the curated board layout:

    docs/references/<game>/<category>/<image-id>.jpg

No candidate download, contact sheet, or review stage is involved — the review
was completed once and its result is committed in
`docs/reference-reviews/classification.json`. This script simply materialises
the images next to their committed `.md` notes so a fresh clone has the full
internal reference board.

IMPORTANT — read before running:
- These screenshots are copyrighted third-party material (Slime Rancher 2,
  Ooblets, Tiny Glade, Garden Galaxy), fetched from official public Steam
  storefront URLs.
- They are private, internal visual-analysis references ONLY.
- They must never be shipped, published, redistributed, embedded, hotlinked,
  trained on, or used as game assets. Never copy them into src/, public/,
  dist/, releases, or marketing.
- The image files are git-ignored on purpose; only the `.md` notes are
  committed. Do not force-add them.

Usage:
    python3 scripts/download-reference-board.py
    python3 scripts/download-reference-board.py --accept-terms   # non-interactive
    python3 scripts/download-reference-board.py --force          # re-download existing

Requirements: Python 3.9+, standard library only (no Pillow needed).
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
REFERENCES = ROOT / "docs" / "references"
CLASSIFICATION = ROOT / "docs" / "reference-reviews" / "classification.json"

USER_AGENT = "TinyTerrariumWorksInternalReferenceBoard/1.0 (+local-internal-use)"
DOWNLOAD_DELAY_SECONDS = 0.20

# Official Steam storefront URLs for every accepted reference, captured from the
# original candidate manifest at classification time. Keyed by image ID; the
# game directory is the ID minus its trailing "-NN" index.
REFERENCE_URLS: dict[str, str] = {
    "garden-galaxy-03": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1970460/ss_24eca8f8366659fb375b562f1a1a5d19ca27c895.1920x1080.jpg?t=1782407487",
    "garden-galaxy-04": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1970460/ss_a8d29cc69aae918fbb2c96e8b2625f7618417181.1920x1080.jpg?t=1782407487",
    "garden-galaxy-06": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1970460/ss_3618d7bb006b1bd02af2f6c7ce20976a3e2c4197.1920x1080.jpg?t=1782407487",
    "ooblets-01": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_ac9b89cd8233c2baf3716113b7bc14b04ddaced7.1920x1080.jpg?t=1696517972",
    "ooblets-02": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_02de4cdb1df6adb5b566097eec96d13ffddd296e.1920x1080.jpg?t=1696517972",
    "ooblets-03": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_7697a31bd38cf7d13db5c0e77fdd2403205d7da1.1920x1080.jpg?t=1696517972",
    "ooblets-04": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_20f9ee0ec6c3266318290fa844183398f7fe7220.1920x1080.jpg?t=1696517972",
    "ooblets-06": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_e769a56674198bff28b441fc3f031f8ba7d3f55d.1920x1080.jpg?t=1696517972",
    "ooblets-07": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_4797944403f4b2efbd29545cd4aef1272b453a45.1920x1080.jpg?t=1696517972",
    "ooblets-09": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_af9919821684499bb80bb35140426138b3405fab.1920x1080.jpg?t=1696517972",
    "ooblets-11": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_9d11ecc4dbcdb84bfd7966338380446e6984235e.1920x1080.jpg?t=1696517972",
    "ooblets-13": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_a36943d0fe3bb5b8342400ff89724b0b4a8c15ab.1920x1080.jpg?t=1696517972",
    "ooblets-14": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_84c5fb843091fda028927793f8495ee8c9ca623c.1920x1080.jpg?t=1696517972",
    "ooblets-17": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_d5fdbf18f2e3ed9f9b2b30e317e4f14b5c795767.1920x1080.jpg?t=1696517972",
    "ooblets-19": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_104ed3a2fdbc7bd3aea49b9f15303f0a2eec653d.1920x1080.jpg?t=1696517972",
    "ooblets-20": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/593150/ss_e17116a6e16e4aff8f4e5abb76acfaa71752718c.1920x1080.jpg?t=1696517972",
    "slime-rancher-2-01": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1657630/6300ad3b599cd5d0cffb8788be8d95d7a019f666/ss_6300ad3b599cd5d0cffb8788be8d95d7a019f666.1920x1080.jpg?t=1776359011",
    "slime-rancher-2-02": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1657630/a97a654e14151e919ef4a661d7628176c20540fc/ss_a97a654e14151e919ef4a661d7628176c20540fc.1920x1080.jpg?t=1776359011",
    "slime-rancher-2-05": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1657630/ss_4009448a95aef4e1b0afb03aec0f37abf83f2d22.1920x1080.jpg?t=1776359011",
    "slime-rancher-2-06": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1657630/4924e16d9345a5cc053a73e789c46e65a3098ac8/ss_4924e16d9345a5cc053a73e789c46e65a3098ac8.1920x1080.jpg?t=1776359011",
    "slime-rancher-2-07": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1657630/ss_5c6e44f866433dc15d94d42cca50f1bda0b9a515.1920x1080.jpg?t=1776359011",
    "slime-rancher-2-12": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1657630/ss_495cead0fc7f9fe07026bb7d018a005c810bd2c9.1920x1080.jpg?t=1776359011",
    "slime-rancher-2-13": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/1657630/ss_0d6e1ca2ecb03008b22588ece2389523a2298889.1920x1080.jpg?t=1776359011",
    "tiny-glade-01": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2198150/ss_1a98b0d5e8111f100b3ececda8f682333337e3cb.1920x1080.jpg?t=1782371576",
    "tiny-glade-02": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2198150/ss_6a8c7a510715796a659bd9fd828cc02cf73e11de.1920x1080.jpg?t=1782371576",
    "tiny-glade-03": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2198150/ss_c9086858afd32f9c2bd49c164ddc2494af1e7f31.1920x1080.jpg?t=1782371576",
    "tiny-glade-09": "https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/2198150/ss_2ec8d6fd1be5aa321e0b82ae33f8a766db94535b.1920x1080.jpg?t=1782371576",
}

DISCLAIMER = """
================================================================================
TINY TERRARIUM WORKS — INTERNAL REFERENCE IMAGE DOWNLOAD
================================================================================

You are about to download {count} copyrighted third-party game screenshots
(Slime Rancher 2, Ooblets, Tiny Glade, Garden Galaxy) from official public
Steam storefront URLs into docs/references/.

By proceeding you agree that these images:

  1. Are used ONLY for private, internal visual-quality analysis.
  2. Will NEVER be shipped, published, redistributed, embedded, hotlinked,
     trained on, committed to git, or used as game assets.
  3. Will never be copied into src/, public/, dist/, releases, or marketing.
  4. Serve only to study transferable principles (readability, materials,
     lighting, composition, feedback, UI hierarchy) — never to copy protected
     characters, artwork, props, UI, layouts, branding, names, or textures.

================================================================================
"""


def fetch_bytes(url: str) -> bytes:
    request = Request(
        url,
        headers={"User-Agent": USER_AGENT, "Accept": "image/*,*/*;q=0.8"},
    )
    try:
        with urlopen(request, timeout=45) as response:
            return response.read()
    except HTTPError as exc:
        raise RuntimeError(f"HTTP {exc.code}") from exc
    except URLError as exc:
        raise RuntimeError(f"network error: {exc.reason}") from exc


def is_jpeg(data: bytes) -> bool:
    return len(data) > 4 and data[:2] == b"\xff\xd8" and data[-2:] == b"\xff\xd9"


def game_slug(image_id: str) -> str:
    # "slime-rancher-2-01" -> "slime-rancher-2"
    return image_id.rsplit("-", 1)[0]


def load_category_selections() -> dict[str, list[str]]:
    if not CLASSIFICATION.exists():
        raise SystemExit(
            f"Missing {CLASSIFICATION.relative_to(ROOT)} — the classification "
            "results must be committed in the repo."
        )
    data = json.loads(CLASSIFICATION.read_text(encoding="utf-8"))
    try:
        return data["summary"]["categorySelections"]
    except KeyError:
        raise SystemExit(
            f"{CLASSIFICATION.relative_to(ROOT)} has no summary.categorySelections."
        )


def confirm_terms(non_interactive: bool) -> None:
    if non_interactive:
        return
    try:
        answer = input("Type 'I accept' to agree and continue: ").strip()
    except EOFError:
        answer = ""
    if answer != "I accept":
        raise SystemExit("Aborted: terms not accepted. No files were downloaded.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Download accepted reference screenshots into docs/references/."
    )
    parser.add_argument(
        "--accept-terms",
        action="store_true",
        help="Accept the internal-use terms non-interactively.",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download images that already exist locally.",
    )
    args = parser.parse_args()

    selections = load_category_selections()

    # image id -> list of category directories it belongs to
    placements: dict[str, list[str]] = {}
    for category, image_ids in selections.items():
        for image_id in image_ids:
            placements.setdefault(image_id, []).append(category)

    unknown = sorted(set(placements) - set(REFERENCE_URLS))
    if unknown:
        raise SystemExit(
            "classification.json selects images with no known source URL: "
            + ", ".join(unknown)
        )

    print(DISCLAIMER.format(count=len(placements)))
    confirm_terms(args.accept_terms)

    downloaded = skipped = failed = 0
    failures: list[str] = []

    for image_id in sorted(placements):
        url = REFERENCE_URLS[image_id]
        targets = [
            REFERENCES / game_slug(image_id) / category / f"{image_id}.jpg"
            for category in sorted(placements[image_id])
        ]

        if not args.force and all(t.exists() and t.stat().st_size > 0 for t in targets):
            print(f"  Exists:  {image_id} ({len(targets)} placement(s))")
            skipped += 1
            continue

        try:
            data = fetch_bytes(url)
            if not is_jpeg(data):
                raise RuntimeError("response is not a valid JPEG")
        except Exception as exc:
            print(f"  FAILED:  {image_id}: {exc}", file=sys.stderr)
            failures.append(image_id)
            failed += 1
            continue

        for target in targets:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(data)
        print(f"  Saved:   {image_id} -> {len(targets)} placement(s)")
        downloaded += 1
        time.sleep(DOWNLOAD_DELAY_SECONDS)

    placed_total = sum(len(v) for v in placements.values())
    print(
        f"\nDone: {downloaded} downloaded, {skipped} already present, "
        f"{failed} failed. Board holds {len(placements)} images across "
        f"{placed_total} category placements under {REFERENCES.relative_to(ROOT)}."
    )
    print("Reminder: these images are internal-only and git-ignored. Never commit them.")

    if failures:
        raise SystemExit(f"Failed downloads: {', '.join(failures)}")


if __name__ == "__main__":
    main()
