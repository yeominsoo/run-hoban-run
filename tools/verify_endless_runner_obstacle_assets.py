#!/usr/bin/env python3
"""Validate the generated Endless Runner obstacle atlas and transparent sprites."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = REPO_ROOT / "endless-runner/assets/obstacles"
EXPECTED_IDS = (
    "stump",
    "thorn-patch",
    "floating-grass-platform",
    "honeybee",
    "bluebird",
    "mossy-rock",
)


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    errors: list[str] = []
    manifest_path = ASSET_ROOT / "manifest.json"
    if not manifest_path.is_file():
        print("FAIL endless-runner obstacle assets\n- manifest.json is missing")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != 1:
        errors.append(f"manifest version must be 1, found {manifest.get('version')}")

    source_entry = manifest.get("sourceAtlas", {})
    source_path = REPO_ROOT / str(source_entry.get("path", ""))
    if not source_path.is_file():
        errors.append("source atlas is missing")
    else:
        with Image.open(source_path) as opened:
            source = opened.convert("RGB")
        if source.width != source.height:
            errors.append(f"source atlas must be square, found {source.size}")
        corners = (
            source.getpixel((0, 0)),
            source.getpixel((source.width - 1, 0)),
            source.getpixel((0, source.height - 1)),
            source.getpixel((source.width - 1, source.height - 1)),
        )
        if corners != ((0, 255, 0),) * 4:
            errors.append(f"source atlas corners must be exact #00ff00, found {corners}")
        if source_entry.get("grid") != {"columns": 2, "rows": 3}:
            errors.append("source atlas grid must be 2 columns x 3 rows")
        if source_entry.get("sha256") != sha256(source_path):
            errors.append("source atlas sha256 does not match manifest")

    assets = manifest.get("assets", [])
    entries = {entry.get("id"): entry for entry in assets if isinstance(entry, dict)}
    if tuple(entries) != EXPECTED_IDS:
        errors.append(f"asset ids/order mismatch: {tuple(entries)}")

    for asset_id in EXPECTED_IDS:
        entry = entries.get(asset_id)
        if entry is None:
            continue
        path = REPO_ROOT / str(entry.get("path", ""))
        if not path.is_file():
            errors.append(f"{asset_id}: file is missing")
            continue
        with Image.open(path) as opened:
            image = opened.convert("RGBA")
        if image.size != (256, 256):
            errors.append(f"{asset_id}: expected 256x256, found {image.size}")
        if any(image.getpixel(point)[3] != 0 for point in ((0, 0), (255, 0), (0, 255), (255, 255))):
            errors.append(f"{asset_id}: canvas corners must be transparent")
        bounds = image.getchannel("A").point(lambda alpha: 255 if alpha >= 16 else 0).getbbox()
        if bounds is None:
            errors.append(f"{asset_id}: visible subject is missing")
        elif list(bounds) != entry.get("visibleBounds"):
            errors.append(f"{asset_id}: visible bounds do not match manifest")
        if entry.get("size") != [256, 256]:
            errors.append(f"{asset_id}: manifest size must be 256x256")
        if entry.get("sha256") != sha256(path):
            errors.append(f"{asset_id}: sha256 does not match manifest")

    if errors:
        print("FAIL endless-runner obstacle assets")
        for message in errors:
            print(f"- {message}")
        return 1

    print("PASS endless-runner obstacle assets: 1 atlas, 6 transparent 256x256 sprites")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
