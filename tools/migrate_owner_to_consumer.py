#!/usr/bin/env python3
"""Dry-run-first, insert-only legacy gym migration into account-owned Train records."""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import shutil
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def catalog():
    source = (ROOT / "public/gym-library.js").read_text()
    return json.loads(re.search(r"window\.GYM_EXERCISE_LIBRARY\s*=\s*(\[.*\]);", source, re.S).group(1))


def transform(personal, owner):
    library = catalog()
    by_id = {item["id"]: item for item in library}
    by_name = {}
    for item in library:
        by_name.setdefault(item["name"].strip().lower(), []).append(item)
    rows, errors = [], []
    for session in personal.get("gymExerciseSessions", []):
        legacy_id = str(session.get("id") or "")
        raw_id = str(session.get("exerciseId") or "")
        matches = by_name.get(raw_id.strip().lower(), [])
        item = by_id.get(raw_id) or (matches[0] if len(matches) == 1 else None)
        date = str(session.get("date") or "")
        if not legacy_id or not item:
            errors.append({"legacyId": legacy_id, "reason": "Missing or ambiguous exercise identity"})
            continue
        try:
            dt.date.fromisoformat(date)
        except ValueError:
            errors.append({"legacyId": legacy_id, "reason": "Invalid original date"})
            continue
        sets = []
        for index, old in enumerate(session.get("sets") or []):
            old_set_id = str(old.get("id") or index)
            sets.append({"setId": str(uuid.uuid5(uuid.NAMESPACE_URL, f"wellframe:{owner}:{legacy_id}:{old_set_id}")),
                         "legacySetId": old_set_id, "exerciseId": item["id"], "exercise": item["name"],
                         "reps": old.get("reps") or 0, "weightKg": old.get("weightKg") or 0,
                         "durationSec": old.get("durationSeconds") or 0, "distanceKm": old.get("distanceKm") or 0,
                         "warmup": bool(old.get("warmup")), "complete": True})
        rows.append({"user_id": owner,
                     "record_id": str(uuid.uuid5(uuid.NAMESPACE_URL, f"wellframe:legacy:{owner}:{legacy_id}")),
                     "kind": "workout", "occurred_at": date + "T00:00:00Z", "revision": 1,
                     "payload": {"title": str(session.get("title") or item["name"])[:100],
                                 "sets": sets, "status": "completed", "endedAt": None,
                                 "notes": str(session.get("notes") or "")[:1000], "source": "legacy-import",
                                 "legacyId": legacy_id, "legacyOriginalDate": date,
                                 "legacyTimePrecision": "date-only"}})
    return rows, errors


def request(method, path, key, base, payload=None):
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"apikey": key, "Authorization": "Bearer " + key, "Content-Type": "application/json",
               "Prefer": "return=representation"}
    with urlopen(Request(base.rstrip("/") + "/rest/v1/" + path, data=body, headers=headers, method=method), timeout=30) as response:
        raw = response.read()
        return json.loads(raw) if raw else []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(ROOT / "data/personal.json"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-dir", default=str(ROOT / "data/migration-backups"))
    args = parser.parse_args()
    owner = os.environ.get("SUPABASE_OWNER_USER_ID", "")
    if not owner:
        if args.apply:
            raise SystemExit("SUPABASE_OWNER_USER_ID is required for --apply")
        owner = str(uuid.UUID(int=0))
    owner = str(uuid.UUID(owner))
    source = Path(args.input)
    personal = json.loads(source.read_text())
    rows, errors = transform(personal, owner)
    report = {"sourceSessions": len(personal.get("gymExerciseSessions", [])), "prepared": len(rows),
              "preparedSets": sum(len(row["payload"]["sets"]) for row in rows), "skippedInvalid": errors,
              "inserted": 0, "alreadyPresent": 0, "dryRun": not args.apply}
    if args.apply:
        key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        base = os.environ.get("SUPABASE_URL")
        if not key or not base:
            raise SystemExit("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required")
        backup_dir = Path(args.backup_dir); backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"personal-{dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')}.json"
        shutil.copy2(source, backup)
        report["backup"] = str(backup)
        for row in rows:
            try:
                request("POST", "consumer_records", key, base, [row])
                report["inserted"] += 1
            except HTTPError as exc:
                if exc.code == 409:
                    query = urlencode({"user_id": f"eq.{owner}", "record_id": f"eq.{row['record_id']}", "select": "record_id", "limit": "1"})
                    if request("GET", "consumer_records?" + query, key, base):
                        report["alreadyPresent"] += 1
                        continue
                raise
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
