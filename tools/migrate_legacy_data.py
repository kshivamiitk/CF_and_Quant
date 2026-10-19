#!/usr/bin/env python3
"""Idempotent legacy gym migration.

Dry-run by default. Use --apply only after applying the Supabase migrations and
setting SUPABASE_OWNER_USER_ID. The report contains counts and errors, not data.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]


def supabase_request(method: str, table: str, query: str = "", payload=None):
    url = os.environ["SUPABASE_URL"].rstrip("/") + f"/rest/v1/{table}" + (f"?{query}" if query else "")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    body = None if payload is None else json.dumps(payload).encode()
    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": "return=representation,resolution=merge-duplicates"}
    with urlopen(Request(url, data=body, headers=headers, method=method), timeout=30) as response:
        raw = response.read().decode()
        return json.loads(raw) if raw else []


def load_catalogue():
    source = (ROOT / "public/gym-library.js").read_text(encoding="utf-8")
    match = re.search(r"window\.GYM_EXERCISE_LIBRARY\s*=\s*(\[.*\]);", source, re.S)
    if not match:
        raise RuntimeError("Could not parse public/gym-library.js")
    return json.loads(match.group(1))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(ROOT / "data/personal.json"))
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--backup-dir", default=str(ROOT / "data/migration-backups"))
    args = parser.parse_args()
    source = Path(args.input)
    personal = json.loads(source.read_text(encoding="utf-8"))
    sessions = personal.get("gymExerciseSessions", [])
    catalogue = load_catalogue()
    names = {item["name"].strip().lower(): item["id"] for item in catalogue}
    report = {"startedAt": datetime.now(timezone.utc).isoformat(), "dryRun": not args.apply, "catalogue": len(catalogue), "sessions": 0, "sets": 0, "errors": []}

    if args.apply:
        if not os.environ.get("SUPABASE_OWNER_USER_ID") or not os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
            raise RuntimeError("SUPABASE_OWNER_USER_ID and SUPABASE_SERVICE_ROLE_KEY are required for --apply")
        backup_dir = Path(args.backup_dir); backup_dir.mkdir(parents=True, exist_ok=True)
        backup = backup_dir / f"personal-{datetime.now().strftime('%Y%m%dT%H%M%SZ')}.json"
        shutil.copy2(source, backup)
        supabase_request("POST", "exercise_catalogue", payload=[{
            "canonical_id": item["id"], "name": item["name"], "category": item["category"], "tracking_mode": item["mode"],
            "supported_metrics": [], "metadata": {"legacy_seed_id": item["id"]}
        } for item in catalogue])

    for session in sessions:
        try:
            exercise_id = names.get(str(session.get("exerciseId", "")).lower()) or session.get("exerciseId")
            if not exercise_id:
                raise ValueError("session has no exerciseId")
            sets = session.get("sets") or []
            if args.apply:
                rows = supabase_request("GET", "exercise_workout_sessions", urlencode({"user_id": f"eq.{os.environ['SUPABASE_OWNER_USER_ID']}", "legacy_id": f"eq.{session['id']}", "select": "id"}))
                if rows:
                    db_id = rows[0]["id"]
                else:
                    inserted = supabase_request("POST", "exercise_workout_sessions", payload={"user_id": os.environ["SUPABASE_OWNER_USER_ID"], "exercise_id": exercise_id, "performed_on": session.get("date"), "title": session.get("title", ""), "notes": session.get("notes", ""), "status": "completed", "source": "legacy-personal-json", "legacy_id": session["id"]})
                    db_id = inserted[0]["id"]
                supabase_request("POST", "exercise_workout_sets", payload=[{"session_id": db_id, "user_id": os.environ["SUPABASE_OWNER_USER_ID"], "set_order": index + 1, "weight_kg": item.get("weightKg"), "external_load_kg": item.get("weightKg"), "reps": item.get("reps"), "duration_seconds": item.get("durationSeconds"), "distance_km": item.get("distanceKm"), "rest_seconds": item.get("restSeconds"), "rpe": item.get("rpe"), "is_warmup": bool(item.get("warmup")), "is_complete": True, "notes": item.get("notes", "")} for index, item in enumerate(sets)])
            report["sessions"] += 1; report["sets"] += len(sets)
        except Exception as exc:
            report["errors"].append({"sessionId": str(session.get("id", "unknown")), "error": str(exc)[:200]})
    report["finishedAt"] = datetime.now(timezone.utc).isoformat()
    print(json.dumps(report, indent=2))
    return 1 if report["errors"] else 0


if __name__ == "__main__":
    raise SystemExit(main())
