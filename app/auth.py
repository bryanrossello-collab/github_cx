"""Header-based SSO identity resolution (Pomerium / oauth2-proxy).

Trust model: we trust the upstream proxy, NOT client-supplied headers.
The proxy strips any client copies before forwarding.

Roles:
  * guest    — ephemeral, read-only (STRICT_AUTH + no identity header)
  * standard — auto-provisioned signed-in user; can edit notes/forecasts
  * admin    — user management, DB diagnostics, account history lookup
  * owner    — CSV uploads, snapshot history, notes import, raw note edit
               (super-user; seeded via BOOTSTRAP_OWNERS)
"""

from __future__ import annotations

import base64
import hashlib
import json
import logging
import secrets
import time
from dataclasses import asdict, dataclass, field
from typing import Any, Optional

from fastapi import Depends, Header, HTTPException, Request, status

from app.config import Settings, get_settings
from app.users import UserRecord, provision_from_identity

logger = logging.getLogger("renewals_studio.auth")

# Short-lived cache of DB-provisioned users keyed by identity email. The auth
# middleware runs on every request; without this we'd hit Postgres (pool
# acquire + users SELECT) for each one, which under load times out and shows
# up as sporadic "guest" / "could not reach server" and admin lag.
_USER_CACHE_TTL_S = 45.0
_user_cache: dict[str, tuple[float, "ResolvedUser"]] = {}


def invalidate_user_cache(email: str | None = None) -> None:
    """Drop cached provisioning (e.g. after an admin changes a role)."""
    if email is None:
        _user_cache.clear()
    else:
        _user_cache.pop(email.lower(), None)

# Header fallback chain — first non-empty wins.
EMAIL_HEADERS = (
    "x-pomerium-claim-email",
    "x-pomerium-user-email",
    "x-auth-request-email",
    "x-forwarded-email",
    "x-goog-authenticated-user-email",
)
NAME_HEADERS = (
    "x-pomerium-claim-name",
    "x-pomerium-claim-given-name",
    "x-auth-request-user",
    "x-forwarded-user",
    "x-goog-authenticated-user-id",
)
JWT_HEADERS = (
    "x-pomerium-jwt",
    "x-pomerium-jwt-assertion",
    "x-forwarded-jwt",
    "x-goog-iap-jwt-assertion",
)


@dataclass
class Identity:
    email: str
    display_name: str
    source: str


@dataclass
class ResolvedUser:
    email: str
    display_name: str
    role: str  # guest | standard | admin | owner
    source: str
    ephemeral: bool = False

    @property
    def is_owner(self) -> bool:
        return self.role == "owner"

    @property
    def is_admin(self) -> bool:
        return self.role in ("admin", "owner")

    @property
    def is_guest(self) -> bool:
        return self.role == "guest"

    @property
    def is_signed_in(self) -> bool:
        return self.role in ("standard", "admin", "owner")

    def to_dict(self) -> dict:
        return {
            "email": self.email,
            "displayName": self.display_name,
            "role": self.role,
            "source": self.source,
            "ephemeral": self.ephemeral,
        }


def _normalize_proxy_email(raw: str) -> str:
    """Strip provider prefixes (e.g. Google IAP ``accounts.google.com:email``)."""
    val = raw.strip()
    if not val:
        return ""
    if ":" in val and "@" in val.split(":", 1)[-1]:
        val = val.split(":", 1)[-1].strip()
    return val.lower()


def _header_value(request: Request, names: tuple[str, ...]) -> str:
    for name in names:
        val = request.headers.get(name)
        if val and val.strip():
            return val.strip()
    return ""


def _decode_jwt_payload(token: str) -> dict:
    """Decode JWT body without verification — proxy-trust edge case only."""
    try:
        parts = token.split(".")
        if len(parts) < 2:
            return {}
        padded = parts[1] + "=" * (-len(parts[1]) % 4)
        raw = base64.urlsafe_b64decode(padded.encode("ascii"))
        return json.loads(raw.decode("utf-8"))
    except Exception:
        return {}


def _jwt_identity(request: Request) -> Optional[Identity]:
    for hdr in JWT_HEADERS:
        token = request.headers.get(hdr)
        if not token or not token.strip():
            continue
        payload = _decode_jwt_payload(token.strip())
        email = (
            payload.get("email")
            or payload.get("preferred_username")
            or payload.get("sub")
            or ""
        )
        if isinstance(email, str) and "@" in email:
            name = (
                payload.get("name")
                or payload.get("given_name")
                or email.split("@")[0]
            )
            return Identity(email=email.lower(), display_name=str(name), source=f"jwt:{hdr}")
    return None


def extract_identity(request: Request) -> Optional[Identity]:
    email = _normalize_proxy_email(_header_value(request, EMAIL_HEADERS))
    if email and "@" in email:
        name = _header_value(request, NAME_HEADERS) or email.split("@")[0]
        hdr = next(
            (h for h in EMAIL_HEADERS if request.headers.get(h)),
            "proxy-header",
        )
        return Identity(email=email, display_name=name, source=hdr)
    return _jwt_identity(request)


def _guest() -> ResolvedUser:
    return ResolvedUser(
        email="",
        display_name="Guest",
        role="guest",
        source="strict-auth-no-header",
        ephemeral=True,
    )


def guest_user() -> ResolvedUser:
    """Public cheap guest (no DB) — used for static assets that skip auth."""
    return _guest()


def _dev_user(settings: Settings) -> ResolvedUser:
    email = settings.effective_dev_user_email()
    owners = set(settings.bootstrap_owner_emails())
    role = "owner" if email.lower() in owners else "admin"
    return ResolvedUser(
        email=email,
        display_name="Local Dev User",
        role=role,
        source="dev-fallback",
        ephemeral=True,
    )


def _ephemeral_bootstrap(email: str, display_name: str, role: str, source: str) -> ResolvedUser:
    return ResolvedUser(
        email=email,
        display_name=display_name,
        role=role,
        source=source,
        ephemeral=True,
    )


async def resolve_user(request: Request) -> ResolvedUser:
    """Resolve the current user from proxy headers + DB provisioning."""
    settings = get_settings()
    identity = extract_identity(request)

    if identity is None:
        if settings.effective_strict_auth:
            return _guest()
        return _dev_user(settings)

    cache_key = identity.email
    cached = _user_cache.get(cache_key)
    if cached is not None and (time.monotonic() - cached[0]) < _USER_CACHE_TTL_S:
        return cached[1]

    bootstrap = set(settings.bootstrap_admin_emails())
    owners = set(settings.bootstrap_owner_emails())
    db = getattr(request.app.state, "db", None)
    db_ready = db is not None and getattr(request.app.state, "db_status", "") == "ready"

    if not db_ready:
        if identity.email in owners:
            role = "owner"
        elif identity.email in bootstrap:
            role = "admin"
        else:
            role = "standard"
        return _ephemeral_bootstrap(
            identity.email, identity.display_name, role, f"{identity.source}:no-db"
        )

    try:
        async with db.acquire() as conn:
            record = await provision_from_identity(
                conn,
                email=identity.email,
                display_name=identity.display_name,
                bootstrap_emails=bootstrap,
                owner_emails=owners,
                auto_provision=settings.auto_provision_users,
            )
            # Record activity (last-seen + daily hit tally). This runs only on
            # a cache MISS, so it's naturally throttled to ~1 write / user /
            # _USER_CACHE_TTL_S. FULLY guarded — it must NEVER break auth.
            if record is not None:
                try:
                    await conn.execute(
                        "UPDATE users SET last_seen_at = NOW() WHERE email = $1",
                        record.email,
                    )
                    await conn.execute(
                        "INSERT INTO user_activity_daily (email, day, hits, last_seen_at) "
                        "VALUES ($1, CURRENT_DATE, 1, NOW()) "
                        "ON CONFLICT (email, day) DO UPDATE SET "
                        "hits = user_activity_daily.hits + 1, last_seen_at = NOW()",
                        record.email,
                    )
                except Exception:
                    logger.debug(
                        "activity tracking failed for %s", record.email, exc_info=True
                    )
    except Exception:
        logger.exception("user_provision_failed email=%s", identity.email)
        if identity.email in owners:
            role = "owner"
        elif identity.email in bootstrap:
            role = "admin"
        else:
            role = "standard"
        return _ephemeral_bootstrap(
            identity.email, identity.display_name, role, f"{identity.source}:db-error"
        )

    if record is None:
        return _ephemeral_bootstrap(
            identity.email,
            identity.display_name,
            "standard",
            f"{identity.source}:not-provisioned",
        )

    resolved = ResolvedUser(
        email=record.email,
        display_name=record.display_name or identity.display_name,
        role=record.role,
        source=identity.source,
        ephemeral=record.ephemeral,
    )
    _user_cache[cache_key] = (time.monotonic(), resolved)
    return resolved


def redact_jwt(value: str) -> str:
    if not value:
        return ""
    digest = hashlib.sha256(value.encode("utf-8")).hexdigest()[:8]
    return f"<jwt: {len(value)} chars, sha-prefix {digest}>"


def collect_proxy_headers(request: Request) -> dict[str, str]:
    out: dict[str, str] = {}
    for hdr in (*EMAIL_HEADERS, *NAME_HEADERS, *JWT_HEADERS):
        val = request.headers.get(hdr)
        if not val:
            continue
        if hdr in JWT_HEADERS:
            out[hdr] = redact_jwt(val)
        else:
            out[hdr] = val
    return out


def build_whoami(request: Request, user: ResolvedUser) -> dict:
    settings = get_settings()
    identity = extract_identity(request)
    db = getattr(request.app.state, "db", None)
    db_configured = db is not None
    return {
        "user": user.to_dict(),
        "identity": {
            "email": identity.email if identity else "",
            "displayName": identity.display_name if identity else "",
            "source": identity.source if identity else "",
        },
        "config": {
            "strict_auth": settings.effective_strict_auth,
            "auto_provision_users": settings.auto_provision_users,
            "bootstrap_admins": settings.bootstrap_admin_emails(),
            "bootstrap_owners": settings.bootstrap_owner_emails(),
            "dev_user_email_when_strict_off": settings.effective_dev_user_email(),
        },
        "proxy_headers_received": collect_proxy_headers(request),
        "db_configured": db_configured,
    }


# ---------------------------------------------------------------------------
# FastAPI dependencies
# ---------------------------------------------------------------------------

def get_current_user(request: Request) -> ResolvedUser:
    user = getattr(request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=500, detail="auth middleware not attached")
    return user


def require_signed_in(user: ResolvedUser = Depends(get_current_user)) -> ResolvedUser:
    if user.is_guest:
        raise HTTPException(
            status_code=401,
            detail={"error": "sign_in_required", "detail": "Authentication required."},
        )
    return user


def require_admin(user: ResolvedUser = Depends(get_current_user)) -> ResolvedUser:
    if user.is_guest:
        raise HTTPException(
            status_code=401,
            detail={"error": "sign_in_required", "detail": "Authentication required."},
        )
    if not user.is_admin:
        raise HTTPException(
            status_code=403,
            detail={"error": "admin_required", "detail": "Admin role required."},
        )
    return user


def require_owner(user: ResolvedUser = Depends(get_current_user)) -> ResolvedUser:
    if user.is_guest:
        raise HTTPException(
            status_code=401,
            detail={"error": "sign_in_required", "detail": "Authentication required."},
        )
    if not user.is_owner:
        raise HTTPException(
            status_code=403,
            detail={"error": "owner_required", "detail": "Owner role required."},
        )
    return user


def require_admin_or_legacy_token(
    request: Request,
    user: ResolvedUser = Depends(get_current_user),
    authorization: Optional[str] = Header(default=None),
    x_signal_password: Optional[str] = Header(default=None, alias="X-Signal-Password"),
) -> ResolvedUser:
    """Accept IDP admin role OR legacy ADMIN_TOKEN (local dev transition)."""
    user = get_current_user(request)
    if user.is_admin:
        return user
    settings = get_settings()
    presented = ""
    if x_signal_password:
        presented = x_signal_password.strip()
    elif authorization and authorization.strip().lower().startswith("bearer "):
        presented = authorization.strip().split(None, 1)[1].strip()
    # Security hardening (QA H4): honor the legacy shared-password admin path
    # only when the token is a real (non-default) value, or we're in dev/local.
    # `legacy_admin_token_active` rejects the shipped default "signal" in
    # production/staging so a non-admin can't self-escalate with a known secret.
    if (
        settings.legacy_admin_token_active
        and presented
        and secrets.compare_digest(presented, settings.admin_token)
    ):
        return ResolvedUser(
            email=user.email or "token-admin@local",
            display_name="Token Admin",
            role="admin",
            source="legacy-admin-token",
            ephemeral=True,
        )
    if user.is_guest:
        raise HTTPException(
            status_code=401,
            detail={"error": "sign_in_required", "detail": "Authentication required."},
        )
    raise HTTPException(
        status_code=403,
        detail={"error": "admin_required", "detail": "Admin role required."},
    )
