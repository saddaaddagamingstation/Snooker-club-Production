import asyncio
import time
import secrets
import hashlib
import smtplib
from email.message import EmailMessage
from urllib.parse import quote
from pymongo.errors import DuplicateKeyError
from dotenv import load_dotenv
from pathlib import Path
from collections import defaultdict, deque
from typing import Literal
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import math
import secrets
from datetime import date, datetime, timezone, timedelta
from zoneinfo import ZoneInfo
import calendar
from typing import List, Optional, Dict

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Query, WebSocket, WebSocketDisconnect
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
from pydantic import BaseModel, Field, EmailStr

# ---- DB ----
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

JWT_SECRET = os.environ['JWT_SECRET']
JWT_ALG = "HS256"
CLUB_NAME = os.environ.get('CLUB_NAME', 'Sadda Adda Snooker')
try:
    CLUB_TIMEZONE = ZoneInfo(os.environ.get('CLUB_TIMEZONE', 'Asia/Kolkata'))
except Exception:
    CLUB_TIMEZONE = ZoneInfo('Asia/Kolkata')

app = FastAPI(title="Sadda Adda Snooker API")
api = APIRouter(prefix="/api")
security = HTTPBearer(auto_error=False)

import logging
import time

logger = logging.getLogger("api_timing")

async def ensure_performance_indexes():
    await db.sessions.create_index(
        [("status", 1), ("start_time", 1)],
        name="idx_sessions_status_start_time",
    )

@app.middleware("http")
async def log_request_duration(request, call_next):
    start = time.perf_counter()

    response = await call_next(request)

    elapsed_ms = (time.perf_counter() - start) * 1000

    logger.info(
        "API_TIMING method=%s path=%s status=%s duration_ms=%.2f",
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
    )

    return response




# ---- Helpers ----
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False


def validate_password_strength(password: str):
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters long")
    if not any(char.isalpha() for char in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one letter")
    if not any(char.isdigit() for char in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one number")
    if not any(not char.isalnum() for char in password):
        raise HTTPException(status_code=400, detail="Password must contain at least one symbol")


def _send_password_reset_email_sync(recipient: str, reset_url: str):
    smtp_host = os.environ.get("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER")
    smtp_password = os.environ.get("SMTP_PASSWORD")
    sender = os.environ.get("SMTP_FROM") or smtp_user

    if not smtp_user or not smtp_password or not sender:
        raise RuntimeError("SMTP_USER, SMTP_PASSWORD, and SMTP_FROM must be configured")

    message = EmailMessage()
    message["Subject"] = "Reset your Sadda Adda Snooker password"
    message["From"] = sender
    message["To"] = recipient
    message.set_content(
        "We received a request to reset your Sadda Adda Snooker password.\\n\\n"
        f"Use this link within 1 hour: {reset_url}\\n\\n"
        "If you did not request this, you can ignore this email."
    )
    message.add_alternative(
        f"""<!doctype html>
<html><body style="font-family:Arial,sans-serif;color:#222;line-height:1.6">
  <h2>Password reset request</h2>
  <p>We received a request to reset your Sadda Adda Snooker password.</p>
  <p><a href="{reset_url}" style="display:inline-block;padding:12px 18px;background:#171717;color:#fff;text-decoration:none;border-radius:6px">Reset password</a></p>
  <p>This link expires in 1 hour. If you did not request this, you can ignore this email.</p>
</body></html>""",
        subtype="html",
    )

    with smtplib.SMTP(smtp_host, smtp_port, timeout=20) as server:
        server.ehlo()
        server.starttls()
        server.ehlo()
        server.login(smtp_user, smtp_password)
        server.send_message(message)


async def send_password_reset_email(recipient: str, reset_url: str):
    await asyncio.to_thread(_send_password_reset_email_sync, recipient, reset_url)

def create_token(user_id: str, email: str, role: str, days: int = 7) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=days),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def now_utc():
    return datetime.now(timezone.utc)

def local_now():
    return now_utc().astimezone(CLUB_TIMEZONE)


def local_day_range(day=None):
    day = day or local_now().date()

    start_local = datetime.combine(
        day,
        datetime.min.time(),
        tzinfo=CLUB_TIMEZONE
    )

    end_local = start_local + timedelta(days=1)

    return (
        start_local.astimezone(timezone.utc),
        end_local.astimezone(timezone.utc)
    )

def iso(dt: datetime) -> str:
    return dt.isoformat()


# ---- Game timer billing (PS5 intentionally does not use this system) ----
DEFAULT_GAME_PRICING = {
    "snooker": {"players": {"2": 170, "3": 170, "4": 180, "5": 220, "6": 260}, "extra_minute": 5},
    "mini_snooker": {"players": {"2": 110, "3": 120, "4": 130, "5": 140, "6": 150}, "extra_minute": 5},
    "pool": {"package_30": 130, "package_60": 250},
    "ps5": {"hourly_rate": None, "players": {"1": 129, "2": 199, "3": 299, "4": 369}},
    "rd_price": 20,
}

async def _get_game_pricing():
    saved = await db.settings.find_one({"key": "game_pricing"}, {"_id": 0})
    value = (saved or {}).get("value") or {}
    # Merge defaults so newly introduced fields remain available on older configs.
    result = {**DEFAULT_GAME_PRICING, **value}
    for game in ("snooker", "mini_snooker"):
        result[game] = {**DEFAULT_GAME_PRICING[game], **(value.get(game) or {})}
        result[game]["players"] = {**DEFAULT_GAME_PRICING[game]["players"], **(value.get(game, {}).get("players") or {})}
    for game in ("pool", "ps5"):
        result[game] = {**DEFAULT_GAME_PRICING[game], **(value.get(game) or {})}
    return result


def _game_type(session_or_table):
    # Preserve unknown/separate game identifiers (including PS5) rather than
    # accidentally routing them through the regular-table timer billing.
    return (session_or_table or {}).get("game_type") or "snooker"


def _fixed_block_price(game_type: str, player_count: int, duration_minutes: int, pricing=None) -> float:
    pricing = pricing or DEFAULT_GAME_PRICING
    if game_type == "pool":
        if duration_minutes == 30:
            return float(pricing["pool"]["package_30"])
        if duration_minutes == 60:
            return float(pricing["pool"]["package_60"])
        raise HTTPException(status_code=400, detail="Pool packages are 30 or 60 minutes")
    rates = pricing.get(game_type, {}).get("players", {})
    base = rates.get(str(player_count), rates.get(player_count))
    if base is None:
        raise HTTPException(status_code=400, detail="Choose a valid player count")
    if game_type == "ps5":
        # PS5 player rates are hourly prices; fixed blocks are prorated by duration.
        return round(float(base) * int(duration_minutes) / 60.0, 2)
    extra_rate = float(pricing.get(game_type, {}).get("extra_minute", 5))
    return float(base) + max(0, duration_minutes - 30) * extra_rate


def _dt_seconds_since(value, now):
    if not value:
        return 0.0
    try:
        start = datetime.fromisoformat(value)
        return max(0.0, (now - start).total_seconds())
    except (TypeError, ValueError):
        return 0.0


def _game_timer_played_seconds(session, now=None):
    now = now or now_utc()
    total = 0.0
    for segment in session.get("game_billing_segments", []):
        if segment.get("kind") == "fixed":
            played = float(segment.get("played_seconds", 0))
            if segment.get("started_at") and not session.get("is_paused"):
                played += _dt_seconds_since(segment.get("started_at"), now)
            total += played
        elif segment.get("kind") == "countup":
            total += float(segment.get("elapsed_seconds", 0))
            if segment.get("started_at") and not session.get("is_paused"):
                total += _dt_seconds_since(segment.get("started_at"), now)
    return max(0, int(total))


def _game_timer_amount(session, now=None):
    now = now or now_utc()
    total = sum(
        float(seg.get("amount", 0))
        for seg in session.get("game_billing_segments", [])
        if seg.get("kind") == "fixed"
    )
    for seg in session.get("game_billing_segments", []):
        if seg.get("kind") == "countup":
            seconds = float(seg.get("elapsed_seconds", 0))
            if seg.get("started_at") and not session.get("is_paused"):
                seconds += _dt_seconds_since(seg.get("started_at"), now)
            total += ((int(seconds) + 59) // 60) * float(seg.get("rate_per_minute", 5))
    return round(total + float(session.get("rd_amount", 0)), 2)


def _pause_game_timer(session, now):
    updates = {}
    segments = list(session.get("game_billing_segments", []))
    mode = session.get("timer_mode")
    if mode == "countdown" and session.get("timer_started_at"):
        elapsed = _dt_seconds_since(session.get("timer_started_at"), now)
        remaining = max(0, int(float(session.get("timer_remaining_seconds", 0)) - elapsed))
        if segments and segments[-1].get("kind") == "fixed" and segments[-1].get("started_at"):
            segments[-1]["played_seconds"] = float(segments[-1].get("played_seconds", 0)) + min(elapsed, float(session.get("timer_remaining_seconds", 0)))
            segments[-1]["started_at"] = None
        updates.update({"timer_remaining_seconds": remaining, "timer_started_at": None})
    elif mode == "countup" and segments and segments[-1].get("kind") == "countup" and segments[-1].get("started_at"):
        segments[-1]["elapsed_seconds"] = float(segments[-1].get("elapsed_seconds", 0)) + _dt_seconds_since(segments[-1]["started_at"], now)
        segments[-1]["started_at"] = None
        updates["timer_started_at"] = None
    if segments:
        updates["game_billing_segments"] = segments
    return updates


def _resume_game_timer(session, now):
    updates = {}
    segments = list(session.get("game_billing_segments", []))
    if session.get("timer_mode") == "countdown" and int(session.get("timer_remaining_seconds", 0)) > 0:
        updates["timer_started_at"] = iso(now)
        if segments and segments[-1].get("kind") == "fixed":
            segments[-1]["started_at"] = iso(now)
    elif session.get("timer_mode") == "countup" and segments and segments[-1].get("kind") == "countup":
        segments[-1]["started_at"] = iso(now)
        updates["timer_started_at"] = iso(now)
    if segments:
        updates["game_billing_segments"] = segments
    return updates


async def _sync_game_timer(session, now=None):
    """Persist countdown expiry so the server, not the browser, decides when play time ends."""
    if not session or not session.get("game_timer_enabled"):
        return session
    now = now or now_utc()
    if session.get("timer_mode") == "countdown" and not session.get("is_paused") and session.get("timer_started_at"):
        elapsed = _dt_seconds_since(session.get("timer_started_at"), now)
        remaining = max(0, int(float(session.get("timer_remaining_seconds", 0)) - elapsed))
        if remaining <= 0:
            segments = list(session.get("game_billing_segments", []))
            if segments and segments[-1].get("kind") == "fixed":
                seg = segments[-1]
                seg["played_seconds"] = float(seg.get("played_seconds", 0)) + float(session.get("timer_remaining_seconds", 0))
                seg["started_at"] = None
                seg["status"] = "completed"
            updates = {
                "timer_mode": "awaiting_decision",
                "timer_remaining_seconds": 0,
                "timer_started_at": None,
                "timer_expired_at": iso(now),
                "game_billing_segments": segments,
            }
            await db.sessions.update_one({"id": session["id"], "status": "active"}, {"$set": updates})
            session.update(updates)
        # Keep the persisted remaining value paired with the original timer_started_at.
        # The client and server both derive the live remainder from that same anchor.
    return session


def _new_fixed_segment(game_type, player_count, duration_minutes, now, pricing=None):
    pricing = pricing or DEFAULT_GAME_PRICING
    amount = _fixed_block_price(game_type, player_count, duration_minutes, pricing)
    return {
        "id": str(uuid.uuid4()),
        "kind": "fixed",
        "duration_minutes": int(duration_minutes),
        "duration_seconds": int(duration_minutes) * 60,
        "played_seconds": 0,
        "amount": amount,
        "rate_per_minute": float(pricing.get(game_type, {}).get("extra_minute", 5)),
        "started_at": iso(now),
        "status": "active",
    }

# ---- Models ----
class GamePricingUpdate(BaseModel):
    pricing: Dict

class LoginReq(BaseModel):
    email: EmailStr
    password: str

class ForgotReq(BaseModel):
    email: EmailStr

class ResetReq(BaseModel):
    token: str
    password: str

class TableIn(BaseModel):
    table_number: str
    table_name: str
    table_size: Literal["large", "small"] = "large"
    hourly_rate: float = 0
    status: str = "available"  # available | running | reserved | maintenance

class PS5StationIn(BaseModel):
    table_number: str
    table_name: str
    status: Literal["available", "maintenance"] = "available"

class PS5BookingCreate(BaseModel):
    customer_name: str
    phone: Optional[str] = ""
    table_id: Optional[str] = None
    start_at: str
    end_at: str
    player_count: int = Field(ge=1, le=4)
    membership_id: Optional[str] = None
    notes: Optional[str] = ""

class TableUpdate(BaseModel):
    table_number: Optional[str] = None
    table_name: Optional[str] = None
    hourly_rate: Optional[float] = None
    status: Optional[str] = None
    table_size: Optional[Literal["large", "small"]] = None

class SnackIn(BaseModel):
    name: str
    category: str
    price: float
    stock_quantity: int = 0
    image_url: Optional[str] = None

class SnackUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = None
    stock_quantity: Optional[int] = None
    image_url: Optional[str] = None

class CategoryIn(BaseModel):
    name: str

class SessionStart(BaseModel):
    table_id: str
    customer_name: Optional[str] = ""
    notes: Optional[str] = ""
    billing_type: Literal["normal", "membership"] = "normal"
    membership_id: Optional[str] = None
    booking_id: Optional[str] = None
    player_count: Optional[int] = Field(default=2, ge=1, le=6)
    rd_selected: bool = False
    duration_minutes: Optional[int] = Field(default=30, ge=1, le=1440)
    game_type: Optional[Literal["snooker", "mini_snooker", "pool", "ps5"]] = None

class TimerExtend(BaseModel):
    duration_minutes: int = Field(ge=1, le=1440)

class MembershipCreate(BaseModel):
    member_name: str
    phone: Optional[str] = ""
    plan: Literal["bronze", "silver", "gold", "platinum"]

class MembershipPackageIn(BaseModel):
    name: str
    price: float = Field(ge=0)
    total_hours: int = Field(gt=0)
    daily_minutes: int = Field(default=120, gt=0)
    validity_days: int = Field(default=30, gt=0)
    description: Optional[str] = ""
    is_active: bool = True

class ManagedMemberIn(BaseModel):
    member_name: str
    phone: str
    package_id: str
    payment_method: Literal["cash", "upi", "card", "bank", "credit"] = "cash"

class ManagedMemberUpdate(BaseModel):
    member_name: Optional[str] = None
    phone: Optional[str] = None
    package_id: Optional[str] = None
    status: Optional[Literal["active", "inactive"]] = None

class SnackOrderItem(BaseModel):
    snack_id: str
    quantity: int

class FoodOrderCreate(BaseModel):
    customer_name: Optional[str] = ""
    items: List[SnackOrderItem]
    discount: float = 0
    payment_method: Optional[str] = None

class FoodOrderAttach(BaseModel):
    table_id: str
    game_type: Optional[Literal["snooker", "mini_snooker", "pool"]] = None
    player_count: Optional[int] = Field(default=2, ge=2, le=6)
    rd_selected: bool = False
    duration_minutes: Optional[int] = Field(default=30, ge=1, le=1440)

class FreezeSnapshot(BaseModel):
    end_time: str
    duration_seconds: Optional[int] = None
    duration_minutes: int
    table_amount: float
    snacks_amount: Optional[float] = None
    grand_total_exact: Optional[float] = None
    grand_total: Optional[int] = None

class SessionEnd(BaseModel):
    discount: float = 0.0
    tax_percent: float = 0.0
    payment_method: str = "cash"
    payment_notes: Optional[str] = ""
    payments: Optional[List[dict]] = None
    freeze_snapshot: Optional[FreezeSnapshot] = None
    automatic_end: bool = False


# ---- Expense Categories ----

DEFAULT_EXPENSE_CATEGORIES = [
    {
        "name": "Fixed Expenses",
        "subcategories": [
            "Rent",
            "Salary",
            "Electricity",
            "Water",
            "Internet",
            "Security",
            "Insurance",
            "Software",
        ],
    },
    {
        "name": "Equipment",
        "subcategories": [
            "Cloth",
            "Cushion",
            "Cue Repair",
            "Cue Tips",
            "Balls",
            "Chalk",
            "Pocket Repair",
            "Lighting",
        ],
    },
    {
        "name": "Food & Beverage Purchases",
        "subcategories": [
            "Snacks",
            "Beverages",
            "Kitchen Supplies",
        ],
    },
    {
        "name": "Operations",
        "subcategories": [
            "Cleaning",
            "Consumables",
            "Stationery",
        ],
    },
    {
        "name": "Marketing",
        "subcategories": [
            "Ads",
            "Print",
            "Digital",
            "Events",
        ],
    },
    {
        "name": "Maintenance",
        "subcategories": [
            "Table Service",
            "AC/HVAC",
            "Plumbing",
            "General",
        ],
    },
    {
        "name": "Taxes & Finance",
        "subcategories": [
            "GST",
            "Bank Fees",
            "Interest",
        ],
    },
    {
        "name": "Tournament Expenses",
        "subcategories": [
            "Prize Money",
            "Trophies",
            "Refreshments",
        ],
    },
    {
        "name": "Miscellaneous",
        "subcategories": [
            "Other",
        ],
    },
]

PAYMENT_METHODS = ["cash", "upi", "card", "bank", "credit"]

class ExpenseCategoryCreate(BaseModel):
    name: str


class ExpenseCategoryUpdate(BaseModel):
    name: str


class ExpenseSubcategoryCreate(BaseModel):
    name: str


class ExpenseSubcategoryUpdate(BaseModel):
    name: str

class ExpenseIn(BaseModel):
    date: str  # ISO date
    category: str
    subcategory: Optional[str] = ""
    amount: float
    payment_method: str = "cash"
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = ""
    notes: Optional[str] = ""
    bill_url: Optional[str] = ""
    recurring: bool = False
    recurring_frequency: Optional[str] = None  # monthly | weekly | yearly

class ExpenseUpdate(BaseModel):
    date: Optional[str] = None
    category: Optional[str] = None
    subcategory: Optional[str] = None
    amount: Optional[float] = None
    payment_method: Optional[str] = None
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = None
    notes: Optional[str] = None
    bill_url: Optional[str] = None

class VendorIn(BaseModel):
    name: str
    contact: Optional[str] = ""
    phone: Optional[str] = ""
    email: Optional[str] = ""
    address: Optional[str] = ""
    category: Optional[str] = ""
    notes: Optional[str] = ""

class RecurringIn(BaseModel):
    name: str
    category: str
    subcategory: Optional[str] = ""
    amount: float
    payment_method: str = "cash"
    vendor_id: Optional[str] = None
    vendor_name: Optional[str] = ""
    frequency: str = "monthly"  # monthly | weekly | yearly
    day_of_month: int = 1
    active: bool = True
    notes: Optional[str] = ""


# ---- Expense Category Migration ----

async def ensure_expense_categories():
    existing = await db.expense_categories.find(
        {},
        {"_id": 0}
    ).to_list(1000)

    now = iso(now_utc())

    # If categories already exist in the NEW structure,
    # don't recreate them.
    if existing and all(
        "id" in c and
        "name" in c and
        "subcategories" in c
        for c in existing
    ):
        print("Expense categories already migrated. Skipping migration.")
        return

    # Build categories from the default structure.
    category_map = {}

    for index, category in enumerate(
        DEFAULT_EXPENSE_CATEGORIES,
        start=1
    ):
        category_id = str(uuid.uuid4())

        subcategories = []

        for sub_name in category["subcategories"]:
            subcategories.append({
                "id": str(uuid.uuid4()),
                "name": sub_name,
                "active": True,
                "created_at": now,
            })

        category_map[category["name"].lower()] = {
            "id": category_id,
            "name": category["name"],
            "active": True,
            "sort_order": index,
            "subcategories": subcategories,
            "created_at": now,
            "updated_at": now,
        }

    # Convert any OLD category/subcategory records.
    for old in existing:
        old_category = (old.get("category") or "").strip()
        old_subcategory = (old.get("subcategory") or "").strip()

        if not old_category:
            continue

        category_key = old_category.lower()

        # Create custom category if it isn't one
        # of our default categories.
        if category_key not in category_map:
            category_map[category_key] = {
                "id": str(uuid.uuid4()),
                "name": old_category,
                "active": True,
                "sort_order": len(category_map) + 1,
                "subcategories": [],
                "created_at": now,
                "updated_at": now,
            }

        # Preserve old subcategory.
        if old_subcategory:
            existing_subcategories = {
                s["name"].lower()
                for s in category_map[category_key]["subcategories"]
            }

            if old_subcategory.lower() not in existing_subcategories:
                category_map[category_key]["subcategories"].append({
                    "id": str(uuid.uuid4()),
                    "name": old_subcategory,
                    "active": True,
                    "created_at": now,
                })

    categories = list(category_map.values())

    # Rebuild sort order.
    for index, category in enumerate(categories, start=1):
        category["sort_order"] = index

    # Replace old category documents with the
    # new category structure.
    await db.expense_categories.delete_many({})

    if categories:
        await db.expense_categories.insert_many(categories)

    print(
        f"Migrated {len(categories)} expense categories "
        f"to the new structure."
    )

USER_CACHE = {}
USER_CACHE_TTL = 30  # seconds

# ---- Auth dependency ----
async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security)
):
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=401,
            detail="Not authenticated"
        )

    token = credentials.credentials

    try:
        payload = jwt.decode(
            token,
            JWT_SECRET,
            algorithms=[JWT_ALG]
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token expired"
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid token"
        )

    user_id = payload["sub"]
    now = time.monotonic()

    cached = USER_CACHE.get(user_id)

    if cached:
        user, cached_at = cached

        if now - cached_at < USER_CACHE_TTL:
            return user

        USER_CACHE.pop(user_id, None)

    user = await db.users.find_one(
        {"id": user_id},
        {"_id": 0, "password_hash": 0}
    )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User not found"
        )

    USER_CACHE[user_id] = (user, now)

    return user

def require_admin(user=Depends(get_current_user)):
    if user.get("role") != "admin":
        raise HTTPException(status_code=403, detail="Admin only")
    return user

@app.get("/api/diagnostics/mongodb-latency")
async def mongodb_latency(
    current_user=Depends(require_admin)):
    
    """Temporary diagnostic: measure MongoDB round-trip latency."""
    samples = []

    try:
        for _ in range(10):
            start = time.perf_counter()
            await db.command("ping")
            samples.append(round((time.perf_counter() - start) * 1000, 2))

        ordered = sorted(samples)

        return {
            "samples_ms": samples,
            "min_ms": min(samples),
            "max_ms": max(samples),
            "average_ms": round(sum(samples) / len(samples), 2),
            "p95_ms": ordered[min(len(ordered) - 1, 8)],
        }

    except Exception:
        logger.exception("MongoDB latency diagnostic failed")
        raise HTTPException(
            status_code=503,
            detail="MongoDB diagnostic failed. Check Railway logs."
        )


# Default staff permissions
DEFAULT_STAFF_PERMISSIONS = {
    # Read-only access is enabled by default. Every write/manage permission is opt-in.
    "view_dashboard": True,
    "view_tables": True,
    "manage_tables": False,
    "view_ps5": True,
    "manage_ps5": False,
    "view_memberships": True,
    "manage_memberships": False,
    "view_sessions": True,
    "manage_sessions": False,
    "clear_session": False,
    "view_snacks": True,
    "manage_snacks": False,
    "view_food_orders": True,
    "manage_food_orders": False,
    "view_expenses": True,
    "manage_expenses": False,
    "view_revenue": True,
    "view_profit": True,
    "view_reports": True,
    "view_settings": True,
    "manage_users": False,
    "manage_settings": False,
}
ALL_PERMISSIONS = list(DEFAULT_STAFF_PERMISSIONS.keys())

# A manage permission automatically grants its matching view permission.
MANAGE_TO_VIEW = {
    "manage_tables": "view_tables",
    "manage_ps5": "view_ps5",
    "manage_memberships": "view_memberships",
    "manage_sessions": "view_sessions",
    "manage_snacks": "view_snacks",
    "manage_food_orders": "view_food_orders",
    "manage_expenses": "view_expenses",
    "manage_settings": "view_settings",
}

def normalize_permissions(raw):
    raw = raw or {}
    return {key: bool(raw.get(key, DEFAULT_STAFF_PERMISSIONS[key])) for key in ALL_PERMISSIONS}

def has_permission(user: dict, perm: str) -> bool:
    if user.get("role") == "admin":
        return True
    permissions = user.get("permissions") or {}
    if permissions.get(perm, False):
        return True
    return any(view_perm == perm and permissions.get(manage_perm, False)
               for manage_perm, view_perm in MANAGE_TO_VIEW.items())

def require_permission(perm: str):
    def _dep(user=Depends(get_current_user)):
        if not has_permission(user, perm):
            raise HTTPException(status_code=403, detail=f"Permission denied: {perm}")
        return user
    return _dep

# ---- Game pricing settings (admin only) ----
@api.get("/settings/game-pricing")
async def get_game_pricing(user=Depends(require_permission("view_settings"))):
    return await _get_game_pricing()

@api.put("/settings/game-pricing")
async def update_game_pricing(body: GamePricingUpdate, user=Depends(require_permission("manage_settings"))):
    p = body.pricing or {}
    try:
        for game in ("snooker", "mini_snooker"):
            players = p[game]["players"]
            if any(float(players[str(n)]) < 0 for n in range(2, 7)) or float(p[game]["extra_minute"]) < 0:
                raise ValueError()
        if any(float(p["pool"][k]) < 0 for k in ("package_30", "package_60")):
            raise ValueError()
        if (p["ps5"].get("hourly_rate") is not None and float(p["ps5"]["hourly_rate"]) < 0) or float(p["rd_price"]) < 0:
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise HTTPException(status_code=400, detail="Invalid pricing values")
    normalized = {
        "snooker": {"players": {str(n): float(p["snooker"]["players"][str(n)]) for n in range(2, 7)}, "extra_minute": float(p["snooker"]["extra_minute"])},
        "mini_snooker": {"players": {str(n): float(p["mini_snooker"]["players"][str(n)]) for n in range(2, 7)}, "extra_minute": float(p["mini_snooker"]["extra_minute"])},
        "pool": {"package_30": float(p["pool"]["package_30"]), "package_60": float(p["pool"]["package_60"])},
        "ps5": {"hourly_rate": None if p["ps5"].get("hourly_rate") in (None, "") else float(p["ps5"]["hourly_rate"])},
        "rd_price": float(p["rd_price"]),
    }
    await db.settings.update_one({"key": "game_pricing"}, {"$set": {"key": "game_pricing", "value": normalized, "updated_at": iso(now_utc()), "updated_by": user["id"]}}, upsert=True)
    return normalized

LOGIN_ATTEMPTS = defaultdict(deque)

LOGIN_MAX_ATTEMPTS = 5
LOGIN_WINDOW_SECONDS = 15 * 60


def check_login_rate_limit(ip: str):
    now = time.monotonic()
    attempts = LOGIN_ATTEMPTS[ip]

    while attempts and now - attempts[0] > LOGIN_WINDOW_SECONDS:
        attempts.popleft()

    if len(attempts) >= LOGIN_MAX_ATTEMPTS:
        raise HTTPException(
            status_code=429,
            detail="Too many login attempts. Try again in 15 minutes."
        )


def record_failed_login(ip: str):
    LOGIN_ATTEMPTS[ip].append(time.monotonic())


def clear_login_attempts(ip: str):
    LOGIN_ATTEMPTS.pop(ip, None)

# ---- Auth Routes ----
@api.post("/auth/login")
async def login(req: LoginReq, request: Request):
    ip = request.client.host if request.client else "unknown"

    check_login_rate_limit(ip)

    email = req.email.lower()
    user = await db.users.find_one({"email": email})

    if not user or not verify_password(
        req.password,
        user["password_hash"]
    ):
        record_failed_login(ip)
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password"
        )

    clear_login_attempts(ip)

    token = create_token(
        user["id"],
        user["email"],
        user["role"]
    )

    return {
        "access_token": token,
        "user": {
            "id": user["id"],
            "email": user["email"],
            "name": user["name"],
            "role": user["role"],
            "permissions": (
                {p: True for p in ALL_PERMISSIONS}
                if user["role"] == "admin"
                else normalize_permissions(user.get("permissions"))
            ),
        },
    }

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    if user.get("role") == "admin":
        user["permissions"] = {p: True for p in ALL_PERMISSIONS}
    else:
        user["permissions"] = normalize_permissions(user.get("permissions"))
    return user

@api.post("/auth/logout")
async def logout(user=Depends(get_current_user)):
    return {"ok": True}

@api.post("/auth/forgot-password")
async def forgot(req: ForgotReq):
    user = await db.users.find_one({"email": req.email.lower()})
    if user:
        raw_token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(raw_token.encode()).hexdigest()

        # Only the newest outstanding reset link remains valid.
        await db.password_resets.update_many(
            {"user_id": user["id"], "used": False},
            {"$set": {"used": True}}
        )
        await db.password_resets.insert_one({
            "token_hash": token_hash,
            "user_id": user["id"],
            "expires_at": now_utc() + timedelta(hours=1),
            "used": False,
        })

        frontend_url = os.environ.get(
            "FRONTEND_URL",
            "https://snooker-club-production.vercel.app"
        ).rstrip("/")
        reset_url = f"{frontend_url}/reset-password?token={quote(raw_token)}"

        try:
            await send_password_reset_email(user["email"], reset_url)
        except Exception:
            logging.exception("Failed to send password reset email")
            # Keep the response generic so account existence is not disclosed.
            raise HTTPException(
                status_code=503,
                detail="Unable to send the reset email right now. Please try again later."
            )

    return {"ok": True, "message": "If the email exists, a reset link has been sent."}


@api.post("/auth/reset-password")
async def reset(req: ResetReq):
    validate_password_strength(req.password)

    token_hash = hashlib.sha256(req.token.encode()).hexdigest()
    rec = await db.password_resets.find_one_and_update(
        {
            "token_hash": token_hash,
            "used": False,
            "expires_at": {"$gt": now_utc()}
        },
        {"$set": {"used": True}},
        return_document=False
    )

    if not rec:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    result = await db.users.update_one(
        {"id": rec["user_id"]},
        {"$set": {"password_hash": hash_password(req.password)}}
    )
    if result.matched_count == 0:
        raise HTTPException(status_code=400, detail="Invalid or expired token")

    # Invalidate any other outstanding reset links for this account.
    await db.password_resets.update_many(
        {"user_id": rec["user_id"], "used": False},
        {"$set": {"used": True}}
    )

    return {"ok": True, "message": "Password updated successfully"}


# ---- Users (admin) ----
@api.get("/users")
async def list_users(user=Depends(require_admin)):
    users = await db.users.find({}, {"_id": 0, "password_hash": 0}).to_list(1000)
    return users

class UserIn(BaseModel):
    name: str
    email: EmailStr
    password: str
    role: str = "staff"
    permissions: Optional[dict] = None

class PermissionsUpdate(BaseModel):
    permissions: dict

class PasswordResetAdmin(BaseModel):
    password: str

@api.put("/users/{user_id}/password")
async def admin_reset_password(user_id: str, body: PasswordResetAdmin, user=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    validate_password_strength(body.password)
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(body.password)}})
    return {"ok": True, "message": f"Password reset for {target['email']}"}

@api.post("/users")
async def create_user(body: UserIn, user=Depends(require_admin)):
    validate_password_strength(body.password)
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    perms = body.permissions if body.permissions is not None else DEFAULT_STAFF_PERMISSIONS.copy()
    # normalize keys
    perms = normalize_permissions(perms)
    new_user = {
        "id": str(uuid.uuid4()),
        "name": body.name,
        "email": email,
        "password_hash": hash_password(body.password),
        "role": body.role,
        "permissions": perms,
        "created_at": iso(now_utc()),
    }
    await db.users.insert_one(new_user.copy())
    return {k: v for k, v in new_user.items() if k != "password_hash"}

@api.put("/users/{user_id}/permissions")
async def update_permissions(user_id: str, body: PermissionsUpdate, user=Depends(require_admin)):
    target = await db.users.find_one({"id": user_id}, {"_id": 0})
    if not target:
        raise HTTPException(status_code=404, detail="User not found")
    perms = normalize_permissions(body.permissions)
    print("=" * 50)
    print("UPDATING USER:", user_id)
    print("NEW PERMISSIONS:", perms)
    print("=" * 50)
    await db.users.update_one({"id": user_id}, {"$set": {"permissions": perms}})
    USER_CACHE.pop(user_id, None)
    target["permissions"] = perms
    target.pop("password_hash", None)
    return target

@api.get("/permissions/available")
async def available_permissions(user=Depends(require_admin)):
    return {"permissions": ALL_PERMISSIONS, "defaults": DEFAULT_STAFF_PERMISSIONS}

@api.delete("/users/{user_id}")
async def delete_user(user_id: str, user=Depends(require_admin)):
    if user_id == user["id"]:
        raise HTTPException(status_code=400, detail="Cannot delete self")
    res = await db.users.delete_one({"id": user_id})
    return {"deleted": res.deleted_count}

# ---- Tables ----
# ---- PS5 Advance Bookings ----
def _ps5_parse_datetime(value: str) -> datetime:
    try:
        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=CLUB_TIMEZONE)
        return dt.astimezone(timezone.utc)
    except (TypeError, ValueError, AttributeError):
        raise HTTPException(status_code=400, detail="Invalid booking date or time")


async def _ps5_active_session_blocks_booking(table_id: str, booking_start: datetime) -> bool:
    """Return whether an active PS5 session still occupies the station at booking_start.

    Timed sessions release the station 15 minutes after their countdown expires.
    Paused, membership, and untimed sessions remain blocking because their end
    time cannot be predicted safely.
    """
    active_session = await db.sessions.find_one(
        {"table_id": table_id, "status": "active", "game_type": "ps5"},
        {"_id": 0}
    )
    if not active_session:
        return False

    if not active_session.get("game_timer_enabled"):
        return True

    timer_mode = active_session.get("timer_mode")
    if timer_mode == "awaiting_decision":
        expired_at = active_session.get("timer_expired_at")
        if not expired_at:
            timer_started_at = active_session.get("timer_started_at")
            remaining = int(active_session.get("timer_remaining_seconds") or 0)
            if not timer_started_at:
                return True
            expected_end = _ps5_parse_datetime(timer_started_at) + timedelta(seconds=remaining)
        else:
            expected_end = _ps5_parse_datetime(expired_at)
    elif timer_mode == "countdown":
        if active_session.get("is_paused") or not active_session.get("timer_started_at"):
            return True
        timer_started_at = _ps5_parse_datetime(active_session["timer_started_at"])
        remaining = max(0, int(active_session.get("timer_remaining_seconds") or 0))
        expected_end = timer_started_at + timedelta(seconds=remaining)
    else:
        # Do not assume a release time for count-up or unknown timer modes.
        return True

    available_at = expected_end + timedelta(minutes=15)
    return booking_start < available_at


async def _ps5_station_is_available(table_id: str, start: datetime, end: datetime):
    if await _ps5_active_session_blocks_booking(table_id, start):
        return False

    existing = await db.ps5_bookings.find(
        {"table_id": table_id, "status": "confirmed"}, {"_id": 0}
    ).to_list(5000)
    for booking in existing:
        old_start = _ps5_parse_datetime(booking["start_at"])
        old_end = _ps5_parse_datetime(booking["end_at"])
        if start < old_end and end > old_start:
            return False
    return True


async def _ps5_mark_no_shows(now=None):
    """Expire unstarted reservations 15 minutes after their scheduled start."""
    now = now or now_utc()
    cutoff = iso(now - timedelta(minutes=15))
    overdue = await db.ps5_bookings.find(
        {"status": "confirmed", "start_at": {"$lte": cutoff}},
        {"_id": 0}
    ).to_list(5000)
    for booking in overdue:
        # A session linked to this booking means the customer arrived, even if
        # the booking status update was interrupted.
        started = await db.sessions.find_one(
            {"ps5_booking_id": booking["id"], "status": "active"},
            {"_id": 1}
        )
        if not started:
            await db.ps5_bookings.update_one(
                {"id": booking["id"], "status": "confirmed"},
                {"$set": {"status": "no_show", "no_show_at": iso(now)}}
            )


@api.get("/ps5-bookings")
async def list_ps5_bookings(user=Depends(require_permission("view_ps5"))):
    now = now_utc()
    await _ps5_mark_no_shows(now)
    rows = await db.ps5_bookings.find(
        {"status": {"$in": ["confirmed", "no_show", "started", "completed"]}},
        {"_id": 0}
    ).sort("start_at", 1).to_list(5000)
    return [
        booking for booking in rows
        if _ps5_parse_datetime(booking["end_at"]) >= now - timedelta(days=1)
    ]


@api.post("/ps5-bookings")
async def create_ps5_booking(body: PS5BookingCreate, user=Depends(require_permission("manage_ps5"))):
    customer_name = body.customer_name.strip()
    if not customer_name:
        raise HTTPException(status_code=400, detail="Customer name is required")

    start = _ps5_parse_datetime(body.start_at)
    end = _ps5_parse_datetime(body.end_at)
    duration_seconds = (end - start).total_seconds()
    if body.membership_id:
        if duration_seconds <= 0 or duration_seconds > 7200 or duration_seconds % 60 != 0:
            raise HTTPException(status_code=400, detail="Membership PS5 bookings must be between 1 and 120 minutes")
    elif duration_seconds not in (1800, 3600, 5400, 7200, 10800, 14400, 18000, 21600):
        raise HTTPException(status_code=400, detail="Regular PS5 bookings must be 30 minutes, 1 hour, 1.5 hours, or 2 to 6 hours")
    if start < now_utc():
        raise HTTPException(status_code=400, detail="Cannot create a booking in the past")

    stations = await db.tables.find(
        {"game_type": "ps5"}, {"_id": 0}
    ).sort("table_number", 1).to_list(length=None)
    if not stations:
        raise HTTPException(status_code=400, detail="No PS5 stations configured")

    pricing = await _get_game_pricing()
    hourly_rate = (pricing.get("ps5") or {}).get("players", {}).get(str(body.player_count))
    if hourly_rate is None:
        raise HTTPException(status_code=400, detail="Invalid PS5 player count or pricing")
    membership = None
    if body.membership_id:
        membership = await db.memberships.find_one(
            {"id": body.membership_id, "status": "active"}, {"_id": 0}
        )
        if not membership:
            raise HTTPException(status_code=404, detail="Active membership not found")
        state = await _membership_status(membership, at=start)
        if state["is_expired"]:
            raise HTTPException(status_code=400, detail="Membership will be expired at the booking time")
        if state["remaining_total_seconds"] <= 0:
            raise HTTPException(status_code=400, detail="Membership has no remaining hours")

        # Reserve the daily membership allowance at booking time. Actual usage is
        # still deducted only when the session starts; confirmed future bookings
        # reserve capacity so multiple bookings cannot exceed the daily limit.
        daily_allowance_seconds = min(int(membership.get("daily_minutes", 120)), 120) * 60
        daily_usage = membership.get("daily_usage") or {}
        existing_reservations = await db.ps5_bookings.find(
            {
                "membership_id": membership["id"],
                "status": "confirmed",
            },
            {"_id": 0, "start_at": 1, "end_at": 1},
        ).to_list(1000)

        day_cursor = start.astimezone(CLUB_TIMEZONE).date()
        final_day = (end - timedelta(microseconds=1)).astimezone(CLUB_TIMEZONE).date()
        while day_cursor <= final_day:
            day_start = datetime.combine(day_cursor, datetime.min.time(), tzinfo=CLUB_TIMEZONE).astimezone(timezone.utc)
            day_end = (datetime.combine(day_cursor, datetime.min.time(), tzinfo=CLUB_TIMEZONE) + timedelta(days=1)).astimezone(timezone.utc)

            requested_seconds = max(
                0,
                (min(end, day_end) - max(start, day_start)).total_seconds(),
            )
            reserved_seconds = 0
            for reservation in existing_reservations:
                reservation_start = _ps5_parse_datetime(reservation["start_at"])
                reservation_end = _ps5_parse_datetime(reservation["end_at"])
                reserved_seconds += max(
                    0,
                    (min(reservation_end, day_end) - max(reservation_start, day_start)).total_seconds(),
                )

            used_seconds = float(daily_usage.get(day_cursor.isoformat(), 0) or 0)
            if used_seconds + reserved_seconds + requested_seconds > daily_allowance_seconds:
                remaining_minutes = max(
                    0,
                    int((daily_allowance_seconds - used_seconds - reserved_seconds) // 60),
                )
                raise HTTPException(
                    status_code=400,
                    detail=f"Membership daily limit is 2 hours. Only {remaining_minutes} minute(s) remain for {day_cursor.isoformat()}.",
                )
            day_cursor += timedelta(days=1)

        # A reservation is not a play session: do not consume membership time
        # or charge extra-player fees until the actual session starts.
        amount = 0.0
    else:
        amount = round(float(hourly_rate) * duration_seconds / 3600, 2)

    selected = None
    if body.table_id:
        selected = next((station for station in stations if station["id"] == body.table_id), None)
        if not selected:
            raise HTTPException(status_code=404, detail="Selected PS5 station not found")
        if selected.get("status") == "maintenance":
            raise HTTPException(status_code=409, detail="Selected PS5 station is not available")
        if selected.get("status") == "running" and not await db.sessions.find_one(
            {"table_id": selected["id"], "status": "active", "game_type": "ps5"},
            {"_id": 1}
        ):
            raise HTTPException(status_code=409, detail="Selected PS5 station is not available")
        if not await _ps5_station_is_available(selected["id"], start, end):
            raise HTTPException(status_code=409, detail="Selected PS5 station already has an overlapping booking or active session")
    else:
        for station in stations:
            if station.get("status") == "maintenance":
                continue
            if station.get("status") == "running" and not await db.sessions.find_one(
                {"table_id": station["id"], "status": "active", "game_type": "ps5"},
                {"_id": 1}
            ):
                continue
            if await _ps5_station_is_available(station["id"], start, end):
                selected = station
                break
        if not selected:
            raise HTTPException(status_code=409, detail="No PS5 station is available for this time")

    now = now_utc()
    booking = {
        "id": str(uuid.uuid4()),
        "customer_name": customer_name,
        "phone": (body.phone or "").strip(),
        "table_id": selected["id"],
        "table_number": selected["table_number"],
        "table_name": selected.get("table_name", ""),
        "game_type": "ps5",
        "start_at": iso(start),
        "end_at": iso(end),
        "duration_minutes": int(duration_seconds / 60),
        "player_count": body.player_count,
        "hourly_rate": float(hourly_rate),
        "billing_type": "membership" if membership else "normal",
        "membership_id": membership["id"] if membership else None,
        "membership_name": membership.get("member_name") if membership else None,
        "amount": amount,
        "payment_due_at_session_end": bool(membership),
        "notes": (body.notes or "").strip(),
        "status": "confirmed",
        "created_at": iso(now),
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),
    }
    await db.ps5_bookings.insert_one(booking.copy())
    return booking


@api.post("/ps5-bookings/{booking_id}/cancel")
async def cancel_ps5_booking(booking_id: str, user=Depends(require_permission("manage_ps5"))):
    booking = await db.ps5_bookings.find_one({"id": booking_id})
    if not booking:
        raise HTTPException(status_code=404, detail="PS5 booking not found")
    if booking.get("status") != "confirmed":
        raise HTTPException(status_code=400, detail="Booking is already cancelled or completed")

    result = await db.ps5_bookings.update_one(
        {"id": booking_id, "status": "confirmed"},
        {"$set": {
            "status": "cancelled",
            "cancelled_at": iso(now_utc()),
            "cancelled_by": user["id"],
        }}
    )
    if result.modified_count == 0:
        raise HTTPException(status_code=409, detail="Booking was already changed")
    return {"ok": True, "message": "PS5 booking cancelled"}


@api.get("/tables")
async def list_tables(user=Depends(require_permission("view_tables"))):
    tables = await db.tables.find({}, {"_id": 0}).sort("table_number", 1).to_list(1000)
    for table in tables:
        if table.get("game_type") == "ps5":
            table["table_size"] = "ps5"
            table["supported_games"] = ["ps5"]
        elif not table.get("table_size"):
            # Backward compatibility for tables created before physical table types.
            old_game = table.get("game_type", "snooker")
            table["table_size"] = "small" if old_game in ("pool", "mini_snooker") else "large"
            table["supported_games"] = ["pool", "mini_snooker"] if table["table_size"] == "small" else ["snooker"]
    return tables

@api.post("/tables")
async def create_table(body: TableIn, user=Depends(require_permission("manage_tables"))):
    table_number = body.table_number.strip()
    table_name = body.table_name.strip()
    if not table_number or not table_name:
        raise HTTPException(status_code=400, detail="Table number and name are required")
    duplicate = await db.tables.find_one({"table_number": {"$regex": f"^{__import__('re').escape(table_number)}$", "$options": "i"}}, {"_id": 1})
    if duplicate:
        raise HTTPException(status_code=409, detail="A table or PS5 station with this number already exists")
    t = {
        "id": str(uuid.uuid4()), "table_number": table_number, "table_name": table_name,
        "table_size": body.table_size, "supported_games": ["snooker"] if body.table_size == "large" else ["pool", "mini_snooker"],
        "hourly_rate": 0.0, "status": body.status, "created_at": iso(now_utc()),
    }
    await db.tables.insert_one(t.copy())
    return {k: v for k, v in t.items() if k != "_id"}

@api.post("/ps5-stations")
async def create_ps5_station(body: PS5StationIn, user=Depends(require_permission("manage_ps5"))):
    table_number = body.table_number.strip()
    table_name = body.table_name.strip()

    if not table_number or not table_name:
        raise HTTPException(status_code=400, detail="Station number and name are required")

    # Station numbers must be unique across all tables and PS5 stations.
    existing_numbers = await db.tables.find(
        {}, {"_id": 0, "table_number": 1}
    ).to_list(length=None)

    if any(
        (row.get("table_number") or "").strip().casefold() == table_number.casefold()
        for row in existing_numbers
    ):
        raise HTTPException(
            status_code=409,
            detail="A table or PS5 station with this number already exists"
        )

    station = {
        "id": str(uuid.uuid4()),
        "table_number": table_number,
        "table_name": table_name,
        "hourly_rate": 0.0,
        "status": body.status,
        "game_type": "ps5",
        "created_at": iso(now_utc()),
    }
    await db.tables.insert_one(station.copy())
    return station

@api.put("/tables/{table_id}")
async def update_table(table_id: str, body: TableUpdate, user=Depends(require_permission("manage_tables"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    existing = await db.tables.find_one({"id": table_id}, {"_id": 0})
    if not existing:
        raise HTTPException(status_code=404, detail="Table not found")
    if existing.get("game_type") == "ps5":
        raise HTTPException(status_code=400, detail="PS5 stations are managed separately")
    if "table_size" in update:
        update["supported_games"] = ["snooker"] if update["table_size"] == "large" else ["pool", "mini_snooker"]
    res = await db.tables.update_one({"id": table_id}, {"$set": update, "$unset": {"game_type": ""}})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Table not found")
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    return t

@api.delete("/tables/{table_id}")
async def delete_table(table_id: str, user=Depends(require_permission("manage_tables"))):
    table = await db.tables.find_one({"id": table_id}, {"_id": 0})
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")

    if table.get("game_type") == "ps5":
        active_session = await db.sessions.find_one(
            {"table_id": table_id, "status": "active"}, {"_id": 1}
        )
        if active_session:
            raise HTTPException(status_code=409, detail="Cannot delete a PS5 station with an active session")
        future_booking = await db.ps5_bookings.find_one({
            "table_id": table_id,
            "status": "confirmed",
            "end_at": {"$gt": iso(now_utc())},
        }, {"_id": 1})
        if future_booking:
            raise HTTPException(status_code=409, detail="Cancel its future confirmed bookings before deleting this PS5 station")

    res = await db.tables.delete_one({"id": table_id})
    return {"deleted": res.deleted_count}

# ---- Categories ----

@api.get("/categories")
async def list_categories(user=Depends(require_permission("view_snacks"))):
    categories = await db.categories.find({}, {"_id": 0}).sort("name", 1).to_list(100)
    return categories

@api.post("/categories")
async def create_category(body: CategoryIn, user=Depends(require_permission("manage_snacks"))):
    name = body.name.strip()

    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")

    existing = await db.categories.find_one({
        "name": {"$regex": f"^{name}$", "$options": "i"}
    })

    if existing:
        raise HTTPException(status_code=400, detail="Category already exists")

    category = {
        "id": str(uuid.uuid4()),
        "name": name,
        "created_at": iso(now_utc())
    }

    await db.categories.insert_one(category.copy())

    return category

# ---- Snacks ----

@api.get("/snacks")
async def list_snacks(user=Depends(require_permission("view_snacks"))):
    snacks = await db.snacks.find(
        {},
        {"_id": 0}
    ).sort("name", 1).to_list(1000)

    return snacks

@api.post("/snacks")
async def create_snack(body: SnackIn, user=Depends(require_permission("manage_snacks"))):
    s = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": iso(now_utc())}
    await db.snacks.insert_one(s.copy())
    return {k: v for k, v in s.items() if k != "_id"}

@api.put("/snacks/{snack_id}")
async def update_snack(snack_id: str, body: SnackUpdate, user=Depends(require_permission("manage_snacks"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.snacks.update_one({"id": snack_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Snack not found")
    s = await db.snacks.find_one({"id": snack_id}, {"_id": 0})
    return s

@api.delete("/snacks/{snack_id}")
async def delete_snack(snack_id: str, user=Depends(require_permission("manage_snacks"))):
    res = await db.snacks.delete_one({"id": snack_id})
    return {"deleted": res.deleted_count}

# ---- Sessions ----

@api.post("/food-orders")
async def create_food_order(
    body: FoodOrderCreate,
    user=Depends(require_permission("manage_food_orders"))
):
    if not body.items:
        raise HTTPException(status_code=400, detail="At least one item is required")

    order_items = []
    total = 0.0

    for requested_item in body.items:
        if requested_item.quantity <= 0:
            raise HTTPException(
                status_code=400,
                detail="Quantity must be positive"
            )

        snack = await db.snacks.find_one(
            {"id": requested_item.snack_id},
            {"_id": 0}
        )

        if not snack:
            raise HTTPException(
                status_code=404,
                detail=f"Snack not found: {requested_item.snack_id}"
            )

        stock = int(snack.get("stock_quantity", 0))

        if stock <= 0:
            raise HTTPException(
                status_code=400,
                detail=f"{snack['name']} is out of stock"
            )

        if requested_item.quantity > stock:
            raise HTTPException(
                status_code=400,
                detail=f"Only {stock} item(s) of {snack['name']} available"
            )

        price = float(snack["price"])
        subtotal = price * requested_item.quantity

        order_items.append({
            "snack_id": snack["id"],
            "name": snack["name"],
            "price": price,
            "quantity": requested_item.quantity,
            "subtotal": subtotal,
        })

        total += subtotal

    # Deduct stock atomically to prevent negative inventory.
    # Combine duplicate snack IDs before deduction.
    required_stock = {}

    for item in order_items:
        snack_id = item["snack_id"]
        required_stock[snack_id] = (
            required_stock.get(snack_id, 0) + item["quantity"]
        )

    deducted_stock = []

    for snack_id, quantity in required_stock.items():
        result = await db.snacks.update_one(
            {
                "id": snack_id,
                "stock_quantity": {"$gte": quantity}
            },
            {
                "$inc": {"stock_quantity": -quantity}
            }
        )

        if result.modified_count == 0:
            # Restore stock already deducted in this order.
            for deducted_id, deducted_quantity in deducted_stock:
                await db.snacks.update_one(
                    {"id": deducted_id},
                    {"$inc": {"stock_quantity": deducted_quantity}}
                )

            raise HTTPException(
                status_code=409,
                detail="Insufficient stock. Please refresh and try again."
            )

        deducted_stock.append((snack_id, quantity))

    discount = max(0, min(float(body.discount or 0), total))
    final_total = round(total - discount, 2)

    order = {
        "id": str(uuid.uuid4()),
        "customer_name": (body.customer_name or "").strip(),
        "items": order_items,
        "total": round(total, 2),
        "discount": round(discount, 2),
        "final_total": final_total,
        "payment_method": body.payment_method,
        "status": "pending",
        "session_id": None,
        "created_at": iso(now_utc()),
        "paid_at": None,
        "created_by": user["id"],
        "created_by_name": user.get("name", ""),}


    await db.food_orders.insert_one(order.copy())

    order.pop("_id", None)
    return order

async def _session_with_details(s):
    table = await db.tables.find_one({"id": s["table_id"]}, {"_id": 0})
    s["table"] = table
    s["snacks_total"] = sum(item.get("subtotal", 0) for item in s.get("snacks", []))
    return s

@api.get("/food-orders/pending")
async def list_pending_food_orders(
    user=Depends(require_permission("view_food_orders"))
):
    orders = await db.food_orders.find(
        {"status": "pending"},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)

    return orders

@api.get("/food-orders/{order_id}")
async def get_food_order(
    order_id: str,
    user=Depends(require_permission("view_food_orders"))
):
    order = await db.food_orders.find_one(
        {"id": order_id},
        {"_id": 0}
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Food order not found"
        )

    return order

@api.post("/food-orders/{order_id}/complete")
async def complete_food_order(
    order_id: str,
    body: dict,
    user=Depends(require_permission("manage_food_orders"))
):
    order = await db.food_orders.find_one(
        {"id": order_id},
        {"_id": 0}
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Food order not found"
        )

    if order.get("status") != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Food order is already {order.get('status')}"
        )

    subtotal = float(order.get("total", 0))
    discount = max(
        0,
        min(float(body.get("discount", 0) or 0), subtotal)
    )

    final_total = round(subtotal - discount, 2)

    payment_method = (
        body.get("payment_method")
        or "Cash"
    )

    result = await db.food_orders.update_one(
    {
        "id": order_id,
        "status": "pending"
    },
    {
        "$set": {
            "status": "completed",
            "discount": round(discount, 2),
            "final_total": final_total,
            "payment_method": payment_method,
            "paid_at": iso(now_utc()),
            "completed_by": user["id"],
            "completed_by_name": user.get("name", ""),
        }
    }
)

    if result.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Order was already completed or changed"
        )

    updated_order = await db.food_orders.find_one(
        {"id": order_id},
        {"_id": 0}
    )

    return updated_order

@api.delete("/food-orders/{order_id}")
async def cancel_food_order(
    order_id: str,
    user=Depends(require_permission("manage_food_orders"))
):
    order = await db.food_orders.find_one(
        {"id": order_id},
        {"_id": 0}
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Food order not found"
        )

    if order.get("status") != "pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending food orders can be cancelled"
        )

    # Atomically claim the pending order before restoring stock.
    result = await db.food_orders.update_one(
        {
            "id": order_id,
            "status": "pending"
        },
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": iso(now_utc()),
                "cancelled_by": user["id"],
                "cancelled_by_name": user.get("name", ""),
            }
        }
    )

    if result.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Order was already cancelled or processed."
        )

    # Restore inventory only after successfully claiming cancellation.
    for item in order.get("items", []):
        quantity = int(item.get("quantity", 0))

        if quantity > 0:
            await db.snacks.update_one(
                {"id": item["snack_id"]},
                {"$inc": {"stock_quantity": quantity}}
            )

    return {
        "ok": True,
        "message": "Food order cancelled",
        "order_id": order_id
    }

@api.post("/food-orders/{order_id}/attach")
async def attach_food_order(
    order_id: str,
    session_id: str = Query(...),
    user=Depends(require_permission("manage_food_orders"))
):
    order = await db.food_orders.find_one(
        {"id": order_id},
        {"_id": 0}
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Food order not found"
        )

    if order.get("status") != "pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending food orders can be attached"
        )

    session = await db.sessions.find_one(
        {"id": session_id},
        {"_id": 0}
    )

    if not session:
        raise HTTPException(
            status_code=404,
            detail="Session not found"
        )

    if session.get("status") != "active":
        raise HTTPException(
            status_code=400,
            detail="Session is not active"
        )

    existing_snacks = session.get("snacks", [])
    order_items = order.get("items", [])

    for item in order_items:
        existing_snacks.append({
            "snack_id": item["snack_id"],
            "name": item["name"],
            "price": item["price"],
            "quantity": item["quantity"],
            "subtotal": item["subtotal"],
            "added_at": order.get("created_at", iso(now_utc())),
            "source": "pre_table_order",
            "food_order_id": order_id,
        })

    snacks_amount = sum(
        float(item.get("subtotal", 0))
        for item in existing_snacks
    )

    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "snacks": existing_snacks,
                "snacks_amount": round(snacks_amount, 2),
            }
        }
    )

    await db.food_orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "status": "attached",
                "session_id": session_id,
                "attached_at": iso(now_utc()),
                "attached_by": user["id"],
                "attached_by_name": user.get("name", ""),
            }
        }
    )

    updated_session = await db.sessions.find_one(
        {"id": session_id},
        {"_id": 0}
    )

    await _session_with_details(updated_session)

    return {
        "ok": True,
        "message": "Food order attached successfully",
        "order_id": order_id,
        "session": updated_session,
    }

@api.post("/food-orders/{order_id}/start-table")
async def start_table_from_food_order(
    order_id: str,
    body: FoodOrderAttach,
    user=Depends(require_permission("manage_food_orders"))
):
    # 1. Find the food order
    order = await db.food_orders.find_one(
        {"id": order_id},
        {"_id": 0}
    )

    if not order:
        raise HTTPException(
            status_code=404,
            detail="Food order not found"
        )

    # 2. Only pending orders can start a table
    if order.get("status") != "pending":
        raise HTTPException(
            status_code=400,
            detail=f"Food order is already {order.get('status')}"
        )

    # 3. Verify table exists and is available
    table = await db.tables.find_one(
        {"id": body.table_id},
        {"_id": 0}
    )

    if not table:
        raise HTTPException(
            status_code=404,
            detail="Table not found"
        )

    if table["status"] != "available":
        raise HTTPException(
            status_code=400,
            detail=f"Table is {table['status']}"
        )

    # 4. Start a normal session
    session = await start_session(
        SessionStart(
            table_id=body.table_id,
            game_type=body.game_type,
            customer_name=order.get("customer_name", ""),
            notes="",
            player_count=body.player_count,
            rd_selected=body.rd_selected,
            duration_minutes=body.duration_minutes,
        ),
        user
    )

    # 5. Convert food-order items into session snacks
    snacks = []

    for item in order.get("items", []):
        snacks.append({
            "snack_id": item["snack_id"],
            "name": item["name"],
            "price": float(item["price"]),
            "quantity": int(item["quantity"]),
            "subtotal": float(item["subtotal"]),
        })

    snacks_amount = round(
        sum(item["subtotal"] for item in snacks),
        2
    )

    # 6. Attach snacks to the newly-created session
    await db.sessions.update_one(
        {"id": session["id"]},
        {
            "$set": {
                "snacks": snacks,
                "snacks_amount": snacks_amount
            }
        }
    )

    # 7. Mark food order as attached
    await db.food_orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "status": "attached",
                "session_id": session["id"],
                "attached_at": iso(now_utc()),
                "attached_by": user["id"],
                "attached_by_name": user.get("name", ""),
                "table_id": table["id"],
                "table_number": table["table_number"]
            }
        }
    )

    # 8. Return updated session
    updated_session = await db.sessions.find_one(
        {"id": session["id"]},
        {"_id": 0}
    )

    await _session_with_details(updated_session)

    return updated_session

@api.get("/sessions")
async def list_sessions(
    status: Optional[str] = None,
    user=Depends(require_permission("view_sessions"))
):
    q = {}

    if status:
        q["status"] = status

    rows = await db.sessions.find(
        q,
        {"_id": 0}
    ).sort(
        "start_time",
        -1
    ).to_list(2000)

    if not rows:
        return []

    table_ids = list({
        r["table_id"]
        for r in rows
        if r.get("table_id")
    })

    tables = await db.tables.find(
        {"id": {"$in": table_ids}},
        {"_id": 0}
    ).to_list(len(table_ids))

    table_map = {
        t["id"]: t
        for t in tables
    }

    for r in rows:
        if r.get("billing_type") == "membership":
            r = await _settle_membership_usage(r, now_utc())
        if r.get("billing_type") == "membership":
            membership = await db.memberships.find_one({"id": r.get("membership_id")}, {"_id": 0})
            if membership:
                r["membership_state"] = await _membership_status(membership)
        r["table"] = table_map.get(r.get("table_id"))
        r["snacks_total"] = sum(
            item.get("subtotal", 0)
            for item in r.get("snacks", [])
        )

    return rows
def _membership_local_now():
    return now_utc().astimezone(CLUB_TIMEZONE)


def _membership_expiry(activated_at, validity_days=30):
    """Return expiry using the package validity; legacy memberships default to 30 days."""
    return activated_at + timedelta(days=max(1, int(validity_days or 30)))

def _membership_day_key(dt):
    return dt.astimezone(CLUB_TIMEZONE).date().isoformat()


def _membership_total_hours(membership):
    if membership.get("total_hours"):
        return int(membership["total_hours"])
    legacy = {"bronze": 10, "silver": 20, "gold": 30, "platinum": 40}
    return legacy.get(str(membership.get("plan", "")).lower(), 0)


def _membership_plan(plan):
    plans = {
        "bronze": {"monthly_fee": 1099, "total_hours": 10, "daily_minutes": 120},
        "silver": {"monthly_fee": 2199, "total_hours": 20, "daily_minutes": 120},
        "gold": {"monthly_fee": 3199, "total_hours": 30, "daily_minutes": 120},
        "platinum": {"monthly_fee": 4199, "total_hours": 40, "daily_minutes": 120},
    }
    return plans[plan]


async def _settle_membership_usage(session, until=None):
    """Accrue only unpaused membership play time, split at club-local midnight."""
    if session.get("billing_type") != "membership" or session.get("status") != "active":
        return session
    membership_id = session.get("membership_id")
    cursor_raw = session.get("membership_usage_cursor") or session.get("start_time")
    if not membership_id or not cursor_raw:
        return session
    membership = await db.memberships.find_one({"id": membership_id})
    if not membership:
        raise HTTPException(status_code=409, detail="Membership record not found")
    cursor = datetime.fromisoformat(cursor_raw)
    end = until or now_utc()
    requested_end = end
    expiry = datetime.fromisoformat(membership["expires_at"])
    if session.get("is_paused"):
        if now_utc() >= expiry and not session.get("membership_exhausted"):
            await db.sessions.update_one({"id": session["id"]}, {"$set": {"membership_exhausted": True, "pause_reason": "MEMBERSHIP_EXPIRED"}})
            session.update({"membership_exhausted": True, "pause_reason": "MEMBERSHIP_EXPIRED"})
        return session
    if cursor >= expiry:
        await db.sessions.update_one({"id": session["id"]}, {"$set": {
            "is_paused": True, "pause_started_at": iso(expiry),
            "pause_reason": "MEMBERSHIP_EXPIRED", "membership_exhausted": True,
            "membership_usage_cursor": iso(expiry),
        }})
        session.update({"is_paused": True, "pause_started_at": iso(expiry), "pause_reason": "MEMBERSHIP_EXPIRED", "membership_exhausted": True, "membership_usage_cursor": iso(expiry)})
        return session
    end = min(end, expiry)
    if end <= cursor:
        return session
    usage = dict(membership.get("daily_usage") or {})
    remaining_seconds = (end - cursor).total_seconds()
    point = cursor
    exhausted_at = expiry if requested_end > expiry else None
    daily_cap = min(int(membership.get("daily_minutes", 120)) * 60, 7200)
    total_cap = _membership_total_hours(membership) * 3600
    total_used = sum(float(v or 0) for v in usage.values())
    total_available = max(0.0, total_cap - total_used)
    if total_available <= 0:
        exhausted_at = cursor
    while remaining_seconds > 0 and total_available > 0 and not exhausted_at:
        local_point = point.astimezone(CLUB_TIMEZONE)
        next_midnight_local = (local_point.replace(hour=0, minute=0, second=0, microsecond=0) + timedelta(days=1))
        next_midnight_utc = next_midnight_local.astimezone(timezone.utc)
        segment_end = min(end, next_midnight_utc)
        segment_seconds = max(0, (segment_end - point).total_seconds())
        key = _membership_day_key(point)
        already_used = float(usage.get(key, 0))
        available = max(0.0, daily_cap - already_used)
        credited = min(segment_seconds, available, total_available)
        usage[key] = already_used + credited
        total_available -= credited
        if credited < segment_seconds:
            exhausted_at = point + timedelta(seconds=credited)
            break
        if total_available <= 0:
            exhausted_at = point + timedelta(seconds=credited)
            break
        point = segment_end
        remaining_seconds -= segment_seconds
    if not exhausted_at and point == end and end.astimezone(CLUB_TIMEZONE).date() == (end - timedelta(microseconds=1)).astimezone(CLUB_TIMEZONE).date():
        final_key = _membership_day_key(end - timedelta(microseconds=1))
        if float(usage.get(final_key, 0)) >= daily_cap:
            exhausted_at = end
    cursor_to_store = exhausted_at or end
    await db.memberships.update_one({"id": membership_id}, {"$set": {"daily_usage": usage}})
    session_update = {"membership_usage_cursor": iso(cursor_to_store)}
    if exhausted_at:
        reason = "MEMBERSHIP_EXPIRED" if exhausted_at == expiry else "MEMBERSHIP_EXHAUSTED"
        session_update.update({"is_paused": True, "pause_started_at": iso(exhausted_at), "pause_reason": reason, "membership_exhausted": True})
    await db.sessions.update_one({"id": session["id"]}, {"$set": session_update})
    session.update(session_update)
    return session


async def _membership_status(membership, at=None):
    at = at or now_utc()
    local = at.astimezone(CLUB_TIMEZONE)
    key = local.date().isoformat()
    allowance = min(int(membership.get("daily_minutes", 120)), 120) * 60
    usage = membership.get("daily_usage") or {}
    used = float(usage.get(key, 0))
    total_used = sum(float(v or 0) for v in usage.values())
    total_hours = _membership_total_hours(membership)
    total_seconds = total_hours * 3600
    total_remaining = max(0, int(total_seconds - total_used))
    expiry = datetime.fromisoformat(membership["expires_at"])
    expired = at >= expiry or membership.get("status") != "active"
    return {
        "membership_id": membership["id"],
        "member_name": membership.get("member_name", ""),
        "phone": membership.get("phone", ""),
        "plan": membership.get("plan", "").title(),
        "monthly_fee": membership.get("monthly_fee", 0),
        "total_hours": total_hours,
        "total_used_seconds": int(total_used),
        "remaining_total_seconds": total_remaining,
        "daily_minutes": min(int(membership.get("daily_minutes", 120)), 120),
        "expires_at": membership["expires_at"],
        "is_expired": expired,
        "used_seconds_today": int(used),
        "remaining_seconds_today": max(0, int(allowance - used)),
        "as_of": iso(at),
    }


@api.get("/memberships")
async def list_memberships(user=Depends(require_permission("view_memberships"))):
    rows = await db.memberships.find({"status": "active"}, {"_id": 0}).sort("created_at", -1).to_list(1000)
    result = []
    for membership in rows:
        result.append({**membership, **(await _membership_status(membership))})
    return result


@api.post("/memberships")
async def create_membership(body: MembershipCreate, user=Depends(require_permission("manage_memberships"))):
    name = body.member_name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Member name is required")
    now = _membership_local_now()
    plan = _membership_plan(body.plan)
    membership = {
        "id": str(uuid.uuid4()), "member_name": name, "phone": (body.phone or "").strip(),
        "plan": body.plan, **plan, "activated_at": iso(now),
        "expires_at": iso(_membership_expiry(now)), "status": "active",
        "daily_usage": {}, "created_at": iso(now_utc()), "created_by": user["id"],
    }
    await db.memberships.insert_one(membership.copy())
    membership.pop("_id", None)
    return {**membership, **(await _membership_status(membership))}


# ---- Membership administration ----

async def _ensure_membership_packages():
    """One-time bootstrap only. Never recreate packages after an admin deletes them."""
    marker = await db.settings.find_one({"key": "membership_packages_seeded_v2"})
    if marker:
        return

    # If any package already exists, this is an established installation.
    # Mark it initialized rather than recreating deleted defaults.
    if await db.membership_packages.count_documents({}) > 0:
        await db.settings.update_one(
            {"key": "membership_packages_seeded_v2"},
            {"$set": {"key": "membership_packages_seeded_v2", "completed_at": iso(now_utc())}},
            upsert=True,
        )
        return

    now = iso(now_utc())
    plans = [
        ("Bronze", 1099, 10),
        ("Silver", 2199, 20),
        ("Gold", 3199, 30),
        ("Platinum", 4199, 40),
    ]
    for name, price, hours in plans:
        await db.membership_packages.insert_one({
            "id": str(uuid.uuid4()),
            "name": name,
            "price": price,
            "total_hours": hours,
            "daily_minutes": 120,
            "validity_days": 30,
            "description": f"{hours} total hours · max 2 hours/day · valid 30 days",
            "is_active": True,
            "created_at": now,
            "updated_at": now,
        })

    await db.settings.update_one(
        {"key": "membership_packages_seeded_v2"},
        {"$set": {"key": "membership_packages_seeded_v2", "completed_at": iso(now_utc())}},
        upsert=True,
    )


@api.get("/membership-admin/overview")
async def membership_admin_overview(user=Depends(require_permission("view_memberships"))):
    members = await db.memberships.find({}, {"_id": 0}).to_list(5000)
    now = now_utc()
    active = [m for m in members if m.get("status") == "active" and datetime.fromisoformat(m["expires_at"]) >= now]
    expired = [m for m in members if m.get("status") != "active" or datetime.fromisoformat(m["expires_at"]) < now]
    month_prefix = _membership_local_now().strftime("%Y-%m")
    collected = sum(float(m.get("monthly_fee", 0)) for m in members if str(m.get("activated_at", "")).startswith(month_prefix))
    recent = sorted(members, key=lambda m: m.get("created_at", ""), reverse=True)[:6]
    expiring = sorted([m for m in active if (datetime.fromisoformat(m["expires_at"]) - now).days <= 7], key=lambda m: m.get("expires_at", ""))[:6]
    return {"total_members": len(members), "active_members": len(active), "expired_members": len(expired),
            "monthly_collection": round(collected, 2), "recent_members": recent, "expiring_soon": expiring}

@api.get("/membership-admin/packages")
async def membership_packages(
    user=Depends(require_permission("view_memberships"))
):
    return await db.membership_packages.find(
        {},
        {"_id": 0}
    ).sort("created_at", -1).to_list(500)


@api.post("/membership-admin/packages")
async def create_membership_package(body: MembershipPackageIn, user=Depends(require_permission("manage_memberships"))):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Package name is required")
    if await db.membership_packages.find_one({"name": {"$regex": f"^{name}$", "$options": "i"}}):
        raise HTTPException(status_code=409, detail="A package with this name already exists")
    now = iso(now_utc())
    item = {"id": str(uuid.uuid4()), **body.dict(), "name": name, "created_at": now, "updated_at": now}
    await db.membership_packages.insert_one(item.copy())
    item.pop("_id", None)
    return item

@api.put("/membership-admin/packages/{package_id}")
async def update_membership_package(package_id: str, body: MembershipPackageIn, user=Depends(require_permission("manage_memberships"))):
    item = await db.membership_packages.find_one({"id": package_id})
    if not item:
        raise HTTPException(status_code=404, detail="Package not found")
    values = body.dict()
    values["name"] = values["name"].strip()
    values["updated_at"] = iso(now_utc())
    await db.membership_packages.update_one({"id": package_id}, {"$set": values})
    return await db.membership_packages.find_one({"id": package_id}, {"_id": 0})

@api.post("/membership-admin/packages/{package_id}/activate")
async def activate_membership_package(
    package_id: str,
    user=Depends(require_permission("manage_memberships"))
):
    result = await db.membership_packages.update_one(
        {"id": package_id},
        {
            "$set": {
                "is_active": True,
                "updated_at": iso(now_utc())
            }
        }
    )

    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Package not found")

    return {
        "ok": True,
        "message": "Package activated"
    }


@api.post("/membership-admin/packages/{package_id}/deactivate")
async def deactivate_membership_package(
    package_id: str,
    user=Depends(require_permission("manage_memberships"))
):
    result = await db.membership_packages.update_one(
        {"id": package_id},
        {
            "$set": {
                "is_active": False,
                "updated_at": iso(now_utc())
            }
        }
    )

    if not result.matched_count:
        raise HTTPException(
            status_code=404,
            detail="Package not found"
        )

    return {
        "ok": True,
        "message": "Package deactivated"
    }

@api.delete("/membership-admin/packages/{package_id}")
async def delete_membership_package(
    package_id: str,
    user=Depends(require_permission("manage_memberships"))
):
    package = await db.membership_packages.find_one({"id": package_id})

    if not package:
        raise HTTPException(
            status_code=404,
            detail="Package not found"
        )

    # Never delete a package that has been assigned to a member.
    member_count = await db.memberships.count_documents({
        "package_id": package_id
    })

    if member_count > 0:
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete this package. {member_count} membership record(s) are linked to it. Deactivate it instead."
        )

    await db.membership_packages.delete_one({"id": package_id})

    return {
        "ok": True,
        "message": "Package deleted successfully"
    }

@api.get("/membership-admin/members")
async def managed_members(user=Depends(require_permission("view_memberships"))):
    rows = await db.memberships.find({}, {"_id": 0}).sort("created_at", -1).to_list(5000)
    result = []
    for m in rows:
        state = await _membership_status(m)
        result.append({**m, **state, "member_id": m.get("member_id", m.get("id"))})
    return result

@api.post("/membership-admin/members")
async def create_managed_member(
    body: ManagedMemberIn,
    user=Depends(require_permission("manage_memberships"))
):
    package = await db.membership_packages.find_one(
        {"id": body.package_id, "is_active": True},
        {"_id": 0}
    )

    if not package:
        raise HTTPException(status_code=404, detail="Active package not found")

    name = body.member_name.strip()

    if not name:
        raise HTTPException(status_code=400, detail="Member name is required")

    # Guarantee unique member codes at database level
    await db.memberships.create_index(
        "member_id",
        unique=True,
        partialFilterExpression={"member_id": {"$type": "string"}}
    )
    now = _membership_local_now()
    validity_days = int(package.get("validity_days", 30) or 30)
    expiry = _membership_expiry(now, validity_days)

    member = {
        "id": str(uuid.uuid4()),
        "member_name": name,
        "phone": body.phone.strip(),
        "package_id": package["id"],
        "package_name": package["name"],
        "plan": package["name"].lower(),
        "monthly_fee": float(package["price"]),
        "daily_minutes": int(package.get("daily_minutes", 120) or 120),
        "total_hours": int(package["total_hours"]),
        "validity_days": validity_days,
        "payment_method": body.payment_method,
        "payment_amount": round(float(package["price"]), 2),
        "activated_at": iso(now),
        "expires_at": iso(expiry),
        "status": "active",
        "daily_usage": {},
        "created_at": iso(now_utc()),
        "created_by": user["id"]
    }

    # Retry if a randomly generated code already exists
    for attempt in range(20):
        member["member_id"] = f"M{secrets.randbelow(90000) + 10000}"

        try:
            await db.memberships.insert_one(member.copy())
            break
        except DuplicateKeyError:
            if attempt == 19:
                raise HTTPException(
                    status_code=500,
                    detail="Could not generate a unique member ID. Please try again."
                )

    # Record the membership purchase in the same payments collection used by
    # session and food-order payments.
    payment_amount = round(float(package["price"]), 2)
    payment_id = None
    if payment_amount > 0:
        payment_id = str(uuid.uuid4())
        payment_invoice = (
            "MEM-"
            + now_utc().strftime("%Y%m%d")
            + "-"
            + member["id"][:6].upper()
        )
        payment_doc = {
            "id": payment_id,
            "membership_id": member["id"],
            "source_type": "membership",
            "source_id": member["id"],
            "invoice_no": payment_invoice,
            "amount": payment_amount,
            "method": body.payment_method,
            "table_number": "Membership",
            "customer_name": name,
            "package_name": package["name"],
            "created_at": iso(now_utc()),
        }
        try:
            await db.payments.insert_one(payment_doc.copy())
        except Exception:
            # Do not leave a newly-created membership without its payment record.
            await db.memberships.delete_one({"id": member["id"]})
            logger.exception("Failed to record membership payment")
            raise HTTPException(
                status_code=500,
                detail="Membership was not created because its payment could not be recorded. Please try again."
            )
        await db.memberships.update_one(
            {"id": member["id"]},
            {"$set": {
                "payment_id": payment_id,
                "payment_invoice": payment_invoice,
                "paid_at": payment_doc["created_at"],
            }}
        )
        member.update({
            "payment_id": payment_id,
            "payment_invoice": payment_invoice,
            "paid_at": payment_doc["created_at"],
        })

    member.pop("_id", None)

    return {
        **member,
        **(await _membership_status(member))
    }

@api.put("/membership-admin/members/{member_id}")
async def update_managed_member(
    member_id: str,
    body: ManagedMemberUpdate,
    user=Depends(require_permission("manage_memberships"))
):
    values = {
        k: v
        for k, v in body.dict(exclude_unset=True).items()
        if v is not None
    }

    if not values:
        raise HTTPException(status_code=400, detail="No changes supplied")

    if "member_name" in values:
        values["member_name"] = values["member_name"].strip()

        if not values["member_name"]:
            raise HTTPException(status_code=400, detail="Member name is required")

    if "phone" in values:
        values["phone"] = values["phone"].strip()

    # Update package details together
    if "package_id" in values:
        package = await db.membership_packages.find_one(
            {"id": values["package_id"], "is_active": True},
            {"_id": 0}
        )

        if not package:
            raise HTTPException(status_code=404, detail="Active package not found")

        existing_member = await db.memberships.find_one(
            {"id": member_id},
            {"_id": 0, "activated_at": 1}
        )
        if not existing_member:
            raise HTTPException(status_code=404, detail="Member not found")
        activated_at = datetime.fromisoformat(existing_member["activated_at"])
        validity_days = int(package.get("validity_days", 30) or 30)
        values.update({
            "package_name": package["name"],
            "plan": package["name"].lower(),
            "monthly_fee": float(package["price"]),
            "daily_minutes": int(package.get("daily_minutes", 120) or 120),
            "total_hours": int(package["total_hours"]),
            "validity_days": validity_days,
            "expires_at": iso(_membership_expiry(activated_at, validity_days)),
        })

    result = await db.memberships.update_one(
        {"id": member_id},
        {"$set": values}
    )

    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Member not found")

    member = await db.memberships.find_one(
        {"id": member_id},
        {"_id": 0}
    )

    return {
        **member,
        **(await _membership_status(member))
    }

@api.delete("/membership-admin/members/{member_id}")
async def delete_managed_member(
    member_id: str,
    user=Depends(require_permission("manage_memberships"))
):
    result = await db.memberships.update_one(
        {"id": member_id, "status": {"$ne": "inactive"}},
        {
            "$set": {
                "status": "inactive",
                "deactivated_at": iso(now_utc()),
                "deactivated_by": user["id"]
            }
        }
    )

    if not result.matched_count:
        raise HTTPException(status_code=404, detail="Member not found")

    return {"message": "Member deactivated successfully"}


@api.get("/membership-admin/game-records")
async def membership_game_records(
    user=Depends(require_permission("view_memberships")),
    limit: int = Query(500, ge=1, le=2000)
):
    # Fetch actual membership gameplay sessions
    sessions = await db.sessions.find(
        {"billing_type": "membership"},
        {"_id": 0}
    ).sort(
        "start_time", -1
    ).limit(limit).to_list(limit)

    if not sessions:
        return []

    # Fetch all linked membership records in one query
    membership_ids = list({
        s.get("membership_id")
        for s in sessions
        if s.get("membership_id")
    })

    members = await db.memberships.find(
        {"id": {"$in": membership_ids}},
        {"_id": 0}
    ).to_list(len(membership_ids))

    member_map = {
        m["id"]: m
        for m in members
    }

    output = []

    for session in sessions:
        membership = member_map.get(
            session.get("membership_id"), {}
        )

        output.append({
            "id": session.get("id"),
            "membership_id": session.get("membership_id"),

            "member_name": membership.get(
                "member_name",
                session.get("customer_name", "Member")
            ),

            "member_id": membership.get("member_id", ""),

            "plan": session.get(
                "membership_plan",
                membership.get("plan", "")
            ),

            "table_number": session.get("table_number", ""),

            "start_time": session.get("start_time"),
            "end_time": session.get("end_time"),

            "status": session.get("status", "unknown"),

            "duration_minutes": session.get(
                "duration_minutes", 0
            ),

            "membership_exhausted": session.get(
                "membership_exhausted", False
            ),

        })

    return output

# ---- Realtime staff alerts (shared Snooker/PS5 behavior) ----
_timer_alert_task = None


class StaffAlertConnections:
    """In-process WebSocket fanout to every authorized connected staff device."""
    def __init__(self):
        self.connections = set()

    def connect(self, websocket: WebSocket):
        self.connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.connections.discard(websocket)

    async def broadcast(self, payload: dict):
        stale = []
        for connection in tuple(self.connections):
            try:
                await connection.send_json(payload)
            except Exception:
                stale.append(connection)
        for connection in stale:
            self.disconnect(connection)


staff_alert_connections = StaffAlertConnections()


async def _send_timer_alert(alert: dict):
    await staff_alert_connections.broadcast({"type": "timer_warning", "alert": alert})


async def _send_session_ended_alert(session: dict):
    payload = {
        "type": "session_ended",
        "alert": {
            "id": f"session-ended-{session.get('id')}",
            "session_id": session.get("id"),
            "game_type": "PS5" if (session.get("game_type") or "").lower() == "ps5" else (session.get("game_type") or "snooker").replace("_", " ").title(),
            "table_number": session.get("table_number") or "Unknown",
            "customer_name": session.get("customer_name") or "Customer",
            "grand_total": session.get("grand_total", 0),
            "ended_at": session.get("ended_at") or session.get("end_time") or iso(now_utc()),
        },
    }
    await staff_alert_connections.broadcast(payload)


@api.websocket("/ws/alerts")
async def staff_alerts_websocket(websocket: WebSocket):
    # Browsers cannot attach Authorization headers to WebSocket handshakes.
    # Authenticate with the first encrypted WebSocket message instead of a
    # query parameter, which could otherwise be recorded in proxy access logs.
    await websocket.accept()
    try:
        auth_message = await asyncio.wait_for(websocket.receive_json(), timeout=10)
        token = auth_message.get("token") if isinstance(auth_message, dict) and auth_message.get("type") == "authenticate" else None
        if not token:
            raise jwt.InvalidTokenError("Missing access token")
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALG])
        if payload.get("type") != "access":
            raise jwt.InvalidTokenError("Invalid token type")
        user = await db.users.find_one({"id": payload.get("sub")}, {"_id": 0, "password_hash": 0})
        if not user:
            raise jwt.InvalidTokenError("User not found")
    except (jwt.PyJWTError, asyncio.TimeoutError, ValueError, TypeError):
        await websocket.close(code=4401, reason="Not authenticated")
        return

    if not has_permission(user, "manage_sessions"):
        await websocket.close(code=4403, reason="Permission denied")
        return

    staff_alert_connections.connect(websocket)
    try:
        # Replay recent alerts after reconnect so a brief network outage does
        # not silently lose an event. The client de-duplicates by stable ID.
        cutoff = iso(now_utc() - timedelta(minutes=10))
        recent_timer_alerts = await db.timer_alerts.find(
            {"created_at": {"$gte": cutoff}}, {"_id": 0}
        ).sort("created_at", -1).to_list(100)
        for alert in reversed(recent_timer_alerts):
            await websocket.send_json({"type": "timer_warning", "alert": alert})

        recent_ended_sessions = await db.sessions.find(
            {"status": "completed", "session_ended_alert_sent": True, "ended_at": {"$gte": cutoff}},
            {"_id": 0, "id": 1, "game_type": 1, "table_number": 1, "customer_name": 1, "grand_total": 1, "ended_at": 1, "end_time": 1},
        ).sort("ended_at", -1).to_list(100)
        for session in reversed(recent_ended_sessions):
            await websocket.send_json({
                "type": "session_ended",
                "alert": {
                    "id": f"session-ended-{session.get('id')}",
                    "session_id": session.get("id"),
                    "game_type": "PS5" if (session.get("game_type") or "").lower() == "ps5" else (session.get("game_type") or "snooker").replace("_", " ").title(),
                    "table_number": session.get("table_number") or "Unknown",
                    "customer_name": session.get("customer_name") or "Customer",
                    "grand_total": session.get("grand_total", 0),
                    "ended_at": session.get("ended_at") or session.get("end_time"),
                },
            })

        while True:
            # Keep the connection alive and detect disconnected clients.
            await websocket.receive_text()
    except WebSocketDisconnect:
        pass
    except Exception:
        logger.exception("Staff alerts WebSocket failed")
    finally:
        staff_alert_connections.disconnect(websocket)


def _timer_alert_remaining(session, segment, now):
    duration = int(segment.get("duration_seconds") or int(segment.get("duration_minutes") or 0) * 60)
    if duration <= 0:
        return None, None
    elapsed = float(segment.get("played_seconds", 0) or 0)
    if segment.get("started_at") and not session.get("is_paused"):
        elapsed += _dt_seconds_since(segment.get("started_at"), now)
    remaining = max(0, int(math.ceil(duration - elapsed)))
    threshold = min(duration * 0.25, 10 * 60)
    return remaining, threshold


async def _scan_timer_alerts_once():
    now = now_utc()
    cursor = db.sessions.find(
        {"status": "active", "game_timer_enabled": True, "timer_mode": {"$in": ["countdown", "awaiting_decision"]}},
        {"_id": 0, "id": 1, "game_type": 1, "table_number": 1, "is_paused": 1, "game_billing_segments": 1}
    )
    async for session in cursor:
        segments = session.get("game_billing_segments") or []
        segment = next((x for x in reversed(segments) if x.get("kind") == "fixed"), None)
        if not segment or not segment.get("id"):
            continue
        remaining, threshold = _timer_alert_remaining(session, segment, now)
        if remaining is None or remaining > threshold:
            continue
        alert = {
            "id": str(uuid.uuid4()), "timer_block_id": segment["id"],
            "session_id": session["id"],
            "game_type": "PS5" if (session.get("game_type") or "").lower() == "ps5" else (session.get("game_type") or "snooker").replace("_", " ").title(),
            "table_number": session.get("table_number") or "Unknown",
            "remaining_seconds": remaining,
            "remaining_display": f"{remaining // 60:02d}:{remaining % 60:02d}",
            "message": "Please inform the customer.", "created_at": iso(now),
        }
        try:
            await db.timer_alerts.insert_one(alert)
        except DuplicateKeyError:
            continue
        await _send_timer_alert(alert)


async def _timer_alert_worker():
    while True:
        try:
            await _scan_timer_alerts_once()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.exception("Timer alert scan failed")
        await asyncio.sleep(1)


@api.get("/timer-alerts/pending")
async def pending_timer_alerts(user=Depends(require_permission("manage_sessions"))):
    delivered = await db.timer_alert_deliveries.find({"user_id": user["id"]}, {"_id": 0, "alert_id": 1}).to_list(5000)
    delivered_ids = [x["alert_id"] for x in delivered]
    return await db.timer_alerts.find({"id": {"$nin": delivered_ids}}, {"_id": 0}).sort("created_at", 1).to_list(100)


@api.post("/timer-alerts/{alert_id}/claim")
async def claim_timer_alert(alert_id: str, user=Depends(require_permission("manage_sessions"))):
    alert = await db.timer_alerts.find_one({"id": alert_id}, {"_id": 0})
    if not alert:
        raise HTTPException(status_code=404, detail="Timer alert not found")
    try:
        await db.timer_alert_deliveries.insert_one({"alert_id": alert_id, "user_id": user["id"], "claimed_at": iso(now_utc())})
    except DuplicateKeyError:
        return {"claimed": False, "alert": None}
    return {"claimed": True, "alert": alert}


@api.get("/sessions/active")
async def active_sessions(user=Depends(require_permission("view_sessions"))):
    rows = await db.sessions.find(
        {"status": "active"},
        {
            "_id": 0,
            "id": 1,
            "table_id": 1,
            "table_number": 1,
            "customer_name": 1,
            "start_time": 1,
            "status": 1,
            "is_paused": 1,
            "pause_started_at": 1,
            "paused_seconds": 1,
            "pause_reason": 1,
            "snacks": 1,
            "duration_minutes": 1,
            "rate_used": 1,
            "table_amount": 1,
            "discount": 1,
            "tax_percent": 1,
            "tax_amount": 1,
            "grand_total": 1,
            "billing_type": 1,
            "membership_id": 1,
            "membership_usage_cursor": 1,
            "membership_exhausted": 1,
            "game_type": 1,
            "game_timer_enabled": 1,
            "player_count": 1,
            "rd_selected": 1,
            "rd_amount": 1,
            "game_billing_segments": 1,
            "timer_mode": 1,
            "timer_remaining_seconds": 1,
            "timer_started_at": 1,
            "timer_expired_at": 1
        }
    ).to_list(1000)

    if not rows:
        return []

    table_ids = list({
        r["table_id"]
        for r in rows
        if r.get("table_id")
    })

    tables = await db.tables.find(
        {"id": {"$in": table_ids}},
        {"_id": 0}
    ).to_list(len(table_ids))

    table_map = {
        t["id"]: t
        for t in tables
    }
    
    for r in rows:
        if r.get("game_timer_enabled"):
            r = await _sync_game_timer(r, now_utc())
        if r.get("billing_type") == "membership" and not r.get("is_paused"):
            r = await _settle_membership_usage(r, now_utc())
        if r.get("billing_type") == "membership":
            membership = await db.memberships.find_one({"id": r.get("membership_id")}, {"_id": 0})
            if membership:
                r["membership_state"] = await _membership_status(membership)
        r["table"] = table_map.get(r.get("table_id"))
        r["snacks_total"] = sum(
            float(item.get("subtotal", 0))
            for item in r.get("snacks", [])
        )

        rate = float(r.get("rate_used", 0))
        now = now_utc()
        start_dt = datetime.fromisoformat(r["start_time"])
        paused_seconds = float(r.get("paused_seconds", 0) or 0)
        if r.get("is_paused") and r.get("pause_started_at"):
            paused_seconds += max(
                0,
                (now - datetime.fromisoformat(r["pause_started_at"])).total_seconds(),
            )
        elapsed_seconds = max(
            0,
            (now - start_dt).total_seconds() - paused_seconds,
        )
        table_amount = (elapsed_seconds / 3600.0) * rate

        if r.get("game_timer_enabled"):
            r["table_amount"] = _game_timer_amount(r, now_utc())
            r["timer_played_seconds"] = _game_timer_played_seconds(r, now_utc())
        else:
            r["table_amount"] = float(r.get("membership_extra_player_charge", 0)) if r.get("billing_type") == "membership" else round(table_amount, 2)

    return rows


@api.get("/sessions/{session_id}")
async def get_session(session_id: str, user=Depends(require_permission("view_sessions"))):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    await _session_with_details(s)
    return s

@api.delete("/sessions/{session_id}")
async def clear_session(
    session_id: str,
    user=Depends(require_permission("clear_session"))
):
    # Separate permission required to permanently clear sessions
    if not has_permission(user, "clear_session"):
        raise HTTPException(
            status_code=403,
            detail="You don't have permission to clear sessions"
        )
    # Find the session
    s = await db.sessions.find_one(
        {"id": session_id},
        {"_id": 0}
    )

    if not s:
        raise HTTPException(
            status_code=404,
            detail="Session not found"
        )

    # Only active sessions can be cleared
    if s.get("status") != "active":
        raise HTTPException(
            status_code=400,
            detail="Only active sessions can be cleared"
        )

    # -----------------------------------------
    # 1. Restore snacks back to inventory
    # -----------------------------------------
    # Atomically claim the active session before restoring inventory.
    result = await db.sessions.delete_one({
        "id": session_id,
        "status": "active"
    })

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Session was already cleared or changed"
        )

    # Restore snacks only after successfully claiming the session.
    for item in s.get("snacks", []):
        snack_id = item.get("snack_id")
        quantity = int(item.get("quantity", 0))

        if snack_id and quantity > 0:
            await db.snacks.update_one(
                {"id": snack_id},
                {"$inc": {"stock_quantity": quantity}}
            )
    # -----------------------------------------
    # 2. Make the table available again
    # -----------------------------------------
    await db.tables.update_one(
        {"id": s["table_id"]},
        {"$set": {"status": "available"}}
    )

    # -----------------------------------------
    # 4. Delete any payment records if they exist
    # -----------------------------------------
    await db.payments.delete_many({
        "session_id": session_id
    })

    return {
    "ok": True,
    "message": "Session cleared successfully",
    "session_id": session_id,
    "table_id": s["table_id"],
    "table_number": s["table_number"]
}

@api.post("/sessions/start")
async def start_session(body: SessionStart, user=Depends(require_permission("manage_sessions"))):
    table = await db.tables.find_one(
    {"id": body.table_id},
    {"_id": 0}
)

    if not table:
        raise HTTPException(
            status_code=404,
            detail="Table not found"
        )

    
    is_ps5_table = table.get("game_type") == "ps5"
    if is_ps5_table:
        game_type = "ps5"
    else:
        table_size = table.get("table_size") or ("small" if table.get("game_type") in ("pool", "mini_snooker") else "large")
        supported_games = table.get("supported_games") or (["pool", "mini_snooker"] if table_size == "small" else ["snooker"])
        game_type = body.game_type or ("snooker" if table_size == "large" else "pool")
        if game_type not in supported_games:
            raise HTTPException(status_code=400, detail=f"{game_type.replace('_', ' ').title()} is not supported on this table")
    linked_booking = None
    ps5_auto_end_at = None
    ps5_auto_end_booking_id = None
    if game_type == "ps5":
        await _ps5_mark_no_shows()
        if body.booking_id:
            linked_booking = await db.ps5_bookings.find_one(
                {"id": body.booking_id, "status": "confirmed", "table_id": table["id"]},
                {"_id": 0}
            )
            if not linked_booking:
                raise HTTPException(status_code=404, detail="Confirmed PS5 booking not found for this station")
            # Early starts are allowed. Starting the booked session consumes
            # membership only from this actual start timestamp.
            body.duration_minutes = int(linked_booking.get("duration_minutes") or body.duration_minutes or 60)
            if linked_booking.get("membership_id"):
                if body.billing_type != "membership":
                    raise HTTPException(status_code=400, detail="This reservation is linked to a membership")
                if body.membership_id and body.membership_id != linked_booking["membership_id"]:
                    raise HTTPException(status_code=400, detail="Selected membership does not match this booking")
                body.membership_id = linked_booking["membership_id"]
        else:
            # Walk-ins are allowed until 15 minutes before the earliest confirmed reservation.
            now_for_cutoff = now_utc()
            future_bookings = await db.ps5_bookings.find({
                "table_id": table["id"], "status": "confirmed",
                "start_at": {"$gt": iso(now_for_cutoff)}
            }, {"_id": 0}).sort("start_at", 1).to_list(100)
            if future_bookings:
                next_booking = future_bookings[0]
                reservation_start = _ps5_parse_datetime(next_booking["start_at"])
                ps5_auto_end_at = reservation_start - timedelta(minutes=15)
                if ps5_auto_end_at <= now_for_cutoff:
                    cutoff_label = ps5_auto_end_at.astimezone(CLUB_TIMEZONE).strftime("%I:%M %p").lstrip("0")
                    reservation_label = reservation_start.astimezone(CLUB_TIMEZONE).strftime("%I:%M %p").lstrip("0")
                    raise HTTPException(status_code=409, detail=f"Walk-ins are closed for this station. The next reservation starts at {reservation_label}; the 15-minute cutoff was {cutoff_label}.")
                ps5_auto_end_booking_id = next_booking["id"]
    pricing = await _get_game_pricing()
    game_timer_enabled = body.billing_type == "normal" and game_type in ("snooker", "mini_snooker", "pool", "ps5")
    if game_timer_enabled:
        duration = int(body.duration_minutes or 30)
        if game_type == "pool" and duration not in (30, 60):
            raise HTTPException(status_code=400, detail="Pool packages are 30 or 60 minutes")
        if game_type in ("snooker", "mini_snooker") and not 2 <= int(body.player_count or 0) <= 6:
            raise HTTPException(status_code=400, detail="Choose 2 to 6 players")
        if game_type == "ps5":
            if duration not in (30, 60, 90, 120, 180, 240, 300, 360):
                raise HTTPException(status_code=400, detail="PS5 sessions must be 30 minutes, 1 hour, 1.5 hours, or 2 to 6 hours")
            if not 1 <= int(body.player_count or 1) <= 4:
                raise HTTPException(status_code=400, detail="PS5 supports 1 to 4 players")
    membership = None
    if body.billing_type == "membership":
        if game_type != "ps5":
            raise HTTPException(status_code=400, detail="Membership can only be used for PS5 sessions")
        if not 1 <= int(body.player_count or 1) <= 4:
            raise HTTPException(status_code=400, detail="PS5 membership supports 1 to 4 players")
        if not body.membership_id:
            raise HTTPException(status_code=400, detail="Select a membership")
        membership = await db.memberships.find_one({"id": body.membership_id, "status": "active"}, {"_id": 0})
        if not membership:
            raise HTTPException(status_code=404, detail="Active membership not found")
        membership_state = await _membership_status(membership)
        if membership_state["is_expired"]:
            raise HTTPException(status_code=400, detail="Membership has expired")
        if membership_state["remaining_seconds_today"] <= 0:
            raise HTTPException(status_code=400, detail="Today's 2-hour membership allowance is exhausted")
        if membership_state["remaining_total_seconds"] <= 0:
            raise HTTPException(status_code=400, detail="All purchased membership hours have been used")
        if await db.sessions.find_one({"membership_id": body.membership_id, "status": "active"}):
            raise HTTPException(status_code=409, detail="This member already has an active session")
    membership_player_charge = ({1: 0, 2: 70, 3: 170, 4: 240}.get(int(body.player_count or 1), 0) if membership else 0)
    session_started_at = now_utc()
    effective_timer_seconds = int(duration * 60) if game_timer_enabled else 0
    initial_billing_segments = []
    if game_timer_enabled:
        if game_type == "ps5" and ps5_auto_end_at:
            available_seconds = max(1, int((ps5_auto_end_at - session_started_at).total_seconds()))
            effective_timer_seconds = min(effective_timer_seconds, available_seconds)
            effective_minutes = max(1, math.ceil(effective_timer_seconds / 60))
            segment = _new_fixed_segment(game_type, int(body.player_count or 1), effective_minutes, session_started_at, pricing)
            segment["duration_seconds"] = effective_timer_seconds
            segment["duration_minutes"] = effective_minutes
            segment["amount"] = round(float(pricing["ps5"]["players"][str(int(body.player_count or 1))]) * effective_timer_seconds / 3600.0, 2)
            initial_billing_segments = [segment]
            duration = effective_minutes
        else:
            initial_billing_segments = [_new_fixed_segment(game_type, int(body.player_count or 2), duration, session_started_at, pricing)]
    session = {
        "id": str(uuid.uuid4()),
        "table_id": table["id"],
        "table_number": table["table_number"],
        "customer_name": body.customer_name or "",
        "notes": body.notes or "",
        "billing_type": body.billing_type,
        "membership_id": body.membership_id if body.billing_type == "membership" else None,
        "ps5_booking_id": linked_booking["id"] if linked_booking else None,
        "membership_plan": membership.get("plan") if membership else None,
        "membership_player_count": int(body.player_count or 1) if membership else None,
        "membership_extra_player_charge": membership_player_charge,
        "membership_usage_cursor": iso(now_utc()) if membership else None,
        "start_time": iso(session_started_at),
        "end_time": None,
        "ps5_auto_end_at": iso(ps5_auto_end_at) if ps5_auto_end_at else None,
        "ps5_auto_end_booking_id": ps5_auto_end_booking_id,
        "ps5_auto_end_reason": "UPCOMING_RESERVATION" if ps5_auto_end_at else None,
        # Pause information
        "is_paused": False,
        "pause_started_at": None,
        "paused_seconds": 0,
        "pause_reason": None,
        "duration_minutes": duration if game_timer_enabled else 0,
        "rate_used": float((pricing["ps5"].get("hourly_rate") if pricing["ps5"].get("hourly_rate") is not None else table.get("hourly_rate", 0)) if game_type == "ps5" and body.billing_type == "normal" else table.get("hourly_rate", 0)),
        "game_type": game_type,
        "game_timer_enabled": game_timer_enabled,
        "player_count": int(body.player_count or (1 if game_type == "ps5" else 2)) if game_type in ("snooker", "mini_snooker", "ps5") else None,
        "rd_selected": bool(body.rd_selected) if game_type in ("snooker", "mini_snooker") else False,
        "rd_amount": float(pricing["rd_price"]) if (game_type in ("snooker", "mini_snooker") and body.rd_selected) else 0.0,
        "pricing_snapshot": pricing,
        "game_billing_segments": initial_billing_segments,
        "timer_mode": "countdown" if game_timer_enabled else None,
        "timer_remaining_seconds": effective_timer_seconds if game_timer_enabled else 0,
        "timer_started_at": iso(session_started_at) if game_timer_enabled else None,
        "timer_expired_at": None,
        "table_amount": float(membership_player_charge),
        "snacks": [],
        "snacks_amount": 0.0,
        "discount": 0.0,
        "tax_percent": 0.0,
        "tax_amount": 0.0,
        "grand_total": 0.0,
        "status": "active",
        "started_by": user["id"],
        "started_by_name": user.get("name", ""),
        "payment_method": None,
        "payment_notes": "",
    }
    # Atomically reserve the table so only one request can start it.
    claim = await db.tables.update_one(
        {
            "id": body.table_id,
            "status": "available"
        },
        {
            "$set": {"status": "starting"}
        }
    )

    if claim.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Table is no longer available. Please refresh."
        )
    try:
        await db.sessions.insert_one(session.copy())
    except Exception:
        await db.tables.update_one(
            {
                "id": table["id"],
                "status": "starting"
            },
            {
                "$set": {"status": "available"}
            }
        )
        raise   

    if linked_booking:
        booking_result = await db.ps5_bookings.update_one(
            {"id": linked_booking["id"], "status": "confirmed"},
            {
                "$set": {
                    "status": "started",
                    "started_at": iso(now_utc()),
                    "session_id": session["id"]
                }
            }
        )

        if booking_result.modified_count == 0:
            await db.sessions.delete_one({"id": session["id"]})

            await db.tables.update_one(
                {"id": table["id"], "status": "starting"},
                {"$set": {"status": "available"}}
            )

            raise HTTPException(
                status_code=409,
                detail="This booking was already started or changed. Please refresh."
            )
    table_result = await db.tables.update_one(
    {
        "id": table["id"],
        "status": "starting"
    },
    {
        "$set": {"status": "running"}
    }
)

    if table_result.modified_count == 0:
        await db.sessions.delete_one({"id": session["id"]})

        if linked_booking:
            await db.ps5_bookings.update_one(
                {
                    "id": linked_booking["id"],
                    "status": "started",
                    "session_id": session["id"]
                },
                {
                    "$set": {
                        "status": "confirmed",
                        "started_at": None,
                        "session_id": None
                    }
                }
            )

        raise HTTPException(
            status_code=409,
            detail="Table status changed while starting the session. Please refresh."
        )
    session.pop("_id", None)
    session["table"] = table
    return session

@api.post("/sessions/{session_id}/timer/continue")
async def continue_game_timer(session_id: str, user=Depends(require_permission("manage_sessions"))):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s.get("status") != "active" or not s.get("game_timer_enabled"):
        raise HTTPException(status_code=400, detail="Active game timer session not found")
    s = await _sync_game_timer(s, now_utc())
    if s.get("timer_mode") != "awaiting_decision":
        raise HTTPException(status_code=409, detail="The current timer has not expired")
    if _game_type(s) in ("pool", "ps5"):
        raise HTTPException(status_code=400, detail="This game uses fixed timer extensions. Choose a new block or end the session.")
    now = now_utc()
    segments = list(s.get("game_billing_segments", []))
    pricing = s.get("pricing_snapshot") or await _get_game_pricing()
    segments.append({"id": str(uuid.uuid4()), "kind": "countup", "elapsed_seconds": 0, "started_at": iso(now), "status": "active", "rate_per_minute": float(pricing.get(_game_type(s), {}).get("extra_minute", 5))})
    await db.sessions.update_one({"id": session_id}, {"$set": {"timer_mode": "countup", "timer_started_at": iso(now), "timer_remaining_seconds": 0, "game_billing_segments": segments, "timer_expired_at": None}})
    return await _session_with_details(await db.sessions.find_one({"id": session_id}, {"_id": 0}))


@api.post("/sessions/{session_id}/timer/extend")
async def extend_game_timer(session_id: str, body: TimerExtend, user=Depends(require_permission("manage_sessions"))):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s.get("status") != "active" or not s.get("game_timer_enabled"):
        raise HTTPException(status_code=400, detail="Active game timer session not found")
    s = await _sync_game_timer(s, now_utc())
    if s.get("timer_mode") != "awaiting_decision":
        raise HTTPException(status_code=409, detail="The current timer has not expired")
    duration = int(body.duration_minutes)
    game_type = _game_type(s)
    if game_type == "pool" and duration not in (30, 60):
        raise HTTPException(status_code=400, detail="Pool packages are 30 or 60 minutes")
    if game_type == "ps5" and duration != 30:
        raise HTTPException(status_code=400, detail="PS5 extensions are fixed 30-minute blocks")
    if game_type in ("snooker", "mini_snooker") and duration not in (30, 60):
        raise HTTPException(status_code=400, detail="Choose a 30 or 60 minute extension")
    now = now_utc()
    segments = list(s.get("game_billing_segments", []))
    pricing = s.get("pricing_snapshot") or await _get_game_pricing()
    extension_seconds = duration * 60
    if game_type == "ps5" and s.get("ps5_auto_end_at"):
        cutoff = _ps5_parse_datetime(s["ps5_auto_end_at"])
        remaining_to_cutoff = int((cutoff - now).total_seconds())
        if remaining_to_cutoff <= 0:
            raise HTTPException(status_code=409, detail="The 15-minute reservation cutoff has been reached. This session will end automatically.")
        extension_seconds = min(extension_seconds, remaining_to_cutoff)
        extension_minutes = max(1, math.ceil(extension_seconds / 60))
        segment = _new_fixed_segment(game_type, int(s.get("player_count") or 1), extension_minutes, now, pricing)
        segment["duration_seconds"] = extension_seconds
        segment["duration_minutes"] = extension_minutes
        segment["amount"] = round(float(pricing["ps5"]["players"][str(int(s.get("player_count") or 1))]) * extension_seconds / 3600.0, 2)
        segments.append(segment)
    else:
        segments.append(_new_fixed_segment(game_type, int(s.get("player_count") or 2), duration, now, pricing))
    await db.sessions.update_one({"id": session_id}, {"$set": {
        "timer_mode": "countdown", "timer_remaining_seconds": extension_seconds,
        "timer_started_at": iso(now), "timer_expired_at": None,
        "game_billing_segments": segments,
    }})
    return await _session_with_details(await db.sessions.find_one({"id": session_id}, {"_id": 0}))


@api.post("/sessions/{session_id}/snacks")
async def add_snack_to_session(session_id: str, body: SnackOrderItem, user=Depends(require_permission("manage_sessions"))):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")
    snack = await db.snacks.find_one({"id": body.snack_id}, {"_id": 0})
    if not snack:
        raise HTTPException(status_code=404, detail="Snack not found")
    
    if body.quantity <= 0:
        raise HTTPException(status_code=400, detail="Quantity must be positive")
    stock = int(snack.get("stock_quantity", 0))

    if stock <= 0:
        raise HTTPException(
            status_code=400,
            detail="This item is out of stock"
        )

    if body.quantity > stock:
        raise HTTPException(
            status_code=400,
            detail=f"Only {stock} item(s) available"
        )
    item = {
        "snack_id": snack["id"],
        "name": snack["name"],
        "price": float(snack["price"]),
        "quantity": body.quantity,
        "subtotal": float(snack["price"]) * body.quantity,
        "added_at": iso(now_utc()),
    }
    snacks = s.get("snacks", [])

    # Merge with the existing snack anywhere in the cart
    existing = next(
        (snack_item for snack_item in snacks
         if snack_item["snack_id"] == item["snack_id"]),
        None
    )

    if existing:
        existing["quantity"] += item["quantity"]
        existing["subtotal"] = (
            existing["quantity"] * existing["price"]
        )
    else:
        snacks.append(item)
    snacks_amount = sum(i["subtotal"] for i in snacks)
    # Deduct stock atomically before updating the session.
    stock_result = await db.snacks.update_one(
        {
            "id": snack["id"],
            "stock_quantity": {"$gte": body.quantity}
        },
        {
            "$inc": {"stock_quantity": -body.quantity}
        }
    )

    if stock_result.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Insufficient stock. Please refresh and try again."
        )

    # Update the session only after stock deduction succeeds.
    try:
        session_result = await db.sessions.update_one(
            {
                "id": session_id,
                "status": "active"
            },
            {
                "$set": {
                    "snacks": snacks,
                    "snacks_amount": snacks_amount
                }
            }
        )

        if session_result.modified_count == 0:
            raise HTTPException(
                status_code=409,
                detail="Session is no longer active. Please refresh."
            )

    except Exception:
        # Restore stock if the session update fails.
        await db.snacks.update_one(
            {"id": snack["id"]},
            {"$inc": {"stock_quantity": body.quantity}}
        )
        raise
    s["snacks_total"] = snacks_amount

    return s

@api.delete("/sessions/{session_id}/snacks/{index}")
async def remove_snack_from_session(
    session_id: str,
    index: int,
    user=Depends(require_permission("manage_sessions"))
):
    s = await db.sessions.find_one(
        {"id": session_id, "status": "active"},
        {"_id": 0}
    )

    if not s:
        raise HTTPException(
            status_code=400,
            detail="Session is not active"
        )

    snacks = s.get("snacks", [])

    if index < 0 or index >= len(snacks):
        raise HTTPException(
            status_code=404,
            detail="Item not found"
        )

    item = snacks[index]
    snack_id = item["snack_id"]

    # Remove one unit from the session cart.
    if item["quantity"] > 1:
        item["quantity"] -= 1
        item["subtotal"] = item["quantity"] * item["price"]
    else:
        snacks.pop(index)

    snacks_amount = round(
        sum(float(i.get("subtotal", 0)) for i in snacks),
        2
    )

    # Save the session first, only if it is still active
    result = await db.sessions.update_one(
        {
            "id": session_id,
            "status": "active"
        },
        {
            "$set": {
                "snacks": snacks,
                "snacks_amount": snacks_amount
            }
        }
    )

    if result.modified_count == 0:
        raise HTTPException(
            status_code=409,
            detail="Session changed. Please refresh and try again."
        )

    # Restore exactly one unit after successful session update.
    await db.snacks.update_one(
        {"id": snack_id},
        {"$inc": {"stock_quantity": 1}}
    )

    updated_session = await db.sessions.find_one(
        {"id": session_id},
        {"_id": 0}
    )

    await _session_with_details(updated_session)
    return updated_session

@api.post("/sessions/{session_id}/pause")
async def pause_session(
    session_id: str,
    reason: str = "MANUAL",
    user=Depends(require_permission("manage_sessions")),
):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})

    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    if s.get("game_timer_enabled"):
        s = await _sync_game_timer(s, now_utc())

    if s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")

    if s.get("is_paused"):
        raise HTTPException(
            status_code=400,
            detail="Session is already paused"
            )

    if reason not in ["MANUAL", "BILLING"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid pause reason"
    )

    if s.get("billing_type") == "membership":
        s = await _settle_membership_usage(s, now_utc())
        if s.get("membership_exhausted"):
            raise HTTPException(status_code=409, detail="Membership daily allowance exhausted")

    pause_now = now_utc()
    timer_updates = _pause_game_timer(s, pause_now) if s.get("game_timer_enabled") else {}
    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "is_paused": True,
                "pause_started_at": iso(pause_now),
                "pause_reason": reason,
                **timer_updates,
            }
        },
    )

    s.update(timer_updates)
    s["is_paused"] = True
    s["pause_started_at"] = iso(pause_now)
    s["pause_reason"] = reason
    s["table"] = await db.tables.find_one(
        {"id": s["table_id"]},
        {"_id": 0}
    )

    return s

@api.post("/sessions/{session_id}/resume")
async def resume_session(
    session_id: str,
    user=Depends(require_permission("manage_sessions")),
):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})

    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    if s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")

    if not s.get("is_paused"):
        raise HTTPException(status_code=400, detail="Session is not paused")
    if s.get("membership_exhausted"):
        raise HTTPException(status_code=409, detail="Membership allowance is exhausted. End this session or continue with normal billing.")
    if s.get("billing_type") == "membership":
        membership = await db.memberships.find_one({"id": s.get("membership_id")}, {"_id": 0})
        if not membership:
            raise HTTPException(status_code=409, detail="Membership record not found")
            
        state = await _membership_status(membership)
        if state["is_expired"] or state["remaining_seconds_today"] <= 0:
            raise HTTPException(status_code=409, detail="Membership has no remaining time today")

    pause_started_at = datetime.fromisoformat(s["pause_started_at"])
    paused_seconds = s.get("paused_seconds", 0)

    paused_seconds += (now_utc() - pause_started_at).total_seconds()

    resume_now = now_utc()
    timer_updates = _resume_game_timer(s, resume_now) if s.get("game_timer_enabled") else {}
    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "is_paused": False,
                "pause_started_at": None,
                "paused_seconds": paused_seconds,
                "pause_reason": None,
                **timer_updates,
                **({"membership_usage_cursor": iso(resume_now)} if s.get("billing_type") == "membership" else {}),
            }
        },
    )

    s["is_paused"] = False
    s["pause_started_at"] = None
    s["paused_seconds"] = paused_seconds
    s["pause_reason"] = None
    s.update(timer_updates)
    s["table"] = await db.tables.find_one(
        {"id": s["table_id"]},
        {"_id": 0}
    )

    return s

@api.post("/sessions/{session_id}/finalize-preview")
async def finalize_preview(session_id: str, user=Depends(require_permission("manage_sessions"))):
    """Build a fresh, session-level billing snapshot without persisting a freeze."""
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")

    now = now_utc()
    if s.get("game_timer_enabled"):
        s = await _sync_game_timer(s, now)
    if s.get("billing_type") == "membership" and not s.get("is_paused"):
        s = await _settle_membership_usage(s, now)

    end = now
    start = datetime.fromisoformat(s["start_time"])
    paused_seconds = float(s.get("paused_seconds", 0) or 0)
    if s.get("is_paused") and s.get("pause_started_at"):
        paused_seconds += max(
            0,
            (end - datetime.fromisoformat(s["pause_started_at"])).total_seconds(),
        )

    duration_seconds = max(0, (end - start).total_seconds() - paused_seconds)
    duration_minutes = int(duration_seconds / 60)
    rate = float(s.get("rate_used", 0))

    if s.get("game_timer_enabled"):
        duration_seconds = _game_timer_played_seconds(s, end)
        duration_minutes = int(duration_seconds / 60)
        table_amount = _game_timer_amount(s, end)
    elif s.get("billing_type") == "membership":
        table_amount = float(s.get("membership_extra_player_charge", 0))
    else:
        table_amount = round((duration_seconds / 3600.0) * rate, 2)

    snacks_amount = round(
        sum(
            float(item.get("subtotal", float(item.get("price", 0)) * int(item.get("quantity", 0))))
            for item in s.get("snacks", [])
        ),
        2,
    )
    rd_amount = (
        round(float(s.get("rd_amount") or 0), 2)
        if s.get("rd_selected") and _game_type(s) in ("snooker", "mini_snooker")
        else 0.0
    )
    rd_additional = 0.0 if s.get("game_timer_enabled") else rd_amount
    grand_total_exact = round(table_amount + rd_additional + snacks_amount, 2)
    grand_total = int(round(grand_total_exact))

    await _session_with_details(s)
    return {
        **s,
        "freeze_snapshot": {
            "end_time": iso(end),
            "duration_seconds": int(duration_seconds),
            "duration_minutes": duration_minutes,
            "table_amount": table_amount,
            "rd_amount": rd_amount,
            "snacks_amount": snacks_amount,
            "grand_total_exact": grand_total_exact,
            "grand_total": grand_total,
        },
    }

@api.post("/sessions/{session_id}/end")
async def end_session(session_id: str, body: SessionEnd, user=Depends(require_permission("manage_sessions"))):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")
    automatic_end = bool(body.automatic_end and s.get("game_type") == "ps5" and s.get("ps5_auto_end_at"))
    end = _ps5_parse_datetime(s["ps5_auto_end_at"]) if automatic_end else now_utc()
    if automatic_end and end > now_utc():
        raise HTTPException(status_code=409, detail="PS5 reservation cutoff has not been reached yet")
    if s.get("game_timer_enabled"):
        s = await _sync_game_timer(s, end)
    if s.get("billing_type") == "membership" and not s.get("is_paused"):
        s = await _settle_membership_usage(s, end)

    # Use the exact reservation cutoff timestamp even if the worker wakes late.
    start_dt = datetime.fromisoformat(s["start_time"])

    paused_seconds = float(s.get("paused_seconds", 0))

    if s.get("is_paused") and s.get("pause_started_at"):
        pause_started = datetime.fromisoformat(
            s["pause_started_at"]
        )
        paused_seconds += max(
            0,
            (end - pause_started).total_seconds()
        )

    duration_seconds = max(
        0,
        (end - start_dt).total_seconds() - paused_seconds
    )

    duration_minutes = int(duration_seconds / 60)
    rate = float(s.get("rate_used", 0))

    # Calculate table amount using the same billing logic as finalize-preview.
    if s.get("game_timer_enabled"):
        duration_seconds = _game_timer_played_seconds(s, end)
        duration_minutes = int(duration_seconds / 60)
        table_amount = _game_timer_amount(s, end)

    elif s.get("billing_type") == "membership":
        table_amount = float(s.get("membership_extra_player_charge", 0))

    else:
        table_amount = round(
            (duration_seconds / 3600.0) * rate, 2
        )

    payment_method = "credit" if automatic_end else (body.payment_method or "cash").lower()
    if payment_method not in PAYMENT_METHODS:
        raise HTTPException(status_code=400, detail=f"Invalid payment_method. Allowed: {', '.join(PAYMENT_METHODS)}")
    # Use freeze_snapshot from the modal if provided; otherwise compute fresh from now.

    snacks_amount = round(
    sum(
        float(item.get("subtotal", float(item.get("price", 0)) * int(item.get("quantity", 0))))
        for item in s.get("snacks", [])
    ),
    2,
    )
    
    rd_amount = (
        round(float(s.get("rd_amount") or 0), 2)
        if s.get("rd_selected") and _game_type(s) in ("snooker", "mini_snooker")
        else 0.0
    )

    rd_additional = 0.0 if s.get("game_timer_enabled") else rd_amount

    gross_subtotal = (
        table_amount + rd_additional + snacks_amount
    )

    discount = float(body.discount or 0)
    tax_percent = float(body.tax_percent or 0)

    # Validate discount
    if not 0 <= discount <= gross_subtotal:
        raise HTTPException(
            status_code=400,
            detail="Invalid discount amount"
        )

    # Validate tax
    if not 0 <= tax_percent <= 100:
        raise HTTPException(
            status_code=400,
            detail="Invalid tax percentage"
        )

    subtotal = gross_subtotal - discount

    tax_amount = round(
        subtotal * tax_percent / 100,
        2
    )

    grand_total_exact = round(subtotal + tax_amount, 2)
    grand_total = int(round(grand_total_exact))  # nearest whole rupee — frozen
    invoice_no = "INV-" + datetime.now().strftime("%Y%m%d") + "-" + s["id"][:6].upper()

    # Auto-ended sessions are invoiced as credit/outstanding, never as collected cash.
    split_payments = []
    if automatic_end:
        split_payments = [{"method": "credit", "amount": grand_total}] if grand_total > 0 else []
    elif body.payments:
        for p in body.payments:
            m = (p.get("method") or "").lower()
            amt = float(p.get("amount") or 0)
            if m not in PAYMENT_METHODS:
                raise HTTPException(status_code=400, detail=f"Invalid payment method '{m}'")
            if amt > 0:
                split_payments.append({"method": m, "amount": round(amt, 2)})
    if not split_payments and not automatic_end:
        split_payments = [{"method": payment_method, "amount": grand_total}]
    total_paid = round(sum(p["amount"] for p in split_payments), 2)
    if not automatic_end and abs(total_paid - grand_total) > 0.5:
        raise HTTPException(status_code=400, detail=f"Payments ({total_paid}) don't match total ({grand_total})")
    primary_method = "credit" if automatic_end else (split_payments[0]["method"] if len(split_payments) == 1 else "split")

    update = {
        "end_time": iso(end),
        "duration_minutes": duration_minutes,
        "table_amount": table_amount,
        "rd_amount": rd_amount,
        "discount": discount,
        "tax_percent": tax_percent,
        "tax_amount": tax_amount,
        "grand_total": grand_total,
        "grand_total_exact": grand_total_exact,
        "status": "completed",
        "rd_selected": bool(s.get("rd_selected")),
        "invoice_no": invoice_no,
        "ended_at": iso(end),
        "payment_method": primary_method,
        "payments": split_payments,
        "payment_notes": ("Automatically ended 15 minutes before the next PS5 reservation. Payment pending as credit." if automatic_end else (body.payment_notes or "")),
        "automatic_end_reason": "UPCOMING_RESERVATION" if automatic_end else None,
        "ended_by": user["id"],
        "ended_by_name": user.get("name", ""),
    }
    payment_docs = [
    {
        "id": str(uuid.uuid4()),
        "session_id": session_id,
        "invoice_no": invoice_no,
        "amount": p["amount"],
        "method": p["method"],
        "notes": body.payment_notes or "",
        "table_number": s["table_number"],
        "customer_name": s.get("customer_name") or "",
        "created_at": iso(end),
    }
    for p in split_payments
    ]

    await asyncio.gather(
        db.sessions.update_one(
            {"id": session_id},
            {"$set": update}
        ),
        db.tables.update_one(
            {"id": s["table_id"]},
            {"$set": {"status": "available"}}
        ),
        *[
            db.payments.insert_one(payment)
            for payment in payment_docs
        ],
    )
    if s.get("ps5_booking_id"):
        await db.ps5_bookings.update_one(
            {"id": s["ps5_booking_id"], "status": "started"},
            {"$set": {"status": "completed", "completed_at": iso(end)}}
        )
    s = await db.sessions.find_one(
        {"id": session_id},
        {"_id": 0}
    )
    # Atomic marker guarantees the realtime event is broadcast once even if
    # the end request is retried or two staff devices submit close together.
    alert_marker = await db.sessions.update_one(
        {"id": session_id, "status": "completed", "session_ended_alert_sent": {"$ne": True}},
        {"$set": {"session_ended_alert_sent": True}},
    )
    if alert_marker.modified_count:
        s["session_ended_alert_sent"] = True
        await _send_session_ended_alert(s)
    await _session_with_details(s)
    return s

@api.post("/sessions/{session_id}/continue-normal")
async def continue_membership_as_normal(session_id: str, user=Depends(require_permission("manage_sessions"))):
    """Close an exhausted membership session and start normal billing on the same table.
    Existing snacks move to the new session so they are billed once.
    """
    old = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not old or old.get("status") != "active" or old.get("billing_type") != "membership":
        raise HTTPException(status_code=400, detail="Active membership session not found")
    if not old.get("membership_exhausted"):
        raise HTTPException(status_code=409, detail="Membership allowance has not been exhausted")
    table = await db.tables.find_one({"id": old["table_id"]}, {"_id": 0})
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    now = now_utc()
    exhausted_at = datetime.fromisoformat(old.get("pause_started_at") or iso(now))
    await db.sessions.update_one({"id": session_id}, {"$set": {
        "status": "completed", "end_time": iso(exhausted_at), "ended_at": iso(exhausted_at),
        "table_amount": 0.0,
        "grand_total": 0, "grand_total_exact": 0.0, "discount": 0.0,
        "tax_amount": 0.0, "payment_method": "membership", "membership_converted": True,
        "ended_by": user["id"], "ended_by_name": user.get("name", ""),
        "session_ended_alert_sent": True,
    }})
    await _send_session_ended_alert({**old, "grand_total": 0, "ended_at": iso(exhausted_at)})
    new_session = {
        "id": str(uuid.uuid4()), "table_id": table["id"], "table_number": table["table_number"],
        "customer_name": old.get("customer_name", ""), "notes": old.get("notes", ""),
        "billing_type": "normal", "membership_id": None, "start_time": iso(now), "end_time": None,
        "is_paused": False, "pause_started_at": None, "paused_seconds": 0, "pause_reason": None,
        "duration_minutes": 0, "rate_used": float(table["hourly_rate"]), "table_amount": 0.0,
        "snacks": old.get("snacks", []), "snacks_amount": float(old.get("snacks_amount", 0)),
        "discount": 0.0, "tax_percent": 0.0, "tax_amount": 0.0, "grand_total": 0.0,
        "status": "active", "started_by": user["id"], "started_by_name": user.get("name", ""),
        "payment_method": None, "payment_notes": "",
        "continued_from_membership_session_id": session_id,
    }
    await db.sessions.insert_one(new_session.copy())
    await db.sessions.update_one({"id": session_id}, {"$set": {"snacks": [], "snacks_amount": 0.0}})
    new_session["table"] = table
    return new_session


async def timed_dashboard_query(name, operation):
    start = time.perf_counter()
    try:
        result = await operation
        return result
    finally:
        elapsed_ms = (time.perf_counter() - start) * 1000
        logger.info(
            "DASHBOARD_QUERY name=%s duration_ms=%.2f",
            name,
            elapsed_ms,
        )


# ---- Dashboard ----
@api.get("/dashboard/stats")
async def dashboard_stats(user=Depends(require_permission("view_dashboard"))):
    today_start, today_end = local_day_range()
    tables, active_table_sessions, active_ps5_sessions, completed_today, food_orders_today, membership_payments_today = await asyncio.gather(
        timed_dashboard_query(
            "tables",
            db.tables.find(
                {},
                {"_id": 0, "status": 1, "game_type": 1, "table_size": 1}
            ).to_list(1000),
        ),
        timed_dashboard_query(
            "active_table_sessions",
            db.sessions.count_documents({
                "status": "active",
                "game_type": {"$ne": "ps5"},
            }),
        ),
        timed_dashboard_query(
            "active_ps5_sessions",
            db.sessions.count_documents({
                "status": "active",
                "game_type": "ps5",
            }),
        ),
        timed_dashboard_query(
            "completed_sessions_today",
            db.sessions.find(
                {
                    "status": "completed",
                    "ended_at": {"$gte": iso(today_start),"$lt": iso(today_end)}
                },
                {
                    "_id": 0,
                    "grand_total": 1,
                    "snacks_amount": 1
                }
            ).to_list(1000),
        ),
        timed_dashboard_query(
            "food_orders_today",
            db.food_orders.find(
                {
                    "status": "completed",
                    "paid_at": {"$gte": iso(today_start),"$lt": iso(today_end)}
                },
                {
                    "_id": 0,
                    "final_total": 1,
                    "total": 1
                }
            ).to_list(1000),
        ),
        timed_dashboard_query(
            "membership_payments_today",
            db.payments.find(
                {
                    "source_type": "membership",
                    "created_at": {"$gte": iso(today_start), "$lt": iso(today_end)}
                },
                {"_id": 0, "amount": 1}
            ).to_list(1000),
        ),
    )

    table_revenue_today = round(
    sum(
        float(s.get("grand_total", 0))
        for s in completed_today
    ),2)

    regular_tables = [t for t in tables if t.get("game_type") != "ps5"]
    ps5_stations = [t for t in tables if t.get("game_type") == "ps5"]

    available = sum(1 for t in regular_tables if t.get("status") == "available")
    occupied = sum(1 for t in regular_tables if t.get("status") == "running")
    available_ps5 = sum(1 for t in ps5_stations if t.get("status") == "available")

    food_only_snacks_revenue = round(
        sum(
            float(
                o.get(
                    "final_total",
                    o.get("total", 0)
                )
            )
            for o in food_orders_today
        ),
        2
    )

    membership_revenue_today = round(
        sum(float(p.get("amount", 0)) for p in membership_payments_today),
        2
    )

    today_revenue = round(
        table_revenue_today + food_only_snacks_revenue + membership_revenue_today,
        2
    )

    today_snacks_revenue = round(
        sum(
            float(s.get("snacks_amount", 0))
            for s in completed_today
        ) + food_only_snacks_revenue,
        2
    )
    today_sessions = len(completed_today) + active_table_sessions + active_ps5_sessions
    return {
        "today_revenue": today_revenue,
        "membership_revenue": membership_revenue_today,
        "active_sessions": active_table_sessions + active_ps5_sessions,
        "active_table_sessions": active_table_sessions,
        "active_ps5_sessions": active_ps5_sessions,
        "available_tables": available,
        "occupied_tables": occupied,
        "available_ps5": available_ps5,
        "snacks_revenue": today_snacks_revenue,
        "today_sessions": today_sessions,
        "total_tables": len(regular_tables),
        "total_ps5": len(ps5_stations),
    }

@api.get("/dashboard/charts")
async def dashboard_charts(user=Depends(require_permission("view_dashboard"))):
    # Daily revenue for last 7 days
    now = datetime.now(timezone.utc)
    daily_start = (now - timedelta(days=6)).replace(
    hour=0,
    minute=0,
    second=0,
    microsecond=0
)
    daily_end = now + timedelta(days=1)

    recent_sessions = await timed_dashboard_query(
        "charts_daily_revenue",
        db.sessions.find(
            {
                "status": "completed",
                "ended_at": {
                    "$gte": iso(daily_start),
                    "$lt": iso(daily_end)
                }
            },
            {
                "_id": 0,
                "ended_at": 1,
                "grand_total": 1
            }
        ).to_list(2000),
    )

    membership_payments = await timed_dashboard_query(
        "charts_membership_revenue",
        db.payments.find(
            {
                "source_type": "membership",
                "created_at": {
                    "$gte": iso(daily_start),
                    "$lt": iso(daily_end)
                }
            },
            {"_id": 0, "created_at": 1, "amount": 1}
        ).to_list(2000),
    )

    daily_map = {}

    for r in recent_sessions:
        ended_at = r.get("ended_at")

        if not ended_at:
            continue

        try:
            day_key = datetime.fromisoformat(ended_at).date()
        except Exception:
            continue

        if day_key not in daily_map:
            daily_map[day_key] = {
                "revenue": 0.0,
                "sessions": 0
            }

        daily_map[day_key]["revenue"] += float(
            r.get("grand_total", 0)
        )

        daily_map[day_key]["sessions"] += 1

    for payment in membership_payments:
        created_at = payment.get("created_at")
        if not created_at:
            continue
        try:
            day_key = datetime.fromisoformat(created_at).date()
        except Exception:
            continue
        if day_key not in daily_map:
            daily_map[day_key] = {"revenue": 0.0, "sessions": 0}
        daily_map[day_key]["revenue"] += float(payment.get("amount", 0))

    daily = []

    for i in range(6, -1, -1):
        d = (now - timedelta(days=i)).date()

        data = daily_map.get(
            d,
            {
                "revenue": 0.0,
                "sessions": 0
            }
        )

        daily.append({
            "date": d.strftime("%a"),
            "revenue": round(data["revenue"], 2),
            "sessions": data["sessions"]
        })
    # Snack sales — top 5
    pipeline = [
        {"$match": {"status": "completed"}},
        {"$unwind": "$snacks"},
        {"$group": {"_id": "$snacks.name", "qty": {"$sum": "$snacks.quantity"}, "revenue": {"$sum": "$snacks.subtotal"}}},
        {"$sort": {"qty": -1}},
        {"$limit": 5},
    ]

    # Peak hours
    pipeline2 = [
        {"$match": {"status": "completed", "start_time": {"$ne": None}}},
        {"$project": {"hour": {"$hour": {"$dateFromString": {"dateString": "$start_time"}}}}},
        {"$group": {"_id": "$hour", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    
    snacks_agg, hours_agg = await asyncio.gather(
        timed_dashboard_query(
            "charts_snack_sales",
            db.sessions.aggregate(pipeline).to_list(10),
        ),
        timed_dashboard_query(
            "charts_peak_hours",
            db.sessions.aggregate(pipeline2).to_list(24),
        ),
    )

    snack_sales = [{"name": x["_id"], "qty": x["qty"], "revenue": round(x["revenue"], 2)} for x in snacks_agg]
    peak = [{"hour": f"{x['_id']:02d}:00", "sessions": x["count"]} for x in hours_agg]
    return {"daily": daily, "snack_sales": snack_sales, "peak_hours": peak}

@api.get("/dashboard/recent")
async def dashboard_recent(user=Depends(require_permission("view_dashboard"))):
    sessions, bills = await asyncio.gather(
    db.sessions.find(
        {},
        {"_id": 0}
    ).sort("start_time", -1).limit(5).to_list(5),

    db.sessions.find(
        {"status": "completed"},
        {"_id": 0}
    ).sort("ended_at", -1).limit(5).to_list(5),
)
    return {"sessions": sessions, "bills": bills}

# ---- Reports ----
@api.get("/reports")
async def reports(
    period: str = Query("daily"),
    start: Optional[str] = None,
    end: Optional[str] = None,
    user=Depends(require_permission("view_reports"))
):
    d_start, d_end = _period_range(period, start, end)

    sessions = await db.sessions.find(
        {
            "status": "completed",
            "ended_at": {
                "$gte": iso(d_start),
                "$lt": iso(d_end)
            }
        },
        {"_id": 0}
    ).to_list(5000)

    # Food-only sales
    food_orders = await db.food_orders.find(
        {
            "status": "completed",
            "paid_at": {
                "$gte": iso(d_start),
                "$lt": iso(d_end)
            }
        },
        {"_id": 0}
    ).to_list(5000)

    # Membership purchases are recorded in db.payments.
    membership_payments = await db.payments.find(
        {
            "source_type": "membership",
            "created_at": {
                "$gte": iso(d_start),
                "$lt": iso(d_end)
            }
        },
        {"_id": 0}
    ).sort("created_at", -1).to_list(5000)
    membership_revenue = round(
        sum(float(p.get("amount", 0)) for p in membership_payments),
        2
    )

    total_sessions = len(sessions)

    # Table/session revenue
    table_revenue = round(
        sum(float(s.get("table_amount", 0)) for s in sessions),
        2
    )

    # Snacks attached to table sessions
    session_snack_revenue = round(
        sum(float(s.get("snacks_amount", 0)) for s in sessions),
        2
    )

    # Food-only revenue
    food_only_revenue = round(
        sum(float(o.get("final_total", o.get("total", 0))) for o in food_orders),
        2
    )

    # Combined snack revenue
    snack_revenue = round(
        session_snack_revenue + food_only_revenue,
        2
    )

    # Total revenue
    total_revenue = round(
        sum(float(s.get("grand_total", 0)) for s in sessions)
        + food_only_revenue
        + membership_revenue,
        2
    )

    avg_duration = round(sum(s.get("duration_minutes", 0) for s in sessions) / total_sessions, 1) if total_sessions else 0
    # best tables
    table_totals = {}
    for s in sessions:
        k = s.get("table_number", "?")
        table_totals[k] = table_totals.get(k, 0) + s.get("grand_total", 0)
    best_tables = sorted([{"table": k, "revenue": round(v, 2)} for k, v in table_totals.items()], key=lambda x: -x["revenue"])[:5]
        # Best snacks
    snack_totals = {}

    # Snacks sold with table sessions
    for s in sessions:
        for item in s.get("snacks", []):
            n = item["name"]

            snack_totals[n] = snack_totals.get(
                n,
                {"qty": 0, "revenue": 0}
            )

            snack_totals[n]["qty"] += int(
                item.get("quantity", 0)
            )

            snack_totals[n]["revenue"] += float(
                item.get("subtotal", 0)
            )

        # Food-only snacks
    for order in food_orders:
        for item in order.get("items", []):
            n = item["name"]

            snack_totals[n] = snack_totals.get(
                n,
                {"qty": 0, "revenue": 0}
            )

            snack_totals[n]["qty"] += int(
                item.get("quantity", 0)
            )

            snack_totals[n]["revenue"] += float(
                item.get("subtotal", 0)
            )

    # Best snacks
    best_snacks = sorted(
        [
            {
                "name": n,
                **v,
                "revenue": round(v["revenue"], 2)
            }
            for n, v in snack_totals.items()
        ],
        key=lambda x: -x["qty"],
    )[:5]


    # Detailed snack sales
    snack_details = []

    # Table sessions
    for s in sessions:
        snacks = s.get("snacks", [])

        if not snacks:
            continue

        snack_list = []
        total_qty = 0
        snack_detail_revenue = 0

        for item in snacks:
            quantity = int(item.get("quantity", 0))
            revenue = float(item.get("subtotal", 0))

            snack_list.append({
                "name": item.get("name", ""),
                "quantity": quantity,
            })

            total_qty += quantity
            snack_detail_revenue += revenue

        snack_details.append({
            "source": "table",
            "table_number": s.get("table_number", "?"),
            "customer_name": s.get("customer_name", ""),
            "snacks": snack_list,
            "total_qty": total_qty,
            "revenue": round(snack_detail_revenue, 2),
            "sold_at": s.get(
                "ended_at",
                s.get("start_time", "")
            ),
        })


    # Food Only orders
    for order in food_orders:
        items = order.get("items", [])

        if not items:
            continue

        snack_list = []
        total_qty = 0
        snack_detail_revenue = 0
        for item in items:
            quantity = int(item.get("quantity", 0))
            revenue = float(item.get("subtotal", 0))

            snack_list.append({
                "name": item.get("name", ""),
                "quantity": quantity,
            })

            total_qty += quantity
            snack_detail_revenue += revenue

        snack_details.append({
            "source": "food_only",
            "table_number": "Food Only",
            "customer_name": order.get("customer_name", ""),
            "snacks": snack_list,
            "total_qty": total_qty,
            "revenue": round(snack_detail_revenue, 2),
            "sold_at": order.get(
                "paid_at",
                order.get("created_at", "")
            ),
        })


    # Sort all snack sales
    snack_details.sort(
        key=lambda x: x.get("sold_at", ""),
        reverse=True
    )


    # Count customers
    customers = len({
        name.strip().lower()
        for name in (
            [s.get("customer_name", "") for s in sessions]
            + [o.get("customer_name", "") for o in food_orders]
            + [p.get("customer_name", "") for p in membership_payments]
        )
        if name and name.strip()
    })


    return {
        "period": period,
        "start": iso(d_start),
        "end": iso(d_end),
        "total_sessions": total_sessions,
        "total_revenue": total_revenue,
        "table_revenue": table_revenue,
        "snack_revenue": snack_revenue,
        "food_only_revenue": food_only_revenue,
        "food_only_orders": len(food_orders),
        "membership_revenue": membership_revenue,
        "membership_payments": membership_payments,
        "avg_duration_min": avg_duration,
        "best_tables": best_tables,
        "best_snacks": best_snacks,
        "snack_details": snack_details,
        "total_customers": customers,
        "sessions": sessions,
    }

# ---- Expense Category Management ----

def _clean_category_name(name: str) -> str:
    return " ".join((name or "").strip().split())


def _category_response(category: dict) -> dict:
    return {
        "id": category["id"],
        "name": category["name"],
        "active": category.get("active", True),
        "sort_order": category.get("sort_order", 0),
        "subcategories": [
            {
                "id": s["id"],
                "name": s["name"],
                "active": s.get("active", True),
            }
            for s in category.get("subcategories", [])
        ],
        "created_at": category.get("created_at"),
        "updated_at": category.get("updated_at"),
    }


async def _find_expense_category(category_id: str):
    category = await db.expense_categories.find_one(
        {"id": category_id},
        {"_id": 0}
    )

    if not category:
        raise HTTPException(
            status_code=404,
            detail="Expense category not found"
        )

    return category


@api.get("/expenses/categories")
async def list_expense_categories(
    user=Depends(require_permission("view_expenses"))
):
    categories = await db.expense_categories.find(
        {"active": True},
        {"_id": 0}
    ).sort("sort_order", 1).to_list(500)

    result = {}

    for category in categories:
        result[category["name"]] = [
            s["name"]
            for s in category.get("subcategories", [])
            if s.get("active", True)
        ]

    return {
        "categories": result,
        "payment_methods": PAYMENT_METHODS,
    }


@api.get("/expenses/category-management")
async def expense_category_management(
    user=Depends(require_permission("view_expenses"))
):
    categories = await db.expense_categories.find(
        {},
        {"_id": 0}
    ).sort("sort_order", 1).to_list(500)

    return {
        "categories": [
            _category_response(c)
            for c in categories
        ]
    }


@api.post("/expenses/categories")
async def create_expense_category(
    body: ExpenseCategoryCreate,
    user=Depends(require_permission("manage_expenses"))
):
    name = _clean_category_name(body.name)

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Category name is required"
        )

    existing = await db.expense_categories.find_one({
        "name": {
            "$regex": f"^{name}$",
            "$options": "i"
        }
    })

    if existing:
        raise HTTPException(
            status_code=400,
            detail="Category already exists"
        )

    last = await db.expense_categories.find_one(
        {},
        sort=[("sort_order", -1)]
    )

    sort_order = (
        int(last.get("sort_order", 0)) + 1
        if last else 1
    )

    now = iso(now_utc())

    category = {
        "id": str(uuid.uuid4()),
        "name": name,
        "active": True,
        "sort_order": sort_order,
        "subcategories": [],
        "created_at": now,
        "updated_at": now,
    }

    await db.expense_categories.insert_one(
        category.copy()
    )

    return _category_response(category)


@api.put("/expenses/categories/{category_id}")
async def update_expense_category(
    category_id: str,
    body: ExpenseCategoryUpdate,
    user=Depends(require_permission("manage_expenses"))
):
    category = await _find_expense_category(category_id)

    new_name = _clean_category_name(body.name)

    if not new_name:
        raise HTTPException(
            status_code=400,
            detail="Category name is required"
        )

    old_name = category["name"]

    if new_name.lower() != old_name.lower():
        duplicate = await db.expense_categories.find_one({
            "name": {
                "$regex": f"^{new_name}$",
                "$options": "i"
            },
            "id": {"$ne": category_id}
        })

        if duplicate:
            raise HTTPException(
                status_code=400,
                detail="Category already exists"
            )

    await db.expense_categories.update_one(
        {"id": category_id},
        {
            "$set": {
                "name": new_name,
                "updated_at": iso(now_utc())
            }
        }
    )

    if old_name != new_name:
        await db.expenses.update_many(
            {"category": old_name},
            {"$set": {"category": new_name}}
        )

        await db.recurring_expenses.update_many(
            {"category": old_name},
            {"$set": {"category": new_name}}
        )

    return await _find_expense_category(category_id)


@api.delete("/expenses/categories/{category_id}")
async def archive_expense_category(
    category_id: str,
    user=Depends(require_permission("manage_expenses"))
):
    category = await _find_expense_category(category_id)

    if not category.get("active", True):
        raise HTTPException(
            status_code=400,
            detail="Category is already archived"
        )

    await db.expense_categories.update_one(
        {"id": category_id},
        {
            "$set": {
                "active": False,
                "updated_at": iso(now_utc())
            }
        }
    )

    return {
        "ok": True,
        "message": "Category archived"
    }


@api.post(
    "/expenses/categories/{category_id}/subcategories"
)
async def create_expense_subcategory(
    category_id: str,
    body: ExpenseSubcategoryCreate,
    user=Depends(require_permission("manage_expenses"))
):
    category = await _find_expense_category(category_id)

    if not category.get("active", True):
        raise HTTPException(
            status_code=400,
            detail="Cannot modify an archived category"
        )

    name = _clean_category_name(body.name)

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Sub-category name is required"
        )

    for sub in category.get("subcategories", []):
        if sub["name"].lower() == name.lower():
            raise HTTPException(
                status_code=400,
                detail="Sub-category already exists"
            )

    subcategory = {
        "id": str(uuid.uuid4()),
        "name": name,
        "active": True,
        "created_at": iso(now_utc()),
    }

    await db.expense_categories.update_one(
        {"id": category_id},
        {
            "$push": {
                "subcategories": subcategory
            },
            "$set": {
                "updated_at": iso(now_utc())
            }
        }
    )

    return subcategory


@api.put(
    "/expenses/categories/{category_id}/subcategories/{subcategory_id}"
)
async def update_expense_subcategory(
    category_id: str,
    subcategory_id: str,
    body: ExpenseSubcategoryUpdate,
    user=Depends(require_permission("manage_expenses"))
):
    category = await _find_expense_category(category_id)

    new_name = _clean_category_name(body.name)

    if not new_name:
        raise HTTPException(
            status_code=400,
            detail="Sub-category name is required"
        )

    target = None

    for sub in category.get("subcategories", []):
        if sub["id"] == subcategory_id:
            target = sub
            break

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Sub-category not found"
        )

    old_name = target["name"]

    await db.expense_categories.update_one(
        {
            "id": category_id,
            "subcategories.id": subcategory_id
        },
        {
            "$set": {
                "subcategories.$.name": new_name,
                "updated_at": iso(now_utc())
            }
        }
    )

    if old_name != new_name:
        await db.expenses.update_many(
            {
                "category": category["name"],
                "subcategory": old_name
            },
            {
                "$set": {
                    "subcategory": new_name
                }
            }
        )

        await db.recurring_expenses.update_many(
            {
                "category": category["name"],
                "subcategory": old_name
            },
            {
                "$set": {
                    "subcategory": new_name
                }
            }
        )

    return {
        "id": subcategory_id,
        "name": new_name,
        "active": target.get("active", True)
    }


@api.delete(
    "/expenses/categories/{category_id}/subcategories/{subcategory_id}"
)
async def archive_expense_subcategory(
    category_id: str,
    subcategory_id: str,
    user=Depends(require_permission("manage_expenses"))
):
    category = await _find_expense_category(category_id)

    target = None

    for sub in category.get("subcategories", []):
        if sub["id"] == subcategory_id:
            target = sub
            break

    if not target:
        raise HTTPException(
            status_code=404,
            detail="Sub-category not found"
        )

    await db.expense_categories.update_one(
        {
            "id": category_id,
            "subcategories.id": subcategory_id
        },
        {
            "$set": {
                "subcategories.$.active": False,
                "updated_at": iso(now_utc())
            }
        }
    )

    return {
        "ok": True,
        "message": "Sub-category archived"
    }

# ---- Expenses ----
def _parse_date(d: Optional[str]) -> datetime:
    if not d:
        return now_utc()

    try:
        parsed = datetime.fromisoformat(d.replace("Z", "+00:00"))

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=CLUB_TIMEZONE)

        return parsed.astimezone(timezone.utc)

    except Exception:
        parsed = datetime.strptime(d, "%Y-%m-%d")
        parsed = parsed.replace(tzinfo=CLUB_TIMEZONE)
        return parsed.astimezone(timezone.utc)
    
@api.get("/expenses")
async def list_expenses(
    start: Optional[str] = None, end: Optional[str] = None,
    category: Optional[str] = None, vendor_id: Optional[str] = None,
    payment_method: Optional[str] = None,
    user=Depends(require_permission("view_expenses")),
):
    q = {}
    if start or end:
        q["date"] = {}
        if start:
            q["date"]["$gte"] = iso(_parse_date(start))

        if end:
            end_date = date.fromisoformat(end) + timedelta(days=1)
            end_local = datetime.combine(
                end_date,
                datetime.min.time(),
                tzinfo=CLUB_TIMEZONE
            )
            q["date"]["$lt"] = iso(end_local.astimezone(timezone.utc))
    if category: q["category"] = category
    if vendor_id: q["vendor_id"] = vendor_id
    if payment_method: q["payment_method"] = payment_method
    rows = await db.expenses.find(q, {"_id": 0}).sort("date", -1).to_list(5000)
    return rows

@api.post("/expenses")
async def create_expense(body: ExpenseIn, user=Depends(require_permission("manage_expenses"))):
    doc = {
        "id": str(uuid.uuid4()),
        "date": iso(_parse_date(body.date)),
        "category": body.category,
        "subcategory": body.subcategory or "",
        "amount": float(body.amount),
        "payment_method": (body.payment_method or "cash").lower(),
        "vendor_id": body.vendor_id,
        "vendor_name": body.vendor_name or "",
        "notes": body.notes or "",
        "bill_url": body.bill_url or "",
        "recurring": bool(body.recurring),
        "recurring_frequency": body.recurring_frequency,
        "created_by": user["id"],
        "created_at": iso(now_utc()),
    }
    await db.expenses.insert_one(doc.copy())
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/expenses/{expense_id}")
async def update_expense(expense_id: str, body: ExpenseUpdate, user=Depends(require_permission("manage_expenses"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if "date" in update:
        update["date"] = iso(_parse_date(update["date"]))
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.expenses.update_one({"id": expense_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Expense not found")
    return await db.expenses.find_one({"id": expense_id}, {"_id": 0})

@api.delete("/expenses/{expense_id}")
async def delete_expense(expense_id: str, user=Depends(require_permission("manage_expenses"))):
    res = await db.expenses.delete_one({"id": expense_id})
    return {"deleted": res.deleted_count}

# ---- Vendors ----
@api.get("/vendors")
async def list_vendors(user=Depends(require_permission("view_expenses"))):
    return await db.vendors.find({}, {"_id": 0}).sort("name", 1).to_list(1000)

@api.post("/vendors")
async def create_vendor(body: VendorIn, user=Depends(require_permission("manage_expenses"))):
    doc = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": iso(now_utc())}
    await db.vendors.insert_one(doc.copy())
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/vendors/{vendor_id}")
async def update_vendor(vendor_id: str, body: VendorIn, user=Depends(require_permission("manage_expenses"))):
    res = await db.vendors.update_one({"id": vendor_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Vendor not found")
    return await db.vendors.find_one({"id": vendor_id}, {"_id": 0})

@api.delete("/vendors/{vendor_id}")
async def delete_vendor(vendor_id: str, user=Depends(require_permission("manage_expenses"))):
    res = await db.vendors.delete_one({"id": vendor_id})
    return {"deleted": res.deleted_count}

# ---- Recurring Expenses ----
def _compute_next_run(freq: str, day_of_month: int, base: datetime) -> datetime:
    if freq == "weekly":
        return base + timedelta(days=7)
    if freq == "yearly":
        try:
            return base.replace(year=base.year + 1)
        except ValueError:
            return base + timedelta(days=365)
    # monthly (default)
    year, month = base.year, base.month + 1
    if month > 12:
        month = 1; year += 1
    try:
        return base.replace(year=year, month=month, day=min(day_of_month, 28))
    except ValueError:
        return base + timedelta(days=30)

@api.get("/recurring-expenses")
async def list_recurring(user=Depends(require_permission("view_expenses"))):
    return await db.recurring_expenses.find({}, {"_id": 0}).sort("name", 1).to_list(500)

@api.post("/recurring-expenses")
async def create_recurring(body: RecurringIn, user=Depends(require_permission("manage_expenses"))):
    now = now_utc()
    next_run = now.replace(day=min(body.day_of_month, 28))
    if next_run < now:
        next_run = _compute_next_run(body.frequency, body.day_of_month, now)
    doc = {
        "id": str(uuid.uuid4()),
        **body.model_dump(),
        "next_run": iso(next_run),
        "last_generated": None,
        "created_at": iso(now),
    }
    await db.recurring_expenses.insert_one(doc.copy())
    return {k: v for k, v in doc.items() if k != "_id"}

@api.put("/recurring-expenses/{rec_id}")
async def update_recurring(rec_id: str, body: RecurringIn, user=Depends(require_permission("manage_expenses"))):
    res = await db.recurring_expenses.update_one({"id": rec_id}, {"$set": body.model_dump()})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Not found")
    return await db.recurring_expenses.find_one({"id": rec_id}, {"_id": 0})

@api.delete("/recurring-expenses/{rec_id}")
async def delete_recurring(rec_id: str, user=Depends(require_permission("manage_expenses"))):
    res = await db.recurring_expenses.delete_one({"id": rec_id})
    return {"deleted": res.deleted_count}

@api.post("/recurring-expenses/run-due")
async def run_due_recurring(user=Depends(require_permission("manage_expenses"))):
    """Generate expenses for all due recurring items."""
    now = now_utc()
    due = await db.recurring_expenses.find({"active": True, "next_run": {"$lte": iso(now)}}, {"_id": 0}).to_list(500)
    generated = 0
    for r in due:
        exp = {
            "id": str(uuid.uuid4()),
            "date": iso(now),
            "category": r["category"],
            "subcategory": r.get("subcategory") or "",
            "amount": float(r["amount"]),
            "payment_method": r.get("payment_method", "cash"),
            "vendor_id": r.get("vendor_id"),
            "vendor_name": r.get("vendor_name", ""),
            "notes": f"(Auto) {r.get('notes','')}",
            "bill_url": "",
            "recurring": True,
            "recurring_frequency": r["frequency"],
            "created_by": user["id"],
            "created_at": iso(now),
            "recurring_source": r["id"],
        }
        await db.expenses.insert_one(exp.copy())
        next_run = _compute_next_run(r["frequency"], r.get("day_of_month", 1), now)
        await db.recurring_expenses.update_one(
            {"id": r["id"]}, {"$set": {"last_generated": iso(now), "next_run": iso(next_run)}}
        )
        generated += 1
    return {"generated": generated}

# ---- Financial Report endpoints ----
def _period_range(period: str, start: Optional[str] = None, end: Optional[str] = None):
    def parse_start(value: str) -> datetime:
        if len(value) == 10:
            local_dt = datetime.combine(
                date.fromisoformat(value),
                datetime.min.time(),
                tzinfo=CLUB_TIMEZONE
            )
            return local_dt.astimezone(timezone.utc)

        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=CLUB_TIMEZONE)

        return dt.astimezone(timezone.utc)

    def parse_end(value: str) -> datetime:
        if len(value) == 10:
            next_day = date.fromisoformat(value) + timedelta(days=1)

            local_dt = datetime.combine(
                next_day,
                datetime.min.time(),
                tzinfo=CLUB_TIMEZONE
            )
            return local_dt.astimezone(timezone.utc)

        dt = datetime.fromisoformat(value.replace("Z", "+00:00"))

        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=CLUB_TIMEZONE)

        return dt.astimezone(timezone.utc)

    if start or end:
        d_start = parse_start(start) if start else datetime.min.replace(tzinfo=timezone.utc)
        d_end = parse_end(end) if end else now_utc()

        if d_start >= d_end:
            raise HTTPException(
                status_code=400,
                detail="End date must be after start date"
            )

        return d_start, d_end

    if period == "yesterday":
        yesterday = local_now().date() - timedelta(days=1)
        return local_day_range(yesterday)

    if period == "weekly":
        now = now_utc()
        return now - timedelta(days=7), now

    if period == "monthly":
        now = now_utc()
        return now - timedelta(days=30), now

    return local_day_range()

@api.get("/reports/pnl")
async def profit_and_loss(period: str = "monthly", start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_permission("view_profit"))):
    d_start, d_end = _period_range(period, start, end)
    # Revenue = completed sessions in range
    sessions = await db.sessions.find(
        {"status": "completed", "ended_at": {"$gte": iso(d_start), "$lt": iso(d_end)}}, {"_id": 0}
    ).to_list(10000)
    table_revenue = round(sum(s.get("table_amount", 0) for s in sessions), 2)
    snack_revenue = round(sum(s.get("snacks_amount", 0) for s in sessions), 2)
    food_orders = await db.food_orders.find(
        {
            "status": "completed",
            "paid_at": {
                "$gte": iso(d_start),
                "$lt": iso(d_end)
            }
        },
        {"_id": 0}
    ).to_list(10000)

    table_revenue = round(
        sum(float(s.get("grand_total", 0)) for s in sessions),
        2
    )

    food_only_revenue = round(
        sum(
            float(
                o.get(
                    "final_total",
                    o.get("total", 0)
                )
            )
            for o in food_orders
        ),
        2
    )

    membership_payments = await db.payments.find(
        {
            "source_type": "membership",
            "created_at": {
                "$gte": iso(d_start),
                "$lt": iso(d_end)
            }
        },
        {"_id": 0}
    ).to_list(10000)
    membership_revenue = round(
        sum(float(p.get("amount", 0)) for p in membership_payments),
        2
    )

    gross_revenue = round(
        table_revenue + food_only_revenue + membership_revenue,
        2
    )
    # Expenses in range
    exps = await db.expenses.find(
        {"date": {"$gte": iso(d_start), "$lt": iso(d_end)}}, {"_id": 0}
    ).to_list(10000)
    total_expenses = round(sum(e.get("amount", 0) for e in exps), 2)
    net_profit = round(gross_revenue - total_expenses, 2)
    margin = round((net_profit / gross_revenue * 100), 2) if gross_revenue > 0 else 0.0
    # Expense breakdown by category
    by_cat = {}
    for e in exps:
        c = e.get("category", "Miscellaneous")
        by_cat[c] = by_cat.get(c, 0) + float(e.get("amount", 0))
    expense_breakdown = sorted(
        [{"category": k, "amount": round(v, 2)} for k, v in by_cat.items()],
        key=lambda x: -x["amount"],
    )
    # Monthly trend (last 6 months) — use club-local month boundaries
    trend = []

    current_local = local_now()
    current_month_index = current_local.year * 12 + current_local.month - 1

    for i in range(5, -1, -1):
        month_index = current_month_index - i

        year = month_index // 12
        month = (month_index % 12) + 1

        month_start_local = datetime(
            year, month, 1, 0, 0, 0,
            tzinfo=CLUB_TIMEZONE
        )

        next_month_index = month_index + 1
        next_year = next_month_index // 12
        next_month = (next_month_index % 12) + 1

        month_end_local = datetime(
            next_year, next_month, 1, 0, 0, 0,
            tzinfo=CLUB_TIMEZONE
        )

        # Current month should only include data up to now
        if i == 0:
            month_end_local = current_local

        month_start_utc = month_start_local.astimezone(timezone.utc)
        month_end_utc = month_end_local.astimezone(timezone.utc)

        rev = await db.sessions.find(
            {
                "status": "completed",
                "ended_at": {
                    "$gte": iso(month_start_utc),
                    "$lt": iso(month_end_utc)
                }
            },
            {"_id": 0}
        ).to_list(5000)

        exp_rows = await db.expenses.find(
            {
                "date": {
                    "$gte": iso(month_start_utc),
                    "$lt": iso(month_end_utc)
                }
            },
            {"_id": 0}
        ).to_list(5000)

        membership_month_payments = await db.payments.find(
            {
                "source_type": "membership",
                "created_at": {
                    "$gte": iso(month_start_utc),
                    "$lt": iso(month_end_utc)
                }
            },
            {"_id": 0, "amount": 1}
        ).to_list(5000)

        revenue = (
            sum(float(x.get("grand_total", 0)) for x in rev)
            + sum(float(x.get("amount", 0)) for x in membership_month_payments)
        )
        expenses = sum(float(x.get("amount", 0)) for x in exp_rows)

        trend.append({
            "month": month_start_local.strftime("%b"),
            "revenue": round(revenue, 2),
            "expenses": round(expenses, 2),
            "profit": round(revenue - expenses, 2),
        })
    return {
        "period": period,
        "start": iso(d_start), "end": iso(d_end),
        "table_revenue": table_revenue,
        "food_only_revenue": food_only_revenue,
        "food_only_orders": len(food_orders),
        "snack_revenue": snack_revenue,
        "membership_revenue": membership_revenue,
        "other_income": 0.0,
        "gross_revenue": gross_revenue,
        "total_expenses": total_expenses,
        "net_profit": net_profit,
        "margin_percent": margin,
        "expense_breakdown": expense_breakdown,
        "revenue_sources": [
            {"name": "Table", "value": table_revenue},
            {"name": "Snacks", "value": snack_revenue},
            {"name": "Memberships", "value": membership_revenue},
        ],
        "monthly_trend": trend,
    }

@api.get("/reports/expenses")
async def report_expenses(period: str = "monthly", start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_permission("view_expenses"))):
    d_start, d_end = _period_range(period, start, end)
    exps = await db.expenses.find(
    {
        "date": {
            "$gte": iso(d_start),
            "$lt": iso(d_end)
        }
    },
    {"_id": 0}
).sort("date", -1).to_list(10000)

    total = round(sum(e.get("amount", 0) for e in exps), 2)
    # by category
    by_cat = {}
    for e in exps:
        c = e.get("category", "Misc")
        by_cat[c] = by_cat.get(c, 0) + float(e.get("amount", 0))
    by_category = sorted([{"category": k, "amount": round(v, 2)} for k, v in by_cat.items()], key=lambda x: -x["amount"])
    # by vendor
    by_v = {}
    for e in exps:
        v = e.get("vendor_name") or "Unassigned"
        by_v[v] = by_v.get(v, 0) + float(e.get("amount", 0))
    vendor_spending = sorted([{"vendor": k, "amount": round(v, 2)} for k, v in by_v.items()], key=lambda x: -x["amount"])[:10]
    # Monthly trend (6 months) — club-local month boundaries
    trend = []

    current_local = local_now()
    current_month_index = current_local.year * 12 + current_local.month - 1

    for i in range(5, -1, -1):
        month_index = current_month_index - i

        year = month_index // 12
        month = (month_index % 12) + 1

        month_start_local = datetime(
            year, month, 1,
            tzinfo=CLUB_TIMEZONE
        )

        next_month_index = month_index + 1
        next_year = next_month_index // 12
        next_month = (next_month_index % 12) + 1

        month_end_local = datetime(
            next_year, next_month, 1,
            tzinfo=CLUB_TIMEZONE
        )

        if i == 0:
            month_end_local = current_local

        month_start_utc = month_start_local.astimezone(timezone.utc)
        month_end_utc = month_end_local.astimezone(timezone.utc)

        exs = await db.expenses.find(
            {
                "date": {
                    "$gte": iso(month_start_utc),
                    "$lt": iso(month_end_utc)
                }
            },
            {"_id": 0}
        ).to_list(5000)

        trend.append({
            "month": month_start_local.strftime("%b"),
            "amount": round(
                sum(float(x.get("amount", 0)) for x in exs),
                2
            )
        })
    # Largest
    largest = sorted(exps, key=lambda x: -float(x.get("amount", 0)))[:10]
    # Recurring
    recurring = await db.recurring_expenses.find({"active": True}, {"_id": 0}).to_list(200)
    return {
        "period": period, "start": iso(d_start), "end": iso(d_end),
        "total": total,
        "count": len(exps),
        "by_category": by_category,
        "vendor_spending": vendor_spending,
        "monthly_trend": trend,
        "largest": largest,
        "recurring": recurring,
        "expenses": exps,
    }

@api.get("/reports/payments")
async def report_payments(
    period: str = "monthly",
    start: Optional[str] = None,
    end: Optional[str] = None,
    user=Depends(require_permission("view_revenue"))
):
    d_start, d_end = _period_range(period, start, end)

    payments = await db.payments.find(
        {
            "created_at": {
                "$gte": iso(d_start),
                "$lt": iso(d_end)
            }
        },
        {"_id": 0}
    ).sort("created_at", -1).to_list(10000)

    # Include Food Only payments
    food_orders = await db.food_orders.find(
        {
            "status": "completed",
            "paid_at": {
                "$gte": iso(d_start),
                "$lt": iso(d_end)
            }
        },
        {"_id": 0}
    ).sort("paid_at", -1).to_list(10000)

    # Add Food Only payments
    for order in food_orders:
        payments.append(
            {
                "id": f"food-{order['id']}",
                "food_order_id": order["id"],
                "invoice_no": f"FOOD-{order['id'][:6].upper()}",
                "amount": float(
                    order.get(
                        "final_total",
                        order.get("total", 0)
                    )
                ),
                "method": (
                    order.get("payment_method")
                    or "cash"
                ).lower(),
                "table_number": "Food Only",
                "customer_name": order.get(
                    "customer_name",
                    ""
                ),
                "created_at": order.get(
                    "paid_at",
                    order.get("created_at")
                ),
            }
        )

    # Calculate payment totals
    by_method = {
        m: 0.0 for m in PAYMENT_METHODS
    }

    for p in payments:
        method = (
            p.get("method") or "cash"
        ).lower()

        if method not in by_method:
            by_method[method] = 0.0

        by_method[method] += float(
            p.get("amount", 0)
        )

    total = round(
        sum(
            float(p.get("amount", 0))
            for p in payments
        ),
        2
    )

    return {
        "period": period,
        "start": iso(d_start),
        "end": iso(d_end),
        "total": total,
        "by_method": {
            k: round(v, 2)
            for k, v in by_method.items()
        },
        "payments": payments,
    }

# ---- Club info ----
@api.get("/club")
async def club_info():
    return {"name": CLUB_NAME}

@api.get("/")
async def root():
    return {"message": "Sadda Adda Snooker API", "club": CLUB_NAME}

app.include_router(api)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=False,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ---- Seed ----
async def seed():
    await db.users.create_index("email", unique=True)
    await db.tables.create_index("table_number", unique=True)
    await db.tables.create_index("id", unique=True)
    await db.password_resets.create_index("expires_at", expireAfterSeconds=0)

    admin_email = os.environ.get("ADMIN_EMAIL", "Saddaaddagamingstation@gmail.com")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "0nv821bhx79qf")
    if not await db.users.find_one({"email": admin_email}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),    
            "name": "Admin",
            "email": admin_email,
            "password_hash": hash_password(admin_pw),
            "role": "admin",
            "created_at": iso(now_utc()),
        })
        logger.info(f"Seeded admin: {admin_email}")
    staff_email = os.environ.get("STAFF_EMAIL", "staff@snooker.com")
    staff_pw = os.environ.get("STAFF_PASSWORD", "staff123")
    if not await db.users.find_one({"email": staff_email}):
        await db.users.insert_one({
            "id": str(uuid.uuid4()),
            "name": "Staff",
            "email": staff_email,
            "password_hash": hash_password(staff_pw),
            "role": "staff",
            "permissions": DEFAULT_STAFF_PERMISSIONS.copy(),
            "created_at": iso(now_utc()),
        })
        logger.info(f"Seeded staff: {staff_email}")

    # One-time migration: reset every existing staff account to the new read-only defaults.
    # The marker prevents subsequent server restarts from overwriting admin-customized grants.
    reset_marker = await db.settings.find_one({"key": "staff_permissions_reset_v2"})
    if not reset_marker:
        await db.users.update_many(
            {"role": "staff"},
            {"$set": {"permissions": DEFAULT_STAFF_PERMISSIONS.copy()}},
        )
        await db.settings.update_one(
            {"key": "staff_permissions_reset_v2"},
            {"$set": {"key": "staff_permissions_reset_v2", "completed_at": iso(now_utc())}},
            upsert=True,
        )

    # Indexes
    await db.expenses.create_index("date")
    await db.expenses.create_index("category")

    await db.payments.create_index("created_at")
    await db.payments.create_index("session_id")
    # One initial purchase payment per membership. Existing session payments
    # are unaffected because they do not have source_type="membership".
    await db.payments.create_index(
        [("source_type", 1), ("source_id", 1)],
        unique=True,
        partialFilterExpression={"source_type": "membership"}
    )

    await db.vendors.create_index("name")

    # Auth
    await db.users.create_index("id")

    # Sessions
    await db.sessions.create_index(
        [("status", 1), ("ended_at", -1)]
    )
    await db.sessions.create_index("start_time")
    await db.sessions.create_index("table_id")
    await db.sessions.create_index("membership_id")
    await db.memberships.create_index("id", unique=True)
    await db.memberships.create_index("status")
    await _ensure_membership_packages()
    await db.membership_packages.create_index("id", unique=True)

    # Food orders
    await db.food_orders.create_index(
        [("status", 1), ("paid_at", -1)]
    )
 
    await ensure_expense_categories()

    if await db.tables.count_documents({}) == 0:
        defaults = [
            {"id": str(uuid.uuid4()), "table_number": "T1", "table_name": "Champion's Cue", "hourly_rate": 300, "status": "available"},
            {"id": str(uuid.uuid4()), "table_number": "T2", "table_name": "Velvet Green", "hourly_rate": 300, "status": "available"},
            {"id": str(uuid.uuid4()), "table_number": "T3", "table_name": "Black Diamond", "hourly_rate": 400, "status": "available"},
            {"id": str(uuid.uuid4()), "table_number": "T4", "table_name": "Royal Pocket", "hourly_rate": 500, "status": "available"},
            {"id": str(uuid.uuid4()), "table_number": "T5", "table_name": "Pro Arena", "hourly_rate": 600, "status": "maintenance"},
        ]
        for t in defaults:
            t["created_at"] = iso(now_utc())
        await db.tables.insert_many(defaults)
        logger.info("Seeded default tables")

_ps5_no_show_task = None
_ps5_reservation_cutoff_task = None

async def _ps5_no_show_worker():
    while True:
        try:
            await _ps5_mark_no_shows()
        except Exception:
            logger.exception("PS5 no-show worker failed")
        await asyncio.sleep(30)


async def _ps5_reservation_cutoff_worker():
    """Close walk-in PS5 sessions at the 15-minute reservation buffer."""
    system_user = {"id": "system-ps5-reservation-cutoff", "name": "Automatic PS5 Reservation Cutoff"}
    while True:
        try:
            now = now_utc()
            due_sessions = await db.sessions.find({
                "status": "active", "game_type": "ps5",
                "ps5_auto_end_at": {"$lte": iso(now), "$ne": None},
            }, {"_id": 0, "id": 1, "table_id": 1, "ps5_auto_end_booking_id": 1}).to_list(200)
            for row in due_sessions:
                session_id = row["id"]
                cutoff_booking = None
                if row.get("ps5_auto_end_booking_id"):
                    cutoff_booking = await db.ps5_bookings.find_one({
                        "id": row["ps5_auto_end_booking_id"], "status": "confirmed",
                    }, {"_id": 0})
                if not cutoff_booking:
                    next_booking = await db.ps5_bookings.find({
                        "table_id": row.get("table_id"), "status": "confirmed",
                        "start_at": {"$gt": iso(now)},
                    }, {"_id": 0}).sort("start_at", 1).to_list(1)
                    if not next_booking:
                        await db.sessions.update_one(
                            {"id": session_id, "status": "active"},
                            {"$set": {
                                "ps5_auto_end_at": None,
                                "ps5_auto_end_booking_id": None,
                                "ps5_auto_end_reason": None,
                                "ps5_auto_end_claimed": False,
                            }},
                        )
                        continue
                    cutoff_booking = next_booking[0]
                    revised_cutoff = _ps5_parse_datetime(cutoff_booking["start_at"]) - timedelta(minutes=15)
                    await db.sessions.update_one(
                        {"id": session_id, "status": "active"},
                        {"$set": {
                            "ps5_auto_end_at": iso(revised_cutoff),
                            "ps5_auto_end_booking_id": cutoff_booking["id"],
                        }},
                    )
                    if revised_cutoff > now:
                        continue
                claim = await db.sessions.update_one(
                    {
                        "id": session_id, "status": "active",
                        "ps5_auto_end_at": {"$lte": iso(now), "$ne": None},
                        "$or": [
                            {"ps5_auto_end_claimed": {"$ne": True}},
                            {"ps5_auto_end_claimed_at": {"$lte": iso(now - timedelta(minutes=2))}},
                        ],
                    },
                    {"$set": {"ps5_auto_end_claimed": True, "ps5_auto_end_claimed_at": iso(now)}},
                )
                if not claim.modified_count:
                    continue
                try:
                    await end_session(
                        session_id,
                        SessionEnd(automatic_end=True, payment_notes="Automatically ended before upcoming PS5 reservation."),
                        user=system_user,
                    )
                    logger.info("Automatically ended PS5 session %s at reservation cutoff", session_id)
                except HTTPException as exc:
                    if exc.status_code != 400:
                        await db.sessions.update_one(
                            {"id": session_id, "status": "active"},
                            {"$set": {"ps5_auto_end_claimed": False}},
                        )
                    logger.warning("Could not automatically end PS5 session %s: %s", session_id, exc.detail)
                except Exception:
                    await db.sessions.update_one(
                        {"id": session_id, "status": "active"},
                        {"$set": {"ps5_auto_end_claimed": False}},
                    )
                    logger.exception("Automatic PS5 cutoff failed for session %s", session_id)
        except Exception:
            logger.exception("PS5 reservation cutoff worker failed")
        await asyncio.sleep(1)


@app.on_event("startup")
async def on_startup():
    global _ps5_no_show_task, _ps5_reservation_cutoff_task, _timer_alert_task
    await seed()
    await ensure_performance_indexes()
    await db.timer_alerts.create_index("timer_block_id", unique=True)
    await db.timer_alerts.create_index("created_at")
    await db.sessions.create_index(
        [("status", 1), ("session_ended_alert_sent", 1), ("ended_at", 1)],
        name="idx_recent_session_end_alerts",
    )
    await db.timer_alert_deliveries.create_index([("alert_id", 1), ("user_id", 1)], unique=True)
    _ps5_no_show_task = asyncio.create_task(_ps5_no_show_worker())
    _ps5_reservation_cutoff_task = asyncio.create_task(_ps5_reservation_cutoff_worker())
    _timer_alert_task = asyncio.create_task(_timer_alert_worker())


@app.on_event("shutdown")
async def on_shutdown():
    global _ps5_no_show_task, _ps5_reservation_cutoff_task, _timer_alert_task
    for task in (_ps5_no_show_task, _ps5_reservation_cutoff_task, _timer_alert_task):
        if task:
            task.cancel()
            try:
                await task
            except asyncio.CancelledError:
                pass
    client.close()
