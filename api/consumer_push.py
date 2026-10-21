"""Account-scoped Web Push for user-scheduled care items."""

from __future__ import annotations

import hashlib
import base64
import json
import os
import re
import uuid
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.parse import quote, urlencode, urlparse
from urllib.request import Request, urlopen
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec


def configured() -> bool:
    return bool(os.environ.get("APP_BASE_URL", "").startswith("https://")) and all(os.environ.get(name) for name in (
        "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "VAPID_PUBLIC_KEY",
        "VAPID_PRIVATE_KEY", "VAPID_SUBJECT", "QSTASH_TOKEN",
        "REMINDER_DISPATCH_SECRET", "APP_BASE_URL"))


def config() -> dict:
    ready = configured()
    return {"configured": ready, "publicKey": os.environ.get("VAPID_PUBLIC_KEY", "") if ready else "",
            "message": "Notifications are available after server push credentials and the database migration are configured." if not ready else "Enable reminders from the installed app. Permission is optional."}


def _db(method: str, table: str, query: dict | None = None, payload=None, *, ignore_duplicate=False):
    base = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/" + table
    url = base + ("?" + urlencode(query) if query else "")
    key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    body = json.dumps(payload).encode() if payload is not None else None
    prefer = "return=representation" + (",resolution=ignore-duplicates" if ignore_duplicate else ",resolution=merge-duplicates")
    request = Request(url, data=body, method=method, headers={
        "apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json", "Prefer": prefer})
    try:
        with urlopen(request, timeout=15) as response:
            return json.loads(response.read() or b"[]")
    except HTTPError as exc:
        raise RuntimeError(f"Push storage unavailable ({exc.code}); apply the consumer push migration.") from exc


def _rows(table: str, filters: dict, limit: int = 500):
    result = []
    while True:
        page = _db("GET", table, {**filters, "limit": str(limit), "offset": str(len(result))})
        result.extend(page)
        if len(page) < limit:
            return result


def _user_id(claims: dict) -> str:
    if claims.get("aud") == "local":
        raise ValueError("Sign in with a real account to enable device reminders")
    return str(uuid.UUID(claims["sub"]))


def _subscription(payload: dict) -> tuple[str, dict]:
    subscription = payload.get("subscription") if isinstance(payload, dict) else None
    if not isinstance(subscription, dict):
        raise ValueError("A browser push subscription is required")
    endpoint = subscription.get("endpoint")
    parsed = urlparse(endpoint) if isinstance(endpoint, str) else None
    host = parsed.hostname if parsed else None
    allowed = host in {"fcm.googleapis.com", "updates.push.services.mozilla.com", "push.apple.com"} or bool(host and (host.endswith(".push.apple.com") or host.endswith(".notify.windows.com")))
    if not endpoint or len(endpoint) > 2048 or parsed.scheme != "https" or not allowed or parsed.username or parsed.password:
        raise ValueError("Unsupported browser push endpoint")
    keys = subscription.get("keys")
    if not isinstance(keys, dict) or not all(isinstance(keys.get(k), str) and re.fullmatch(r"[A-Za-z0-9_-]{10,200}", keys[k]) for k in ("p256dh", "auth")):
        raise ValueError("Invalid browser push keys")
    clean = {"endpoint": endpoint, "keys": {"p256dh": keys["p256dh"], "auth": keys["auth"]}}
    return hashlib.sha256(endpoint.encode()).hexdigest(), clean


def vapid_private_key() -> str:
    """Normalize the raw 32-byte key emitted by `web-push generate-vapid-keys`."""
    value = os.environ["VAPID_PRIVATE_KEY"].replace("\\n", "\n").strip()
    if value.startswith("-----BEGIN"):
        private = serialization.load_pem_private_key(value.encode(), password=None)
    else:
        raw = base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))
        private = ec.derive_private_key(int.from_bytes(raw, "big"), ec.SECP256R1()) if len(raw) == 32 else serialization.load_der_private_key(raw, password=None)
    if not isinstance(private, ec.EllipticCurvePrivateKey) or not isinstance(private.curve, ec.SECP256R1):
        raise ValueError("VAPID_PRIVATE_KEY must be a P-256 key")
    der = private.private_bytes(serialization.Encoding.DER, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    return base64.urlsafe_b64encode(der).decode().rstrip("=")


def ensure_schedule():
    destination = os.environ["APP_BASE_URL"].rstrip("/") + "/api/consumer-push/dispatch"
    if not destination.startswith("https://"):
        raise ValueError("APP_BASE_URL must be HTTPS for background reminders")
    token = os.environ["QSTASH_TOKEN"]
    secret = os.environ["REMINDER_DISPATCH_SECRET"]
    request = Request(
        "https://qstash.upstash.io/v2/schedules/" + quote(destination, safe=""),
        data=b'{}', method="POST", headers={
            "Authorization": f"Bearer {token}", "Content-Type": "application/json",
            "Upstash-Cron": "* * * * *", "Upstash-Schedule-Id": "wellframe-consumer-care",
            "Upstash-Retries": "1", "Upstash-Forward-X-Reminder-Secret": secret})
    with urlopen(request, timeout=15):
        pass


def subscribe(claims: dict, payload: dict) -> dict:
    if not configured():
        raise RuntimeError("Push reminders are not configured")
    user_id = _user_id(claims)
    endpoint_hash, clean = _subscription(payload)
    ensure_schedule()
    _db("POST", "consumer_push_subscriptions", {"on_conflict": "user_id,endpoint_hash"},
        {"user_id": user_id, "endpoint_hash": endpoint_hash, "subscription": clean})
    return {"ok": True}


def unsubscribe(claims: dict, payload: dict) -> dict:
    user_id = _user_id(claims)
    endpoint_hash, _ = _subscription(payload)
    _db("DELETE", "consumer_push_subscriptions", {"user_id": f"eq.{user_id}", "endpoint_hash": f"eq.{endpoint_hash}"})
    return {"ok": True}


def status(claims: dict, payload: dict) -> dict:
    user_id = _user_id(claims)
    endpoint_hash, _ = _subscription(payload)
    rows = _db("GET", "consumer_push_subscriptions", {"select": "endpoint_hash", "user_id": f"eq.{user_id}", "endpoint_hash": f"eq.{endpoint_hash}", "limit": "1"})
    return {"subscribed": bool(rows)}


def send_test(claims: dict, payload: dict) -> dict:
    user_id = _user_id(claims)
    endpoint_hash, _ = _subscription(payload)
    rows = _db("GET", "consumer_push_subscriptions", {"select": "subscription", "user_id": f"eq.{user_id}", "endpoint_hash": f"eq.{endpoint_hash}", "limit": "1"})
    if not rows:
        raise ValueError("Enable reminders on this device before sending a test")
    key = "test:" + endpoint_hash + ":" + datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M")
    claim = _db("POST", "consumer_push_deliveries", {"on_conflict": "user_id,occurrence_key"},
                {"user_id": user_id, "occurrence_key": key}, ignore_duplicate=True)
    if not claim:
        raise ValueError("A test was already sent this minute")
    try:
        outcome = _send(rows[0]["subscription"], {"title": "Wellframe test reminder", "body": "Notifications are connected on this device.", "url": "/?tab=care", "tag": "wellframe-test"})
        if outcome != "sent":
            raise RuntimeError("This device's push subscription has expired. Turn reminders off and on again.")
        return {"sent": True}
    except Exception:
        _db("DELETE", "consumer_push_deliveries", {"user_id": f"eq.{user_id}", "occurrence_key": f"eq.{key}"})
        raise


def _send(subscription: dict, payload: dict) -> str:
    from pywebpush import WebPushException, webpush
    try:
        webpush(subscription_info=subscription, data=json.dumps(payload),
                vapid_private_key=vapid_private_key(),
                vapid_claims={"sub": os.environ["VAPID_SUBJECT"]}, ttl=300)
        return "sent"
    except WebPushException as exc:
        status_code = getattr(exc, "status_code", None) or getattr(getattr(exc, "response", None), "status_code", None)
        if status_code in {404, 410}:
            return "expired"
        raise


def due_care(items: list, logs: list, now: datetime) -> list[dict]:
    """Find today's unacknowledged times in a small late-delivery window."""
    due = []
    for item in items:
        payload = item.get("payload") or {}
        if payload.get("paused") or not payload.get("times"):
            continue
        try:
            zone = ZoneInfo(payload.get("timezone") or "UTC")
        except (ZoneInfoNotFoundError, TypeError, ValueError):
            continue
        local_now = now.astimezone(zone)
        for hhmm in payload["times"]:
            if not isinstance(hhmm, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", hhmm):
                continue
            hour, minute = map(int, hhmm.split(":"))
            due_local = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if not due_local <= local_now < due_local + timedelta(minutes=15):
                continue
            occurrence = f"{item['record_id']}:{local_now.date().isoformat()}:{hhmm}"
            if any(log.get("user_id") == item["user_id"] and log.get("payload", {}).get("itemId") == item["record_id"] and
                   (log.get("payload", {}).get("occurrenceId") == occurrence or
                    (not log.get("payload", {}).get("occurrenceId") and datetime.fromisoformat(log["occurred_at"].replace("Z", "+00:00")).astimezone(zone).date() == local_now.date()))
                   and log.get("payload", {}).get("status") in {"taken", "skipped"} for log in logs):
                continue
            due.append({"user_id": item["user_id"], "occurrence": occurrence})
    return due


def due_workouts(profiles: list, workouts: list, now: datetime) -> list[dict]:
    due = []
    seen_users = set()
    for profile in profiles:
        user_id = profile["user_id"]
        if user_id in seen_users:
            continue
        seen_users.add(user_id)
        payload = profile.get("payload") or {}
        hhmm = payload.get("workoutReminderTime")
        if not isinstance(hhmm, str) or not re.fullmatch(r"(?:[01]\d|2[0-3]):[0-5]\d", hhmm):
            continue
        try:
            zone = ZoneInfo(payload.get("timezone") or "UTC")
        except (ZoneInfoNotFoundError, TypeError, ValueError):
            continue
        local_now = now.astimezone(zone)
        hour, minute = map(int, hhmm.split(":"))
        due_local = local_now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if not due_local <= local_now < due_local + timedelta(minutes=15):
            continue
        if any(row["user_id"] == user_id and row.get("payload", {}).get("status") in {"active", "completed"} and
               datetime.fromisoformat(row["occurred_at"].replace("Z", "+00:00")).astimezone(zone).date() == local_now.date() for row in workouts):
            continue
        due.append({"user_id": user_id, "occurrence": f"workout:{local_now.date().isoformat()}:{hhmm}", "type": "workout"})
    return due


def dispatch(now: datetime | None = None) -> dict:
    if not configured():
        raise RuntimeError("Push reminders are not configured")
    now = now or datetime.now(timezone.utc)
    _db("DELETE", "consumer_push_deliveries", {"created_at": f"lt.{(now - timedelta(days=30)).isoformat()}"})
    subscriptions = _rows("consumer_push_subscriptions", {"select": "user_id,endpoint_hash,subscription"})
    if not subscriptions:
        return {"sent": 0, "due": 0}
    users = {entry["user_id"] for entry in subscriptions}
    items = [row for row in _rows("consumer_records", {"select": "user_id,record_id,payload", "kind": "eq.care_item"}) if row["user_id"] in users]
    logs = _rows("consumer_records", {"select": "user_id,payload,occurred_at", "kind": "eq.care_log", "occurred_at": f"gte.{(now - timedelta(hours=48)).isoformat()}"})
    profiles = _rows("consumer_records", {"select": "user_id,payload,occurred_at", "kind": "eq.profile", "order": "occurred_at.desc"})
    workouts = _rows("consumer_records", {"select": "user_id,payload,occurred_at", "kind": "eq.workout", "occurred_at": f"gte.{(now - timedelta(hours=48)).isoformat()}"})
    due = due_care(items, logs, now) + due_workouts([row for row in profiles if row["user_id"] in users], workouts, now)
    sent = 0
    for reminder in due:
        user_id, occurrence = reminder["user_id"], reminder["occurrence"]
        claimed = _db("POST", "consumer_push_deliveries", {"on_conflict": "user_id,occurrence_key"},
                      {"user_id": user_id, "occurrence_key": occurrence}, ignore_duplicate=True)
        if not claimed:
            continue
        delivered = False
        for entry in [sub for sub in subscriptions if sub["user_id"] == user_id]:
            try:
                workout = reminder.get("type") == "workout"
                result = _send(entry["subscription"], {"title": "Wellframe workout reminder" if workout else "Wellframe care reminder",
                                                        "body": "Your training time is here. Open the app when you're ready." if workout else "An item on your care checklist is due. Open the app to review it.",
                                                        "tag": f"wellframe-{hashlib.sha256(occurrence.encode()).hexdigest()[:16]}", "url": "/?tab=train" if workout else "/?tab=care"})
                if result == "sent":
                    delivered = True
                    sent += 1
                elif result == "expired":
                    _db("DELETE", "consumer_push_subscriptions", {"user_id": f"eq.{user_id}", "endpoint_hash": f"eq.{entry['endpoint_hash']}"})
            except Exception:
                continue
        if not delivered:
            _db("DELETE", "consumer_push_deliveries", {"user_id": f"eq.{user_id}", "occurrence_key": f"eq.{occurrence}"})
    return {"sent": sent, "due": len(due)}
