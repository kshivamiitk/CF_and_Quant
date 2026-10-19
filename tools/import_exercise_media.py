"""Import a reviewed-in-scope batch of RepDB free stills. Requires Pillow.

Run --dry-run first; assets are in-app media, not a redistributable dataset.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import re
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ORIGIN = "https://exercise-dataset.com/"
INDEX = ORIGIN + "exercises.json"
LICENSE = "https://github.com/RepDB/exercise-dataset/blob/main/LICENSE-DATA.md"
# Explicit movement/equipment/variant matches; aliases retain their own canonical IDs.
MAPPING = {
    "CH01": "bench-press", "CH02": "incline-bench-press", "CH03": "decline-bench-press-barbell", "CH04": "db-bench-press",
    "CH07": "smith-machine-bench-press", "CH14": "incline-dumbbell-fly",
    "CH24": "deficit-push-ups", "CH26": "close-grip-push-ups", "SH04": "seated-db-press",
    "SH02": "seated-barbell-overhead-press", "SH08": "one-arm-dumbbell-shoulder-press",
    "SH13": "seated-dumbbell-lateral-raise",
    "BK14": "assisted-pull-ups", "BK31": "deadlift", "BK33": "hex-bar-deadlift",
    "BK15": "barbell-row",
    "TR01": "close-grip-bench-press", "TR13": "diamond-push-ups", "QU01": "squat",
    "QU12": "leg-press", "QU13": "close-stance-leg-press", "QU14": "wide-stance-leg-press",
    "CA04": "single-leg-calf-raise", "CO03": "toes-to-bar",
    "HG01": "romanian-deadlift", "FB01": "deadlift", "FB02": "squat",
    "CO21": "plank", "CO22": "side-plank",
}


def fetch(url: str) -> bytes:
    with urllib.request.urlopen(urllib.request.Request(url, headers={"User-Agent": "Wellframe-media-import/1.0"}), timeout=30) as response:
        return response.read()


def save_webp(raw: bytes, target: Path, width: int) -> dict:
    image = Image.open(BytesIO(raw)).convert("RGB")
    image.thumbnail((width, width), Image.Resampling.LANCZOS)
    target.parent.mkdir(parents=True, exist_ok=True)
    image.save(target, "WEBP", quality=78, method=6)
    return {"path": "/" + str(target.relative_to(ROOT / "public")), "width": image.width,
            "height": image.height, "bytes": target.stat().st_size}


def local_or_fetch(relative: str, target: Path, width: int) -> dict:
    if not relative.startswith("images/flat/") or ".." in relative:
        raise ValueError(f"Unexpected source path: {relative}")
    if target.exists():
        with Image.open(target) as image:
            return {"path": "/" + str(target.relative_to(ROOT / "public")),
                    "width": image.width, "height": image.height, "bytes": target.stat().st_size}
    return save_webp(fetch(ORIGIN + relative), target, width)


def normalized_name(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", value.lower()).strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()
    raw_index = fetch(INDEX)
    source_hash = hashlib.sha256(raw_index).hexdigest()
    catalog = {item["id"]: item for item in json.loads(raw_index)["exercises"]}
    text = (ROOT / "public" / "gym-library.js").read_text()
    existing = json.loads(text[text.index("["):text.rindex("]") + 1])
    if len(existing) != 370 or len({item["id"] for item in existing}) != 370:
        raise ValueError("Canonical catalog count changed; review coverage generation")
    by_name = {}
    for source in catalog.values():
        by_name.setdefault(normalized_name(source["name_en"]), []).append(source)
    mapping = dict(MAPPING)
    for item in existing:
        if item["id"] in mapping:
            continue
        matches = by_name.get(normalized_name(item["name"]), [])
        if len(matches) == 1:
            mapping[item["id"]] = matches[0]["id"]

    output = {}
    credits = []
    def import_one(pair: tuple[str, str]) -> tuple[str, dict]:
        canonical, provider_id = pair
        source = catalog[provider_id]
        flat = source.get("images", {}).get("flat", {})
        if not (flat.get("start") or flat.get("main")):
            raise ValueError(f"No free still for {canonical}")
        metadata = {"exerciseId": canonical, "providerId": provider_id,
                    "sourcePage": INDEX, "mediaType": "still",
                    "sourceName": source["name_en"],
                    "alt": source["name_en"] + " exercise illustration",
                    "creator": "RepDB", "license": "RepDB Free Exercise Dataset License", "licenseUrl": LICENSE,
                    "requiredCredit": "Exercise data by RepDB (repdb.co)", "changes": "Resized and recompressed WebP for app display",
                    "retrievedAt": dt.date.today().isoformat(), "sourceIndexSha256": source_hash,
                    "mappingStatus": "explicit variant/equipment match" if canonical in MAPPING else "unique normalized exact name",
                    "rightsReview": "free-tier in-app use with attribution",
                    "formReview": "external technique review pending", "thumb": None, "start": None,
                    "end": None, "poster": None, "demoMp4": None, "demoWebm": None}
        if not args.dry_run:
            directory = ROOT / "public" / "media" / "exercises" / canonical
            for key, source_key, width in (("start", "start", 512), ("end", "peak", 512)):
                relative = flat.get(source_key)
                if relative:
                    metadata[key] = local_or_fetch(relative, directory / (key + ".webp"), width)
                    if key == "start":
                        metadata["thumb"] = local_or_fetch(relative, directory / "thumb.webp", 220)
                        metadata["poster"] = metadata["start"]
            if not metadata["start"]:
                metadata["start"] = local_or_fetch(flat["main"], directory / "start.webp", 512)
                metadata["thumb"] = local_or_fetch(flat["main"], directory / "thumb.webp", 220)
                metadata["poster"] = metadata["start"]
        return canonical, metadata

    with ThreadPoolExecutor(max_workers=8) as workers:
        for canonical, metadata in workers.map(import_one, mapping.items()):
            output[canonical] = metadata
            credits.append({"exerciseId": canonical, "creator": metadata["creator"], "sourcePage": metadata["sourcePage"],
                            "license": metadata["license"], "licenseUrl": LICENSE, "requiredCredit": metadata["requiredCredit"],
                            "changes": metadata["changes"]})
    print(f"Matched {len(output)} catalog IDs; index sha256={source_hash}")
    if args.dry_run:
        return
    (ROOT / "public" / "data").mkdir(exist_ok=True)
    (ROOT / "public" / "data" / "exercise-media.json").write_text(json.dumps({"source": INDEX, "sourceIndexSha256": source_hash, "entries": output}, indent=2) + "\n")
    (ROOT / "public" / "data" / "media-credits.json").write_text(json.dumps({"credits": credits}, indent=2) + "\n")
    report = ["# Exercise media coverage", "", "Generated by `tools/import_exercise_media.py`.", "",
              f"Total canonical IDs: 370. Local still thumbnails: {sum(bool(v['thumb']) for v in output.values())}. "
              f"Paired poses: {sum(bool(v['start'] and v['end']) for v in output.values())}. Real motion: 0.",
              "All imported illustrations have rights metadata; external technique review remains pending. "
              "Uncovered entries use a neutral category fallback, not a substituted movement.", "",
              "| ID | Exercise | Still | Paired poses | Real motion | Review | Source/license |", "| --- | --- | --- | --- | --- | --- | --- |"]
    for item in existing:
        media = output.get(item["id"])
        report.append(f"| {item['id']} | {item['name']} | {'Yes' if media and media['thumb'] else 'No'} | "
                      f"{'Yes' if media and media['end'] else 'No'} | No | "
                      f"{'Technique pending' if media else 'No exact imported match'} | "
                      f"{'RepDB free in-app license' if media else '—'} |")
    (ROOT / "docs" / "EXERCISE_MEDIA_COVERAGE.md").write_text("\n".join(report) + "\n")


if __name__ == "__main__":
    main()
