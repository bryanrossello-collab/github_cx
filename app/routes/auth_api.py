"""Auth diagnostics and user management API."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.auth import build_whoami, get_current_user, invalidate_user_cache, require_admin, require_signed_in
from app.database import DatabaseUnavailable
from app.users import delete_user, list_directory, list_users, update_user_role, upsert_user

router = APIRouter(prefix="/api", tags=["auth"])


def _db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database not connected")
    return db


class RoleUpdateBody(BaseModel):
    role: Literal["standard", "admin", "owner"]


class ManualUserBody(BaseModel):
    email: str = Field(min_length=3)
    display_name: str = ""
    role: Literal["standard", "admin"] = "standard"


@router.get("/whoami")
async def whoami(request: Request, user=Depends(get_current_user)) -> dict:
    return build_whoami(request, user)


@router.get("/users/directory")
async def users_directory(
    request: Request,
    _user=Depends(require_signed_in),
) -> dict:
    db = _db(request)
    async with db.acquire() as conn:
        users = await list_directory(conn)
    return {"users": users}


@router.get("/users")
async def users_list(
    request: Request,
    _admin=Depends(require_admin),
) -> dict:
    db = _db(request)
    async with db.acquire() as conn:
        rows = await list_users(conn)
    return {
        "users": [
            {
                "email": u.email,
                "displayName": u.display_name,
                "role": u.role,
                "createdAt": u.created_at.isoformat() if u.created_at else None,
                "updatedAt": u.updated_at.isoformat() if u.updated_at else None,
                "lastSeenAt": u.last_seen_at.isoformat() if u.last_seen_at else None,
            }
            for u in rows
        ]
    }


@router.get("/users/usage")
async def users_usage(
    request: Request,
    _admin=Depends(require_admin),
) -> dict:
    """Overall usage rollup from user_activity_daily (sampled at the ~45s
    login-cache granularity, so `hits` is an approximate activity count)."""
    db = _db(request)
    async with db.acquire() as conn:
        daily_rows = await conn.fetch(
            "SELECT day, COUNT(DISTINCT email) AS users, COALESCE(SUM(hits), 0) AS hits "
            "FROM user_activity_daily "
            "WHERE day >= CURRENT_DATE - INTERVAL '29 days' "
            "GROUP BY day ORDER BY day ASC"
        )
        active_7d = await conn.fetchval(
            "SELECT COUNT(DISTINCT email) FROM user_activity_daily "
            "WHERE day >= CURRENT_DATE - 6"
        )
        active_30d = await conn.fetchval(
            "SELECT COUNT(DISTINCT email) FROM user_activity_daily "
            "WHERE day >= CURRENT_DATE - 29"
        )
        top_rows = await conn.fetch(
            "SELECT a.email, "
            "       COALESCE(SUM(a.hits), 0) AS hits30d, "
            "       MAX(a.last_seen_at) AS last_seen_at, "
            "       u.display_name AS display_name, u.role AS role "
            "FROM user_activity_daily a "
            "LEFT JOIN users u ON u.email = a.email "
            "WHERE a.day >= CURRENT_DATE - 29 "
            "GROUP BY a.email, u.display_name, u.role "
            "ORDER BY hits30d DESC, last_seen_at DESC NULLS LAST "
            "LIMIT 20"
        )
    return {
        "ok": True,
        "daily": [
            {
                "day": r["day"].isoformat() if r["day"] else None,
                "users": int(r["users"] or 0),
                "hits": int(r["hits"] or 0),
            }
            for r in daily_rows
        ],
        "active_7d": int(active_7d or 0),
        "active_30d": int(active_30d or 0),
        "top_users": [
            {
                "email": r["email"],
                "displayName": r["display_name"] or "",
                "role": r["role"] or "",
                "lastSeenAt": r["last_seen_at"].isoformat() if r["last_seen_at"] else None,
                "hits30d": int(r["hits30d"] or 0),
            }
            for r in top_rows
        ],
    }


@router.post("/users")
async def users_create(
    body: ManualUserBody,
    request: Request,
    admin=Depends(require_admin),
) -> dict:
    """Manually add a user before their first SSO sign-in."""
    email = body.email.strip().lower()
    if "@" not in email:
        raise HTTPException(status_code=400, detail={"error": "invalid_email"})
    db = _db(request)
    async with db.acquire() as conn:
        user = await upsert_user(
            conn,
            email=email,
            display_name=body.display_name.strip(),
            role=body.role,
        )
    invalidate_user_cache(email)
    return {
        "ok": True,
        "user": {
            "email": user.email,
            "displayName": user.display_name,
            "role": user.role,
        },
    }


@router.put("/users/{email}/role")
async def users_update_role(
    email: str,
    body: RoleUpdateBody,
    request: Request,
    admin=Depends(require_admin),
) -> dict:
    target = email.strip().lower()
    # Only an OWNER may grant the owner role (privilege-escalation guard).
    # Admins can still promote/demote between standard and admin.
    if body.role == "owner" and admin.role != "owner":
        raise HTTPException(
            status_code=403,
            detail={
                "error": "owner_required",
                "detail": "Only an owner can promote a user to owner.",
            },
        )
    db = _db(request)
    async with db.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT role FROM users WHERE email = $1", target
        )
        if existing is None:
            raise HTTPException(status_code=404, detail={"error": "not_found"})
        # An existing owner's role can't be changed via the UI (prevents
        # accidentally removing the last owner). Promoting a NON-owner up to
        # owner is allowed above for owner callers.
        if existing["role"] == "owner":
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "cannot_change_owner",
                    "detail": "An existing owner's role can't be changed here.",
                },
            )
        if admin.email.lower() == target:
            if admin.role == "owner" and body.role != "owner":
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "cannot_self_demote",
                        "detail": "Owners can't demote themselves.",
                    },
                )
            if admin.role == "admin" and body.role != "admin":
                raise HTTPException(
                    status_code=400,
                    detail={
                        "error": "cannot_self_demote",
                        "detail": "Admins can't demote themselves.",
                    },
                )
        updated = await update_user_role(conn, target, body.role)
    invalidate_user_cache(target)
    if updated is None:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {
        "ok": True,
        "user": {
            "email": updated.email,
            "displayName": updated.display_name,
            "role": updated.role,
        },
    }


@router.delete("/users/{email}")
async def users_delete(
    email: str,
    request: Request,
    admin=Depends(require_admin),
) -> dict:
    target = email.strip().lower()
    if admin.email.lower() == target:
        raise HTTPException(
            status_code=400,
            detail={
                "error": "cannot_self_delete",
                "detail": "Admins can't delete themselves.",
            },
        )
    db = _db(request)
    async with db.acquire() as conn:
        existing = await conn.fetchrow(
            "SELECT role FROM users WHERE email = $1", target
        )
        if existing is None:
            raise HTTPException(status_code=404, detail={"error": "not_found"})
        if existing["role"] == "owner":
            raise HTTPException(
                status_code=400,
                detail={
                    "error": "cannot_delete_owner",
                    "detail": "Owner accounts cannot be removed via the UI.",
                },
            )
        deleted = await delete_user(conn, target)
    invalidate_user_cache(target)
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"ok": True}
