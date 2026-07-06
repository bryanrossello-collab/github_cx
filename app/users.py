"""User persistence — auto-provision, bootstrap re-promotion, admin CRUD."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Optional

import asyncpg


@dataclass
class UserRecord:
    email: str
    display_name: str
    role: str  # 'standard' | 'admin' | 'owner'
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None
    ephemeral: bool = False
    source: str = "database"


def _row_to_user(row: asyncpg.Record, *, source: str = "database") -> UserRecord:
    return UserRecord(
        email=row["email"],
        display_name=row["display_name"] or "",
        role=row["role"],
        created_at=row.get("created_at"),
        updated_at=row.get("updated_at"),
        ephemeral=False,
        source=source,
    )


async def get_user(conn: asyncpg.Connection, email: str) -> Optional[UserRecord]:
    row = await conn.fetchrow(
        "SELECT email, display_name, role, created_at, updated_at "
        "FROM users WHERE email = $1",
        email.lower(),
    )
    return _row_to_user(row) if row else None


async def list_users(conn: asyncpg.Connection) -> list[UserRecord]:
    rows = await conn.fetch(
        "SELECT email, display_name, role, created_at, updated_at "
        "FROM users ORDER BY email"
    )
    return [_row_to_user(r) for r in rows]


async def list_directory(conn: asyncpg.Connection) -> list[dict]:
    rows = await conn.fetch(
        "SELECT email, display_name, role FROM users ORDER BY email"
    )
    return [
        {"email": r["email"], "displayName": r["display_name"] or "", "role": r["role"]}
        for r in rows
    ]


async def upsert_user(
    conn: asyncpg.Connection,
    *,
    email: str,
    display_name: str = "",
    role: str = "standard",
) -> UserRecord:
    row = await conn.fetchrow(
        """
        INSERT INTO users (email, display_name, role, updated_at)
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT (email) DO UPDATE SET
            display_name = CASE
                WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name
                ELSE users.display_name
            END,
            role = EXCLUDED.role,
            updated_at = NOW()
        RETURNING email, display_name, role, created_at, updated_at
        """,
        email.lower(),
        display_name,
        role,
    )
    return _row_to_user(row, source="database")


async def ensure_bootstrap_owner(conn: asyncpg.Connection, email: str) -> UserRecord:
    """Re-promote a bootstrap owner if they were demoted in SQL."""
    row = await conn.fetchrow(
        """
        UPDATE users SET role = 'owner', updated_at = NOW()
        WHERE email = $1 AND role <> 'owner'
        RETURNING email, display_name, role, created_at, updated_at
        """,
        email.lower(),
    )
    if row:
        return _row_to_user(row, source="bootstrap-repromote-owner")
    existing = await get_user(conn, email)
    if existing:
        return existing
    return await upsert_user(conn, email=email, role="owner")


async def seed_bootstrap_owners(
    conn: asyncpg.Connection,
    profiles: list[tuple[str, str]],
) -> int:
    """Upsert bootstrap owners with role=owner. Runs on every boot."""
    count = 0
    for email, display_name in profiles:
        await conn.execute(
            """
            INSERT INTO users (email, display_name, role, updated_at)
            VALUES ($1, $2, 'owner', NOW())
            ON CONFLICT (email) DO UPDATE SET
                display_name = CASE
                    WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name
                    ELSE users.display_name
                END,
                role = 'owner',
                updated_at = NOW()
            """,
            email.lower(),
            display_name,
        )
        count += 1
    return count


async def ensure_bootstrap_admin(conn: asyncpg.Connection, email: str) -> UserRecord:
    """Re-promote a bootstrap admin if they were demoted in SQL."""
    row = await conn.fetchrow(
        """
        UPDATE users SET role = 'admin', updated_at = NOW()
        WHERE email = $1 AND role <> 'admin'
        RETURNING email, display_name, role, created_at, updated_at
        """,
        email.lower(),
    )
    if row:
        return _row_to_user(row, source="bootstrap-repromote")
    existing = await get_user(conn, email)
    if existing:
        return existing
    return await upsert_user(conn, email=email, role="admin")


async def update_user_role(
    conn: asyncpg.Connection, email: str, role: str
) -> Optional[UserRecord]:
    row = await conn.fetchrow(
        """
        UPDATE users SET role = $2, updated_at = NOW()
        WHERE email = $1
        RETURNING email, display_name, role, created_at, updated_at
        """,
        email.lower(),
        role,
    )
    return _row_to_user(row) if row else None


async def delete_user(conn: asyncpg.Connection, email: str) -> bool:
    result = await conn.execute(
        "DELETE FROM users WHERE email = $1",
        email.lower(),
    )
    return result.endswith("1")


async def seed_bootstrap_admins(
    conn: asyncpg.Connection,
    profiles: list[tuple[str, str]],
) -> int:
    """Upsert bootstrap admins with role=admin. Runs on every boot."""
    count = 0
    for email, display_name in profiles:
        await conn.execute(
            """
            INSERT INTO users (email, display_name, role, updated_at)
            VALUES ($1, $2, 'admin', NOW())
            ON CONFLICT (email) DO UPDATE SET
                display_name = CASE
                    WHEN EXCLUDED.display_name <> '' THEN EXCLUDED.display_name
                    ELSE users.display_name
                END,
                role = CASE
                    WHEN users.role = 'owner' THEN 'owner'
                    ELSE 'admin'
                END,
                updated_at = NOW()
            """,
            email.lower(),
            display_name,
        )
        count += 1
    return count


async def provision_from_identity(
    conn: asyncpg.Connection,
    *,
    email: str,
    display_name: str,
    bootstrap_emails: set[str],
    owner_emails: set[str],
    auto_provision: bool,
) -> Optional[UserRecord]:
    """Load or create a user row for an authenticated identity."""
    normalized = email.lower()
    existing = await get_user(conn, normalized)
    if existing:
        if normalized in owner_emails and existing.role != "owner":
            return await ensure_bootstrap_owner(conn, normalized)
        if normalized in bootstrap_emails and existing.role not in ("admin", "owner"):
            return await ensure_bootstrap_admin(conn, normalized)
        return existing
    if not auto_provision:
        return None
    if normalized in owner_emails:
        role = "owner"
    elif normalized in bootstrap_emails:
        role = "admin"
    else:
        role = "standard"
    return await upsert_user(
        conn, email=normalized, display_name=display_name, role=role
    )
