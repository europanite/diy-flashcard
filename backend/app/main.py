"""Optional paid-tier starter API (single-tenant development implementation).

Not connected to the free local-first frontend. For multi-user production use,
replace the API-key demo auth with user identities, billing entitlements and
isolated storage before exposing publicly.
"""
from __future__ import annotations

import hmac
import json
import os
import sqlite3
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException, Response
from pydantic import BaseModel, ConfigDict, Field

APP = FastAPI(title="You FrashCard API", version="0.1.0", description="Optional subscription backend (development only)")
LOCK = threading.Lock()


class Deck(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1)
    name: str = Field(min_length=1)
    updatedAt: str


class Card(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1)
    deckId: str = Field(min_length=1)
    front: str
    back: str
    dueAt: str
    updatedAt: str
    intervalDays: float = Field(ge=0)
    ease: float = Field(ge=1)


class Review(BaseModel):
    model_config = ConfigDict(extra="allow")
    id: str = Field(min_length=1)
    cardId: str = Field(min_length=1)
    grade: int = Field(ge=0, le=3)
    reviewedAt: str
    intervalDays: float = Field(ge=0)


class Snapshot(BaseModel):
    model_config = ConfigDict(extra="allow")
    schemaVersion: int = Field(default=1, ge=1, le=1)
    updatedAt: str
    decks: list[Deck] = Field(default_factory=list, max_length=100_000)
    cards: list[Card] = Field(default_factory=list, max_length=100_000)
    reviews: list[Review] = Field(default_factory=list, max_length=1_000_000)


def db_path() -> Path:
    return Path(os.environ.get("DATABASE_PATH", "/data/service.sqlite3"))


def connection() -> sqlite3.Connection:
    path = db_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(path, timeout=10)
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("""CREATE TABLE IF NOT EXISTS snapshots (
        subject TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        data TEXT NOT NULL
    )""")
    return conn


def authenticate(x_api_key: str | None = Header(default=None)) -> str:
    configured_key = os.getenv("API_KEY", "")
    if not configured_key:
        raise HTTPException(503, detail="Server API key is not configured")
    if not x_api_key or not hmac.compare_digest(configured_key, x_api_key):
        raise HTTPException(401, detail="Unauthorized")
    # Single tenant. Replace with verified subject/user ID before billing launch.
    return "dev-tenant"


def fresh_snapshot() -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "updatedAt": datetime.now(timezone.utc).isoformat(),
        "decks": [], "cards": [], "reviews": [],
    }


@APP.get("/healthz")
def health() -> dict[str, str]:
    return {"status": "ok"}


@APP.get("/v1/snapshot", response_model=Snapshot)
def get_snapshot(response: Response, subject: str = Depends(authenticate)) -> dict[str, Any]:
    with connection() as db:
        row = db.execute("SELECT revision, data FROM snapshots WHERE subject=?", (subject,)).fetchone()
    response.headers["ETag"] = f'"{row[0] if row else 0}"'
    return json.loads(row[1]) if row else fresh_snapshot()


@APP.put("/v1/snapshot", response_model=Snapshot)
def put_snapshot(data: Snapshot, response: Response, if_match: str | None = Header(default=None), subject: str = Depends(authenticate)) -> Snapshot:
    if not if_match or not if_match.startswith('"') or not if_match.endswith('"'):
        raise HTTPException(428, detail='If-Match: "<revision>" is required')
    try:
        requested_revision = int(if_match[1:-1])
    except ValueError as exc:
        raise HTTPException(400, detail="Malformed revision") from exc
    if requested_revision < 0:
        raise HTTPException(400, detail="Malformed revision")
    ids = [item.id for item in [*data.decks, *data.cards, *data.reviews]]
    if len(ids) != len(set(ids)):
        raise HTTPException(422, detail="Duplicate entity ID")
    with LOCK, connection() as db:
        db.execute("BEGIN IMMEDIATE")
        row = db.execute("SELECT revision FROM snapshots WHERE subject=?", (subject,)).fetchone()
        current = row[0] if row else 0
        if current != requested_revision:
            db.rollback()
            raise HTTPException(409, detail="Snapshot revision conflict. Fetch and merge before retrying.")
        db.execute("""INSERT INTO snapshots(subject,revision,data) VALUES(?,?,?)
            ON CONFLICT(subject) DO UPDATE SET revision=excluded.revision, data=excluded.data""",
            (subject, current + 1, data.model_dump_json()))
        db.commit()
    response.headers["ETag"] = f'"{current + 1}"'
    return data


@APP.get("/v1/summary")
def get_summary(subject: str = Depends(authenticate)) -> dict[str, int]:
    with connection() as db:
        row = db.execute("SELECT data FROM snapshots WHERE subject=?", (subject,)).fetchone()
    data = json.loads(row[0]) if row else fresh_snapshot()
    live_decks = {d["id"] for d in data["decks"] if not d.get("deletedAt")}
    cards = [c for c in data["cards"] if not c.get("deletedAt") and c["deckId"] in live_decks]
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    return {"decks": len(live_decks), "cards": len(cards), "due": sum(c["dueAt"] <= now for c in cards), "reviews": len(data["reviews"])}


app = APP
