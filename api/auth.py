"""Small Supabase JWT boundary shared by the local and Vercel handlers."""

from __future__ import annotations

import os
from functools import lru_cache


@lru_cache(maxsize=1)
def _jwk_client():
    try:
        import jwt
    except ImportError:
        return None
    from jwt import PyJWKClient

    jwks_url = os.environ.get("SUPABASE_JWKS_URL", "")
    if not jwks_url and os.environ.get("SUPABASE_URL"):
        jwks_url = f"{os.environ['SUPABASE_URL'].rstrip('/')}/auth/v1/.well-known/jwks.json"
    return PyJWKClient(jwks_url) if jwks_url else None


def _header(headers: dict, name: str) -> str:
    wanted = name.lower()
    return next((str(value) for key, value in headers.items() if key.lower() == wanted), "")


def authenticate_request(headers: dict) -> dict | None:
    """Return verified claims, or None. Explicit local bypass is dev-only."""
    if not _header(headers, "authorization") and os.environ.get("ALLOW_LOCAL_DEV_AUTH") == "1" and os.environ.get("VERCEL") != "1" and os.environ.get("APP_ENV", "").lower() != "production":
        return {"sub": os.environ.get("SUPABASE_OWNER_USER_ID") or "local-development", "aud": "local"}

    authorization = _header(headers, "authorization")
    if not authorization.lower().startswith("bearer "):
        return None
    token = authorization[7:].strip()
    client = _jwk_client()
    if not token or client is None:
        return None
    try:
        import jwt

        signing_key = client.get_signing_key_from_jwt(token).key
        issuer = os.environ.get("SUPABASE_AUTH_ISSUER", "")
        if not issuer and os.environ.get("SUPABASE_URL"):
            issuer = f"{os.environ['SUPABASE_URL'].rstrip('/')}/auth/v1"
        options = {"require": ["exp", "sub", "aud"]}
        claims = jwt.decode(
            token,
            signing_key,
            algorithms=["RS256", "ES256"],
            audience=os.environ.get("SUPABASE_AUTH_AUDIENCE", "authenticated"),
            issuer=issuer or None,
            options=options,
        )
    except Exception:
        return None

    return claims


def is_legacy_owner(claims: dict | None) -> bool:
    owner = os.environ.get("SUPABASE_OWNER_USER_ID", "").strip()
    return bool(claims and owner and claims.get("sub") == owner)
