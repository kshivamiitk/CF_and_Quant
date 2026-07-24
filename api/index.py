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
    active = []
    sent = 0
    for subscription in personal.get("pushSubscriptions", []):
        if send_push(subscription, {
            "title": "Reminders are ready",
            "body": "Your Kumar Quant calendar can now notify this iPhone.",
            "tag": "reminder-test",
            "url": "/?view=planner",
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
    return local_time.replace(tzinfo=ZoneInfo("Asia/Kolkata")).astimezone(timezone.utc)


def dispatch_due_reminders() -> dict:
    personal = tracker.read_json(tracker.PERSONAL_PATH, tracker.default_personal())
    subscriptions = personal.get("pushSubscriptions", [])
    now = datetime.now(timezone.utc)
    sent = 0
    changed = False
    active_subscriptions = list(subscriptions)
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
        next_subscriptions = []
        for subscription in active_subscriptions:
            if send_push(subscription, {
                "title": event.get("title") or "Scheduled task",
                "body": event.get("notes") or "It is time for your scheduled work.",
                "tag": f"calendar-{event.get('id', 'event')}",
                "url": f"/?view=planner&date={str(event.get('start', ''))[:10]}",
            }):
                next_subscriptions.append(subscription)
                sent += 1
        active_subscriptions = next_subscriptions
        event["lastNotifiedFor"] = reminder_key
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
            existing["updatedAt"] = tracker.isoformat_utc(tracker.utc_now())
            existing["version"] = 2
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
