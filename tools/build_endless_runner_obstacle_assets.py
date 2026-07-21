#!/usr/bin/env python3
"""Build transparent Endless Runner obstacle sprites from the approved 2x3 atlas."""

from __future__ import annotations

import hashlib
import json
import os
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


ATLAS_COLUMNS = 2
ATLAS_ROWS = 3
CANVAS_SIZE = (256, 256)
GENERATED_ATLAS = Path(
    "output/imagegen/endless-runner-obstacles-2026-07-21/endless-runner-obstacle-atlas.png"
)
ASSET_ROOT = Path("endless-runner/assets/obstacles")
ARCHIVED_ATLAS = ASSET_ROOT / "source/endless-runner-obstacle-atlas.png"


@dataclass(frozen=True)
class SpriteSpec:
    name: str
    row: int
    column: int
    anchor: str


SPRITES = (
    SpriteSpec("stump", 0, 0, "ground"),
    SpriteSpec("thorn-patch", 0, 1, "ground"),
    SpriteSpec("floating-grass-platform", 1, 0, "center"),
    SpriteSpec("honeybee", 1, 1, "center"),
    SpriteSpec("bluebird", 2, 0, "center"),
    SpriteSpec("mossy-rock", 2, 1, "ground"),
)


def chroma_helper_path() -> Path:
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex"))
    helper = codex_home / "skills/.system/imagegen/scripts/remove_chroma_key.py"
    if not helper.is_file():
        raise FileNotFoundError(f"Missing imagegen chroma-key helper: {helper}")
    return helper


def remove_chroma_key(source: Path, destination: Path) -> None:
    subprocess.run(
        [
            sys.executable,
            str(chroma_helper_path()),
            "--input",
            str(source),
            "--out",
            str(destination),
            "--auto-key",
            "border",
            "--soft-matte",
            "--transparent-threshold",
            "12",
            "--opaque-threshold",
            "220",
            "--despill",
            "--edge-contract",
            "1",
            "--force",
        ],
        check=True,
    )


def visible_bounds(image: Image.Image) -> tuple[int, int, int, int]:
    bounds = image.getchannel("A").point(lambda alpha: 255 if alpha >= 16 else 0).getbbox()
    if bounds is None:
        raise RuntimeError("Sprite cell has no visible pixels")
    return bounds


def normalize_sprite(cell: Image.Image, anchor: str) -> Image.Image:
    subject = cell.crop(visible_bounds(cell))
    max_width = 232
    max_height = 220 if anchor == "ground" else 216
    scale = min(max_width / subject.width, max_height / subject.height)
    size = (
        max(1, round(subject.width * scale)),
        max(1, round(subject.height * scale)),
    )
    subject = subject.resize(size, Image.Resampling.LANCZOS)
    canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
    x = round((CANVAS_SIZE[0] - subject.width) / 2)
    y = 236 - subject.height if anchor == "ground" else round((CANVAS_SIZE[1] - subject.height) / 2)
    canvas.alpha_composite(subject, (x, y))
    return canvas


def source_atlas(repo_root: Path) -> Path:
    generated = repo_root / GENERATED_ATLAS
    archived = repo_root / ARCHIVED_ATLAS
    if generated.is_file():
        return generated
    if archived.is_file():
        return archived
    raise FileNotFoundError(f"Missing generated or archived obstacle atlas: {generated}, {archived}")


def build(repo_root: Path) -> None:
    source = source_atlas(repo_root)
    asset_root = repo_root / ASSET_ROOT
    asset_root.mkdir(parents=True, exist_ok=True)

    with tempfile.TemporaryDirectory(prefix="endless-runner-obstacles-") as temporary_directory:
        transparent_path = Path(temporary_directory) / "obstacle-atlas-transparent.png"
        remove_chroma_key(source, transparent_path)
        with Image.open(transparent_path) as opened:
            atlas = opened.convert("RGBA")

        if atlas.width != atlas.height:
            raise ValueError(f"Obstacle atlas must be square: {atlas.size}")

        source_dir = asset_root / "source"
        source_dir.mkdir(parents=True, exist_ok=True)
        canonical = Image.new("RGBA", atlas.size, (0, 255, 0, 255))
        canonical.alpha_composite(atlas)
        archived_atlas = repo_root / ARCHIVED_ATLAS
        canonical.convert("RGB").save(archived_atlas, format="PNG", optimize=True)

        cell_width = atlas.width // ATLAS_COLUMNS
        cell_height = atlas.height // ATLAS_ROWS
        manifest_assets: list[dict[str, object]] = []

        for spec in SPRITES:
            left = spec.column * cell_width
            top = spec.row * cell_height
            right = atlas.width if spec.column == ATLAS_COLUMNS - 1 else left + cell_width
            bottom = atlas.height if spec.row == ATLAS_ROWS - 1 else top + cell_height
            cell = atlas.crop((left, top, right, bottom))
            sprite = normalize_sprite(cell, spec.anchor)
            destination = asset_root / f"{spec.name}.png"
            sprite.save(destination, format="PNG", optimize=True)
            bounds = visible_bounds(sprite)
            manifest_assets.append(
                {
                    "id": spec.name,
                    "path": (ASSET_ROOT / destination.name).as_posix(),
                    "size": list(CANVAS_SIZE),
                    "visibleBounds": list(bounds),
                    "anchor": spec.anchor,
                    "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                }
            )

        manifest = {
            "version": 1,
            "generatedOn": "2026-07-21",
            "sourceAtlas": {
                "path": ARCHIVED_ATLAS.as_posix(),
                "grid": {"columns": ATLAS_COLUMNS, "rows": ATLAS_ROWS},
                "sha256": hashlib.sha256(archived_atlas.read_bytes()).hexdigest(),
            },
            "assets": manifest_assets,
        }
        (asset_root / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    project_stat = repo_root.stat()
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        for path in (asset_root, *asset_root.rglob("*")):
            os.chown(path, project_stat.st_uid, project_stat.st_gid)

    print(f"Built {len(SPRITES)} Endless Runner obstacle sprites at {asset_root}")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    build(repo_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
