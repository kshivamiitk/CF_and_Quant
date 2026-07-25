from __future__ import annotations

import json
import os
import sys
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
    if not key or not redis_configured():
        return ORIGINAL_READ_JSON(path, default)

    raw = redis_request(["GET", key])
    if raw is None:
        seed = ORIGINAL_READ_JSON(path, default)
        redis_request(["SET", key, json.dumps(seed, ensure_ascii=True)])
        return seed
    if isinstance(raw, (dict, list)):
        return raw
    return json.loads(raw)


def vercel_write_json(path: Path, payload) -> None:
    key = storage_key(path)
    if not key or not redis_configured():
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


def app_base_url() -> str:
    configured = os.environ.get("APP_BASE_URL", "").rstrip("/")
    if configured:
        return configured
    host = os.environ.get("VERCEL_PROJECT_PRODUCTION_URL") or os.environ.get("VERCEL_URL")
    return f"https://{host}" if host else ""


def push_config_payload() -> dict:
    qstash_ready = bool(os.environ.get("QSTASH_TOKEN") and os.environ.get("REMINDER_DISPATCH_SECRET"))
    configured = push_configured() and qstash_ready and bool(app_base_url())
    if configured:
        message = "Install the app on your Home Screen, then enable notifications."
    else:
        message = "Add the VAPID, QStash, reminder secret, and APP_BASE_URL environment variables in Vercel."
    return {
        "configured": configured,
        "publicKey": os.environ.get("VAPID_PUBLIC_KEY", "") if configured else "",
        "message": message,
    }


def ensure_reminder_schedule() -> None:
    token = os.environ.get("QSTASH_TOKEN", "")
    secret = os.environ.get("REMINDER_DISPATCH_SECRET", "")
    base_url = app_base_url()
    if not token or not secret or not base_url:
        raise RuntimeError("QStash reminder scheduler is not configured")
    destination = f"{base_url}/api/push/dispatch"
    request = Request(
        f"https://qstash.upstash.io/v2/schedules/{quote(destination, safe='')}",
        data=b'{"source":"kumar-quant-calendar"}',
        headers={
            "Authorization": f"Bearer {token}",
            "Content-Type": "application/json",
            "Upstash-Cron": "* * * * *",
            "Upstash-Schedule-Id": "kumar-quant-reminders",
            "Upstash-Retries": "1",
            "Upstash-Forward-X-Reminder-Secret": secret,
        },
        method="POST",
    )
    with urlopen(request, timeout=15) as response:
        if response.status >= 300:
            raise RuntimeError("Could not configure reminder schedule")


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
        if status in {404, 410}:
            return False
        raise


def subscribe_push(payload: dict) -> dict:
    if not push_config_payload()["configured"]:
        raise RuntimeError("Push reminders are not configured")
    subscription = payload.get("subscription")
    if not isinstance(subscription, dict) or not subscription.get("endpoint"):
        raise ValueError("A valid push subscription is required")
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    subscriptions = personal.setdefault("pushSubscriptions", [])
    endpoint = subscription["endpoint"]
    subscriptions = [item for item in subscriptions if item.get("endpoint") != endpoint]
    subscriptions.append(subscription)
    personal["pushSubscriptions"] = subscriptions[-5:]
    tracker.write_json(tracker.PERSONAL_PATH, personal)
    ensure_reminder_schedule()
    return {"ok": True, "subscriptionCount": len(personal["pushSubscriptions"])}


def send_test_push() -> dict:
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    local_zone = ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Kolkata"))
    local_today = datetime.now(local_zone).date()
    app_badge = (datetime(local_today.year + 1, 1, 1, tzinfo=local_zone).date() - local_today).days
    active = []
    sent = 0
    for subscription in personal.get("pushSubscriptions", []):
        if send_push(subscription, {
            "title": "Reminders are ready",
            "body": "Calendar tasks, daily plans, and contest alerts can now reach this iPhone.",
            "tag": "reminder-test",
            "url": "/?view=planner",
            "appBadge": max(0, app_badge),
        }):
            active.append(subscription)
            sent += 1
    personal["pushSubscriptions"] = active
    tracker.write_json(tracker.PERSONAL_PATH, personal)
    return {"ok": True, "sent": sent}


def event_start_utc(event: dict) -> datetime | None:
    raw = event.get("startUtc")
    if raw:
        return datetime.fromisoformat(str(raw).replace("Z", "+00:00")).astimezone(timezone.utc)
    local_value = event.get("start")
    if not local_value:
        return None
    local_time = datetime.fromisoformat(str(local_value))
    return local_time.replace(tzinfo=ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Kolkata"))).astimezone(timezone.utc)


def dispatch_due_reminders() -> dict:
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    subscriptions = personal.get("pushSubscriptions", [])
    now = datetime.now(timezone.utc)
    local_zone = ZoneInfo(os.environ.get("APP_TIMEZONE", "Asia/Kolkata"))
    local_now = now.astimezone(local_zone)
    sent = 0
    changed = False
    active_subscriptions = list(subscriptions)
    notification_state = personal.setdefault("notificationState", {})
    year_end = datetime(local_now.year + 1, 1, 1, tzinfo=local_zone)
    app_badge = max(0, (year_end.date() - local_now.date()).days)

    def broadcast(payload: dict) -> None:
        nonlocal active_subscriptions, sent, changed
        payload["appBadge"] = app_badge
        next_subscriptions = []
        for subscription in active_subscriptions:
            if send_push(subscription, payload):
                next_subscriptions.append(subscription)
                sent += 1
        if next_subscriptions != active_subscriptions:
            changed = True
        active_subscriptions = next_subscriptions

    for event in personal.get("schedule", []):
        if event.get("notify") is False:
            continue
        start = event_start_utc(event)
        if not start:
            continue
        reminder_time = start - timedelta(minutes=max(0, int(event.get("reminderMinutes") or 0)))
        reminder_key = reminder_time.isoformat()
        if event.get("lastNotifiedFor") == reminder_key:
            continue
        if not reminder_time <= now < reminder_time + timedelta(minutes=2):
            continue
        broadcast({
            "title": event.get("title") or "Scheduled task",
            "body": event.get("notes") or "It is time for your scheduled work.",
            "tag": f"calendar-{event.get('id', 'event')}",
            "url": f"/?view=planner&date={str(event.get('start', ''))[:10]}",
        })
        event["lastNotifiedFor"] = reminder_key
        changed = True

    # Tasks can alert at their due time, while urgent tasks alert once per day
    # until completed so they cannot quietly disappear in a long list.
    for task in personal.get("tasks", []):
        if task.get("completed"):
            continue
        task_id = task.get("id", "task")
        if task.get("priority") == "urgent" and 7 <= local_now.hour < 22:
            urgent_key = f"urgent:{task_id}:{local_now.date().isoformat()}"
            if not notification_state.get(urgent_key):
                broadcast({
                    "title": "Urgent task",
                    "body": task.get("title") or "An urgent task needs your attention.",
                    "tag": f"urgent-{task_id}",
                    "url": "/?view=life",
                })
                notification_state[urgent_key] = now.isoformat()
                changed = True
        due = task.get("dueUtc")
        if due:
            try:
                due_time = datetime.fromisoformat(str(due).replace("Z", "+00:00")).astimezone(timezone.utc)
            except ValueError:
                due_time = None
        elif task.get("due"):
            try:
                due_time = datetime.fromisoformat(str(task["due"])).replace(tzinfo=local_zone).astimezone(timezone.utc)
            except ValueError:
                due_time = None
        else:
            due_time = None
        if not due_time:
            continue
        reminder_time = due_time - timedelta(minutes=max(0, int(task.get("reminderMinutes") or 0)))
        reminder_key = f"task-due:{task_id}:{reminder_time.isoformat()}"
        if notification_state.get(reminder_key) or not reminder_time <= now < reminder_time + timedelta(minutes=2):
            continue
        broadcast({
            "title": "Task due" if task.get("priority") != "urgent" else "Urgent task due",
            "body": task.get("title") or "Open your task list.",
            "tag": f"task-{task_id}",
            "url": "/?view=life",
        })
        notification_state[reminder_key] = now.isoformat()
        changed = True

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

    local_hhmm = local_now.strftime("%H:%M")
    for habit in personal.get("habits", []):
        if not habit.get("reminderTime") or str(habit.get("reminderTime"))[:5] != local_hhmm:
            continue
        if not habit_due_today(habit):
            continue
        if local_now.date().isoformat() in (habit.get("completions") or []):
            continue
        habit_key = f"habit:{habit.get('id', 'habit')}:{local_now.date().isoformat()}"
        if notification_state.get(habit_key):
            continue
        broadcast({
            "title": "Habit reminder",
            "body": habit.get("title") or "Keep your promise to yourself today.",
            "tag": f"habit-{habit.get('id', 'habit')}",
            "url": "/?view=life",
        })
        notification_state[habit_key] = now.isoformat()
        changed = True

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
            broadcast({
                "title": title_for(record, days),
                "body": record.get("title") or record.get("name") or "Open the app for details.",
                "tag": f"{prefix}-{record.get('id', 'item')}-{days}",
                "url": "/?view=insights" if prefix == "bill" else "/?view=life",
            })
            notification_state[key] = now.isoformat()
            changed = True

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
            if str(event.get("start") or "")[:10] == local_date
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
            broadcast({
                "title": "Your plan for today",
                "body": f"{', '.join(parts)}. First up: {detail}",
                "tag": daily_key,
                "url": "/?view=today",
            })
        notification_state["dailyDigest"] = daily_key
        changed = True

    # Contest alerts continue in the background even when the app is closed.
    try:
        contests = tracker.contests_payload(False).get("contests", [])
    except Exception:
        contests = []
    for contest in contests:
        start = datetime.fromtimestamp(contest.get("startTimeSeconds", 0), timezone.utc)
        end = datetime.fromtimestamp(contest.get("endTimeSeconds", 0), timezone.utc)
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
        title = f"{contest.get('platform', 'Programming')} contest is live" if bucket == "live" else (
            f"{contest.get('platform', 'Programming')} contest in {bucket}"
        )
        broadcast({
            "title": title,
            "body": contest.get("title") or "Open the contest radar for details.",
            "tag": f"contest-{contest.get('platform')}-{contest.get('startTimeSeconds')}-{bucket}",
            "url": "/?view=contests",
        })
        notification_state[contest_key] = now.isoformat()
        changed = True

    # Keep the deduplication record bounded.
    dated_keys = [key for key in notification_state if ":" in key and key != "dailyDigest"]
    if len(dated_keys) > 600:
        for key in dated_keys[:-600]:
            notification_state.pop(key, None)
        changed = True
    if active_subscriptions != subscriptions:
        personal["pushSubscriptions"] = active_subscriptions
        changed = True
    if changed:
        personal["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())
        tracker.write_json(tracker.PERSONAL_PATH, personal)
    return {"ok": True, "sent": sent, "checkedAt": now.isoformat()}


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
    require_token = os.environ.get("REQUIRE_TRACKER_TOKEN", "").lower() in {"1", "true", "yes", "on"}
    if not require_token:
        return True
    expected = os.environ.get("TRACKER_PRIVATE_TOKEN") or os.environ.get("CF2000_PRIVATE_TOKEN") or ""
    if not expected:
        return True
    parsed = urlparse(path)
    query = parse_qs(parsed.query)
    supplied = headers.get("x-tracker-token") or headers.get("X-Tracker-Token") or (query.get("token") or [""])[0]
    return supplied == expected


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
        if path == "/api/push/config":
            return json_response(push_config_payload())
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

        if path == "/api/personal":
            existing = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
            if not isinstance(payload, dict):
                return json_response({"error": "Personal payload must be an object"}, 400)
            existing["owner"] = tracker.OWNER_NAME
            existing["schedule"] = payload.get("schedule", existing.get("schedule", []))
            existing["notes"] = payload.get("notes", existing.get("notes", []))
            existing["expenses"] = payload.get("expenses", existing.get("expenses", []))
            existing["incomes"] = payload.get("incomes", existing.get("incomes", []))
            existing["focusSessions"] = payload.get("focusSessions", existing.get("focusSessions", []))
            for field in ("tasks", "goals", "habits", "weeklyReviews", "healthLogs", "careerItems", "documents",
                          "accounts", "budgets", "bills", "savingsGoals", "debts"):
                existing[field] = payload.get(field, existing.get(field, []))
            existing["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())
            existing["version"] = 4
            tracker.write_json(tracker.PERSONAL_PATH, existing)
            return json_response({"ok": True, "personal": tracker.public_personal(existing)})

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
