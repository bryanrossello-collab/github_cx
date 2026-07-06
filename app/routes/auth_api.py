"""Auth diagnostics and user management API."""

from __future__ import annotations

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel, Field

from app.auth import build_whoami, get_current_user, require_admin, require_signed_in
from app.database import DatabaseUnavailable
from app.users import delete_user, list_directory, list_users, update_user_role, upsert_user

router = APIRouter(prefix="/api", tags=["auth"])


def _db(request: Request):
    db = getattr(request.app.state, "db", None)
    if db is None:
        raise DatabaseUnavailable("database not connected")
    return db


class RoleUpdateBody(BaseModel):
    role: Literal["standard", "admin"]


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
            }
            for u in rows
        ]
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
                    "error": "cannot_change_owner",
                    "detail": "Owner role is managed via BOOTSTRAP_OWNERS only.",
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
    if not deleted:
        raise HTTPException(status_code=404, detail={"error": "not_found"})
    return {"ok": True}
