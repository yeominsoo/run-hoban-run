#!/usr/bin/env python3
"""Build eight-frame Endless Runner character animations from authored sheets.

Each character has two 4x4 sheets.  The first contains RUN and JUMP (two rows
per action), and the second contains SLIDE and FALL.  The script removes the
chroma background, extracts and normalizes all 32 genuinely authored poses,
and encodes them directly.  It never creates motion by translating, rotating,
scaling, mirroring, or duplicating a source pose.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
from collections import deque
from dataclasses import dataclass
from pathlib import Path

from PIL import Image


CANVAS_SIZE = (256, 256)
PIVOT = (128, 232)
FRAME_COUNT = 8
SHEET_COLUMNS = 4
SHEET_ROWS = 4
ACTIONS = ("run", "jump", "slide", "fall")
ACTION_LABELS = {"run": "달리기", "jump": "점프", "slide": "슬라이딩", "fall": "넘어짐"}
ACTION_DURATIONS = {
    "run": [80, 80, 80, 80, 80, 80, 80, 80],
    "jump": [70, 70, 80, 90, 100, 90, 90, 100],
    "slide": [90, 90, 200, 200, 200, 200, 90, 90],
    "fall": [90, 100, 110, 120, 130, 150, 180, 220],
}
METHOD = "eight model-generated chronological poses from approved identity references; no transform tween"
LOOPING_ACTIONS = frozenset({"run"})
SLIDE_CLIPS = {
    "enter": {"frame_indexes": (0, 1), "durations": [90, 90], "loop": False},
    "hold": {"frame_indexes": (2, 3, 4, 5), "durations": [100, 100, 100, 100], "loop": True},
    "exit": {"frame_indexes": (6, 7), "durations": [90, 90], "loop": False},
}
SHEET_GROUPS = {
    "run-jump": ("run", "jump"),
    "slide-fall": ("slide", "fall"),
}
DESIGN_SOURCE_DIR = Path("output/imagegen/endless-runner-characters-2026-07-15")
FRAME_SHEET_DIR = Path("output/imagegen/endless-runner-8frame-2026-07-24")
ASSET_DIR = Path("endless-runner/assets/characters")


@dataclass(frozen=True)
class Style:
    key: str
    label: str
    design_source_name: str
    design_asset_name: str
    boy_design_source_name: str
    boy_design_asset_name: str


@dataclass(frozen=True)
class Character:
    key: str
    label: str
    identity: str
    source_family: str


@dataclass(frozen=True)
class ForegroundComponent:
    bounds: tuple[int, int, int, int]
    center_x: float
    center_y: float
    pixel_count: int
    pixels: tuple[int, ...]


STYLES = (
    Style(
        key="flat-sticker",
        label="플랫 스티커",
        design_source_name="concept-a-flat-sticker-action-sheet-v3-two-girls-dress-corrected.png",
        design_asset_name="runner-flat-sticker-action-sheet.png",
        boy_design_source_name="checkered-vest-boy-flat-sticker-action-sheet-v1.png",
        boy_design_asset_name="checkered-vest-boy-flat-sticker-action-sheet.png",
    ),
    Style(
        key="storybook-paper",
        label="동화책 페이퍼",
        design_source_name="concept-b-storybook-cutpaper-action-sheet-v3-two-girls-dress-corrected.png",
        design_asset_name="runner-storybook-paper-action-sheet.png",
        boy_design_source_name="checkered-vest-boy-storybook-paper-action-sheet-v1.png",
        boy_design_asset_name="checkered-vest-boy-storybook-paper-action-sheet.png",
    ),
    Style(
        key="soft-3d-toy",
        label="소프트 3D 토이",
        design_source_name="concept-c-soft-3d-toy-action-sheet-v3-two-girls-dress-corrected.png",
        design_asset_name="runner-soft-3d-toy-action-sheet.png",
        boy_design_source_name="checkered-vest-boy-soft-3d-toy-action-sheet-v1.png",
        boy_design_asset_name="checkered-vest-boy-soft-3d-toy-action-sheet.png",
    ),
)

CHARACTERS = (
    Character(key="floral-hat-girl", label="꽃모자 소녀", identity="girl", source_family="two-girls"),
    Character(key="pink-glasses-girl", label="분홍안경 소녀", identity="girl", source_family="two-girls"),
    Character(key="checkered-vest-boy", label="체크 조끼 소년", identity="boy", source_family="checkered-vest-boy"),
)


def design_source_details(
    style: Style,
    source_family: str,
) -> tuple[str, str, str, tuple[str, ...]]:
    if source_family == "two-girls":
        return (
            style.design_source_name,
            style.design_asset_name,
            "v3-two-girls-dress-corrected",
            ("floral-hat-girl", "pink-glasses-girl"),
        )
    if source_family == "checkered-vest-boy":
        return (
            style.boy_design_source_name,
            style.boy_design_asset_name,
            "v1-checkered-vest-boy-large-monolid-eyes",
            ("checkered-vest-boy",),
        )
    raise ValueError(f"Unknown design source family: {source_family}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=Path(__file__).resolve().parents[1],
        help="run-hoban-run repository root",
    )
    parser.add_argument(
        "--only-character",
        help="Rebuild only this character ID while preserving every other runtime asset byte-for-byte.",
    )
    parser.add_argument(
        "--only-action",
        choices=ACTIONS,
        help="Rebuild only this action; requires --only-character.",
    )
    arguments = parser.parse_args()
    if bool(arguments.only_character) != bool(arguments.only_action):
        parser.error("--only-character and --only-action must be used together")
    return arguments


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


def find_foreground_components(sheet: Image.Image) -> list[ForegroundComponent]:
    """Return every non-trivial connected alpha component in a full source sheet.

    Authored poses are laid out on an implicit 4x4 grid, but airborne and prone
    silhouettes can legitimately cross the mathematical cell boundaries.  Finding
    components on the full sheet keeps each complete figure intact and prevents a
    rigid cell crop from importing pieces of the neighbouring pose.
    """

    alpha = sheet.getchannel("A")
    width, height = sheet.size
    values = alpha.tobytes()
    visited = bytearray(width * height)
    components: list[ForegroundComponent] = []

    for start, value in enumerate(values):
        if value == 0 or visited[start]:
            continue
        visited[start] = 1
        queue: deque[int] = deque((start,))
        pixels: list[int] = []
        min_x = width
        min_y = height
        max_x = 0
        max_y = 0
        sum_x = 0
        sum_y = 0

        while queue:
            index = queue.popleft()
            pixels.append(index)
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
                    if not visited[neighbor] and values[neighbor] > 0:
                        visited[neighbor] = 1
                        queue.append(neighbor)

        # Chroma removal can leave a tiny isolated antialiasing speck.  A real
        # authored pose is tens of thousands of pixels, so exclude 32px noise
        # from the grid assignment as well as anything smaller.
        if len(pixels) <= 32:
            continue
        components.append(
            ForegroundComponent(
                bounds=(min_x, min_y, max_x + 1, max_y + 1),
                center_x=sum_x / len(pixels),
                center_y=sum_y / len(pixels),
                pixel_count=len(pixels),
                pixels=tuple(pixels),
            )
        )

    return components


def assign_components_to_grid(
    components: list[ForegroundComponent],
    sheet_size: tuple[int, int],
) -> list[list[ForegroundComponent]]:
    width, height = sheet_size
    expected_count = SHEET_COLUMNS * SHEET_ROWS
    if len(components) != expected_count:
        raise RuntimeError(
            f"Expected exactly {expected_count} authored foreground components, "
            f"found {len(components)}"
        )

    ordered = sorted(components, key=lambda component: (component.center_y, component.center_x))
    rows = [
        sorted(
            ordered[row * SHEET_COLUMNS : (row + 1) * SHEET_COLUMNS],
            key=lambda component: component.center_x,
        )
        for row in range(SHEET_ROWS)
    ]

    for row_index, row in enumerate(rows):
        if len(row) != SHEET_COLUMNS:
            raise RuntimeError(f"Foreground row {row_index + 1} does not contain four poses")
        if any(
            row[column].center_x >= row[column + 1].center_x
            for column in range(SHEET_COLUMNS - 1)
        ):
            raise RuntimeError(f"Foreground row {row_index + 1} centroids are not monotonic")
        if row_index < SHEET_ROWS - 1:
            if max(component.center_y for component in row) >= min(
                component.center_y for component in rows[row_index + 1]
            ):
                raise RuntimeError(f"Foreground row {row_index + 1} overlaps the next centroid row")

        for column_index, component in enumerate(row):
            expected_left = column_index * width / SHEET_COLUMNS
            expected_right = (column_index + 1) * width / SHEET_COLUMNS
            expected_top = row_index * height / SHEET_ROWS
            expected_bottom = (row_index + 1) * height / SHEET_ROWS
            if not (
                expected_left <= component.center_x < expected_right
                and expected_top <= component.center_y < expected_bottom
            ):
                raise RuntimeError(
                    f"Foreground component centroid ({component.center_x:.1f}, "
                    f"{component.center_y:.1f}) is outside slot "
                    f"{row_index + 1},{column_index + 1}"
                )
            left, top, right, bottom = component.bounds
            if left <= 0 or top <= 0 or right >= width or bottom >= height:
                raise RuntimeError(
                    f"Foreground component in slot {row_index + 1},{column_index + 1} "
                    f"touches the outer sheet border: {component.bounds}"
                )

    if sum(len(row) for row in rows) != expected_count:
        raise RuntimeError("Not all authored foreground components were assigned to the grid")
    return rows


def isolate_component(sheet: Image.Image, component: ForegroundComponent) -> Image.Image:
    left, top, right, bottom = component.bounds
    frame = Image.new("RGBA", (right - left, bottom - top), (0, 0, 0, 0))
    source_pixels = sheet.load()
    frame_pixels = frame.load()
    sheet_width = sheet.width
    for index in component.pixels:
        y, x = divmod(index, sheet_width)
        frame_pixels[x - left, y - top] = source_pixels[x, y]
    return frame


def extract_sheet_frames(sheet: Image.Image, group: str) -> dict[str, list[Image.Image]]:
    if group not in SHEET_GROUPS:
        raise ValueError(f"Unknown sheet group: {group}")
    actions = SHEET_GROUPS[group]
    extracted = {action: [] for action in actions}
    components = find_foreground_components(sheet)
    grid = assign_components_to_grid(components, sheet.size)

    for action_offset, action in enumerate(actions):
        for frame_index in range(FRAME_COUNT):
            row = action_offset * 2 + frame_index // SHEET_COLUMNS
            column = frame_index % SHEET_COLUMNS
            extracted[action].append(isolate_component(sheet, grid[row][column]))
    return extracted


def normalize_frames(frames: dict[str, list[Image.Image]]) -> dict[str, list[Image.Image]]:
    if set(frames) != set(ACTIONS):
        raise RuntimeError(f"Expected actions {ACTIONS}, found {tuple(frames)}")
    if any(len(action_frames) != FRAME_COUNT for action_frames in frames.values()):
        raise RuntimeError("Every action must contain exactly eight authored frames")

    run_height = max(frame.height for frame in frames["run"])
    all_frames = [frame for action_frames in frames.values() for frame in action_frames]
    max_width = max(frame.width for frame in all_frames)
    max_height = max(frame.height for frame in all_frames)
    scale = min(196 / run_height, 224 / max_width, 220 / max_height)

    normalized: dict[str, list[Image.Image]] = {}
    for action, action_frames in frames.items():
        normalized[action] = []
        for frame in action_frames:
            size = (max(1, round(frame.width * scale)), max(1, round(frame.height * scale)))
            subject = frame.resize(size, Image.Resampling.LANCZOS)
            canvas = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
            x = round(PIVOT[0] - subject.width / 2)
            y = PIVOT[1] - subject.height
            canvas.alpha_composite(subject, (x, y))

            # Chroma removal can leave a one-to-three-pixel low-alpha fringe below a shoe.
            # Keep every already-valid frame byte-positioned as before, but correct frames
            # whose verifier-visible (alpha >= 96) baseline would otherwise miss the pivot.
            visible_bounds = canvas.getchannel("A").point(
                lambda alpha: 255 if alpha >= 96 else 0
            ).getbbox()
            if visible_bounds is None:
                raise RuntimeError(f"{action} frame has no verifier-visible subject")
            baseline_delta = PIVOT[1] - visible_bounds[3]
            if abs(baseline_delta) > 2:
                aligned = Image.new("RGBA", CANVAS_SIZE, (0, 0, 0, 0))
                aligned.alpha_composite(canvas, (0, baseline_delta))
                canvas = aligned
            normalized[action].append(canvas)
    return normalized


def validate_distinct_frames(frames: dict[str, list[Image.Image]], character_id: str) -> None:
    for action, action_frames in frames.items():
        digests = {hashlib.sha256(frame.tobytes()).hexdigest() for frame in action_frames}
        if len(digests) != FRAME_COUNT:
            raise RuntimeError(f"{character_id}/{action} contains duplicate rendered frames")


def gif_palette_frame(image: Image.Image) -> Image.Image:
    rgb = image.convert("RGB")
    palette = rgb.quantize(colors=255, method=Image.Quantize.MEDIANCUT)
    transparent = image.getchannel("A").point(lambda alpha: 255 if alpha < 96 else 0)
    palette.paste(255, mask=transparent)
    palette.info["transparency"] = 255
    palette.info["disposal"] = 2
    return palette


def save_gif(
    frames: list[Image.Image],
    durations: list[int],
    destination: Path,
    *,
    loop: bool,
) -> None:
    if len(frames) != len(durations):
        raise ValueError(f"GIF frame/duration mismatch for {destination}")
    palette_frames = [gif_palette_frame(frame) for frame in frames]
    options: dict[str, object] = {
        "save_all": True,
        "append_images": palette_frames[1:],
        "duration": durations,
        "disposal": 2,
        "transparency": 255,
        "optimize": False,
    }
    if loop:
        options["loop"] = 0
    palette_frames[0].save(destination, format="GIF", **options)


def select_input(generated: Path, fallback: Path, description: str) -> Path:
    if generated.is_file():
        return generated
    if fallback.is_file():
        return fallback
    raise FileNotFoundError(f"Missing {description} in both paths: {generated}, {fallback}")


def copy_design_sources(
    repo_root: Path,
    current_asset_root: Path,
    staging_root: Path,
    manifest: dict[str, object],
) -> None:
    destination_root = staging_root / "sources"
    destination_root.mkdir(parents=True)
    for style in STYLES:
        for source_family in ("two-girls", "checkered-vest-boy"):
            generated_name, asset_name, design_revision, identities = design_source_details(
                style,
                source_family,
            )
            generated = repo_root / DESIGN_SOURCE_DIR / generated_name
            fallback = current_asset_root / "sources" / asset_name
            source = select_input(
                generated,
                fallback,
                f"approved {source_family} {style.key} design source",
            )
            destination = destination_root / asset_name
            shutil.copyfile(source, destination)
            manifest["sourceSheets"].append(
                {
                    "id": f"{source_family}-{style.key}",
                    "identities": list(identities),
                    "style": style.key,
                    "label": style.label,
                    "path": (ASSET_DIR / "sources" / asset_name).as_posix(),
                    "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                    "designRevision": design_revision,
                }
            )


def replace_asset_root(staging_root: Path, asset_root: Path) -> None:
    backup = asset_root.with_name(f".{asset_root.name}-previous")
    if backup.exists():
        shutil.rmtree(backup)
    if asset_root.exists():
        asset_root.rename(backup)
    try:
        staging_root.rename(asset_root)
    except Exception:
        if backup.exists() and not asset_root.exists():
            backup.rename(asset_root)
        raise
    if backup.exists():
        shutil.rmtree(backup)


def match_project_ownership(tree_root: Path, project_root: Path) -> None:
    """Keep root-run rebuilds writable by the repository owner.

    Codex may execute this tool as root even though the checkout belongs to the
    regular project user.  tempfile creates its staging root as 0700, so normalize
    that mode and, when permitted, carry the repository owner's uid/gid to the
    complete generated tree before the atomic rename.
    """

    tree_root.chmod(0o755)
    if not hasattr(os, "geteuid") or os.geteuid() != 0:
        return
    project_stat = project_root.stat()
    for path in (tree_root, *tree_root.rglob("*")):
        os.chown(path, project_stat.st_uid, project_stat.st_gid)


def build_single_action(repo_root: Path, character_id: str, action: str) -> None:
    """Rebuild one runtime action without re-encoding unrelated approved assets."""

    selected = next(
        (
            (style, character)
            for style in STYLES
            for character in CHARACTERS
            if f"{character.key}-{style.key}" == character_id
        ),
        None,
    )
    if selected is None:
        valid_ids = sorted(
            f"{character.key}-{style.key}"
            for style in STYLES
            for character in CHARACTERS
        )
        raise ValueError(f"Unknown character ID {character_id!r}; expected one of {valid_ids}")

    asset_root = repo_root / ASSET_DIR
    frame_sheet_root = repo_root / FRAME_SHEET_DIR
    manifest_path = asset_root / "manifest.json"
    if not manifest_path.is_file():
        raise FileNotFoundError(f"Missing current asset manifest: {manifest_path}")

    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest["generatedOn"] = "2026-07-24"
    staging_path = Path(tempfile.mkdtemp(prefix=".characters-staging-", dir=asset_root.parent))
    try:
        shutil.copytree(asset_root, staging_path, dirs_exist_ok=True)
        extracted: dict[str, list[Image.Image]] = {}

        with tempfile.TemporaryDirectory(prefix="endless-runner-chroma-") as temporary_directory:
            temporary_root = Path(temporary_directory)
            for group, group_actions in SHEET_GROUPS.items():
                sheet_name = f"{character_id}-{group}-8frame-sheet.png"
                fallback = asset_root / "frame-sheets" / sheet_name
                generated = frame_sheet_root / sheet_name
                updates_group = action in group_actions
                source = (
                    select_input(generated, fallback, f"{character_id} {group} frame sheet")
                    if updates_group
                    else fallback
                )
                staged_sheet = staging_path / "frame-sheets" / sheet_name
                if updates_group:
                    shutil.copyfile(source, staged_sheet)

                transparent_sheet = temporary_root / sheet_name
                remove_chroma_key(staged_sheet if updates_group else source, transparent_sheet)
                with Image.open(transparent_sheet) as opened:
                    transparent_rgba = opened.convert("RGBA")
                    if updates_group and source == generated:
                        canonical_sheet = Image.new(
                            "RGBA",
                            transparent_rgba.size,
                            (0, 255, 0, 255),
                        )
                        canonical_sheet.alpha_composite(transparent_rgba)
                        canonical_sheet.convert("RGB").save(
                            staged_sheet,
                            format="PNG",
                            optimize=True,
                        )
                    extracted.update(extract_sheet_frames(transparent_rgba, group))

                if updates_group:
                    relative = (ASSET_DIR / "frame-sheets" / sheet_name).as_posix()
                    entry = next(
                        (
                            candidate
                            for candidate in manifest["frameSheets"]
                            if candidate.get("characterId") == character_id
                            and candidate.get("group") == group
                        ),
                        None,
                    )
                    if entry is None:
                        raise RuntimeError(f"Manifest is missing frame sheet {character_id}/{group}")
                    entry["path"] = relative
                    entry["sha256"] = hashlib.sha256(staged_sheet.read_bytes()).hexdigest()

        normalized = normalize_frames(extracted)
        validate_distinct_frames(normalized, character_id)
        action_frames = normalized[action]
        character_dir = staging_path / character_id
        frames_dir = character_dir / "frames"
        for frame_index, frame in enumerate(action_frames, start=1):
            filename = f"{character_id}-{action}-{frame_index:02d}.png"
            frame.save(frames_dir / filename, format="PNG", optimize=True)

        preview_name = f"{character_id}-{action}.png"
        gif_name = f"{character_id}-{action}.gif"
        action_frames[0].save(character_dir / preview_name, format="PNG", optimize=True)
        save_gif(
            action_frames,
            ACTION_DURATIONS[action],
            character_dir / gif_name,
            loop=action in LOOPING_ACTIONS,
        )
        if action == "slide":
            for clip_name, spec in SLIDE_CLIPS.items():
                indexes = spec["frame_indexes"]
                save_gif(
                    [action_frames[index] for index in indexes],
                    spec["durations"],
                    character_dir / f"{character_id}-slide-{clip_name}.gif",
                    loop=bool(spec["loop"]),
                )

        (staging_path / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        match_project_ownership(staging_path, repo_root)
        replace_asset_root(staging_path, asset_root)
    finally:
        if staging_path.exists():
            shutil.rmtree(staging_path)

    print(f"Built {character_id}/{action} while preserving unrelated runtime assets")


def build(repo_root: Path) -> None:
    asset_root = repo_root / ASSET_DIR
    asset_parent = asset_root.parent
    asset_parent.mkdir(parents=True, exist_ok=True)
    frame_sheet_root = repo_root / FRAME_SHEET_DIR

    manifest: dict[str, object] = {
        "version": 4,
        "generatedOn": "2026-07-24",
        "canvas": {"width": CANVAS_SIZE[0], "height": CANVAS_SIZE[1], "pivot": list(PIVOT)},
        "frameCountPerAction": FRAME_COUNT,
        "method": METHOD,
        "sourceSheets": [],
        "frameSheets": [],
        "characters": [],
    }

    staging_path = Path(tempfile.mkdtemp(prefix=".characters-staging-", dir=asset_parent))
    try:
        copy_design_sources(repo_root, asset_root, staging_path, manifest)
        staged_sheets = staging_path / "frame-sheets"
        staged_sheets.mkdir()

        with tempfile.TemporaryDirectory(prefix="endless-runner-chroma-") as temporary_directory:
            temporary_root = Path(temporary_directory)
            for style in STYLES:
                for character in CHARACTERS:
                    character_id = f"{character.key}-{style.key}"
                    extracted: dict[str, list[Image.Image]] = {}
                    character_sheet_paths: list[str] = []

                    for group in SHEET_GROUPS:
                        sheet_name = f"{character_id}-{group}-8frame-sheet.png"
                        generated = frame_sheet_root / sheet_name
                        fallback = asset_root / "frame-sheets" / sheet_name
                        source = select_input(generated, fallback, f"{character_id} {group} frame sheet")
                        staged_sheet = staged_sheets / sheet_name
                        shutil.copyfile(source, staged_sheet)

                        with Image.open(staged_sheet) as image:
                            if image.width != image.height:
                                raise ValueError(f"Frame sheet must be square 4x4: {staged_sheet} {image.size}")
                        transparent_sheet = temporary_root / sheet_name
                        remove_chroma_key(staged_sheet, transparent_sheet)
                        with Image.open(transparent_sheet) as opened:
                            transparent_rgba = opened.convert("RGBA")
                            if source == generated:
                                # Image generation can add a barely visible green lighting gradient
                                # even when a flat chroma background is requested.  Preserve the
                                # extracted antialiased subject, but canonicalize the archived sheet
                                # so its empty background again satisfies the exact #00ff00 contract.
                                canonical_sheet = Image.new(
                                    "RGBA",
                                    transparent_rgba.size,
                                    (0, 255, 0, 255),
                                )
                                canonical_sheet.alpha_composite(transparent_rgba)
                                canonical_sheet.convert("RGB").save(
                                    staged_sheet,
                                    format="PNG",
                                    optimize=True,
                                )
                            group_frames = extract_sheet_frames(transparent_rgba, group)
                        overlap = set(extracted).intersection(group_frames)
                        if overlap:
                            raise RuntimeError(f"Duplicate actions across sheets for {character_id}: {overlap}")
                        extracted.update(group_frames)

                        relative = (ASSET_DIR / "frame-sheets" / sheet_name).as_posix()
                        character_sheet_paths.append(relative)
                        manifest["frameSheets"].append(
                            {
                                "characterId": character_id,
                                "group": group,
                                "actions": list(SHEET_GROUPS[group]),
                                "path": relative,
                                "sha256": hashlib.sha256(staged_sheet.read_bytes()).hexdigest(),
                            }
                        )

                    normalized = normalize_frames(extracted)
                    validate_distinct_frames(normalized, character_id)
                    character_dir = staging_path / character_id
                    frames_dir = character_dir / "frames"
                    frames_dir.mkdir(parents=True)
                    actions: dict[str, object] = {}

                    for action in ACTIONS:
                        action_frames = normalized[action]
                        frame_paths: list[str] = []
                        for frame_index, frame in enumerate(action_frames, start=1):
                            filename = f"{character_id}-{action}-{frame_index:02d}.png"
                            frame_path = frames_dir / filename
                            frame.save(frame_path, format="PNG", optimize=True)
                            frame_paths.append((ASSET_DIR / character_id / "frames" / filename).as_posix())

                        preview_name = f"{character_id}-{action}.png"
                        gif_name = f"{character_id}-{action}.gif"
                        action_frames[0].save(character_dir / preview_name, format="PNG", optimize=True)
                        durations = ACTION_DURATIONS[action]
                        save_gif(
                            action_frames,
                            durations,
                            character_dir / gif_name,
                            loop=action in LOOPING_ACTIONS,
                        )
                        action_manifest: dict[str, object] = {
                            "label": ACTION_LABELS[action],
                            "png": (ASSET_DIR / character_id / preview_name).as_posix(),
                            "gif": (ASSET_DIR / character_id / gif_name).as_posix(),
                            "frames": frame_paths,
                            "frameCount": FRAME_COUNT,
                            "durationsMs": durations,
                            "durationMs": sum(durations),
                            "loop": action in LOOPING_ACTIONS,
                        }

                        if action == "slide":
                            clips: dict[str, object] = {}
                            for clip_name, spec in SLIDE_CLIPS.items():
                                indexes = spec["frame_indexes"]
                                clip_frames = [action_frames[index] for index in indexes]
                                clip_filename = f"{character_id}-slide-{clip_name}.gif"
                                save_gif(
                                    clip_frames,
                                    spec["durations"],
                                    character_dir / clip_filename,
                                    loop=bool(spec["loop"]),
                                )
                                clips[clip_name] = {
                                    "gif": (ASSET_DIR / character_id / clip_filename).as_posix(),
                                    "frameIndexes": [index + 1 for index in indexes],
                                    "frameCount": len(indexes),
                                    "durationsMs": spec["durations"],
                                    "durationMs": sum(spec["durations"]),
                                    "loop": spec["loop"],
                                }
                            action_manifest["clips"] = clips
                        actions[action] = action_manifest

                    manifest["characters"].append(
                        {
                            "id": character_id,
                            "label": f"{character.label} · {style.label}",
                            "identity": character.identity,
                            "style": style.key,
                            "source": (
                                ASSET_DIR
                                / "sources"
                                / design_source_details(style, character.source_family)[1]
                            ).as_posix(),
                            "frameSheets": character_sheet_paths,
                            "actions": actions,
                        }
                    )

        (staging_path / "manifest.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        match_project_ownership(staging_path, repo_root)
        replace_asset_root(staging_path, asset_root)
    finally:
        if staging_path.exists():
            shutil.rmtree(staging_path)

    print(
        f"Built {len(manifest['characters'])} characters x {len(ACTIONS)} actions x "
        f"{FRAME_COUNT} authored frames at {asset_root}"
    )


if __name__ == "__main__":
    arguments = parse_args()
    if arguments.only_character:
        build_single_action(
            arguments.repo_root.resolve(),
            arguments.only_character,
            arguments.only_action,
        )
    else:
        build(arguments.repo_root.resolve())
