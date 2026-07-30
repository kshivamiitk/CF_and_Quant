from __future__ import annotations

import json
import os
import sys
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

import server as tracker  # noqa: E402


ORIGINAL_READ_JSON = tracker.read_json
ORIGINAL_WRITE_JSON = tracker.write_json
MUTABLE_PATH_KEYS = {
    tracker.PROGRESS_PATH: "progress",
    tracker.QUANT_PROGRESS_PATH: "quant_progress",
    tracker.PERSONAL_PATH: "personal",
    tracker.CONTEST_CACHE_PATH: "contest_cache",
}


def redis_configured() -> bool:
    return bool(os.environ.get("UPSTASH_REDIS_REST_URL") and os.environ.get("UPSTASH_REDIS_REST_TOKEN"))


def supabase_configured() -> bool:
    return bool(
        (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL"))
        and (
            os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
            or os.environ.get("SUPABASE_ANON_KEY")
            or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        )
    )


def supabase_request(table: str, method: str = "GET", query: str = "", payload=None, prefer: str = ""):
    base = (os.environ.get("SUPABASE_URL") or os.environ.get("NEXT_PUBLIC_SUPABASE_URL") or "").rstrip("/")
    key = (
        os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
        or os.environ.get("SUPABASE_ANON_KEY")
        or os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
        or ""
    )
    url = f"{base}/rest/v1/{table}{'?' + query if query else ''}"
    headers = {
        "apikey": key,
        "Authorization": f"Bearer {key}",
        "Content-Type": "application/json",
    }
    if prefer:
        headers["Prefer"] = prefer
    data = json.dumps(payload, ensure_ascii=True).encode("utf-8") if payload is not None else None
    request = Request(url, data=data, headers=headers, method=method)
    with urlopen(request, timeout=20) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def supabase_sync_notes_normalized(payload: dict) -> None:
    owner = os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam")
    now = tracker.isoformat_utc(tracker.utc_now())
    folder_rows = [{
        "owner_id": owner,
        "id": str(item.get("id")),
        "name": item.get("name") or "Notes",
        "created_at": item.get("createdAt") or now,
        "updated_at": item.get("updatedAt") or item.get("createdAt") or now,
    } for item in payload.get("notesFolders", []) if item.get("id")]
    note_rows = [{
        "owner_id": owner,
        "id": str(item.get("id")),
        "folder_id": item.get("folderId") or "notes-default",
        "title": item.get("title") or "",
        "plain_text": item.get("body") or "",
        "content_html": item.get("contentHtml") or "",
        "markdown_body": item.get("markdownBody") or "",
        "editor_mode": item.get("format") or item.get("editorMode") or "rich",
        "pinned": bool(item.get("pinned")),
        "created_at": item.get("createdAt") or now,
        "updated_at": item.get("updatedAt") or now,
    } for item in payload.get("notes", []) if item.get("id")]
    supabase_request("notes", "DELETE", f"owner_id=eq.{quote(owner)}")
    supabase_request("note_folders", "DELETE", f"owner_id=eq.{quote(owner)}")
    if folder_rows:
        supabase_request("note_folders", "POST", payload=folder_rows, prefer="resolution=merge-duplicates")
    if note_rows:
        supabase_request("notes", "POST", payload=note_rows, prefer="resolution=merge-duplicates")


def supabase_sync_normalized(name: str, payload) -> None:
    owner = os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam")
    now = tracker.isoformat_utc(tracker.utc_now())

    def replace_rows(table: str, rows: list[dict]) -> None:
        supabase_request(table, "DELETE", f"owner_id=eq.{quote(owner)}")
        if rows:
            supabase_request(table, "POST", payload=rows, prefer="resolution=merge-duplicates")

    if name == "quant_progress":
        rows = []
        for question_id, item in (payload.get("items") or {}).items():
            rows.append({
                "owner_id": owner, "question_id": question_id,
                "status": item.get("status") or "todo",
                "attempts": int(item.get("attempts") or 0),
                "answer": item.get("userSolution") or "",
                "notes": item.get("notes") or "",
                "assigned_at": item.get("assignedAt"),
                "solved_at": item.get("solvedAt"),
                "solution_revealed": bool(item.get("solutionRevealed")),
                "updated_at": item.get("lastUpdated") or now,
            })
        replace_rows("quant_question_progress", rows)
    elif name == "personal":
        skin_rows, skin_steps, gym_rows, gym_exercises, completions = [], [], [], [], []
        workout_sessions, workout_set_logs = [], []
        for routine in payload.get("skinRoutines", []):
            routine_id = str(routine.get("id"))
            skin_rows.append({
                "owner_id": owner, "id": routine_id, "name": routine.get("name") or "",
                "period": routine.get("period") or "custom", "reminder_time": routine.get("time") or None,
                "days": routine.get("days") or list(range(7)), "active": routine.get("active", True),
                "updated_at": now,
            })
            for index, step in enumerate(routine.get("steps") or []):
                value = step if isinstance(step, dict) else {"name": str(step)}
                skin_steps.append({
                    "owner_id": owner, "id": f"{routine_id}:step:{index}", "routine_id": routine_id,
                    "step_order": index + 1, "name": value.get("name") or "",
                    "product": value.get("product") or "", "duration_seconds": int(value.get("durationSeconds") or 0),
                    "notes": value.get("notes") or "",
                })
            completions.extend({
                "owner_id": owner, "routine_type": "skin", "routine_id": routine_id, "completed_on": date
            } for date in routine.get("completions") or [])
        for plan in payload.get("gymPlans", []):
            plan_id = str(plan.get("id"))
            gym_rows.append({
                "owner_id": owner, "id": plan_id, "name": plan.get("name") or "",
                "day_code": -1 if plan.get("day") == "daily" else int(plan.get("day") or 0),
                "reminder_time": plan.get("time") or None,
                "duration_minutes": int(plan.get("durationMinutes") or 0), "active": plan.get("active", True),
                "updated_at": now,
            })
            for index, exercise in enumerate(plan.get("exercises") or []):
                gym_exercises.append({
                    "owner_id": owner, "id": f"{plan_id}:exercise:{index}", "plan_id": plan_id,
                    "exercise_order": index + 1, "name": exercise.get("name") or "",
                    "sets": int(exercise.get("sets") or 0) if str(exercise.get("sets") or "").isdigit() else 0,
                    "reps": str(exercise.get("reps") or ""), "weight_kg": float(exercise.get("weightKg") or 0),
                    "duration_seconds": int(exercise.get("durationSeconds") or 0),
                    "rest_seconds": int(exercise.get("restSeconds") or 0), "notes": exercise.get("notes") or "",
                })
            completions.extend({
                "owner_id": owner, "routine_type": "gym", "routine_id": plan_id, "completed_on": date
            } for date in plan.get("completions") or [])
            for session in plan.get("completionHistory") or []:
                session_id = f"{plan_id}:{session.get('date')}"
                workout_sessions.append({
                    "owner_id": owner, "id": session_id, "plan_id": plan_id,
                    "performed_on": session.get("date"), "started_at": session.get("completedAt"),
                    "completed_at": session.get("completedAt"),
                    "duration_minutes": int(session.get("durationMinutes") or plan.get("durationMinutes") or 0),
                    "notes": session.get("notes") or "",
                })
                for index, exercise in enumerate(session.get("snapshot") or []):
                    workout_set_logs.append({
                        "owner_id": owner, "id": f"{session_id}:exercise:{index}", "session_id": session_id,
                        "exercise_name": exercise.get("name") or "", "set_number": 0,
                        "reps": str(exercise.get("reps") or ""), "weight_kg": float(exercise.get("weightKg") or 0),
                        "duration_seconds": int(exercise.get("durationSeconds") or 0),
                        "rest_seconds": int(exercise.get("restSeconds") or 0), "notes": exercise.get("notes") or "",
                    })
        # Dated workout sessions are historical snapshots. Each completed or
        # partial set is stored independently from the weekly plan.
        workout_sessions = []
        workout_set_logs = []
        for session in payload.get("gymSessions", []):
            session_id = str(session.get("id"))
            workout_sessions.append({
                "owner_id": owner, "id": session_id, "plan_id": str(session.get("planId")),
                "performed_on": session.get("date"), "started_at": session.get("startedAt"),
                "completed_at": session.get("completedAt"),
                "duration_minutes": int(session.get("plannedMinutes") or 0),
                "notes": session.get("notes") or "",
            })
            for exercise_index, exercise in enumerate(session.get("exercises") or []):
                for set_index, set_log in enumerate(exercise.get("sets") or []):
                    workout_set_logs.append({
                        "owner_id": owner, "id": f"{session_id}:{exercise_index}:{set_index}",
                        "session_id": session_id, "exercise_name": exercise.get("name") or "",
                        "set_number": int(set_log.get("number") or set_index + 1),
                        "reps": str(set_log.get("actualReps") or ""),
                        "weight_kg": float(set_log.get("actualWeightKg") or 0),
                        "duration_seconds": int(set_log.get("durationSeconds") or 0),
                        "rest_seconds": int(set_log.get("restSeconds") or 0),
                        "notes": "completed" if set_log.get("completed") else "pending",
                    })
        schedule_rows = []
        for event in payload.get("schedule", []):
            if not event.get("startUtc"):
                continue
            schedule_rows.append({
                "owner_id": owner, "id": str(event.get("id")), "title": event.get("title") or "",
                "starts_at": event.get("startUtc"), "ends_at": event.get("endUtc"),
                "reminder_minutes": int(event.get("reminderMinutes") or 0),
                "notify": event.get("notify") is not False, "completed": bool(event.get("completed")),
                "notes": event.get("notes") or "", "updated_at": event.get("updatedAt") or now,
            })
        focus_rows = [{
            "owner_id": owner, "id": str(session.get("id")), "label": session.get("label") or "Focus session",
            "planned_minutes": int(session.get("minutes") or 0), "actual_minutes": int(session.get("minutes") or 0),
            "started_at": session.get("startedAt"), "completed_at": session.get("completedAt"),
        } for session in payload.get("focusSessions", [])]
        contest_rows = [{
            "owner_id": owner, "id": str(contest.get("id")), "platform": contest.get("platform") or "",
            "title": contest.get("title") or "", "contest_url": contest.get("url") or "",
            "starts_at": datetime.fromtimestamp(int(contest.get("startTimeSeconds") or 0), timezone.utc).isoformat(),
            "duration_seconds": int(contest.get("durationSeconds") or 0),
            "participation_status": contest.get("status") or "interested", "added_at": contest.get("addedAt") or now,
        } for contest in payload.get("contestCalendar", [])]
        skin_product_rows = [{
            "owner_id": owner, "id": str(item.get("id")), "name": item.get("name") or "",
            "product_type": item.get("type") or "", "opened_on": item.get("openedOn") or None,
            "expires_on": item.get("expiresOn") or None, "notes": item.get("notes") or "",
        } for item in payload.get("skinProducts", [])]
        reflection_rows = [{
            "owner_id": owner, "id": str(item.get("id")), "reflected_on": item.get("date"),
            "mood": item.get("mood") or "okay", "reflection": item.get("text") or "",
            "reconciliation": item.get("reconciliation") or "", "updated_at": item.get("updatedAt") or now,
        } for item in payload.get("dailyReflections", [])]
        quant_attempt_rows = [{
            "owner_id": owner, "id": str(item.get("id")), "question_id": item.get("questionId") or "",
            "question_title": item.get("title") or "", "field_name": item.get("field") or "",
            "previous_value": str(item.get("from") or ""), "new_value": str(item.get("to") or ""),
            "occurred_at": item.get("occurredAt") or now,
        } for item in payload.get("quantAttemptHistory", [])]
        skin_log_rows = [{
            "owner_id": owner, "id": str(item.get("id")), "routine_id": item.get("routineId") or "",
            "step_index": int(item.get("stepIndex") or 0), "completed_on": item.get("date"),
            "completed_at": item.get("completedAt") or now,
        } for item in payload.get("skinStepLogs", [])]
        arcade_rows = [{
            "owner_id": owner, "id": str(item.get("id")), "game_type": item.get("gameType") or "",
            "score": float(item.get("score") or 0), "xp": int(item.get("xp") or 0),
            "rounds": int(item.get("rounds") or 0), "metrics": item.get("metrics") or {},
            "started_at": item.get("startedAt") or now, "completed_at": item.get("completedAt") or now,
        } for item in payload.get("arcadeSessions", [])]
        # Children must be removed before their parent rows because the schema
        # intentionally enforces referential integrity.
        for table in ("arcade_game_sessions", "skincare_step_logs", "skincare_steps", "gym_exercises", "workout_set_logs", "workout_sessions", "routine_completions", "skincare_routines", "gym_plans", "schedule_events", "focus_sessions", "contest_calendar_entries", "skincare_products", "daily_reflections", "quant_attempt_history"):
            supabase_request(table, "DELETE", f"owner_id=eq.{quote(owner)}")
        for table, rows in (
            ("skincare_routines", skin_rows), ("skincare_steps", skin_steps),
            ("gym_plans", gym_rows), ("gym_exercises", gym_exercises),
            ("routine_completions", completions), ("schedule_events", schedule_rows),
            ("workout_sessions", workout_sessions), ("workout_set_logs", workout_set_logs),
            ("focus_sessions", focus_rows), ("contest_calendar_entries", contest_rows),
            ("skincare_products", skin_product_rows), ("daily_reflections", reflection_rows),
            ("quant_attempt_history", quant_attempt_rows), ("skincare_step_logs", skin_log_rows),
            ("arcade_game_sessions", arcade_rows),
        ):
            if rows:
                supabase_request(table, "POST", payload=rows, prefer="resolution=merge-duplicates")
        supabase_sync_notes_normalized(payload)


def redis_request(command: list):
    url = os.environ["UPSTASH_REDIS_REST_URL"].rstrip("/")
    token = os.environ["UPSTASH_REDIS_REST_TOKEN"]
    request = Request(
        url,
        data=json.dumps(command).encode("utf-8"),
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        payload = json.loads(response.read().decode("utf-8"))
    if "error" in payload and payload["error"]:
        raise RuntimeError(payload["error"])
    return payload.get("result")


def storage_key(path: Path) -> str | None:
    name = MUTABLE_PATH_KEYS.get(path)
    if not name:
        return None
    prefix = os.environ.get("TRACKER_STORAGE_PREFIX", "kumar_quant")
    return f"{prefix}:{name}"


def vercel_read_json(path: Path, default):
    key = storage_key(path)
    if not key:
        return ORIGINAL_READ_JSON(path, default)
    name = MUTABLE_PATH_KEYS[path]
    if supabase_configured():
        try:
            rows = supabase_request("tracker_documents", query=f"owner_id=eq.{quote(os.environ.get('SUPABASE_OWNER_ID', 'kumar-shivam'))}&document_key=eq.{quote(name)}&select=payload")
            if rows:
                return rows[0]["payload"]
            if redis_configured():
                raw = redis_request(["GET", key])
                seed = json.loads(raw) if isinstance(raw, str) else raw
            else:
                seed = None
            seed = seed if seed is not None else ORIGINAL_READ_JSON(path, default)
            vercel_write_json(path, seed)
            return seed
        except (HTTPError, URLError, RuntimeError, ValueError):
            pass
    if not redis_configured():
        return ORIGINAL_READ_JSON(path, default)

    raw = redis_request(["GET", key])
    if raw is None:
        seed = ORIGINAL_READ_JSON(path, default)
        redis_request(["SET", key, json.dumps(seed, ensure_ascii=True)])
        return seed
    if isinstance(raw, (dict, list)):
        return raw
    return json.loads(raw)


def supabase_write_personal_cas(payload: dict, attempts: int = 5) -> dict:
    """Persist the personal document without losing concurrent note updates."""
    owner = os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam")
    candidate = deepcopy(payload)
    for _attempt in range(attempts):
        rows = supabase_request(
            "tracker_documents",
            query=(
                f"owner_id=eq.{quote(owner)}"
                "&document_key=eq.personal"
                "&select=payload,updated_at"
            ),
        )
        if not rows:
            supabase_request(
                "tracker_documents",
                "POST",
                payload={
                    "owner_id": owner,
                    "document_key": "personal",
                    "payload": candidate,
                    "updated_at": datetime.now(timezone.utc).isoformat(timespec="microseconds"),
                },
                prefer="resolution=merge-duplicates",
            )
            return candidate

        current_payload = rows[0].get("payload")
        current_payload = current_payload if isinstance(current_payload, dict) else {}
        merged = deepcopy(candidate)
        # The incoming request owns the other personal collections, while
        # Notes are merged record-by-record using updatedAt and tombstones.
        tracker.merge_personal_notes(merged, current_payload)
        current_notification_state = current_payload.get("notificationState")
        merged_notification_state = merged.get("notificationState")
        if isinstance(current_notification_state, dict):
            combined_notification_state = dict(current_notification_state)
            if isinstance(merged_notification_state, dict):
                combined_notification_state.update(merged_notification_state)
            merged["notificationState"] = combined_notification_state

        previous_updated_at = rows[0].get("updated_at")
        next_updated_at = datetime.now(timezone.utc).isoformat(timespec="microseconds")
        updated = supabase_request(
            "tracker_documents",
            "PATCH",
            query=(
                f"owner_id=eq.{quote(owner)}"
                "&document_key=eq.personal"
                f"&updated_at=eq.{quote(str(previous_updated_at), safe='')}"
            ),
            payload={"payload": merged, "updated_at": next_updated_at},
            prefer="return=representation",
        )
        if updated:
            return merged
        candidate = merged
    raise RuntimeError("Personal data changed repeatedly; please retry the save")


def supabase_write_notes_cas(payload: dict, attempts: int = 5) -> dict:
    """Atomically merge Notes while preserving every non-Notes collection."""
    owner = os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam")
    for _attempt in range(attempts):
        rows = supabase_request(
            "tracker_documents",
            query=(
                f"owner_id=eq.{quote(owner)}"
                "&document_key=eq.personal"
                "&select=payload,updated_at"
            ),
        )
        if not rows:
            raise RuntimeError("Personal data has not been initialized")
        current = rows[0].get("payload")
        current = deepcopy(current) if isinstance(current, dict) else tracker.default_personal()
        tracker.merge_personal_notes(current, payload)
        current["version"] = 5
        current["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())
        next_updated_at = datetime.now(timezone.utc).isoformat(timespec="microseconds")
        updated = supabase_request(
            "tracker_documents",
            "PATCH",
            query=(
                f"owner_id=eq.{quote(owner)}"
                "&document_key=eq.personal"
                f"&updated_at=eq.{quote(str(rows[0].get('updated_at')), safe='')}"
            ),
            payload={"payload": current, "updated_at": next_updated_at},
            prefer="return=representation",
        )
        if updated:
            return current
    raise RuntimeError("Notes changed repeatedly; please retry the save")


def supabase_write_notification_cas(
    notification_state: dict,
    diagnostics: dict,
    subscriptions: list,
    removed_endpoints: set[str],
    attempts: int = 5,
) -> dict:
    """Atomically update reminder-owned fields and preserve user edits."""
    owner = os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam")
    for _attempt in range(attempts):
        rows = supabase_request(
            "tracker_documents",
            query=(
                f"owner_id=eq.{quote(owner)}"
                "&document_key=eq.personal"
                "&select=payload,updated_at"
            ),
        )
        if not rows:
            raise RuntimeError("Personal data has not been initialized")
        current = rows[0].get("payload")
        current = deepcopy(current) if isinstance(current, dict) else tracker.default_personal()
        current_state = current.get("notificationState")
        current_state = dict(current_state) if isinstance(current_state, dict) else {}
        current_state.update(notification_state)
        dated_keys = [key for key in current_state if ":" in key and key != "dailyDigest"]
        if len(dated_keys) > 600:
            for key in dated_keys[:-600]:
                current_state.pop(key, None)
        current["notificationState"] = current_state
        current["notificationDiagnostics"] = diagnostics

        merged_subscriptions = []
        seen_endpoints = set()
        for item in [*(current.get("pushSubscriptions") or []), *subscriptions]:
            if not valid_push_subscription(item):
                continue
            endpoint = item.get("endpoint")
            if endpoint in removed_endpoints or endpoint in seen_endpoints:
                continue
            seen_endpoints.add(endpoint)
            merged_subscriptions.append(clean_push_subscription(item))
        current["pushSubscriptions"] = merged_subscriptions[-20:]
        current["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())

        next_updated_at = datetime.now(timezone.utc).isoformat(timespec="microseconds")
        updated = supabase_request(
            "tracker_documents",
            "PATCH",
            query=(
                f"owner_id=eq.{quote(owner)}"
                "&document_key=eq.personal"
                f"&updated_at=eq.{quote(str(rows[0].get('updated_at')), safe='')}"
            ),
            payload={"payload": current, "updated_at": next_updated_at},
            prefer="return=representation",
        )
        if updated:
            return current
    raise RuntimeError("Reminder data changed repeatedly; retry on the next dispatch")


def vercel_write_json(path: Path, payload) -> None:
    key = storage_key(path)
    if not key:
        ORIGINAL_WRITE_JSON(path, payload)
        return
    name = MUTABLE_PATH_KEYS[path]
    if supabase_configured():
        try:
            if name == "personal" and isinstance(payload, dict):
                payload = supabase_write_personal_cas(payload)
            else:
                supabase_request("tracker_documents", "POST", payload={
                    "owner_id": os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam"),
                    "document_key": name, "payload": payload,
                    "updated_at": tracker.isoformat_utc(tracker.utc_now()),
                }, prefer="resolution=merge-duplicates")
            try:
                supabase_sync_normalized(name, payload)
            except (HTTPError, URLError, RuntimeError, ValueError):
                pass
            return
        except (HTTPError, URLError, RuntimeError, ValueError):
            pass
    if not redis_configured():
        ORIGINAL_WRITE_JSON(path, payload)
        return
    redis_request(["SET", key, json.dumps(payload, ensure_ascii=True)])


tracker.read_json = vercel_read_json
tracker.write_json = vercel_write_json


def push_configured() -> bool:
    return bool(
        os.environ.get("VAPID_PUBLIC_KEY")
        and os.environ.get("VAPID_PRIVATE_KEY")
        and os.environ.get("VAPID_SUBJECT")
    )


def app_timezone() -> ZoneInfo:
    """Return the configured local timezone without letting a typo stop dispatch."""
    try:
        return ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Kolkata"))
    except (KeyError, ValueError):
        return ZoneInfo("Asia/Kolkata")


def app_base_url() -> str:
    # A preview deployment can recreate the shared QStash schedule. Always point
    # that schedule at the stable production alias when Vercel provides one,
    # rather than pinning reminders to an old deployment-specific APP_BASE_URL.
    production_host = os.environ.get("VERCEL_PROJECT_PRODUCTION_URL", "").strip().rstrip("/")
    if production_host:
        return production_host if production_host.startswith(("http://", "https://")) else f"https://{production_host}"
    configured = os.environ.get("APP_BASE_URL", "").rstrip("/")
    if configured:
        return configured
    host = os.environ.get("VERCEL_URL")
    return f"https://{host}" if host else ""


def qstash_api_urls() -> list[str]:
    """Return QStash regions in a deterministic fallback order.

    QStash tokens are region-specific. Older installations used the EU alias
    unconditionally, which makes a valid US token fail with a misleading 404.
    """
    configured = os.environ.get("QSTASH_URL", "").strip().rstrip("/")
    region = os.environ.get("QSTASH_REGION", "").strip().upper().replace("-", "_")
    regional = {
        "US_EAST_1": "https://qstash-us-east-1.upstash.io",
        "EU_CENTRAL_1": "https://qstash-eu-central-1.upstash.io",
    }.get(region)
    candidates = [
        configured,
        regional or "",
        "https://qstash-us-east-1.upstash.io",
        "https://qstash-eu-central-1.upstash.io",
    ]
    result = []
    for candidate in candidates:
        if candidate and candidate not in result:
            result.append(candidate)
    return result


def ensure_reminder_schedule() -> dict:
    token = os.environ.get("QSTASH_TOKEN", "")
    secret = os.environ.get("REMINDER_DISPATCH_SECRET", "")
    base_url = app_base_url()
    if not token or not secret or not base_url:
        return {
            "ok": False,
            "error": "QStash reminder scheduler is not configured",
            "destination": f"{base_url}/api/push/dispatch" if base_url else "",
        }

    destination = f"{base_url}/api/push/dispatch"
    last_status = None
    for qstash_url in qstash_api_urls():
        request = Request(
            # QStash expects the nested destination to retain its http(s)
            # scheme. Encoding ':' and '/' makes it reject the URL as invalid.
            f"{qstash_url}/v2/schedules/{quote(destination, safe=':/')}",
            data=b'{"source":"kumar-quant-calendar","version":2}',
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                "Upstash-Cron": "* * * * *",
                "Upstash-Schedule-Id": "kumar-quant-reminders",
                "Upstash-Method": "POST",
                "Upstash-Timeout": "30s",
                "Upstash-Retries": "3",
                "Upstash-Forward-X-Reminder-Secret": secret,
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=15) as response:
                raw = response.read().decode("utf-8")
                payload = json.loads(raw) if raw else {}
                return {
                    "ok": True,
                    "scheduleId": payload.get("scheduleId", "kumar-quant-reminders"),
                    "destination": destination,
                    "region": urlparse(qstash_url).hostname,
                    "cron": "* * * * *",
                }
        except HTTPError as exc:
            last_status = exc.code
            # A token from the other QStash region returns 401/403/404. Try the
            # remaining regional endpoint, but do not mask request-shape errors.
            if exc.code not in {401, 403, 404}:
                break
        except URLError:
            last_status = "network"
            continue
    return {
        "ok": False,
        "error": (
            f"QStash rejected the scheduler request (HTTP {last_status})"
            if isinstance(last_status, int)
            else "Could not reach QStash"
        ),
        "destination": destination,
    }


def valid_push_subscription(subscription: dict) -> bool:
    if not isinstance(subscription, dict):
        return False
    endpoint = subscription.get("endpoint")
    keys = subscription.get("keys")
    return bool(
        isinstance(endpoint, str)
        and endpoint.startswith("https://")
        and isinstance(keys, dict)
        and isinstance(keys.get("p256dh"), str)
        and keys.get("p256dh")
        and isinstance(keys.get("auth"), str)
        and keys.get("auth")
    )


def clean_push_subscription(subscription: dict) -> dict:
    return {
        "endpoint": subscription["endpoint"],
        "expirationTime": subscription.get("expirationTime"),
        "keys": {
            "p256dh": subscription["keys"]["p256dh"],
            "auth": subscription["keys"]["auth"],
        },
    }


def push_config_payload(ensure_scheduler: bool = False) -> dict:
    qstash_ready = bool(os.environ.get("QSTASH_TOKEN") and os.environ.get("REMINDER_DISPATCH_SECRET"))
    configured = push_configured() and qstash_ready and bool(app_base_url())
    scheduler = ensure_reminder_schedule() if configured and ensure_scheduler else None
    if configured:
        message = (
            "Install the app on your Home Screen, then enable notifications."
            if not scheduler or scheduler.get("ok")
            else "Push is configured, but the background scheduler needs attention."
        )
    else:
        message = "Add the VAPID, QStash, reminder secret, and APP_BASE_URL environment variables in Vercel."
    payload = {
        "configured": configured,
        "publicKey": os.environ.get("VAPID_PUBLIC_KEY", "") if configured else "",
        "message": message,
        "timezone": getattr(app_timezone(), "key", "Asia/Kolkata"),
        "destination": f"{app_base_url()}/api/push/dispatch" if app_base_url() else "",
    }
    if scheduler is not None:
        payload["scheduler"] = scheduler
    return payload


def send_push(subscription: dict, payload: dict) -> bool:
    try:
        from pywebpush import WebPushException, webpush
    except ImportError as exc:
        raise RuntimeError("pywebpush is not installed") from exc
    private_key = os.environ.get("VAPID_PRIVATE_KEY", "").replace("\\n", "\n")
    try:
        webpush(
            subscription_info=subscription,
            data=json.dumps(payload, ensure_ascii=True),
            vapid_private_key=private_key,
            vapid_claims={"sub": os.environ.get("VAPID_SUBJECT", "")},
            ttl=300,
        )
        return True
    except WebPushException as exc:
        status = getattr(getattr(exc, "response", None), "status_code", None)
        # 404/410 are expired endpoints. A 400 means the stored endpoint/keys
        # are malformed and retrying it forever cannot recover it.
        if status in {400, 404, 410}:
            return False
        raise


def subscribe_push(payload: dict) -> dict:
    if not push_config_payload()["configured"]:
        raise RuntimeError("Push reminders are not configured")
    subscription = payload.get("subscription")
    if not valid_push_subscription(subscription):
        raise ValueError("A complete push subscription with endpoint and keys is required")
    subscription = clean_push_subscription(subscription)
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    subscriptions = [
        item for item in personal.setdefault("pushSubscriptions", [])
        if valid_push_subscription(item)
    ]
    endpoint = subscription["endpoint"]
    subscriptions = [item for item in subscriptions if item.get("endpoint") != endpoint]
    subscriptions.append(subscription)
    # Keep enough room for an iPhone, iPad, desktop, and reinstalled web apps.
    personal["pushSubscriptions"] = subscriptions[-20:]
    tracker.write_json(tracker.PERSONAL_PATH, personal)
    scheduler = ensure_reminder_schedule()
    return {
        "ok": True,
        "subscriptionCount": len(personal["pushSubscriptions"]),
        "scheduler": scheduler,
    }


def send_test_push() -> dict:
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    local_zone = app_timezone()
    local_today = datetime.now(local_zone).date()
    app_badge = (datetime(local_today.year + 1, 1, 1, tzinfo=local_zone).date() - local_today).days
    active = []
    sent = 0
    transient_failures = 0
    removed = 0
    for subscription in personal.get("pushSubscriptions", []):
        if not valid_push_subscription(subscription):
            removed += 1
            continue
        try:
            delivered = send_push(subscription, {
                "title": "Reminders are ready",
                "body": "Calendar tasks, daily plans, and contest alerts can now reach this device.",
                "tag": "reminder-test",
                "url": "/?view=planner",
                "appBadge": max(0, app_badge),
            })
        except Exception:
            active.append(subscription)
            transient_failures += 1
            continue
        if delivered:
            active.append(subscription)
            sent += 1
        else:
            removed += 1
    if active != personal.get("pushSubscriptions", []):
        personal["pushSubscriptions"] = active
        tracker.write_json(tracker.PERSONAL_PATH, personal)
    return {
        "ok": True,
        "sent": sent,
        "transientFailures": transient_failures,
        "removedSubscriptions": removed,
        "subscriptionCount": len(active),
    }


def parse_datetime_utc(raw, naive_zone) -> datetime | None:
    if raw is None or raw == "":
        return None
    try:
        if isinstance(raw, (int, float)):
            # Accommodate both Unix seconds and JavaScript milliseconds.
            timestamp = float(raw)
            if abs(timestamp) > 10_000_000_000:
                timestamp /= 1000
            return datetime.fromtimestamp(timestamp, timezone.utc)
        value = str(raw).strip()
        if value.isdigit():
            return parse_datetime_utc(int(value), naive_zone)
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=naive_zone)
        return parsed.astimezone(timezone.utc)
    except (OverflowError, OSError, TypeError, ValueError):
        return None


def event_start_utc(event: dict, local_zone=None) -> datetime | None:
    local_zone = local_zone or app_timezone()
    # startUtc is authoritative when valid, but a corrupt legacy value should
    # fall back to the visible local datetime rather than dropping the event.
    for field in ("startUtc", "startsAt", "starts_at"):
        parsed = parse_datetime_utc(event.get(field), timezone.utc)
        if parsed:
            return parsed
    for field in ("start", "dateTime", "datetime", "date"):
        parsed = parse_datetime_utc(event.get(field), local_zone)
        if parsed:
            return parsed
    return None


def reminder_minutes(item: dict, default: int = 0) -> int:
    try:
        return max(0, min(30 * 24 * 60, int(float(item.get("reminderMinutes", default) or 0))))
    except (TypeError, ValueError):
        return max(0, default)


def reminder_diagnostics() -> dict:
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    local_zone = app_timezone()
    now = datetime.now(timezone.utc)
    upcoming = []
    invalid = 0
    enabled = 0
    for event in personal.get("schedule", []):
        if event.get("notify") is False or event.get("completed"):
            continue
        enabled += 1
        start = event_start_utc(event, local_zone)
        if not start:
            invalid += 1
            continue
        reminder_at = start - timedelta(minutes=reminder_minutes(event))
        if start + timedelta(minutes=30) >= now:
            upcoming.append({
                "id": str(event.get("id", "event")),
                "title": event.get("title") or "Scheduled task",
                "startAt": start.isoformat(),
                "reminderAt": reminder_at.isoformat(),
            })
    upcoming.sort(key=lambda item: item["reminderAt"])
    subscriptions = personal.get("pushSubscriptions", [])
    return {
        "ok": True,
        "configured": push_config_payload()["configured"],
        "timezone": getattr(local_zone, "key", "Asia/Kolkata"),
        "destination": f"{app_base_url()}/api/push/dispatch" if app_base_url() else "",
        "scheduler": ensure_reminder_schedule(),
        "subscriptionCount": len([item for item in subscriptions if valid_push_subscription(item)]),
        "invalidSubscriptionCount": len([item for item in subscriptions if not valid_push_subscription(item)]),
        "enabledCalendarEvents": enabled,
        "invalidCalendarEvents": invalid,
        "nextCalendarReminders": upcoming[:5],
        "lastDispatch": personal.get("notificationDiagnostics"),
    }


def dispatch_due_reminders(now: datetime | None = None) -> dict:
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    subscriptions = personal.get("pushSubscriptions", [])
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        now = now.replace(tzinfo=timezone.utc)
    now = now.astimezone(timezone.utc)
    local_zone = app_timezone()
    local_now = now.astimezone(local_zone)
    sent = 0
    changed = False
    active_subscriptions = [item for item in subscriptions if valid_push_subscription(item)]
    removed_subscriptions = len(subscriptions) - len(active_subscriptions)
    transient_failures = 0
    delivery_attempts = 0
    notification_count = 0
    events_scanned = 0
    invalid_events = 0
    due_calendar_events = 0
    next_calendar_reminders = []
    if removed_subscriptions:
        changed = True
    notification_state = personal.setdefault("notificationState", {})
    heartbeat_bucket = now.strftime("%Y-%m-%dT%H")
    if notification_state.get("schedulerHeartbeatHour") != heartbeat_bucket:
        notification_state["schedulerHeartbeatHour"] = heartbeat_bucket
        changed = True
    year_end = datetime(local_now.year + 1, 1, 1, tzinfo=local_zone)
    app_badge = max(0, (year_end.date() - local_now.date()).days)

    def broadcast(payload: dict) -> int:
        nonlocal active_subscriptions, sent, changed, transient_failures
        nonlocal delivery_attempts, removed_subscriptions, notification_count
        payload["appBadge"] = app_badge
        next_subscriptions = []
        delivered = 0
        for subscription in active_subscriptions:
            delivery_attempts += 1
            try:
                if send_push(subscription, payload):
                    next_subscriptions.append(subscription)
                    sent += 1
                    delivered += 1
                else:
                    removed_subscriptions += 1
            except Exception:
                # Keep subscriptions after transient push-provider failures. Only
                # explicit permanent responses remove an expired subscription.
                next_subscriptions.append(subscription)
                transient_failures += 1
        if next_subscriptions != active_subscriptions:
            changed = True
        active_subscriptions = next_subscriptions
        if delivered:
            notification_count += 1
        return delivered

    def mark_after_delivery(key: str, delivered: int) -> bool:
        nonlocal changed
        if delivered <= 0:
            return False
        notification_state[key] = now.isoformat()
        changed = True
        return True

    def reminder_bucket(prefix: str, item_id: str, interval_hours: int = 2) -> str:
        bucket_hour = (local_now.hour // interval_hours) * interval_hours
        return f"{prefix}:{item_id}:{local_now.date().isoformat()}:{bucket_hour:02d}"

    for event in personal.get("schedule", []):
        events_scanned += 1
        if event.get("notify") is False or event.get("completed"):
            continue
        start = event_start_utc(event, local_zone)
        if not start:
            invalid_events += 1
            continue
        reminder_time = start - timedelta(minutes=reminder_minutes(event))
        event_id = str(event.get("id", "event"))
        due_key = f"calendar-due:{event_id}:{reminder_time.isoformat()}"
        event_local_date = start.astimezone(local_zone).date()
        if reminder_time > now:
            next_calendar_reminders.append(reminder_time)
        # Catch up a delayed advance reminder until shortly after the event
        # begins. This works for 15-minute and multi-day reminder lead times.
        catch_up_deadline = start + timedelta(minutes=30)
        if reminder_time <= now < catch_up_deadline and not notification_state.get(due_key):
            due_calendar_events += 1
            notes = str(event.get("notes") or "").strip()
            delivered = broadcast({
                "title": event.get("title") or "Scheduled task",
                "body": notes if notes and not notes.startswith(("http://", "https://")) else "It is time for your scheduled work.",
                "tag": f"calendar-{event_id}-due",
                "url": f"/?view=planner&date={event_local_date.isoformat()}",
            })
            mark_after_delivery(due_key, delivered)

        # Keep nudging unfinished work every two hours during daytime on the
        # scheduled day. Waiting two hours avoids a duplicate at the due time.
        repeat_after = start + timedelta(hours=2)
        if repeat_after <= now and event_local_date == local_now.date() and 9 <= local_now.hour < 22:
            repeat_number = int((now - repeat_after).total_seconds() // (2 * 3600))
            repeat_key = f"calendar-open:{event_id}:{event_local_date.isoformat()}:{repeat_number}"
            if not notification_state.get(repeat_key):
                delivered = broadcast({
                    "title": "Still on today’s schedule",
                    "body": f"{event.get('title') or 'Scheduled task'} is not marked complete.",
                    "tag": f"calendar-{event_id}-open",
                    "url": f"/?view=planner&date={event_local_date.isoformat()}",
                })
                mark_after_delivery(repeat_key, delivered)

        # A missed non-contest item remains visible once a day for one week,
        # instead of disappearing forever at midnight.
        overdue_days = (local_now.date() - event_local_date).days
        if event.get("kind") != "contest" and 1 <= overdue_days <= 7 and 9 <= local_now.hour < 21:
            overdue_key = f"calendar-overdue:{event_id}:{local_now.date().isoformat()}"
            if not notification_state.get(overdue_key):
                delivered = broadcast({
                    "title": "Calendar task still incomplete",
                    "body": f"{event.get('title') or 'A scheduled task'} was due {overdue_days} day{'s' if overdue_days != 1 else ''} ago.",
                    "tag": f"calendar-{event_id}-overdue",
                    "url": f"/?view=planner&date={event_local_date.isoformat()}",
                })
                mark_after_delivery(overdue_key, delivered)

    # Tasks can alert at their due time, while urgent tasks alert once per day
    # until completed so they cannot quietly disappear in a long list.
    for task in personal.get("tasks", []):
        if task.get("completed"):
            continue
        task_id = task.get("id", "task")
        if task.get("priority") == "urgent" and 7 <= local_now.hour < 22:
            urgent_key = f"urgent:{task_id}:{local_now.date().isoformat()}"
            if not notification_state.get(urgent_key):
                delivered = broadcast({
                    "title": "Urgent task",
                    "body": task.get("title") or "An urgent task needs your attention.",
                    "tag": f"urgent-{task_id}",
                    "url": "/?view=planner",
                })
                mark_after_delivery(urgent_key, delivered)
        due = task.get("dueUtc")
        if due:
            due_time = parse_datetime_utc(due, timezone.utc)
        elif task.get("due"):
            due_time = parse_datetime_utc(task.get("due"), local_zone)
        else:
            due_time = None
        if not due_time:
            continue
        reminder_time = due_time - timedelta(minutes=reminder_minutes(task))
        reminder_key = f"task-due:{task_id}:{reminder_time.isoformat()}"
        if notification_state.get(reminder_key) or not reminder_time <= now < due_time + timedelta(hours=6):
            continue
        delivered = broadcast({
            "title": "Task due" if task.get("priority") != "urgent" else "Urgent task due",
            "body": task.get("title") or "Open your task list.",
            "tag": f"task-{task_id}",
            "url": "/?view=planner",
        })
        mark_after_delivery(reminder_key, delivered)

    # Habit reminder times are local to the configured app timezone.
    def habit_due_today(habit: dict) -> bool:
        frequency = habit.get("frequency")
        if frequency == "weekdays" and local_now.weekday() >= 5:
            return False
        if frequency == "weekly3":
            week_start = local_now.date() - timedelta(days=local_now.weekday())
            completed_this_week = [
                value for value in (habit.get("completions") or [])
                if week_start.isoformat() <= str(value) <= local_now.date().isoformat()
            ]
            return len(completed_this_week) < 3
        return True

    for habit in personal.get("habits", []):
        reminder_value = str(habit.get("reminderTime") or "")
        try:
            hour, minute = [int(part) for part in reminder_value.split(":")[:2]]
            habit_due = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        except (TypeError, ValueError):
            continue
        if not habit_due <= local_now < habit_due + timedelta(hours=6):
            continue
        if not habit_due_today(habit):
            continue
        if local_now.date().isoformat() in (habit.get("completions") or []):
            continue
        habit_key = f"habit:{habit.get('id', 'habit')}:{local_now.date().isoformat()}"
        if notification_state.get(habit_key):
            continue
        delivered = broadcast({
            "title": "Habit reminder",
            "body": habit.get("title") or "Keep your promise to yourself today.",
            "tag": f"habit-{habit.get('id', 'habit')}",
            "url": "/?view=today",
        })
        mark_after_delivery(habit_key, delivered)

    def alert_date_records(records: list, date_field: str, prefix: str, buckets: tuple[int, ...], title_for) -> None:
        nonlocal changed
        for record in records:
            raw_date = record.get(date_field)
            if not raw_date or record.get("paid") is True:
                continue
            try:
                target_date = datetime.fromisoformat(str(raw_date)[:10]).date()
            except ValueError:
                continue
            days = (target_date - local_now.date()).days
            if days not in buckets:
                continue
            key = f"{prefix}:{record.get('id', 'item')}:{raw_date}:{days}"
            if notification_state.get(key):
                continue
            delivered = broadcast({
                "title": title_for(record, days),
                "body": record.get("title") or record.get("name") or "Open the app for details.",
                "tag": f"{prefix}-{record.get('id', 'item')}-{days}",
                "url": "/?view=today",
            })
            mark_after_delivery(key, delivered)

    alert_date_records(
        personal.get("bills", []), "dueDate", "bill", (7, 1, 0),
        lambda record, days: f"{record.get('kind', 'Bill').title()} {'is due today' if days == 0 else f'due in {days} day' + ('s' if days != 1 else '')}"
    )
    alert_date_records(
        personal.get("documents", []), "expiryDate", "document", (30, 7, 1, 0),
        lambda _record, days: "Document expires today" if days == 0 else f"Document expires in {days} day{'s' if days != 1 else ''}"
    )
    alert_date_records(
        personal.get("careerItems", []), "dueDate", "career", (7, 1, 0),
        lambda _record, days: "Career item due today" if days == 0 else f"Career deadline in {days} day{'s' if days != 1 else ''}"
    )
    alert_date_records(
        personal.get("goals", []), "targetDate", "goal", (7, 1, 0),
        lambda _record, days: "Goal deadline today" if days == 0 else f"Goal deadline in {days} day{'s' if days != 1 else ''}"
    )

    # Send a single morning briefing with every kind of work due today.
    daily_key = f"daily:{local_now.date().isoformat()}"
    if 8 <= local_now.hour < 10 and notification_state.get("dailyDigest") != daily_key:
        local_date = local_now.date().isoformat()
        today_events = [
            event for event in personal.get("schedule", [])
            if not event.get("completed")
            and (event_start := event_start_utc(event, local_zone))
            and event_start.astimezone(local_zone).date().isoformat() == local_date
        ]
        open_tasks = [task for task in personal.get("tasks", []) if not task.get("completed")]
        today_tasks = [task for task in open_tasks if str(task.get("due") or "")[:10] == local_date]
        overdue_tasks = [task for task in open_tasks if task.get("due") and str(task.get("due"))[:10] < local_date]
        urgent_tasks = [task for task in open_tasks if task.get("priority") == "urgent"]
        incomplete_habits = [
            habit for habit in personal.get("habits", [])
            if habit_due_today(habit) and local_date not in (habit.get("completions") or [])
        ]
        today_bills = [bill for bill in personal.get("bills", []) if not bill.get("paid") and str(bill.get("dueDate") or "") == local_date]
        try:
            today_payload = tracker.build_today_payload()
            targets = today_payload.get("targets", [])
            today_contests = [
                contest for contest in today_payload.get("contests", [])
                if datetime.fromtimestamp(contest.get("startTimeSeconds", 0), timezone.utc).astimezone(local_zone).date().isoformat() == local_date
            ]
        except Exception:
            targets = []
            today_contests = []
        parts = []
        if today_events:
            parts.append(f"{len(today_events)} calendar task{'s' if len(today_events) != 1 else ''}")
        if today_tasks:
            parts.append(f"{len(today_tasks)} due task{'s' if len(today_tasks) != 1 else ''}")
        if overdue_tasks:
            parts.append(f"{len(overdue_tasks)} overdue")
        if urgent_tasks:
            parts.append(f"{len(urgent_tasks)} urgent")
        if incomplete_habits:
            parts.append(f"{len(incomplete_habits)} habit{'s' if len(incomplete_habits) != 1 else ''}")
        if today_bills:
            parts.append(f"{len(today_bills)} bill{'s' if len(today_bills) != 1 else ''}")
        if today_contests:
            parts.append(f"{len(today_contests)} contest{'s' if len(today_contests) != 1 else ''}")
        if targets:
            parts.append(f"{len(targets)} practice target{'s' if len(targets) != 1 else ''}")
        if parts:
            priority_items = urgent_tasks + overdue_tasks + today_tasks + today_events + today_contests + today_bills + incomplete_habits + targets
            detail = priority_items[0].get("title") or "Open the app to review your day"
            delivered = broadcast({
                "title": "Your plan for today",
                "body": f"{', '.join(parts)}. First up: {detail}",
                "tag": daily_key,
                "url": "/?view=today",
            })
            if delivered:
                notification_state["dailyDigest"] = daily_key
                changed = True

    # The active quant problem stays incomplete until explicitly solved. Nudge
    # every three hours in the daytime, even when the app is closed.
    try:
        quant_today = tracker.build_quant_today_payload(assign_next=False)
        current_quant = quant_today.get("current")
    except Exception:
        current_quant = None
    if current_quant and current_quant.get("status") != "done" and 9 <= local_now.hour < 22:
        quant_id = str(current_quant.get("id", "active"))
        quant_key = reminder_bucket("quant-open", quant_id, interval_hours=3)
        if not notification_state.get(quant_key):
            delivered = broadcast({
                "title": "Quant problem still waiting",
                "body": current_quant.get("title") or "Finish today’s active quant problem.",
                "tag": f"quant-open-{quant_id}",
                "url": "/?view=today",
            })
            mark_after_delivery(quant_key, delivered)

    # Wellness routines use local time and continue to nudge every two hours
    # until the user checks them off for the current day.
    def wellness_due_today(item: dict, kind: str) -> bool:
        if kind == "gym":
            return str(item.get("day", "daily")) == "daily" or str(item.get("day")) == str(local_now.weekday())
        days = item.get("days") or list(range(7))
        return local_now.weekday() in [int(day) for day in days]

    def wellness_reminders(records: list, kind: str) -> None:
        local_date = local_now.date().isoformat()
        for item in records:
            if not wellness_due_today(item, kind) or local_date in (item.get("completions") or []):
                continue
            if kind == "gym":
                session = next((
                    value for value in personal.get("gymSessions", [])
                    if value.get("planId") == item.get("id") and value.get("date") == local_date
                ), None)
                if session and session.get("status") in {"in_progress", "completed", "absent", "rest"}:
                    continue
            try:
                hour, minute = [int(part) for part in str(item.get("time") or "").split(":")[:2]]
                due_local = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            except (TypeError, ValueError):
                continue
            if local_now < due_local or local_now.hour >= 22:
                continue
            item_id = str(item.get("id", kind))
            due_key = f"{kind}-due:{item_id}:{local_date}"
            if local_now < due_local + timedelta(hours=2) and not notification_state.get(due_key):
                title = "Time for your skin care" if kind == "skin" else "Your workout is ready"
                delivered = broadcast({
                    "title": title,
                    "body": item.get("name") or ("Complete today’s routine." if kind == "skin" else "Start today’s training plan."),
                    "tag": f"{kind}-{item_id}-due",
                    "url": "/?view=wellness" if kind == "skin" else "/?view=gym",
                })
                mark_after_delivery(due_key, delivered)
            # Begin repeat nudges two hours after the configured start time.
            if local_now >= due_local + timedelta(hours=2):
                repeat_key = reminder_bucket(f"{kind}-open", item_id)
                if not notification_state.get(repeat_key):
                    title = "Skin routine still waiting" if kind == "skin" else "Workout not completed yet"
                    delivered = broadcast({
                        "title": title,
                        "body": item.get("name") or "Open Wellness and finish today’s routine.",
                        "tag": f"{kind}-{item_id}-open",
                        "url": "/?view=wellness" if kind == "skin" else "/?view=gym",
                    })
                    mark_after_delivery(repeat_key, delivered)

    wellness_reminders(personal.get("skinRoutines", []), "skin")
    wellness_reminders(personal.get("gymPlans", []), "gym")

    # Contest alerts continue in the background even when the app is closed.
    try:
        contests = tracker.contests_payload(False).get("contests", [])
    except Exception:
        contests = []
    for contest in contests:
        try:
            start_seconds = float(contest.get("startTimeSeconds") or 0)
            end_seconds = float(contest.get("endTimeSeconds") or 0)
            if end_seconds <= start_seconds:
                end_seconds = start_seconds + max(0, float(contest.get("durationSeconds") or 0))
            if start_seconds <= 0 or end_seconds <= start_seconds:
                continue
            start = datetime.fromtimestamp(start_seconds, timezone.utc)
            end = datetime.fromtimestamp(end_seconds, timezone.utc)
        except (OverflowError, OSError, TypeError, ValueError):
            continue
        starts_in = (start - now).total_seconds()
        if starts_in <= 0 < (end - now).total_seconds():
            bucket = "live"
        elif 0 < starts_in <= 15 * 60:
            bucket = "15m"
        elif 15 * 60 < starts_in <= 60 * 60:
            bucket = "1h"
        elif 60 * 60 < starts_in <= 24 * 60 * 60:
            bucket = "24h"
        else:
            continue
        contest_key = f"contest:{contest.get('platform')}:{contest.get('startTimeSeconds')}:{bucket}"
        if notification_state.get(contest_key):
            continue
        if bucket == "live":
            title = f"{contest.get('platform', 'Programming')} contest is live"
        else:
            minutes_left = max(1, int((starts_in + 59) // 60))
            time_left = (
                f"{minutes_left} min"
                if minutes_left < 60
                else f"{max(1, round(minutes_left / 60))} hr"
            )
            title = f"{contest.get('platform', 'Programming')} contest in {time_left}"
        delivered = broadcast({
            "title": title,
            "body": contest.get("title") or "Open the contest radar for details.",
            "tag": f"contest-{contest.get('platform')}-{contest.get('startTimeSeconds')}-{bucket}",
            "url": "/?view=contests",
        })
        mark_after_delivery(contest_key, delivered)

    # Keep the deduplication record bounded.
    dated_keys = [key for key in notification_state if ":" in key and key != "dailyDigest"]
    if len(dated_keys) > 600:
        for key in dated_keys[:-600]:
            notification_state.pop(key, None)
        changed = True
    subscriptions_changed = active_subscriptions != subscriptions
    if subscriptions_changed:
        changed = True
    if changed:
        diagnostics = {
            "lastDispatchAt": now.isoformat(),
            "lastDispatchLocal": local_now.isoformat(),
            "sent": sent,
            "notifications": notification_count,
            "deliveryAttempts": delivery_attempts,
            "transientFailures": transient_failures,
            "removedSubscriptions": removed_subscriptions,
            "eventsScanned": events_scanned,
            "invalidEvents": invalid_events,
            "dueCalendarEvents": due_calendar_events,
        }
        active_endpoints = {
            item.get("endpoint") for item in active_subscriptions
            if valid_push_subscription(item)
        }
        removed_endpoints = {
            item.get("endpoint") for item in subscriptions
            if valid_push_subscription(item) and item.get("endpoint") not in active_endpoints
        }
        if supabase_configured():
            # This compare-and-swap changes reminder-owned fields only. A note,
            # schedule, or workout save that lands concurrently is preserved.
            supabase_write_notification_cas(
                notification_state,
                diagnostics,
                active_subscriptions,
                removed_endpoints,
            )
        else:
            # Local fallback: re-read after slow network delivery, then merge
            # only reminder-owned state into the newest document.
            latest = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
            latest_state = latest.get("notificationState")
            latest_state = dict(latest_state) if isinstance(latest_state, dict) else {}
            latest_state.update(notification_state)
            latest["notificationState"] = latest_state
            latest["notificationDiagnostics"] = diagnostics
            merged_subscriptions = []
            seen_endpoints = set()
            for item in [*(latest.get("pushSubscriptions") or []), *active_subscriptions]:
                if not valid_push_subscription(item):
                    continue
                endpoint = item.get("endpoint")
                if endpoint in removed_endpoints or endpoint in seen_endpoints:
                    continue
                seen_endpoints.add(endpoint)
                merged_subscriptions.append(clean_push_subscription(item))
            latest["pushSubscriptions"] = merged_subscriptions[-20:]
            latest["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())
            tracker.write_json(tracker.PERSONAL_PATH, latest)
    return {
        "ok": True,
        "sent": sent,
        "notifications": notification_count,
        "deliveryAttempts": delivery_attempts,
        "transientFailures": transient_failures,
        "removedSubscriptions": removed_subscriptions,
        "subscriptionCount": len(active_subscriptions),
        "eventsScanned": events_scanned,
        "invalidEvents": invalid_events,
        "dueCalendarEvents": due_calendar_events,
        "nextCalendarReminderAt": (
            min(next_calendar_reminders).isoformat()
            if next_calendar_reminders
            else None
        ),
        "timezone": getattr(local_zone, "key", "Asia/Kolkata"),
        "checkedAt": now.isoformat(),
        "localCheckedAt": local_now.isoformat(),
    }


def json_response(payload, status=200):
    return {
        "status": status,
        "headers": {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": json.dumps(payload, ensure_ascii=True),
    }


def text_response(text: str, status=200):
    return {
        "status": status,
        "headers": {
            "Content-Type": "text/plain; charset=utf-8",
            "Cache-Control": "no-store",
        },
        "body": text,
    }


def is_authorized(path: str, headers: dict) -> bool:
    return True


def read_body_json(body: bytes):
    if not body:
        return {}
    return json.loads(body.decode("utf-8"))


def api_route(method: str, raw_path: str, headers: dict | None = None, body: bytes = b""):
    headers = headers or {}
    parsed = urlparse(raw_path)
    path = parsed.path

    if path != "/api/push/dispatch" and not is_authorized(raw_path, headers):
        return json_response({"error": "Private token required"}, 401)

    if method == "GET":
        if path == "/api/roadmap":
            return json_response(tracker.read_json(tracker.ROADMAP_PATH, {"topics": []}))
        if path == "/api/progress":
            return json_response(tracker.read_json(tracker.PROGRESS_PATH, tracker.default_progress()))
        if path == "/api/quant":
            return json_response(tracker.build_quant_list_payload())
        if path == "/api/quant/today":
            return json_response(tracker.build_quant_today_payload())
        if path == "/api/personal":
            return json_response(tracker.public_personal(tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())))
        if path == "/api/notes":
            return json_response(tracker.public_notes(tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())))
        if path == "/api/push/config":
            # Opening the app also repairs a missing/stale minute schedule.
            return json_response(push_config_payload(ensure_scheduler=True))
        if path == "/api/push/diagnostics":
            return json_response(reminder_diagnostics())
        if path == "/api/contests":
            force_refresh = "refresh=1" in parsed.query
            try:
                return json_response(tracker.contests_payload(force_refresh))
            except Exception as exc:
                return json_response({"ok": False, "error": str(exc), "contests": []}, 502)
        if path == "/api/today":
            try:
                return json_response(tracker.build_today_payload())
            except Exception as exc:
                return json_response({"ok": False, "error": str(exc), "targets": [], "contests": []}, 502)
        if path == "/api/health":
            return text_response("ok\n")
        return text_response("Not found\n", 404)

    if method == "POST":
        if path not in {
            "/api/progress",
            "/api/sync-codeforces",
            "/api/quant/progress",
            "/api/personal",
            "/api/notes",
            "/api/push/subscribe",
            "/api/push/test",
            "/api/push/dispatch",
        }:
            return text_response("Not found\n", 404)
        try:
            payload = read_body_json(body)
        except json.JSONDecodeError:
            return json_response({"error": "Invalid JSON"}, 400)

        if path == "/api/sync-codeforces":
            handle = str(payload.get("handle", "")).strip()
            if not handle:
                return json_response({"error": "Codeforces handle is required"}, 400)
            try:
                return json_response(tracker.sync_progress_from_codeforces(handle))
            except HTTPError as exc:
                return json_response({"error": f"Codeforces HTTP error {exc.code}"}, 502)
            except URLError as exc:
                return json_response({"error": f"Could not reach Codeforces: {exc.reason}"}, 502)
            except Exception as exc:
                return json_response({"error": str(exc)}, 502)

        if path == "/api/quant/progress":
            try:
                return json_response(tracker.update_quant_question(payload))
            except ValueError as exc:
                return json_response({"error": str(exc)}, 400)
            except Exception as exc:
                return json_response({"error": str(exc)}, 500)

        if path == "/api/push/dispatch":
            expected = os.environ.get("REMINDER_DISPATCH_SECRET", "")
            supplied = headers.get("x-reminder-secret") or headers.get("X-Reminder-Secret") or ""
            if not expected or supplied != expected:
                return json_response({"error": "Unauthorized reminder dispatch"}, 401)
            try:
                return json_response(dispatch_due_reminders())
            except Exception as exc:
                return json_response({"error": str(exc)}, 500)

        if path == "/api/push/subscribe":
            try:
                return json_response(subscribe_push(payload))
            except ValueError as exc:
                return json_response({"error": str(exc)}, 400)
            except Exception as exc:
                return json_response({"error": str(exc)}, 500)

        if path == "/api/push/test":
            try:
                return json_response(send_test_push())
            except Exception as exc:
                return json_response({"error": str(exc)}, 500)

        if path == "/api/notes":
            if not isinstance(payload, dict):
                return json_response({"error": "Notes payload must be an object"}, 400)
            try:
                if supabase_configured():
                    stored = supabase_write_notes_cas(payload)
                    try:
                        supabase_sync_notes_normalized(stored)
                    except (HTTPError, URLError, RuntimeError, ValueError):
                        pass
                else:
                    existing = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
                    tracker.merge_personal_notes(existing, payload)
                    existing["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())
                    existing["version"] = 5
                    tracker.write_json(tracker.PERSONAL_PATH, existing)
                    stored = tracker.read_json(tracker.PERSONAL_PATH, existing)
                return json_response({"ok": True, **tracker.public_notes(stored)})
            except Exception as exc:
                return json_response({"error": str(exc)}, 500)

        if path == "/api/personal":
            existing = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
            if not isinstance(payload, dict):
                return json_response({"error": "Personal payload must be an object"}, 400)
            existing["owner"] = tracker.OWNER_NAME
            existing["schedule"] = payload.get("schedule", existing.get("schedule", []))
            tracker.merge_personal_notes(existing, payload)
            existing["expenses"] = payload.get("expenses", existing.get("expenses", []))
            existing["incomes"] = payload.get("incomes", existing.get("incomes", []))
            existing["focusSessions"] = payload.get("focusSessions", existing.get("focusSessions", []))
            for field in ("arcadeSessions", "skinRoutines", "skinStepLogs", "gymPlans", "gymSessions", "customExercises", "contestCalendar", "skinProducts", "dailyReflections", "quantAttemptHistory", "tasks", "goals", "habits", "weeklyReviews", "healthLogs", "careerItems", "documents",
                          "accounts", "budgets", "bills", "savingsGoals", "debts"):
                existing[field] = payload.get(field, existing.get(field, []))
            existing["settings"] = payload.get("settings", existing.get("settings", {}))
            existing["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())
            existing["version"] = 5
            tracker.write_json(tracker.PERSONAL_PATH, existing)
            stored = tracker.read_json(tracker.PERSONAL_PATH, existing)
            return json_response({"ok": True, "personal": tracker.public_personal(stored)})

        if not isinstance(payload, dict) or "items" not in payload:
            return json_response({"error": "Progress payload must contain items"}, 400)

        existing = tracker.read_json(tracker.PROGRESS_PATH, tracker.default_progress())
        existing["goal"] = payload.get("goal", existing.get("goal", tracker.default_progress()["goal"]))
        existing["profile"] = payload.get("profile", existing.get("profile", tracker.default_progress()["profile"]))
        existing["lastSyncAt"] = payload.get("lastSyncAt", existing.get("lastSyncAt"))
        existing["items"] = payload.get("items", {})
        existing["version"] = 1
        tracker.write_json(tracker.PROGRESS_PATH, existing)
        return json_response({"ok": True, "progress": existing})

    return text_response("Method not allowed\n", 405)


class handler(BaseHTTPRequestHandler):
    def _headers_dict(self) -> dict:
        return {key.lower(): value for key, value in self.headers.items()}

    def _send(self, response: dict) -> None:
        body = response["body"].encode("utf-8")
        self.send_response(response["status"])
        for key, value in response["headers"].items():
            self.send_header(key, value)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        self._send(api_route("GET", self.path, self._headers_dict()))

    def do_POST(self):
        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length)
        self._send(api_route("POST", self.path, self._headers_dict(), body))
