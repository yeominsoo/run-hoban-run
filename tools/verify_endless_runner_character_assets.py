#!/usr/bin/env python3
"""Validate the latest eight-frame Endless Runner character asset set."""

from __future__ import annotations

import hashlib
import json
import sys
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from PIL import Image, ImageChops, ImageSequence


REPO_ROOT = Path(__file__).resolve().parents[1]
ASSET_ROOT = REPO_ROOT / "endless-runner/assets/characters"
MANIFEST_PATH = ASSET_ROOT / "manifest.json"

MANIFEST_VERSION = 4
CANVAS_SIZE = (256, 256)
PIVOT = (128, 232)
FRAME_COUNT = 8
ACTIONS = ("run", "jump", "slide", "fall")
METHOD = "eight model-generated chronological poses from approved identity references; no transform tween"
IAN_RUN_CHARACTER_ID = "checkered-vest-boy-soft-3d-toy"
IAN_RUN_HEAD_X_SPREAD_MAX = 12.0
IAN_RUN_HEAD_Y_SPREAD_MAX = 22.5
ACTION_DURATIONS = {
    "run": [80, 80, 80, 80, 80, 80, 80, 80],
    "jump": [70, 70, 80, 90, 100, 90, 90, 100],
    "slide": [90, 90, 200, 200, 200, 200, 90, 90],
    "fall": [90, 100, 110, 120, 130, 150, 180, 220],
}
SLIDE_CLIPS = {
    "enter": {"indexes": [1, 2], "durations": [90, 90], "loop": False},
    "hold": {"indexes": [3, 4, 5, 6], "durations": [100, 100, 100, 100], "loop": True},
    "exit": {"indexes": [7, 8], "durations": [90, 90], "loop": False},
}
SHEET_GROUPS = {
    "run-jump": ("run", "jump"),
    "slide-fall": ("slide", "fall"),
}
CHARACTERS = {
    "floral-hat-girl-flat-sticker": {
        "style": "flat-sticker",
        "identity": "girl",
        "source": "two-girls-flat-sticker",
    },
    "pink-glasses-girl-flat-sticker": {
        "style": "flat-sticker",
        "identity": "girl",
        "source": "two-girls-flat-sticker",
    },
    "checkered-vest-boy-flat-sticker": {
        "style": "flat-sticker",
        "identity": "boy",
        "source": "checkered-vest-boy-flat-sticker",
    },
    "floral-hat-girl-storybook-paper": {
        "style": "storybook-paper",
        "identity": "girl",
        "source": "two-girls-storybook-paper",
    },
    "pink-glasses-girl-storybook-paper": {
        "style": "storybook-paper",
        "identity": "girl",
        "source": "two-girls-storybook-paper",
    },
    "checkered-vest-boy-storybook-paper": {
        "style": "storybook-paper",
        "identity": "boy",
        "source": "checkered-vest-boy-storybook-paper",
    },
    "floral-hat-girl-soft-3d-toy": {
        "style": "soft-3d-toy",
        "identity": "girl",
        "source": "two-girls-soft-3d-toy",
    },
    "pink-glasses-girl-soft-3d-toy": {
        "style": "soft-3d-toy",
        "identity": "girl",
        "source": "two-girls-soft-3d-toy",
    },
    "checkered-vest-boy-soft-3d-toy": {
        "style": "soft-3d-toy",
        "identity": "boy",
        "source": "checkered-vest-boy-soft-3d-toy",
    },
}
SOURCE_SHEETS = {
    "two-girls-flat-sticker": {
        "style": "flat-sticker",
        "identities": ["floral-hat-girl", "pink-glasses-girl"],
        "path": "endless-runner/assets/characters/sources/runner-flat-sticker-action-sheet.png",
        "sha256": "ef7da9cd250d8dae3202c750f396c95303c9d760fa9b23c537225e0bcd45670a",
        "designRevision": "v3-two-girls-dress-corrected",
    },
    "checkered-vest-boy-flat-sticker": {
        "style": "flat-sticker",
        "identities": ["checkered-vest-boy"],
        "path": "endless-runner/assets/characters/sources/checkered-vest-boy-flat-sticker-action-sheet.png",
        "sha256": "015f7cfc093a8524eeb6094720c93314f00c2ed1f1de1f60c3ffeac152c956f7",
        "designRevision": "v1-checkered-vest-boy-large-monolid-eyes",
    },
    "two-girls-storybook-paper": {
        "style": "storybook-paper",
        "identities": ["floral-hat-girl", "pink-glasses-girl"],
        "path": "endless-runner/assets/characters/sources/runner-storybook-paper-action-sheet.png",
        "sha256": "0813e5f1c813efe2eed1a9c847ec14ee7abe0d36cca0e21672be951fa5f1e48b",
        "designRevision": "v3-two-girls-dress-corrected",
    },
    "checkered-vest-boy-storybook-paper": {
        "style": "storybook-paper",
        "identities": ["checkered-vest-boy"],
        "path": "endless-runner/assets/characters/sources/checkered-vest-boy-storybook-paper-action-sheet.png",
        "sha256": "e8de11bd245e409afa16c1a1f20f32d3e2375c68005527606182277ae2a3d3de",
        "designRevision": "v1-checkered-vest-boy-large-monolid-eyes",
    },
    "two-girls-soft-3d-toy": {
        "style": "soft-3d-toy",
        "identities": ["floral-hat-girl", "pink-glasses-girl"],
        "path": "endless-runner/assets/characters/sources/runner-soft-3d-toy-action-sheet.png",
        "sha256": "3c6f241064235f63193f7daa1d417952dd07c41ba9042fe7bf4f20a8c2ad3674",
        "designRevision": "v3-two-girls-dress-corrected",
    },
    "checkered-vest-boy-soft-3d-toy": {
        "style": "soft-3d-toy",
        "identities": ["checkered-vest-boy"],
        "path": "endless-runner/assets/characters/sources/checkered-vest-boy-soft-3d-toy-action-sheet.png",
        "sha256": "d590a3623d44bd474a35b7b19d378617748f92da057921e2a1d996364db6436d",
        "designRevision": "v1-checkered-vest-boy-large-monolid-eyes",
    },
}


@dataclass(frozen=True)
class ComponentStat:
    bounds: tuple[int, int, int, int]
    center_x: float
    center_y: float
    pixel_count: int


def error(errors: list[str], message: str) -> None:
    errors.append(message)


def repo_path(value: object, context: str, errors: list[str]) -> Path | None:
    if not isinstance(value, str) or not value:
        error(errors, f"{context}: expected a non-empty project-relative path")
        return None
    path = (REPO_ROOT / value).resolve()
    try:
        path.relative_to(REPO_ROOT)
    except ValueError:
        error(errors, f"{context}: path escapes the repository: {value}")
        return None
    return path


def load_manifest(errors: list[str]) -> dict[str, Any] | None:
    if not MANIFEST_PATH.is_file():
        error(errors, "manifest.json is missing")
        return None
    try:
        manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        error(errors, f"manifest.json cannot be read: {exc}")
        return None
    if not isinstance(manifest, dict):
        error(errors, "manifest root must be an object")
        return None
    return manifest


def alpha_mask(image: Image.Image) -> Image.Image:
    return image.getchannel("A").point(lambda value: 255 if value >= 96 else 0)


def visible_bounds(image: Image.Image) -> tuple[int, int, int, int] | None:
    return alpha_mask(image).getbbox()


def verify_ian_run_head_stability(frames: list[Image.Image], errors: list[str]) -> None:
    """Keep Ian's head anchored while allowing the smaller vertical run-cycle bob."""

    if len(frames) != FRAME_COUNT:
        return
    centers: list[tuple[float, float]] = []
    for frame_index, frame in enumerate(frames, start=1):
        hair_pixels: list[tuple[int, int]] = []
        for y in range(25, 125):
            for x in range(35, 220):
                red, green, blue, alpha = frame.getpixel((x, y))
                if (
                    alpha > 128
                    and red < 95
                    and green < 75
                    and blue < 65
                    and red > green * 0.9
                ):
                    hair_pixels.append((x, y))
        if len(hair_pixels) < 500:
            error(
                errors,
                f"{IAN_RUN_CHARACTER_ID}/run frame {frame_index}: "
                f"cannot locate a stable hair/head anchor ({len(hair_pixels)} pixels)",
            )
            return
        centers.append(
            (
                sum(x for x, _ in hair_pixels) / len(hair_pixels),
                sum(y for _, y in hair_pixels) / len(hair_pixels),
            )
        )

    horizontal_spread = max(x for x, _ in centers) - min(x for x, _ in centers)
    vertical_spread = max(y for _, y in centers) - min(y for _, y in centers)
    if horizontal_spread > IAN_RUN_HEAD_X_SPREAD_MAX:
        error(
            errors,
            f"{IAN_RUN_CHARACTER_ID}/run: head horizontal spread "
            f"{horizontal_spread:.1f}px exceeds {IAN_RUN_HEAD_X_SPREAD_MAX:.1f}px",
        )
    if vertical_spread > IAN_RUN_HEAD_Y_SPREAD_MAX:
        error(
            errors,
            f"{IAN_RUN_CHARACTER_ID}/run: head vertical spread "
            f"{vertical_spread:.1f}px exceeds {IAN_RUN_HEAD_Y_SPREAD_MAX:.1f}px",
        )


def connected_component_stats(
    mask: bytes,
    width: int,
    height: int,
    *,
    minimum_pixels: int,
) -> list[ComponentStat]:
    if len(mask) != width * height:
        raise ValueError("connected-component mask size does not match the image")
    visited = bytearray(width * height)
    components: list[ComponentStat] = []
    for start, value in enumerate(mask):
        if value == 0 or visited[start]:
            continue
        visited[start] = 1
        queue: deque[int] = deque((start,))
        count = 0
        min_x = width
        min_y = height
        max_x = 0
        max_y = 0
        sum_x = 0
        sum_y = 0
        while queue:
            index = queue.popleft()
            count += 1
            y, x = divmod(index, width)
            min_x = min(min_x, x)
            min_y = min(min_y, y)
            max_x = max(max_x, x)
            max_y = max(max_y, y)
            sum_x += x
            sum_y += y
            for neighbor_y in range(max(0, y - 1), min(height, y + 2)):
                row_start = neighbor_y * width
                for neighbor_x in range(max(0, x - 1), min(width, x + 2)):
                    neighbor = row_start + neighbor_x
                    if not visited[neighbor] and mask[neighbor]:
                        visited[neighbor] = 1
                        queue.append(neighbor)
        if count >= minimum_pixels:
            components.append(
                ComponentStat(
                    bounds=(min_x, min_y, max_x + 1, max_y + 1),
                    center_x=sum_x / count,
                    center_y=sum_y / count,
                    pixel_count=count,
                )
            )
    return components


def verify_single_subject_component(
    image: Image.Image,
    context: str,
    errors: list[str],
) -> None:
    alpha = image.getchannel("A")
    mask = bytes(1 if value >= 16 else 0 for value in alpha.getdata())
    components = connected_component_stats(
        mask,
        image.width,
        image.height,
        minimum_pixels=16,
    )
    if len(components) != 1:
        details = sorted((component.pixel_count for component in components), reverse=True)
        error(
            errors,
            f"{context}: expected one connected subject with no neighbouring fragments, "
            f"found {len(components)} components {details}",
        )


def load_frame(path: Path, context: str, errors: list[str]) -> Image.Image | None:
    if not path.is_file():
        error(errors, f"{context}: missing {path.relative_to(REPO_ROOT)}")
        return None
    try:
        with Image.open(path) as opened:
            if opened.format != "PNG":
                error(errors, f"{context}: expected PNG, found {opened.format}")
            frame = opened.convert("RGBA")
    except (OSError, ValueError) as exc:
        error(errors, f"{context}: cannot decode PNG: {exc}")
        return None
    if frame.size != CANVAS_SIZE:
        error(errors, f"{context}: expected {CANVAS_SIZE}, found {frame.size}")
    bounds = visible_bounds(frame)
    if bounds is None:
        error(errors, f"{context}: no visible subject")
        return frame
    if abs(bounds[3] - PIVOT[1]) > 2:
        error(errors, f"{context}: visible baseline {bounds[3]} does not match pivot {PIVOT[1]}")
    alpha = frame.getchannel("A")
    if any(alpha.getpixel(point) > 16 for point in ((0, 0), (255, 0), (0, 255), (255, 255))):
        error(errors, f"{context}: canvas corners must be transparent")
    visible_pixels = sum(1 for value in alpha.getdata() if value >= 96)
    if not 500 <= visible_pixels <= 45_000:
        error(errors, f"{context}: implausible visible pixel count {visible_pixels}")
    verify_single_subject_component(frame, context, errors)
    return frame


def silhouette_difference(first: Image.Image, second: Image.Image) -> float:
    first_mask = alpha_mask(first)
    second_mask = alpha_mask(second)
    xor = ImageChops.logical_xor(first_mask.convert("1"), second_mask.convert("1"))
    union = ImageChops.lighter(first_mask, second_mask)
    union_count = sum(1 for value in union.getdata() if value)
    difference_count = sum(1 for value in xor.getdata() if value)
    return difference_count / max(1, union_count)


def verify_distinct(frames: list[Image.Image], context: str, errors: list[str]) -> None:
    if len(frames) != FRAME_COUNT:
        return
    digests = [hashlib.sha256(frame.tobytes()).hexdigest() for frame in frames]
    if len(set(digests)) != FRAME_COUNT:
        error(errors, f"{context}: frames must be eight unique authored images")
    for index in range(FRAME_COUNT - 1):
        difference = silhouette_difference(frames[index], frames[index + 1])
        if difference < 0.015:
            error(
                errors,
                f"{context}: frames {index + 1}->{index + 2} change only {difference:.1%} of the silhouette",
            )


def verify_slide_shape(frames: list[Image.Image], context: str, errors: list[str]) -> None:
    if len(frames) != FRAME_COUNT:
        return
    heights = []
    for frame in frames:
        bounds = visible_bounds(frame)
        heights.append(0 if bounds is None else bounds[3] - bounds[1])
    hold_heights = heights[2:6]
    # Wide horizontal slides can have taller hats, bent knees, or trailing fabric while
    # retaining the same low torso/baseline.  Keep this as a gross drift guard rather
    # than treating bounding-box height as the collision silhouette itself.
    if max(hold_heights) - min(hold_heights) > 70:
        error(errors, f"{context}: slide hold frames 3-6 do not keep a stable low silhouette: {hold_heights}")
    if heights[7] <= (sum(hold_heights) / len(hold_heights)) * 1.08:
        error(errors, f"{context}: slide frame 8 must visibly recover upright: {heights}")


def gif_frame_matches_source(
    source: Image.Image,
    decoded: Image.Image,
    context: str,
    errors: list[str],
) -> None:
    source_mask = alpha_mask(source)
    decoded_mask = alpha_mask(decoded)
    xor = ImageChops.logical_xor(source_mask.convert("1"), decoded_mask.convert("1"))
    mismatch = sum(1 for value in xor.getdata() if value) / (CANVAS_SIZE[0] * CANVAS_SIZE[1])
    if mismatch > 0.012:
        error(errors, f"{context}: GIF/source silhouette mismatch {mismatch:.1%}")


def verify_gif(
    path: Path,
    source_frames: list[Image.Image],
    durations: list[int],
    expected_loop: bool,
    context: str,
    errors: list[str],
) -> None:
    if not path.is_file():
        error(errors, f"{context}: missing GIF {path.relative_to(REPO_ROOT)}")
        return
    try:
        if path.read_bytes()[:6] not in (b"GIF87a", b"GIF89a"):
            error(errors, f"{context}: invalid GIF signature")
        with Image.open(path) as opened:
            if opened.size != CANVAS_SIZE:
                error(errors, f"{context}: expected GIF size {CANVAS_SIZE}, found {opened.size}")
            if getattr(opened, "n_frames", 1) != len(source_frames):
                error(
                    errors,
                    f"{context}: expected {len(source_frames)} GIF frames, found {getattr(opened, 'n_frames', 1)}",
                )
            loop_value = opened.info.get("loop")
            if expected_loop and loop_value != 0:
                error(errors, f"{context}: looping GIF must declare loop=0, found {loop_value!r}")
            if not expected_loop and loop_value == 0:
                error(errors, f"{context}: finite GIF unexpectedly loops forever")
            decoded_frames = [frame.convert("RGBA") for frame in ImageSequence.Iterator(opened)]
            decoded_durations = [
                int(frame.info.get("duration", opened.info.get("duration", 0)))
                for frame in ImageSequence.Iterator(opened)
            ]
        if decoded_durations != durations:
            error(errors, f"{context}: expected durations {durations}, found {decoded_durations}")
        if len(decoded_frames) == len(source_frames):
            for index, (source, decoded) in enumerate(zip(source_frames, decoded_frames), start=1):
                gif_frame_matches_source(source, decoded, f"{context} frame {index}", errors)
    except (OSError, ValueError, EOFError) as exc:
        error(errors, f"{context}: cannot decode GIF: {exc}")


def verify_sources(manifest: dict[str, Any], expected: set[Path], errors: list[str]) -> None:
    entries = manifest.get("sourceSheets")
    if not isinstance(entries, list):
        error(errors, "manifest sourceSheets must be a list")
        return
    by_id = {entry.get("id"): entry for entry in entries if isinstance(entry, dict)}
    if set(by_id) != set(SOURCE_SHEETS):
        error(errors, f"source IDs must be {sorted(SOURCE_SHEETS)}, found {sorted(by_id)}")
    for source_id, spec in SOURCE_SHEETS.items():
        entry = by_id.get(source_id)
        if not isinstance(entry, dict):
            continue
        if entry.get("path") != spec["path"]:
            error(errors, f"source {source_id}: wrong path {entry.get('path')!r}")
        if entry.get("style") != spec["style"]:
            error(errors, f"source {source_id}: wrong style {entry.get('style')!r}")
        if entry.get("identities") != spec["identities"]:
            error(errors, f"source {source_id}: wrong identities {entry.get('identities')!r}")
        if entry.get("sha256") != spec["sha256"]:
            error(errors, f"source {source_id}: manifest is not pinned to the approved design")
        if entry.get("designRevision") != spec["designRevision"]:
            error(errors, f"source {source_id}: wrong design revision")
        path = repo_path(entry.get("path"), f"source {source_id}", errors)
        if path is None:
            continue
        expected.add(path)
        if not path.is_file():
            error(errors, f"source {source_id}: file is missing")
            continue
        actual_sha = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_sha != spec["sha256"]:
            error(errors, f"source {source_id}: actual SHA does not match approved design")
        try:
            with Image.open(path) as image:
                if image.size != (2048, 1152) or image.format != "PNG":
                    error(errors, f"source {source_id}: expected 2048x1152 PNG, found {image.size} {image.format}")
        except (OSError, ValueError) as exc:
            error(errors, f"source {source_id}: cannot decode: {exc}")


def verify_sheet(path: Path, context: str, errors: list[str]) -> None:
    if not path.is_file():
        error(errors, f"{context}: sheet is missing")
        return
    try:
        with Image.open(path) as opened:
            if opened.format != "PNG" or opened.width != opened.height:
                error(errors, f"{context}: expected square PNG, found {opened.size} {opened.format}")
            rgb = opened.convert("RGB")
        key = (0, 255, 0)
        corners = (
            rgb.getpixel((0, 0)),
            rgb.getpixel((rgb.width - 1, 0)),
            rgb.getpixel((0, rgb.height - 1)),
            rgb.getpixel((rgb.width - 1, rgb.height - 1)),
        )
        if any(pixel != key for pixel in corners):
            error(errors, f"{context}: all four corners must be exact #00ff00, found {corners}")
        border = (
            [rgb.getpixel((x, 0)) for x in range(rgb.width)]
            + [rgb.getpixel((x, rgb.height - 1)) for x in range(rgb.width)]
            + [rgb.getpixel((0, y)) for y in range(rgb.height)]
            + [rgb.getpixel((rgb.width - 1, y)) for y in range(rgb.height)]
        )
        exact_border_ratio = sum(pixel == key for pixel in border) / max(1, len(border))
        if exact_border_ratio != 1.0:
            error(
                errors,
                f"{context}: outer border must be 100% exact #00ff00, "
                f"found {exact_border_ratio:.2%}",
            )

        pixels = list(rgb.getdata())
        foreground_mask = bytes(0 if pixel == key else 1 for pixel in pixels)
        components = connected_component_stats(
            foreground_mask,
            rgb.width,
            rgb.height,
            minimum_pixels=32,
        )
        if len(components) != 16:
            error(
                errors,
                f"{context}: expected exactly 16 complete foreground components, "
                f"found {len(components)}",
            )
        else:
            ordered = sorted(components, key=lambda component: (component.center_y, component.center_x))
            rows = [
                sorted(ordered[row * 4 : (row + 1) * 4], key=lambda component: component.center_x)
                for row in range(4)
            ]
            for row_index, row in enumerate(rows):
                if any(row[column].center_x >= row[column + 1].center_x for column in range(3)):
                    error(errors, f"{context}: row {row_index + 1} centroids are not monotonic")
                if row_index < 3 and max(component.center_y for component in row) >= min(
                    component.center_y for component in rows[row_index + 1]
                ):
                    error(errors, f"{context}: row {row_index + 1} centroid order overlaps")
                for column_index, component in enumerate(row):
                    if not (
                        column_index * rgb.width / 4 <= component.center_x < (column_index + 1) * rgb.width / 4
                        and row_index * rgb.height / 4 <= component.center_y < (row_index + 1) * rgb.height / 4
                    ):
                        error(
                            errors,
                            f"{context}: component centroid is outside slot "
                            f"{row_index + 1},{column_index + 1}",
                        )
                    left, top, right, bottom = component.bounds
                    if left <= 0 or top <= 0 or right >= rgb.width or bottom >= rgb.height:
                        error(
                            errors,
                            f"{context}: component in slot {row_index + 1},{column_index + 1} "
                            f"touches outer border",
                        )
        for row in range(4):
            for column in range(4):
                cell = rgb.crop(
                    (
                        column * rgb.width // 4,
                        row * rgb.height // 4,
                        (column + 1) * rgb.width // 4,
                        (row + 1) * rgb.height // 4,
                    )
                )
                pixels = list(cell.getdata())
                chroma = sum(
                    1
                    for red, green, blue in pixels
                    if green >= 165 and green >= red + 65 and green >= blue + 65
                ) / max(1, len(pixels))
                if not 0.35 <= chroma <= 0.97:
                    error(errors, f"{context}: cell {row + 1},{column + 1} has invalid chroma ratio {chroma:.1%}")
    except (OSError, ValueError) as exc:
        error(errors, f"{context}: cannot decode sheet: {exc}")


def verify_frame_sheets(
    manifest: dict[str, Any], expected: set[Path], errors: list[str]
) -> dict[str, list[str]]:
    entries = manifest.get("frameSheets")
    if not isinstance(entries, list):
        error(errors, "manifest frameSheets must be a list")
        return {}
    by_character: dict[str, list[str]] = {character_id: [] for character_id in CHARACTERS}
    seen: set[tuple[str, str]] = set()
    for entry in entries:
        if not isinstance(entry, dict):
            error(errors, "frameSheets entries must be objects")
            continue
        character_id = entry.get("characterId")
        group = entry.get("group")
        if character_id not in CHARACTERS or group not in SHEET_GROUPS:
            error(errors, f"unexpected frame sheet key: {character_id}/{group}")
            continue
        key = (character_id, group)
        if key in seen:
            error(errors, f"duplicate frame sheet: {character_id}/{group}")
        seen.add(key)
        expected_relative = (
            f"endless-runner/assets/characters/frame-sheets/"
            f"{character_id}-{group}-8frame-sheet.png"
        )
        if entry.get("path") != expected_relative:
            error(errors, f"{character_id}/{group}: wrong frame-sheet path")
        if entry.get("actions") != list(SHEET_GROUPS[group]):
            error(errors, f"{character_id}/{group}: wrong action mapping")
        path = repo_path(entry.get("path"), f"{character_id}/{group}", errors)
        if path is None:
            continue
        expected.add(path)
        by_character[character_id].append(entry.get("path"))
        verify_sheet(path, f"{character_id}/{group}", errors)
        if path.is_file() and entry.get("sha256") != hashlib.sha256(path.read_bytes()).hexdigest():
            error(errors, f"{character_id}/{group}: frame-sheet SHA mismatch")
    expected_keys = {(character_id, group) for character_id in CHARACTERS for group in SHEET_GROUPS}
    if seen != expected_keys:
        error(errors, f"expected {len(expected_keys)} latest frame sheets, found {len(seen)}")
    return by_character


def verify_characters(
    manifest: dict[str, Any],
    sheet_paths: dict[str, list[str]],
    expected_frames: set[Path],
    expected_previews: set[Path],
    expected_gifs: set[Path],
    errors: list[str],
) -> None:
    entries = manifest.get("characters")
    if not isinstance(entries, list):
        error(errors, "manifest characters must be a list")
        return
    by_id = {entry.get("id"): entry for entry in entries if isinstance(entry, dict)}
    if set(by_id) != set(CHARACTERS):
        error(errors, f"character IDs must be latest nine-character set; found {sorted(by_id)}")
    for character_id, spec in CHARACTERS.items():
        entry = by_id.get(character_id)
        if not isinstance(entry, dict):
            continue
        if entry.get("identity") != spec["identity"] or entry.get("style") != spec["style"]:
            error(errors, f"{character_id}: wrong identity/style")
        if entry.get("source") != SOURCE_SHEETS[spec["source"]]["path"]:
            error(errors, f"{character_id}: wrong approved source reference")
        if set(entry.get("frameSheets", [])) != set(sheet_paths.get(character_id, [])):
            error(errors, f"{character_id}: frameSheets do not match verified sheets")
        actions = entry.get("actions")
        if not isinstance(actions, dict) or set(actions) != set(ACTIONS):
            error(errors, f"{character_id}: expected actions {ACTIONS}")
            continue

        loaded_actions: dict[str, list[Image.Image]] = {}
        for action in ACTIONS:
            action_entry = actions.get(action)
            context = f"{character_id}/{action}"
            if not isinstance(action_entry, dict):
                error(errors, f"{context}: manifest entry is missing")
                continue
            base = f"endless-runner/assets/characters/{character_id}/{character_id}-{action}"
            expected_png = f"{base}.png"
            expected_gif = f"{base}.gif"
            frame_relatives = [
                f"endless-runner/assets/characters/{character_id}/frames/"
                f"{character_id}-{action}-{index:02d}.png"
                for index in range(1, FRAME_COUNT + 1)
            ]
            if action_entry.get("png") != expected_png or action_entry.get("gif") != expected_gif:
                error(errors, f"{context}: wrong preview/GIF path")
            if action_entry.get("frames") != frame_relatives:
                error(errors, f"{context}: manifest must list ordered 01..08 frame PNGs")
            if action_entry.get("frameCount") != FRAME_COUNT:
                error(errors, f"{context}: frameCount must be {FRAME_COUNT}")
            durations = ACTION_DURATIONS[action]
            if action_entry.get("durationsMs") != durations or action_entry.get("durationMs") != sum(durations):
                error(errors, f"{context}: wrong durations")
            expected_loop = action == "run"
            if action_entry.get("loop") is not expected_loop:
                error(errors, f"{context}: wrong loop declaration")

            frames: list[Image.Image] = []
            for index, relative in enumerate(frame_relatives, start=1):
                path = repo_path(relative, f"{context} frame {index}", errors)
                if path is None:
                    continue
                expected_frames.add(path)
                loaded = load_frame(path, f"{context} frame {index}", errors)
                if loaded is not None:
                    frames.append(loaded)
            loaded_actions[action] = frames
            verify_distinct(frames, context, errors)
            if action == "slide":
                verify_slide_shape(frames, context, errors)

            preview_path = repo_path(action_entry.get("png"), f"{context} preview", errors)
            gif_path = repo_path(action_entry.get("gif"), f"{context} GIF", errors)
            if preview_path is not None:
                expected_previews.add(preview_path)
                preview = load_frame(preview_path, f"{context} preview", errors)
                if preview is not None and frames and preview.tobytes() != frames[0].tobytes():
                    error(errors, f"{context}: preview must equal frame 01")
            if gif_path is not None:
                expected_gifs.add(gif_path)
                verify_gif(gif_path, frames, durations, expected_loop, context, errors)

            if action == "slide":
                clips = action_entry.get("clips")
                if not isinstance(clips, dict) or set(clips) != set(SLIDE_CLIPS):
                    error(errors, f"{context}: slide clips must be enter/hold/exit")
                    continue
                for clip_name, clip_spec in SLIDE_CLIPS.items():
                    clip_entry = clips.get(clip_name)
                    clip_context = f"{context}-{clip_name}"
                    if not isinstance(clip_entry, dict):
                        error(errors, f"{clip_context}: manifest entry is missing")
                        continue
                    expected_relative = f"{base}-{clip_name}.gif"
                    if clip_entry.get("gif") != expected_relative:
                        error(errors, f"{clip_context}: wrong GIF path")
                    indexes = clip_spec["indexes"]
                    durations = clip_spec["durations"]
                    if clip_entry.get("frameIndexes") != indexes:
                        error(errors, f"{clip_context}: wrong source frame indexes")
                    if clip_entry.get("frameCount") != len(indexes):
                        error(errors, f"{clip_context}: wrong frameCount")
                    if clip_entry.get("durationsMs") != durations or clip_entry.get("durationMs") != sum(durations):
                        error(errors, f"{clip_context}: wrong durations")
                    if clip_entry.get("loop") is not clip_spec["loop"]:
                        error(errors, f"{clip_context}: wrong loop declaration")
                    clip_path = repo_path(clip_entry.get("gif"), clip_context, errors)
                    if clip_path is not None:
                        expected_gifs.add(clip_path)
                        source_subset = [frames[index - 1] for index in indexes] if len(frames) == 8 else []
                        verify_gif(
                            clip_path,
                            source_subset,
                            durations,
                            bool(clip_spec["loop"]),
                            clip_context,
                            errors,
                        )
        if character_id == IAN_RUN_CHARACTER_ID:
            verify_ian_run_head_stability(loaded_actions.get("run", []), errors)


def verify_inventory(
    expected_sources: set[Path],
    expected_sheets: set[Path],
    expected_frames: set[Path],
    expected_previews: set[Path],
    expected_gifs: set[Path],
    errors: list[str],
) -> None:
    character_count = len(CHARACTERS)
    action_count = len(ACTIONS)
    inventories = (
        ("source sheet", expected_sources, {path.resolve() for path in ASSET_ROOT.glob("sources/*.png")}, len(SOURCE_SHEETS)),
        ("frame sheet", expected_sheets, {path.resolve() for path in ASSET_ROOT.glob("frame-sheets/*.png")}, character_count * len(SHEET_GROUPS)),
        ("frame PNG", expected_frames, {path.resolve() for path in ASSET_ROOT.glob("*/frames/*.png")}, character_count * action_count * FRAME_COUNT),
        (
            "preview PNG",
            expected_previews,
            {path.resolve() for path in ASSET_ROOT.glob("*/*.png") if path.parent.name in CHARACTERS},
            character_count * action_count,
        ),
        (
            "GIF",
            expected_gifs,
            {path.resolve() for path in ASSET_ROOT.glob("*/*.gif")},
            character_count * (action_count + len(SLIDE_CLIPS)),
        ),
    )
    for label, expected, actual, count in inventories:
        if len(actual) != count:
            error(errors, f"inventory: expected {count} {label} files, found {len(actual)}")
        extras = actual - expected
        missing = expected - actual
        if extras:
            error(errors, f"inventory: stale {label} files remain: {', '.join(sorted(path.name for path in extras))}")
        if missing:
            error(errors, f"inventory: missing {label} files: {', '.join(sorted(path.name for path in missing))}")
    if any(path.name.startswith("floral-hat-boy-") for path in ASSET_ROOT.iterdir()):
        error(errors, "inventory: obsolete floral-hat-boy asset directory remains")
    expected_top_level = set(CHARACTERS) | {"sources", "frame-sheets", "manifest.json"}
    actual_top_level = {path.name for path in ASSET_ROOT.iterdir()}
    if actual_top_level != expected_top_level:
        error(
            errors,
            f"inventory: top-level asset entries must be latest-only; "
            f"found extras={sorted(actual_top_level - expected_top_level)} "
            f"missing={sorted(expected_top_level - actual_top_level)}",
        )
    stale_atomic_dirs = sorted(
        path.name
        for path in ASSET_ROOT.parent.iterdir()
        if path.name == ".characters-previous" or path.name.startswith(".characters-staging-")
    )
    if stale_atomic_dirs:
        error(errors, f"inventory: stale atomic-build directories remain: {stale_atomic_dirs}")


def main() -> int:
    errors: list[str] = []
    manifest = load_manifest(errors)
    if manifest is None:
        print("FAIL endless-runner eight-frame assets")
        for item in errors:
            print(f"- {item}")
        return 1

    if manifest.get("version") != MANIFEST_VERSION:
        error(errors, f"manifest version must be {MANIFEST_VERSION}")
    if manifest.get("frameCountPerAction") != FRAME_COUNT:
        error(errors, f"manifest frameCountPerAction must be {FRAME_COUNT}")
    if manifest.get("method") != METHOD:
        error(errors, "manifest method must declare the latest identity-approved eight-pose/no-transform generation")
    if manifest.get("canvas") != {"width": 256, "height": 256, "pivot": [128, 232]}:
        error(errors, "manifest canvas/pivot contract is wrong")

    expected_sources: set[Path] = set()
    expected_sheets: set[Path] = set()
    expected_frames: set[Path] = set()
    expected_previews: set[Path] = set()
    expected_gifs: set[Path] = set()
    verify_sources(manifest, expected_sources, errors)
    sheets = verify_frame_sheets(manifest, expected_sheets, errors)
    verify_characters(
        manifest,
        sheets,
        expected_frames,
        expected_previews,
        expected_gifs,
        errors,
    )
    verify_inventory(
        expected_sources,
        expected_sheets,
        expected_frames,
        expected_previews,
        expected_gifs,
        errors,
    )

    if errors:
        print("FAIL endless-runner eight-frame assets")
        for item in errors:
            print(f"- {item}")
        return 1
    print(
        "PASS endless-runner eight-frame assets: 6 approved designs, 18 frame sheets, "
        "288 frame PNGs, 36 eight-frame GIFs, 27 slide phase GIFs"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
