#!/usr/bin/env python3
"""Validate the Endless Runner meadow terrain source and runtime texture."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

from PIL import Image


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = REPO_ROOT / "endless-runner/assets/terrain"


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main() -> int:
    errors: list[str] = []
    manifest_path = ASSET_ROOT / "manifest.json"
    if not manifest_path.is_file():
        print("FAIL endless-runner terrain assets\n- manifest.json is missing")
        return 1

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if manifest.get("version") != 1:
        errors.append(f"manifest version must be 1, found {manifest.get('version')}")

    for key, expected_size in (("source", (1024, 1024)), ("runtime", (512, 512))):
        entry = manifest.get(key, {})
        path = REPO_ROOT / str(entry.get("path", ""))
        if not path.is_file():
            errors.append(f"{key}: file is missing")
            continue
        with Image.open(path) as opened:
            image = opened.convert("RGB")
        if image.size != expected_size:
            errors.append(f"{key}: expected {expected_size}, found {image.size}")
        if entry.get("size") != list(expected_size):
            errors.append(f"{key}: manifest size mismatch")
        if entry.get("sha256") != sha256(path):
            errors.append(f"{key}: sha256 does not match manifest")
        if key == "runtime":
            mismatched_rows = sum(
                image.getpixel((0, y)) != image.getpixel((image.width - 1, y))
                for y in range(image.height)
            )
            if mismatched_rows:
                errors.append(f"runtime: {mismatched_rows} rows have a visible horizontal seam")

    runtime = manifest.get("runtime", {})
    if runtime.get("id") != "meadow-ground":
        errors.append("runtime id must be meadow-ground")
    if runtime.get("seamBlendWidth") != 56:
        errors.append("runtime seam blend width must be 56")

    if errors:
        print("FAIL endless-runner terrain assets")
        for message in errors:
            print(f"- {message}")
        return 1

    print("PASS endless-runner terrain assets: 1 source, 1 seamless 512x512 runtime texture")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
