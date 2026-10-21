#!/usr/bin/env python3
from __future__ import annotations

import argparse
import datetime as dt
import json
import mimetypes
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, unquote, urlencode, urlparse, parse_qs
from urllib.request import Request, urlopen

from api.auth import authenticate_request, is_legacy_owner
from api.consumer import handle as consumer_handle
from api.account import delete_account


ROOT = Path(__file__).resolve().parent
PUBLIC = ROOT / "public"
DATA = ROOT / "data"
PERSONAL_PATH = DATA / "personal.json"
OWNER_NAME = "Kumar Shivam"


def load_local_env() -> None:
    """Load local .env values without overriding explicitly supplied variables."""
    env_path = ROOT / ".env"
    if not env_path.exists():
        return
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip('"').strip("'")
        if key and key not in os.environ:
            os.environ[key] = value


load_local_env()


def supabase_configured() -> bool:
    return bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"))


def production_mode() -> bool:
    return os.environ.get("VERCEL") == "1" or os.environ.get("APP_ENV", "").lower() == "production"


def supabase_request(method: str, path: str, payload=None):
    base_url = os.environ["SUPABASE_URL"].rstrip("/")
    service_key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
    body = None if payload is None else json.dumps(payload, ensure_ascii=True).encode("utf-8")
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }
    if method in {"POST", "PATCH"}:
        headers["Prefer"] = "return=representation,resolution=merge-duplicates"
    request = Request(f"{base_url}/rest/v1/{path}", data=body, headers=headers, method=method)
    with urlopen(request, timeout=15) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw) if raw else None


def supabase_document_key(path: Path) -> str | None:
    return "personal" if path == PERSONAL_PATH else None


def supabase_read_json(path: Path, default):
    document_key = supabase_document_key(path)
    if not document_key or not supabase_configured():
        return None
    owner_id = os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam")
    query = urlencode({"owner_id": f"eq.{owner_id}", "document_key": f"eq.{document_key}", "select": "payload"})
    rows = supabase_request("GET", f"tracker_documents?{query}")
    if rows:
        return rows[0].get("payload", default)
    supabase_request("POST", "tracker_documents", {
        "owner_id": owner_id,
        "document_key": document_key,
        "payload": default,
    })
    return default


def supabase_write_json(path: Path, payload) -> bool:
    document_key = supabase_document_key(path)
    if not document_key or not supabase_configured():
        return False
    owner_id = os.environ.get("SUPABASE_OWNER_ID", "kumar-shivam")
    query = urlencode({"owner_id": f"eq.{owner_id}", "document_key": f"eq.{document_key}"})
    supabase_request("PATCH", f"tracker_documents?{query}", {
        "payload": payload,
        "updated_at": dt.datetime.now(dt.timezone.utc).isoformat(),
    })
    return True


def read_json(path: Path, default):
    if supabase_configured() and supabase_document_key(path):
        try:
            return supabase_read_json(path, default)
        except Exception as exc:
            if production_mode():
                raise RuntimeError("Primary database read failed") from exc
            print(f"Supabase read failed; using local storage: {exc}")
    elif production_mode() and supabase_document_key(path):
        raise RuntimeError("Primary database is not configured")
    if not path.exists():
        return default
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def write_json(path: Path, payload) -> None:
    if supabase_configured() and supabase_document_key(path):
        try:
            if supabase_write_json(path, payload):
                return
        except Exception as exc:
            if production_mode():
                raise RuntimeError("Primary database write failed") from exc
            print(f"Supabase write failed; using local storage: {exc}")
    elif production_mode() and supabase_document_key(path):
        raise RuntimeError("Primary database is not configured")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w", encoding="utf-8") as file:
        json.dump(payload, file, indent=2, ensure_ascii=True)
        file.write("\n")
    os.replace(tmp, path)


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def isoformat_utc(value: dt.datetime) -> str:
    return value.astimezone(dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def parse_datetime(value) -> dt.datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        return dt.datetime.fromtimestamp(value, dt.timezone.utc)
    if isinstance(value, str):
        raw = value.strip()
        if not raw:
            return None
        if raw.endswith("Z"):
            raw = raw[:-1] + "+00:00"
        try:
            parsed = dt.datetime.fromisoformat(raw)
        except ValueError:
            return None
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=dt.timezone.utc)
        return parsed.astimezone(dt.timezone.utc)
    return None


def fetch_json_url(url: str, timeout: int = 60):
    request = Request(url, headers={"User-Agent": "cf2000-tracker/1.0"})
    with urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def default_personal():
    return {
        "version": 4,
        "owner": OWNER_NAME,
        "schedule": [],
        "notes": [],
        "skinRoutines": [],
        "skinStepLogs": [],
        "gymPlans": [],
        "gymSessions": [],
        "customExercises": [],
        "gymExerciseSessions": [],
        "gymExerciseFavorites": [],
        "contestCalendar": [],
        "skinProducts": [],
        "dailyReflections": [],
        "expenses": [],
        "incomes": [],
        "focusSessions": [],
        "tasks": [],
        "goals": [],
        "habits": [],
        "weeklyReviews": [],
        "healthLogs": [],
        "careerItems": [],
        "documents": [],
        "accounts": [],
        "budgets": [],
        "bills": [],
        "savingsGoals": [],
        "debts": [],
        "settings": {"humourStyle": "playful", "flexibleStreaks": True},
        "notificationState": {},
        "pushSubscriptions": [],
        "updatedAt": None
    }


def public_personal(personal):
    return {
        "version": personal.get("version", 4),
        "owner": personal.get("owner", OWNER_NAME),
        "schedule": personal.get("schedule", []),
        "notes": personal.get("notes", []),
        "skinRoutines": personal.get("skinRoutines", []),
        "skinStepLogs": personal.get("skinStepLogs", []),
        "gymPlans": personal.get("gymPlans", []),
        "gymSessions": personal.get("gymSessions", []),
        "customExercises": personal.get("customExercises", []),
        "gymExerciseSessions": personal.get("gymExerciseSessions", []),
        "gymExerciseFavorites": personal.get("gymExerciseFavorites", []),
        "contestCalendar": personal.get("contestCalendar", []),
        "skinProducts": personal.get("skinProducts", []),
        "dailyReflections": personal.get("dailyReflections", []),
        "expenses": personal.get("expenses", []),
        "incomes": personal.get("incomes", []),
        "focusSessions": personal.get("focusSessions", []),
        "tasks": personal.get("tasks", []),
        "goals": personal.get("goals", []),
        "habits": personal.get("habits", []),
        "weeklyReviews": personal.get("weeklyReviews", []),
        "healthLogs": personal.get("healthLogs", []),
        "careerItems": personal.get("careerItems", []),
        "documents": personal.get("documents", []),
        "accounts": personal.get("accounts", []),
        "budgets": personal.get("budgets", []),
        "bills": personal.get("bills", []),
        "savingsGoals": personal.get("savingsGoals", []),
        "debts": personal.get("debts", []),
        "settings": personal.get("settings", {"humourStyle": "playful", "flexibleStreaks": True}),
        "healthImports": personal.get("healthImports", []),
        "updatedAt": personal.get("updatedAt"),
    }



class TrackerHandler(BaseHTTPRequestHandler):
    server_version = "CF2000Tracker/1.0"

    def log_message(self, fmt, *args):
        print("%s - %s" % (self.address_string(), fmt % args))

    def send_json(self, payload, status=200):
        body = json.dumps(payload, ensure_ascii=True).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def send_text(self, text, status=200):
        body = text.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def private_token(self) -> str:
        return getattr(self.server, "private_token", "") or ""

    def is_authorized(self) -> bool:
        return authenticate_request({key.lower(): value for key, value in self.headers.items()}) is not None

    def require_api_auth(self) -> bool:
        if self.is_authorized():
            return True
        self.send_json({"error": "Authentication required"}, 401)
        return False

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path.startswith("/api/") and path != "/api/auth/config" and not self.require_api_auth():
            return

        if path == "/api/auth/config":
            return self.send_json({"url": os.environ.get("SUPABASE_URL", ""), "publishableKey": os.environ.get("SUPABASE_PUBLISHABLE_KEY", "")})
        if path == "/api/auth/me":
            claims = authenticate_request(dict(self.headers.items()))
            return self.send_json({"legacyOwner": is_legacy_owner(claims), "userId": claims["sub"]})
        if path == "/api/consumer":
            return self.handle_consumer("GET")
        if path == "/api/consumer-push/config":
            from api.consumer_push import config
            return self.send_json(config())
        if path in {"/api/personal", "/api/push/config"} and not is_legacy_owner(authenticate_request(dict(self.headers.items()))):
            return self.send_json({"error": "Legacy workspace is private"}, 403)
        if path == "/api/personal":
            return self.send_json(public_personal(read_json(PERSONAL_PATH, default_personal())))
        if path == "/api/push/config":
            return self.send_json({
                "configured": False,
                "publicKey": "",
                "message": "Push reminders are available after Vercel environment variables are configured.",
            })
        if path == "/health":
            return self.send_text("ok\n")
        if path == "/":
            return self.serve_file(PUBLIC / "index.html")

        requested = unquote(path.lstrip("/"))
        safe_path = (PUBLIC / requested).resolve()
        if PUBLIC.resolve() not in safe_path.parents and safe_path != PUBLIC.resolve():
            return self.send_text("Forbidden\n", 403)
        return self.serve_file(safe_path)

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/consumer":
            return self.handle_consumer("POST")
        if parsed.path in {"/api/consumer-push/subscribe", "/api/consumer-push/unsubscribe", "/api/consumer-push/status", "/api/consumer-push/test"}:
            if not self.require_api_auth():
                return
            from api.consumer_push import subscribe, unsubscribe, status, send_test
            claims = authenticate_request(dict(self.headers.items()))
            length = int(self.headers.get("Content-Length", "0"))
            if length > 8192:
                return self.send_json({"error": "Request too large"}, 413)
            try:
                payload = json.loads(self.rfile.read(length) or b"{}")
                if parsed.path.endswith("/subscribe"):
                    result = subscribe(claims, payload)
                elif parsed.path.endswith("/unsubscribe"):
                    result = unsubscribe(claims, payload)
                elif parsed.path.endswith("/status"):
                    result = status(claims, payload)
                else:
                    result = send_test(claims, payload)
                return self.send_json(result)
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                return self.send_json({"error": str(exc)}, 400)
            except Exception:
                return self.send_json({"error": "Reminder service unavailable. Check server configuration and migration."}, 503)
        if parsed.path not in {"/api/personal", "/api/health-import"}:
            return self.send_text("Not found\n", 404)
        if not self.require_api_auth():
            return
        if not is_legacy_owner(authenticate_request(dict(self.headers.items()))):
            return self.send_json({"error": "Legacy workspace is private"}, 403)

        length = int(self.headers.get("Content-Length", "0"))
        if length > 1024 * 1024:
            return self.send_json({"error": "Request too large"}, 413)
        raw = self.rfile.read(length)
        try:
            payload = json.loads(raw.decode("utf-8"))
        except json.JSONDecodeError:
            return self.send_json({"error": "Invalid JSON"}, 400)

        if parsed.path == "/api/health-import":
            existing = read_json(PERSONAL_PATH, default_personal())
            imports = existing.get("healthImports", [])
            source = str(payload.get("source") or "Shortcut").strip()[:120]
            source_sample_id = str(payload.get("sourceSampleId") or f"{source}:{payload.get('date') or dt.date.today().isoformat()}").strip()[:200]
            entry = {
                "date": payload.get("date") or dt.date.today().isoformat(),
                "steps": payload.get("steps"),
                "activeCalories": payload.get("activeCalories"),
                "heartRate": payload.get("heartRate"),
                "standHours": payload.get("standHours"),
                "sleepHours": payload.get("sleepHours"),
                "workoutMinutes": payload.get("workoutMinutes"),
                "source": source,
                "sourceSampleId": source_sample_id,
                "metadata": payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {},
                "importedAt": isoformat_utc(utc_now()),
            }
            imports = [i for i in imports if i.get("sourceSampleId") != source_sample_id]
            imports.append(entry)
            existing["healthImports"] = imports
            write_json(PERSONAL_PATH, existing)
            return self.send_json({"ok": True, "entry": entry})

        if parsed.path == "/api/personal":
            existing = read_json(PERSONAL_PATH, default_personal())
            if not isinstance(payload, dict):
                return self.send_json({"error": "Personal payload must be an object"}, 400)
            existing["owner"] = OWNER_NAME
            existing["schedule"] = payload.get("schedule", existing.get("schedule", []))
            existing["notes"] = payload.get("notes", existing.get("notes", []))
            existing["expenses"] = payload.get("expenses", existing.get("expenses", []))
            existing["incomes"] = payload.get("incomes", existing.get("incomes", []))
            existing["focusSessions"] = payload.get("focusSessions", existing.get("focusSessions", []))
            for field in ("skinRoutines", "skinStepLogs", "gymPlans", "gymSessions", "customExercises", "gymExerciseSessions", "gymExerciseFavorites", "contestCalendar", "skinProducts", "dailyReflections", "tasks", "goals", "habits", "weeklyReviews", "healthLogs", "careerItems", "documents",
                          "accounts", "budgets", "bills", "savingsGoals", "debts"):
                existing[field] = payload.get(field, existing.get(field, []))
            existing["settings"] = payload.get("settings", existing.get("settings", {}))
            existing["updatedAt"] = isoformat_utc(utc_now())
            existing["version"] = 4
            write_json(PERSONAL_PATH, existing)
            return self.send_json({"ok": True, "personal": public_personal(existing)})

    def do_DELETE(self):
        if urlparse(self.path).path == "/api/consumer":
            return self.handle_consumer("DELETE")
        if urlparse(self.path).path == "/api/account":
            claims = authenticate_request(dict(self.headers.items()))
            if not claims:
                return self.send_json({"error": "Authentication required"}, 401)
            length = int(self.headers.get("Content-Length", "0"))
            if length > 1024:
                return self.send_json({"error": "Request too large"}, 413)
            status, result = delete_account(self.rfile.read(length), claims, self.headers.get("Authorization", ""))
            return self.send_json(result, status)
        return self.send_text("Not found\n", 404)

    def handle_consumer(self, method: str):
        claims = authenticate_request(dict(self.headers.items()))
        if not claims:
            return self.send_json({"error": "Authentication required"}, 401)
        length = int(self.headers.get("Content-Length", "0")) if method != "GET" else 0
        if length > 128 * 1024:
            return self.send_json({"error": "Request too large"}, 413)
        body = self.rfile.read(length) if length else b""
        try:
            offset = int(parse_qs(urlparse(self.path).query).get("offset", ["0"])[0])
        except ValueError:
            return self.send_json({"error": "Invalid page offset"}, 400)
        kind = parse_qs(urlparse(self.path).query).get("kind", [None])[0]
        status, result = consumer_handle(method, body, claims, self.headers.get("Authorization", ""), offset, kind)
        return self.send_json(result, status)

    def serve_file(self, path: Path):
        if not path.exists() or not path.is_file():
            return self.send_text("Not found\n", 404)
        content_type = mimetypes.guess_type(str(path))[0] or "application/octet-stream"
        body = path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)


def main():
    parser = argparse.ArgumentParser(description="Life tracker")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--token", default=os.environ.get("CF2000_PRIVATE_TOKEN", ""))
    args = parser.parse_args()

    DATA.mkdir(parents=True, exist_ok=True)
    PUBLIC.mkdir(parents=True, exist_ok=True)
    if not PERSONAL_PATH.exists():
        write_json(PERSONAL_PATH, default_personal())

    server = ThreadingHTTPServer((args.host, args.port), TrackerHandler)
    server.private_token = args.token
    print(f"Tracker running at http://{args.host}:{args.port}")
    if args.token:
        print("Private API token is enabled. Open with ?token=YOUR_TOKEN once on each device.")
    elif args.host not in {"127.0.0.1", "localhost"}:
        print("Warning: running on a network host without --token exposes tracker APIs to the network.")
    server.serve_forever()


if __name__ == "__main__":
    main()
