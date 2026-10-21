"""Per-account consumer records. The bearer token and RLS own cloud access."""

from __future__ import annotations

import datetime as dt
import json
import os
import re
import uuid
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
LOCAL_DIR = Path(os.environ.get("CONSUMER_LOCAL_DATA_DIR") or ROOT / "data" / "local-users")
KINDS = {"profile", "workout", "routine", "water", "care_item", "care_log", "health_sample", "favorite", "custom_exercise"}
METRICS = {"steps": ("count", 0, 1000000), "active_energy": ("kcal", 0, 100000),
           "heart_rate": ("bpm", 0, 350), "hrv": ("ms", 0, 1000),
           "distance": ("km", 0, 10000)}


def _error(message: str, status: int = 400):
    return status, {"error": message}


def _timestamp(value):
    if not isinstance(value, str):
        raise ValueError("A valid event time is required")
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError("A valid event time is required") from exc
    if parsed.tzinfo is None:
        raise ValueError("Event time must include a timezone")
    if parsed > dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=2):
        raise ValueError("Event time is too far in the future")
    return parsed.astimezone(dt.timezone.utc).isoformat()


def _text(value, limit=120):
    if not isinstance(value, str):
        raise ValueError("Text value required")
    return value.strip()[:limit]


def _number(value, minimum, maximum):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not minimum <= value <= maximum:
        raise ValueError("Number is outside the accepted range")
    return value


def validate(kind: str, payload: dict) -> dict:
    if kind not in KINDS or not isinstance(payload, dict):
        raise ValueError("Invalid record")
    if kind == "profile":
        interests = payload.get("interests", [])
        if not isinstance(interests, list) or len(interests) > 4 or any(x not in {"Strength", "Cardio", "General fitness", "Daily wellness"} for x in interests):
            raise ValueError("Invalid interests")
        workout_time = payload.get("workoutReminderTime", "")
        if not isinstance(workout_time, str) or (workout_time and not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", workout_time)):
            raise ValueError("Invalid workout reminder time")
        return {"displayName": _text(payload.get("displayName", ""), 80), "interests": interests,
                "timezone": _text(payload.get("timezone", "UTC"), 80), "unit": payload.get("unit") if payload.get("unit") in {"metric", "imperial"} else "metric",
                "workoutReminderTime": workout_time}
    if kind == "water":
        return {"amountMl": _number(payload.get("amountMl"), 1, 5000), "source": "manual"}
    if kind == "favorite":
        exercise_id = _text(payload.get("exerciseId", ""), 80)
        if not exercise_id or not re.fullmatch(r"(?:[A-Z]{2}\d{2}|custom:[0-9a-f-]{36})", exercise_id):
            raise ValueError("Invalid exercise ID")
        return {"exerciseId": exercise_id}
    if kind == "custom_exercise":
        name = _text(payload.get("name", ""), 100)
        if not name:
            raise ValueError("Exercise name is required")
        mode = payload.get("mode")
        if mode not in {"load_reps", "bodyweight_reps", "timed_hold", "reps_duration", "duration_distance"}:
            raise ValueError("Invalid tracking mode")
        return {"name": name, "mode": mode, "category": _text(payload.get("category", "Custom"), 80), "source": "user-created"}
    if kind == "routine":
        title = _text(payload.get("title", ""), 100)
        ids = payload.get("exerciseIds", [])
        if not title or not isinstance(ids, list) or not 1 <= len(ids) <= 30 or len(ids) != len(set(ids)):
            raise ValueError("Routine needs a name and 1–30 distinct exercises")
        if any(not isinstance(value, str) or not re.fullmatch(r"(?:[A-Z]{2}\d{2}|custom:[0-9a-f-]{36})", value) for value in ids):
            raise ValueError("Invalid routine exercise")
        return {"title": title, "exerciseIds": ids, "source": "user-created"}
    if kind == "workout":
        title = _text(payload.get("title", ""), 100)
        if not title:
            raise ValueError("Workout name is required")
        sets = payload.get("sets", [])
        if not isinstance(sets, list) or len(sets) > 100:
            raise ValueError("Too many sets")
        clean_sets = []
        for row in sets:
            if not isinstance(row, dict):
                raise ValueError("Invalid set")
            exercise_id = _text(row.get("exerciseId") or "", 80)
            if exercise_id and not re.fullmatch(r"(?:[A-Z]{2}\d{2}|custom:[0-9a-f-]{36})", exercise_id):
                raise ValueError("Invalid exercise ID")
            set_id = row.get("setId") or str(uuid.uuid4())
            try:
                set_id = str(uuid.UUID(set_id))
            except (ValueError, TypeError, AttributeError) as exc:
                raise ValueError("Invalid set ID") from exc
            clean_sets.append({"setId": set_id, "legacySetId": _text(row.get("legacySetId") or "", 120) or None,
                               "exerciseId": exercise_id or None,
                               "exercise": _text(row.get("exercise", ""), 100),
                               "reps": _number(row.get("reps", 0), 0, 1000),
                               "weightKg": _number(row.get("weightKg", 0), 0, 1000),
                               "durationSec": _number(row.get("durationSec", 0), 0, 86400),
                               "distanceKm": _number(row.get("distanceKm", 0), 0, 1000),
                               "warmup": bool(row.get("warmup", False)),
                               "complete": bool(row.get("complete", False))})
        ended_at = _timestamp(payload["endedAt"]) if payload.get("endedAt") else None
        rest_until = _timestamp(payload["restUntil"]) if payload.get("restUntil") else None
        source = payload.get("source") if payload.get("source") in {"manual", "legacy-import"} else "manual"
        result = {"title": title, "sets": clean_sets, "status": payload.get("status") if payload.get("status") in {"active", "completed"} else "active",
                "endedAt": ended_at, "restUntil": rest_until, "notes": _text(payload.get("notes", ""), 1000),
                "source": source}
        if source == "legacy-import":
            result.update({"legacyId": _text(payload.get("legacyId") or "", 120),
                           "legacyOriginalDate": _text(payload.get("legacyOriginalDate") or "", 10),
                           "legacyTimePrecision": "date-only"})
        return result
    if kind == "care_item":
        name = _text(payload.get("name", ""), 100)
        if not name:
            raise ValueError("Item name is required")
        times = payload.get("times", [])
        if not isinstance(times, list) or len(times) > 8 or any(not isinstance(t, str) or len(t) != 5 or t[2] != ":" or not t[:2].isdigit() or not t[3:].isdigit() or int(t[:2]) > 23 or int(t[3:]) > 59 for t in times):
            raise ValueError("Invalid reminder time")
        return {"name": name, "type": payload.get("type") if payload.get("type") in {"medicine", "supplement"} else "supplement",
                "instructions": _text(payload.get("instructions", ""), 500), "times": times,
                "timezone": _text(payload.get("timezone", "UTC"), 80),
                "paused": bool(payload.get("paused", False)), "source": "user-entered"}
    if kind == "care_log":
        try:
            item_id = str(uuid.UUID(payload.get("itemId", "")))
        except (ValueError, TypeError, AttributeError) as exc:
            raise ValueError("Invalid care item") from exc
        status = payload.get("status")
        if status not in {"taken", "skipped", "snoozed"}:
            raise ValueError("Invalid check-in status")
        occurrence_id = payload.get("occurrenceId")
        if occurrence_id is not None:
            if not isinstance(occurrence_id, str) or not re.fullmatch(r"[0-9a-f-]{36}:\d{4}-\d{2}-\d{2}:\d{2}:\d{2}", occurrence_id) or not occurrence_id.startswith(item_id + ":"):
                raise ValueError("Invalid scheduled occurrence")
        return {"itemId": item_id, "status": status, "occurrenceId": occurrence_id, "source": "user-entered"}
    if kind == "health_sample":
        metric = payload.get("metricType")
        if metric not in METRICS:
            raise ValueError("Unsupported metric")
        unit, minimum, maximum = METRICS[metric]
        if payload.get("unit") != unit:
            raise ValueError("Unsupported unit")
        source_id = _text(payload.get("sourceId", ""), 150)
        sample_id = _text(payload.get("sourceSampleId", ""), 150)
        if not source_id or not sample_id:
            raise ValueError("Source identifiers are required")
        deleted = bool(payload.get("deleted", False))
        if deleted:
            return {"metricType": metric, "unit": unit, "sourceId": source_id, "sourceSampleId": sample_id, "deleted": True}
        start = _timestamp(payload.get("sampleStart"))
        end = _timestamp(payload.get("sampleEnd"))
        if end < start:
            raise ValueError("Sample end precedes start")
        return {"metricType": metric, "unit": unit, "value": _number(payload.get("value"), minimum, maximum),
                "sampleStart": start, "sampleEnd": end, "sourceId": source_id,
                "sourceSampleId": sample_id, "sourceName": _text(payload.get("sourceName", ""), 120),
                "sourceBundleId": _text(payload.get("sourceBundleId", ""), 150),
                "deleted": False}
    raise ValueError("Invalid record")


def _cloud_request(method: str, path: str, token: str, payload=None, merge: bool = False):
    url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    body = json.dumps(payload).encode() if payload is not None else None
    headers = {"apikey": os.environ["SUPABASE_PUBLISHABLE_KEY"], "Authorization": "Bearer " + token,
               "Content-Type": "application/json", "Prefer": "return=representation" + (",resolution=merge-duplicates" if merge else "")}
    request = Request(url, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=15) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as exc:
        raise RuntimeError(f"Database request failed ({exc.code})") from exc


def _local_path(user_id: str) -> Path:
    # A verified UUID (or the one explicit local-development identity) is safe as a filename.
    if user_id != "local-development":
        uuid.UUID(user_id)
    return LOCAL_DIR / f"{user_id}.json"


def _local_read(user_id: str) -> list:
    path = _local_path(user_id)
    return json.loads(path.read_text()) if path.exists() else []


def _local_write(user_id: str, rows: list):
    LOCAL_DIR.mkdir(parents=True, exist_ok=True)
    path = _local_path(user_id)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(rows, ensure_ascii=True))
    temporary.replace(path)


def handle(method: str, raw_body: bytes, claims: dict, authorization: str, offset: int = 0, kind: str | None = None):
    user_id = str(claims["sub"])
    token = authorization.removeprefix("Bearer ").strip()
    production = os.environ.get("VERCEL") == "1" or os.environ.get("APP_ENV", "").lower() == "production"
    local = (not token and claims.get("aud") == "local") or (not production and os.environ.get("CONSUMER_LOCAL_MODE") == "1")
    if not local and (not os.environ.get("SUPABASE_URL") or not os.environ.get("SUPABASE_PUBLISHABLE_KEY")):
        return _error("Data service is unavailable", 503)
    if method == "GET":
        try:
            if not 0 <= offset <= 100000:
                return _error("Invalid page offset")
            if kind is not None and kind not in KINDS:
                return _error("Invalid record type")
            if local:
                rows = sorted((item for item in _local_read(user_id) if kind is None or item["kind"] == kind),
                              key=lambda item: (item["occurred_at"], item["record_id"]), reverse=True)[offset:offset + 300]
            else:
                filters = {"user_id": f"eq.{user_id}", "select": "record_id,kind,occurred_at,payload,revision,updated_at",
                           "order": "occurred_at.desc,record_id.desc", "limit": "300", "offset": str(offset)}
                if kind:
                    filters["kind"] = f"eq.{kind}"
                query = urlencode(filters)
                rows = _cloud_request("GET", "consumer_records?" + query, token)
            return 200, {"records": rows, "development": local}
        except (RuntimeError, OSError, ValueError):
            return _error("Could not load your records. Retry shortly.", 503)
    if method not in {"POST", "DELETE"}:
        return _error("Method not allowed", 405)
    if len(raw_body) > 128 * 1024:
        return _error("Request too large", 413)
    try:
        data = json.loads(raw_body)
        if method == "DELETE" and data.get("allImported") is True:
            if local:
                rows = _local_read(user_id)
                removed = sum(item["kind"] == "health_sample" for item in rows)
                _local_write(user_id, [item for item in rows if item["kind"] != "health_sample"])
            else:
                query = urlencode({"user_id": f"eq.{user_id}", "kind": "eq.health_sample"})
                removed = len(_cloud_request("DELETE", "consumer_records?" + query, token) or [])
            return 200, {"ok": True, "removed": removed}
        record_id = str(uuid.UUID(data.get("recordId", "")))
        if method == "POST":
            kind = data.get("kind")
            payload = validate(kind, data.get("payload"))
            occurred_at = _timestamp(data.get("occurredAt"))
            if kind == "care_log":
                if local:
                    owned = next((item for item in _local_read(user_id) if item["record_id"] == payload["itemId"] and item["kind"] == "care_item"), None)
                else:
                    owned_query = urlencode({"user_id": f"eq.{user_id}", "record_id": f"eq.{payload['itemId']}", "kind": "eq.care_item", "select": "record_id,payload", "limit": "1"})
                    owned = next(iter(_cloud_request("GET", "consumer_records?" + owned_query, token)), None)
                if not owned:
                    return _error("Care item was not found", 404)
                if payload.get("occurrenceId"):
                    if payload["occurrenceId"][-5:] not in owned["payload"].get("times", []):
                        return _error("Scheduled time was not found")
                    record_id = str(uuid.uuid5(uuid.NAMESPACE_URL, user_id + ":" + payload["occurrenceId"]))
            expected = data.get("expectedRevision", 0)
            if not isinstance(expected, int) or isinstance(expected, bool) or expected < 0:
                return _error("Invalid record revision")
            row = {"user_id": user_id, "record_id": record_id, "kind": kind, "occurred_at": occurred_at,
                   "payload": payload, "revision": expected + 1}
            if local:
                rows = _local_read(user_id)
                old = next((item for item in rows if item["record_id"] == record_id), None)
                current = old.get("revision", 1) if old else 0
                if kind == "health_sample":
                    expected = current
                    row["revision"] = current + 1
                if current != expected:
                    if old and old["payload"] == payload and old["occurred_at"] == occurred_at:
                        return 200, {"ok": True, "record": old}
                    return _error("This entry changed elsewhere. Reload before editing.", 409)
                rows = [item for item in rows if item["record_id"] != record_id]
                rows.append(row)
                _local_write(user_id, rows)
            else:
                if kind == "health_sample":
                    # Native source samples use stable IDs and may replay after token refresh.
                    _cloud_request("POST", "consumer_records?on_conflict=user_id,record_id", token, [row], merge=True)
                elif expected == 0:
                    try:
                        _cloud_request("POST", "consumer_records", token, [row])
                    except RuntimeError as exc:
                        if "(409)" not in str(exc):
                            raise
                        existing_query = urlencode({"user_id": f"eq.{user_id}", "record_id": f"eq.{record_id}", "select": "record_id,kind,occurred_at,payload,revision", "limit": "1"})
                        existing = _cloud_request("GET", "consumer_records?" + existing_query, token)
                        if existing and existing[0]["payload"] == payload and existing[0]["occurred_at"].replace("Z", "+00:00") == occurred_at:
                            return 200, {"ok": True, "record": existing[0]}
                        return _error("This entry changed elsewhere. Reload before editing.", 409)
                else:
                    query = urlencode({"user_id": f"eq.{user_id}", "record_id": f"eq.{record_id}", "revision": f"eq.{expected}"})
                    updated = _cloud_request("PATCH", "consumer_records?" + query, token, row)
                    if not updated:
                        return _error("This entry changed elsewhere. Reload before editing.", 409)
            return 200, {"ok": True, "record": row}
        if local:
            rows = _local_read(user_id)
            old = next((item for item in rows if item["record_id"] == record_id), None)
            if old and data.get("expectedRevision", old.get("revision", 1)) != old.get("revision", 1):
                return _error("This entry changed elsewhere. Reload before deleting.", 409)
            rows = [item for item in rows if item["record_id"] != record_id]
            _local_write(user_id, rows)
        else:
            filters = {"user_id": f"eq.{user_id}", "record_id": f"eq.{record_id}"}
            if "expectedRevision" in data:
                filters["revision"] = f"eq.{int(data['expectedRevision'])}"
            removed = _cloud_request("DELETE", "consumer_records?" + urlencode(filters), token)
            if "expectedRevision" in data and not removed:
                return _error("This entry changed elsewhere. Reload before deleting.", 409)
        return 200, {"ok": True}
    except (ValueError, TypeError, AttributeError, KeyError):
        return _error("Check the entry and try again")
    except (RuntimeError, OSError):
        return _error("Could not save your changes. Retry shortly.", 503)
