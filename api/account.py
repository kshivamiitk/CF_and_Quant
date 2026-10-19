"""Self-service deletion for new consumer accounts only."""

from __future__ import annotations

import json
import os
import uuid
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from api.auth import is_legacy_owner


def delete_account(body: bytes, claims: dict, authorization: str):
    if claims.get("aud") == "local" or not authorization.lower().startswith("bearer "):
        return 403, {"error": "Sign in to delete an account"}
    if is_legacy_owner(claims):
        return 409, {"error": "This legacy account needs assisted deletion because older records use separate storage"}
    if len(body) > 1024:
        return 413, {"error": "Request too large"}
    try:
        payload = json.loads(body)
        if payload.get("confirm") != "DELETE MY ACCOUNT":
            return 400, {"error": "Type DELETE MY ACCOUNT to confirm"}
        user_id = str(uuid.UUID(claims["sub"]))
    except (ValueError, TypeError, KeyError, AttributeError):
        return 400, {"error": "Invalid request"}
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
    if not url or not key:
        return 503, {"error": "Account deletion is unavailable. Try again later."}
    request = Request(f"{url}/auth/v1/admin/users/{user_id}", headers={"apikey": key, "Authorization": f"Bearer {key}"}, method="DELETE")
    try:
        with urlopen(request, timeout=20):
            pass
    except (HTTPError, OSError):
        return 503, {"error": "Account deletion did not finish. Try again later."}
    return 200, {"deleted": True}
