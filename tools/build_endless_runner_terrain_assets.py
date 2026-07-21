#!/usr/bin/env python3
"""Build the seamless Endless Runner meadow ground texture."""

from __future__ import annotations

import hashlib
import json
import os
from pathlib import Path

from PIL import Image


GENERATED_SOURCE = Path(
    "output/imagegen/endless-runner-terrain-2026-07-21/meadow-ground-source.png"
)
ASSET_ROOT = Path("endless-runner/assets/terrain")
ARCHIVED_SOURCE = ASSET_ROOT / "source/meadow-ground-source.webp"
RUNTIME_TEXTURE = ASSET_ROOT / "meadow-ground.png"
SOURCE_SIZE = (1024, 1024)
RUNTIME_SIZE = (512, 512)
SEAM_BLEND_WIDTH = 56


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def canonical_source(repo_root: Path) -> Image.Image:
    generated = repo_root / GENERATED_SOURCE
    archived = repo_root / ARCHIVED_SOURCE

    if generated.is_file():
        with Image.open(generated) as opened:
            source = opened.convert("RGB")
        source = source.resize(SOURCE_SIZE, Image.Resampling.LANCZOS)
        archived.parent.mkdir(parents=True, exist_ok=True)
        source.save(archived, format="WEBP", quality=95, method=6)
    elif not archived.is_file():
        raise FileNotFoundError(f"Missing generated or archived terrain source: {generated}, {archived}")

    # 런타임 PNG는 항상 저장소에 보존된 정본에서 생성해 clean clone에서도 동일하게 재현한다.
    with Image.open(archived) as opened:
        return opened.convert("RGB")


def blend_horizontal_seam(image: Image.Image, width: int) -> Image.Image:
    """Make opposite edge pixels identical and ease the correction into the tile."""
    if width < 2 or width * 2 >= image.width:
        raise ValueError(f"Invalid seam blend width {width} for {image.size}")

    result = image.copy()
    source = image.load()
    destination = result.load()
    for inset in range(width):
        left_x = inset
        right_x = image.width - 1 - inset
        mix = 0.5 * (1 - inset / (width - 1))
        for y in range(image.height):
            left = source[left_x, y]
            right = source[right_x, y]
            destination[left_x, y] = tuple(
                round(left[channel] * (1 - mix) + right[channel] * mix)
                for channel in range(3)
            )
            destination[right_x, y] = tuple(
                round(right[channel] * (1 - mix) + left[channel] * mix)
                for channel in range(3)
            )
    return result


def build(repo_root: Path) -> None:
    asset_root = repo_root / ASSET_ROOT
    asset_root.mkdir(parents=True, exist_ok=True)
    source = canonical_source(repo_root)
    runtime = source.resize(RUNTIME_SIZE, Image.Resampling.LANCZOS)
    runtime = blend_horizontal_seam(runtime, SEAM_BLEND_WIDTH)

    destination = repo_root / RUNTIME_TEXTURE
    runtime.save(destination, format="PNG", optimize=True)
    archived = repo_root / ARCHIVED_SOURCE
    manifest = {
        "version": 1,
        "generatedOn": "2026-07-21",
        "source": {
            "path": ARCHIVED_SOURCE.as_posix(),
            "size": list(SOURCE_SIZE),
            "sha256": sha256(archived),
        },
        "runtime": {
            "id": "meadow-ground",
            "path": RUNTIME_TEXTURE.as_posix(),
            "size": list(RUNTIME_SIZE),
            "seamBlendWidth": SEAM_BLEND_WIDTH,
            "sha256": sha256(destination),
        },
    }
    (asset_root / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )

    project_stat = repo_root.stat()
    if hasattr(os, "geteuid") and os.geteuid() == 0:
        for path in (asset_root, *asset_root.rglob("*")):
            os.chown(path, project_stat.st_uid, project_stat.st_gid)

    print(f"Built seamless Endless Runner terrain texture at {destination}")


def main() -> int:
    repo_root = Path(__file__).resolve().parents[1]
    build(repo_root)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
