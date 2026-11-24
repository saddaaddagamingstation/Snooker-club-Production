import asyncio
import time
from dotenv import load_dotenv
from pathlib import Path
from typing import Literal
ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

import os
import uuid
import logging
import secrets
from datetime import datetime, timezone, timedelta
from typing import List, Optional

import bcrypt
import jwt
from fastapi import FastAPI, APIRouter, HTTPException, Depends, Request, Query
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
CLUB_NAME = os.environ.get('CLUB_NAME', 'Supreme Snooker Club')

app = FastAPI(title="Supreme Snooker Club API")
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


@app.get("/api/diagnostics/mongodb-latency")
async def mongodb_latency():
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


# ---- Helpers ----
def hash_password(p: str) -> str:
    return bcrypt.hashpw(p.encode(), bcrypt.gensalt()).decode()

def verify_password(p: str, h: str) -> bool:
    try:
        return bcrypt.checkpw(p.encode(), h.encode())
    except Exception:
        return False

def create_token(user_id: str, email: str, role: str, days: int = 7) -> str:
    payload = {
        "sub": user_id, "email": email, "role": role,
        "exp": datetime.now(timezone.utc) + timedelta(days=days),
        "type": "access",
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALG)

def now_utc():
    return datetime.now(timezone.utc)

def iso(dt: datetime) -> str:
    return dt.isoformat()

# ---- Models ----
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
    hourly_rate: float
    status: str = "available"  # available | running | reserved | maintenance

class TableUpdate(BaseModel):
    table_number: Optional[str] = None
    table_name: Optional[str] = None
    hourly_rate: Optional[float] = None
    status: Optional[str] = None

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

class SnackOrderItem(BaseModel):
    snack_id: str
    quantity: int

class FoodOrderCreate(BaseModel):
    customer_name: Optional[str] = ""
    items: List[SnackOrderItem]
    status: Literal["pending", "completed"] = "pending"
    discount: float = 0
    payment_method: Optional[str] = None

class FoodOrderAttach(BaseModel):
    table_id: str

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


class FrameEnd(BaseModel):
    player_a: Optional[str] = ""
    player_b: Optional[str] = ""
    winner: Optional[str] = ""
    paid_by: Optional[str] = ""
    notes: Optional[str] = ""


class FrameStart(BaseModel):
    player_a: Optional[str] = ""
    player_b: Optional[str] = ""

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

# Default staff permissions
DEFAULT_STAFF_PERMISSIONS = {
    "manage_tables": False,
    "manage_snacks": False,
    "manage_sessions": True,
    "clear_session": False,  #New
    "manage_expenses": False,
    "view_expenses": False,
    "view_revenue": False,
    "view_profit": False,
    "view_reports": False,
    "manage_users": False,
    "manage_settings": False,
}
ALL_PERMISSIONS = list(DEFAULT_STAFF_PERMISSIONS.keys())

def has_permission(user: dict, perm: str) -> bool:
    if user.get("role") == "admin":
        return True
    return bool((user.get("permissions") or {}).get(perm, False))

def require_permission(perm: str):
    def _dep(user=Depends(get_current_user)):
        if not has_permission(user, perm):
            raise HTTPException(status_code=403, detail=f"Permission denied: {perm}")
        return user
    return _dep

# ---- Auth Routes ----
@api.post("/auth/login")
async def login(req: LoginReq):
    email = req.email.lower()
    user = await db.users.find_one({"email": email})
    if not user or not verify_password(req.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_token(user["id"], user["email"], user["role"])
    return {
        "access_token": token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"], "role": user["role"],
            "permissions": user.get("permissions") or (DEFAULT_STAFF_PERMISSIONS.copy() if user["role"] != "admin" else {p: True for p in ALL_PERMISSIONS}),
        },
    }

@api.get("/auth/me")
async def me(user=Depends(get_current_user)):
    if user.get("role") == "admin":
        user["permissions"] = {p: True for p in ALL_PERMISSIONS}
    elif not user.get("permissions"):
        user["permissions"] = DEFAULT_STAFF_PERMISSIONS.copy()
    return user

@api.post("/auth/logout")
async def logout(user=Depends(get_current_user)):
    return {"ok": True}

@api.post("/auth/forgot-password")
async def forgot(req: ForgotReq):
    user = await db.users.find_one({"email": req.email.lower()})
    if user:
        token = secrets.token_urlsafe(32)
        await db.password_resets.insert_one({
            "token": token, "user_id": user["id"],
            "expires_at": now_utc() + timedelta(hours=1),
            "used": False,
        })
        logging.info(f"PASSWORD RESET LINK: /reset-password?token={token}")
    return {"ok": True, "message": "If the email exists, a reset link has been generated (check server logs)."}

@api.post("/auth/reset-password")
async def reset(req: ResetReq):
    rec = await db.password_resets.find_one({"token": req.token, "used": False})
    if not rec or rec["expires_at"] < now_utc():
        raise HTTPException(status_code=400, detail="Invalid or expired token")
    await db.users.update_one({"id": rec["user_id"]}, {"$set": {"password_hash": hash_password(req.password)}})
    await db.password_resets.update_one({"token": req.token}, {"$set": {"used": True}})
    return {"ok": True}

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
    if len(body.password) < 4:
        raise HTTPException(status_code=400, detail="Password must be at least 4 characters")
    await db.users.update_one({"id": user_id}, {"$set": {"password_hash": hash_password(body.password)}})
    return {"ok": True, "message": f"Password reset for {target['email']}"}

@api.post("/users")
async def create_user(body: UserIn, user=Depends(require_admin)):
    email = body.email.lower()
    if await db.users.find_one({"email": email}):
        raise HTTPException(status_code=400, detail="Email already exists")
    perms = body.permissions if body.permissions is not None else DEFAULT_STAFF_PERMISSIONS.copy()
    # normalize keys
    perms = {k: bool(perms.get(k, False)) for k in ALL_PERMISSIONS}
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
    perms = {k: bool(body.permissions.get(k, False)) for k in ALL_PERMISSIONS}
    print("=" * 50)
    print("UPDATING USER:", user_id)
    print("NEW PERMISSIONS:", perms)
    print("=" * 50)
    await db.users.update_one({"id": user_id}, {"$set": {"permissions": perms}})
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
@api.get("/tables")
async def list_tables(user=Depends(get_current_user)):
    tables = await db.tables.find({}, {"_id": 0}).sort("table_number", 1).to_list(1000)
    return tables

@api.post("/tables")
async def create_table(body: TableIn, user=Depends(require_permission("manage_tables"))):
    t = {"id": str(uuid.uuid4()), **body.model_dump(), "created_at": iso(now_utc())}
    await db.tables.insert_one(t.copy())
    return {k: v for k, v in t.items() if k != "_id"}

@api.put("/tables/{table_id}")
async def update_table(table_id: str, body: TableUpdate, user=Depends(require_permission("manage_tables"))):
    update = {k: v for k, v in body.model_dump().items() if v is not None}
    if not update:
        raise HTTPException(status_code=400, detail="No fields to update")
    res = await db.tables.update_one({"id": table_id}, {"$set": update})
    if res.matched_count == 0:
        raise HTTPException(status_code=404, detail="Table not found")
    t = await db.tables.find_one({"id": table_id}, {"_id": 0})
    return t

@api.delete("/tables/{table_id}")
async def delete_table(table_id: str, user=Depends(require_permission("manage_tables"))):
    res = await db.tables.delete_one({"id": table_id})
    return {"deleted": res.deleted_count}

# ---- Categories ----

@api.get("/categories")
async def list_categories(user=Depends(get_current_user)):
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
async def list_snacks(user=Depends(get_current_user)):
    snacks = await db.snacks.find({}, {"_id": 0}).sort("name", 1).to_list(1000)
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
    user=Depends(require_permission("manage_sessions"))
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

    # Deduct stock
    for item in order_items:
        await db.snacks.update_one(
            {"id": item["snack_id"]},
            {"$inc": {"stock_quantity": -item["quantity"]}}
        )

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
        "status": body.status,
        "session_id": None,
        "created_at": iso(now_utc()),
        "paid_at": iso(now_utc()) if body.status == "completed" else None,
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
    user=Depends(require_permission("manage_sessions"))
):
    orders = await db.food_orders.find(
        {"status": "pending"},
        {"_id": 0}
    ).sort("created_at", -1).to_list(200)

    return orders

@api.get("/food-orders/{order_id}")
async def get_food_order(
    order_id: str,
    user=Depends(require_permission("manage_sessions"))
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
    user=Depends(require_permission("manage_sessions"))
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

    await db.food_orders.update_one(
        {"id": order_id},
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

    updated_order = await db.food_orders.find_one(
        {"id": order_id},
        {"_id": 0}
    )

    return updated_order

@api.delete("/food-orders/{order_id}")
async def cancel_food_order(
    order_id: str,
    user=Depends(require_permission("manage_sessions"))
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

    # Restore inventory
    for item in order.get("items", []):
        quantity = int(item.get("quantity", 0))

        if quantity > 0:
            await db.snacks.update_one(
                {"id": item["snack_id"]},
                {"$inc": {"stock_quantity": quantity}}
            )

    # Mark order as cancelled
    await db.food_orders.update_one(
        {"id": order_id},
        {
            "$set": {
                "status": "cancelled",
                "cancelled_at": iso(now_utc()),
                "cancelled_by": user["id"],
                "cancelled_by_name": user.get("name", ""),
            }
        }
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
    user=Depends(require_permission("manage_sessions"))
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
    user=Depends(require_permission("manage_sessions"))
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
            customer_name=order.get("customer_name", ""),
            notes=""
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
    user=Depends(get_current_user)
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
        r["table"] = table_map.get(r.get("table_id"))
        r["snacks_total"] = sum(
            item.get("subtotal", 0)
            for item in r.get("snacks", [])
        )

    return rows
@api.get("/sessions/active")
async def active_sessions(user=Depends(get_current_user)):
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
            "current_frame": 1,
            "frames": 1,
            "snacks": 1,
            "duration_minutes": 1,
            "rate_used": 1,
            "table_amount": 1,
            "discount": 1,
            "tax_percent": 1,
            "tax_amount": 1,
            "grand_total": 1
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
        r["table"] = table_map.get(r.get("table_id"))
        r["snacks_total"] = sum(
            float(item.get("subtotal", 0))
            for item in r.get("snacks", [])
        )

        rate = float(r.get("rate_used", 0))
        frames = r.get("frames") or []
        table_amount = sum(
            float(frame.get("amount", 0))
            for frame in frames
        )

        current_frame = r.get("current_frame")
        if current_frame and current_frame.get("start_time"):
            now = now_utc()
            frame_start = datetime.fromisoformat(
                current_frame["start_time"]
            )
            frame_paused_seconds = float(
                current_frame.get("paused_seconds", 0)
            )

            current_pause_seconds = 0
            if r.get("is_paused") and r.get("pause_started_at"):
                current_pause_seconds = (
                    now - datetime.fromisoformat(
                        r["pause_started_at"]
                    )
                ).total_seconds()

            elapsed_seconds = max(
                0,
                (now - frame_start).total_seconds()
                - frame_paused_seconds
                - current_pause_seconds
            )

            table_amount += (elapsed_seconds / 3600) * rate

        r["table_amount"] = round(table_amount, 2)

    return rows


@api.get("/sessions/{session_id}")
async def get_session(session_id: str, user=Depends(get_current_user)):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s:
        raise HTTPException(status_code=404, detail="Session not found")
    await _session_with_details(s)
    return s

@api.delete("/sessions/{session_id}")
async def clear_session(
    session_id: str,
    user=Depends(require_permission("manage_sessions"))
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

    # -----------------------------------------
    # 5. Permanently delete the session
    # -----------------------------------------
    result = await db.sessions.delete_one({
        "id": session_id,
        "status": "active"
    })

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Session was already cleared"
        )

    return {
        "ok": True,
        "message": "Session cleared successfully",
        "session_id": session_id,
        "table_id": s["table_id"],
        "table_number": s["table_number"]
    }

@api.post("/sessions/start")
async def start_session(body: SessionStart, user=Depends(require_permission("manage_sessions"))):
    table = await db.tables.find_one({"id": body.table_id}, {"_id": 0})
    if not table:
        raise HTTPException(status_code=404, detail="Table not found")
    if table["status"] != "available":
        raise HTTPException(status_code=400, detail=f"Table is {table['status']}")
    session = {
        "id": str(uuid.uuid4()),
        "table_id": table["id"],
        "table_number": table["table_number"],
        "customer_name": body.customer_name or "",
        "notes": body.notes or "",
        "start_time": iso(now_utc()),
        "end_time": None,
        # Pause information
        "is_paused": False,
        "pause_started_at": None,
        "paused_seconds": 0,
        "pause_reason": None,
        "duration_minutes": 0,
        "rate_used": float(table["hourly_rate"]),
        "table_amount": 0.0,
        "snacks": [],
        "snacks_amount": 0.0,
        "discount": 0.0,
        "tax_percent": 0.0,
        "tax_amount": 0.0,
        "grand_total": 0.0,
        "status": "active",
        "started_by": user["id"],
        "started_by_name": user.get("name", ""),
        "frames": [],
        "current_frame": {
            "id": str(uuid.uuid4()),
            "frame_number": 1,
            "player_a": "",
            "player_b": "",
            "start_time": iso(now_utc()),
            "end_time": None,
            "winner": None,
            "loser": None,
            "paid_by": None,
            "notes": "",
            "duration_minutes": 0,
            "paused_seconds": 0,
        },
        "payment_method": None,
        "payment_notes": "",
    }
    await db.sessions.insert_one(session.copy())
    await db.tables.update_one({"id": table["id"]}, {"$set": {"status": "running"}})
    session.pop("_id", None)
    session["table"] = table
    return session

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
    await db.sessions.update_one(
        {"id": session_id},
        {"$set": {"snacks": snacks, "snacks_amount": snacks_amount}},
    )
    # decrement stock
    new_stock = max(0, int(snack.get("stock_quantity", 0)) - body.quantity)
    await db.snacks.update_one({"id": snack["id"]}, {"$set": {"stock_quantity": new_stock}})
    s["snacks"] = snacks
    s["snacks_amount"] = snacks_amount
    s["table"] = await db.tables.find_one(
        {"id": s["table_id"]},
        {"_id": 0}
    )
    s["snacks_total"] = snacks_amount

    return s

@api.delete("/sessions/{session_id}/snacks/{index}")
async def remove_snack_from_session(
    session_id: str,
    index: int,
    user=Depends(require_permission("manage_sessions"))
):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")

    snacks = s.get("snacks", [])

    if index < 0 or index >= len(snacks):
        raise HTTPException(status_code=404, detail="Item not found")

    item = snacks[index]

    if item["quantity"] > 1:
        # Decrease quantity by 1
        item["quantity"] -= 1
        item["subtotal"] = item["quantity"] * item["price"]

        # Restock only 1 item
        await db.snacks.update_one(
            {"id": item["snack_id"]},
            {"$inc": {"stock_quantity": 1}}
        )

    else:
        # Remove snack completely
        removed = snacks.pop(index)

        await db.snacks.update_one(
            {"id": removed["snack_id"]},
            {"$inc": {"stock_quantity": 1}}
        )

    # Recalculate total snacks amount
    snacks_amount = sum(i["subtotal"] for i in snacks)

    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "snacks": snacks,
                "snacks_amount": snacks_amount,
            }
        }
    )

    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    await _session_with_details(s)
    return s

@api.post("/sessions/{session_id}/pause")
async def pause_session(
    session_id: str,
    reason: str = "MANUAL",
    user=Depends(require_permission("manage_sessions")),
):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})

    if not s:
        raise HTTPException(status_code=404, detail="Session not found")

    if s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")

    if s.get("is_paused"):
        raise HTTPException(
            status_code=400,
            detail="Session is already paused"
            )

    # A session can only be manually paused while a frame is running.
    # If no frame is active, the user must start a frame first.
    if not s.get("current_frame"):
        raise HTTPException(
            status_code=400,
            detail="Please start a frame first. You can pause the session only while a frame is running."
        )

    if reason not in ["MANUAL", "BILLING", "FRAME_END"]:
        raise HTTPException(
            status_code=400,
            detail="Invalid pause reason"
    )

    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "is_paused": True,
                "pause_started_at": now_utc().isoformat(),
                "pause_reason": reason,
            }
        },
    )

    s["is_paused"] = True
    s["pause_started_at"] = now_utc().isoformat()
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

    pause_started_at = datetime.fromisoformat(s["pause_started_at"])
    paused_seconds = s.get("paused_seconds", 0)

    paused_seconds += (now_utc() - pause_started_at).total_seconds()

    current_frame = s.get("current_frame")

    pause_duration = (now_utc() - pause_started_at).total_seconds()

    if current_frame:
        current_frame["paused_seconds"] = (
            current_frame.get("paused_seconds", 0)
            + pause_duration
        )

    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "is_paused": False,
                "pause_started_at": None,
                "paused_seconds": paused_seconds,
                "pause_reason": None,
                "current_frame": current_frame,
            }
        },
    )

    s["is_paused"] = False
    s["pause_started_at"] = None
    s["paused_seconds"] = paused_seconds
    s["pause_reason"] = None
    s["current_frame"] = current_frame
    s["table"] = await db.tables.find_one(
        {"id": s["table_id"]},
        {"_id": 0}
    )

    return s

class FinalizePreviewBody(BaseModel):
    player_a: Optional[str] = ""
    player_b: Optional[str] = ""
    winner: Optional[str] = ""
    paid_by: Optional[str] = ""
    notes: Optional[str] = ""

@api.post("/sessions/{session_id}/finalize-preview")
async def finalize_preview(session_id: str, body: FinalizePreviewBody, user=Depends(require_permission("manage_sessions"))):
    """Computes an EPHEMERAL billing snapshot for the End & Bill modal.
    Does NOT persist any freeze state. Each call returns a FRESH snapshot from the current time.
    On modal cancel, the caller discards the snapshot and the session keeps running live.
    On confirm (/end), the caller passes the snapshot back in the request body."""
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")
    end = now_utc() 
    start = datetime.fromisoformat(s["start_time"])
    paused_seconds = float(s.get("paused_seconds", 0))

    if s.get("is_paused") and s.get("pause_started_at"):
        pause_started = datetime.fromisoformat(s["pause_started_at"])
        paused_seconds += (end - pause_started).total_seconds()

    duration_seconds = max(
        0,
        (end - start).total_seconds() - paused_seconds,
    )
    duration_minutes = int(duration_seconds / 60)
    duration_hours = duration_seconds / 3600.0
    rate = float(s["rate_used"])
    frames = s.get("frames", [])

    # Always start with completed frames
    table_amount_raw = sum(float(f.get("amount", 0)) for f in frames)

    # Always add the currently running frame (preview only)
    cf = None

    if s.get("current_frame"):
        cf = dict(s["current_frame"])

        cf["player_a"] = body.player_a
        cf["player_b"] = body.player_b
        cf["winner"] = body.winner
        if body.winner == body.player_a:
            cf["loser"] = body.player_b
        elif body.winner == body.player_b:
            cf["loser"] = body.player_a
        else:
            cf["loser"] = ""
        cf["paid_by"] = body.paid_by
        cf["notes"] = body.notes

        frame_start = datetime.fromisoformat(cf["start_time"])
        frame_paused_seconds = float(
            cf.get("paused_seconds", 0)
        )

        # If billing was opened while this frame was running,
        # the current billing pause has not yet been added to
        # the frame's paused_seconds, so subtract it here.
        if s.get("is_paused") and s.get("pause_started_at"):
            current_pause_seconds = (
                end - datetime.fromisoformat(s["pause_started_at"])
            ).total_seconds()
        else:
            current_pause_seconds = 0

        cf_seconds = max(
            0,
            (end - frame_start).total_seconds()
            - frame_paused_seconds
            - current_pause_seconds
        )

        cf_amount = round((cf_seconds / 3600.0) * rate, 2)

        cf["end_time"] = iso(end)
        cf["duration_minutes"] = int(cf_seconds / 60)
        cf["amount"] = cf_amount

        table_amount_raw += cf_amount

    # If there are no frames at all, fall back to whole session
    if not frames and not s.get("current_frame"):
        table_amount_raw = duration_hours * rate
        print({
    "frames_total": sum(float(f.get("amount", 0)) for f in frames),
    "current_frame_amount": cf["amount"] if cf else None,
    "table_amount_raw": table_amount_raw,
})
    table_amount = round(table_amount_raw, 2)
    # Calculate snack amount directly from the actual session items
    snacks_amount = round(
        sum(
            float(item.get("subtotal", float(item.get("price", 0)) * int(item.get("quantity", 0))))
            for item in s.get("snacks", [])
        ),
        2,
    )
    grand_total_exact = round(table_amount + snacks_amount, 2)
    grand_total = int(round(grand_total_exact))
    await _session_with_details(s)
    # Strip any legacy preview_* fields that may exist from before this refactor
    for k in ("preview_end_time", "preview_duration_minutes", "preview_table_amount", "preview_grand_total", "preview_grand_total_exact"):
        s.pop(k, None)
    return {
        **s,
        "preview_frame": cf if s.get("current_frame") else None,
        "freeze_snapshot": {
            "end_time": iso(end),
            "duration_seconds": int(duration_seconds),
            "duration_minutes": duration_minutes,
            "table_amount": table_amount,
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
    # Determine authoritative end timestamp
    start_dt = datetime.fromisoformat(s["start_time"])
    now = now_utc()
    if body.freeze_snapshot:
        try:
            snap_end = datetime.fromisoformat(body.freeze_snapshot.end_time)
        except Exception:
            raise HTTPException(status_code=400, detail="Invalid freeze_snapshot.end_time")
        # Validate: must be between start_time and now, and monetary values non-negative
        if snap_end < start_dt or snap_end > now + timedelta(seconds=5):
            raise HTTPException(status_code=400, detail="freeze_snapshot.end_time out of range")
        if body.freeze_snapshot.duration_minutes < 0 or body.freeze_snapshot.table_amount < 0:
            raise HTTPException(status_code=400, detail="freeze_snapshot values must be non-negative")
        end = snap_end
        rate = float(s["rate_used"])

        paused_seconds = float(s.get("paused_seconds", 0))

        if s.get("is_paused") and s.get("pause_started_at"):
            pause_started = datetime.fromisoformat(s["pause_started_at"])
            paused_seconds += (end - pause_started).total_seconds()

        duration_seconds = max(
            0,
            (end - start_dt).total_seconds() - paused_seconds
        )

        duration_minutes = int(duration_seconds / 60)
    else:
        end = now
        rate = float(s["rate_used"])

        paused_seconds = float(s.get("paused_seconds", 0))

        if s.get("is_paused") and s.get("pause_started_at"):
            pause_started = datetime.fromisoformat(s["pause_started_at"])
            paused_seconds += (end - pause_started).total_seconds()

        duration_seconds = max(
            0,
            (end - start_dt).total_seconds() - paused_seconds
        )

    duration_minutes = int(duration_seconds / 60)

    # Close current frame (if any) at the authoritative end timestamp — BEFORE writing session
    frames = list(s.get("frames") or [])
    if s.get("current_frame"):
        frame = dict(s["current_frame"])
        frame["end_time"] = iso(end)
        frame_start = datetime.fromisoformat(frame["start_time"])
        frame_paused_seconds = float(
            frame.get("paused_seconds", 0)
        )

        # If the current frame is frozen for billing,
        # exclude the current billing pause as well.
        if s.get("is_paused") and s.get("pause_started_at"):
            current_pause_seconds = (
                end - datetime.fromisoformat(s["pause_started_at"])
            ).total_seconds()
        else:
            current_pause_seconds = 0

        dur_sec = max(
            0,
            (end - frame_start).total_seconds()
            - frame_paused_seconds
            - current_pause_seconds
        )
        frame["duration_minutes"] = int(dur_sec / 60)
        frame["amount"] = round((dur_sec / 3600.0) * rate, 2)
        frame["auto_closed"] = True
        frames.append(frame)

    # Table amount: sum of frame amounts if any, else full duration × rate
    if frames:
        table_amount = round(sum(float(f.get("amount", 0)) for f in frames), 2)
    else:
        table_amount = round((duration_seconds / 3600.0) * rate, 2)
    payment_method = (body.payment_method or "cash").lower()
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
    discount = float(body.discount or 0)
    tax_percent = float(body.tax_percent or 0)
    subtotal = table_amount + snacks_amount - discount
    tax_amount = round(subtotal * tax_percent / 100, 2)
    grand_total_exact = round(subtotal + tax_amount, 2)
    grand_total = int(round(grand_total_exact))  # nearest whole rupee — frozen
    invoice_no = "INV-" + datetime.now().strftime("%Y%m%d") + "-" + s["id"][:6].upper()

    # Split payments: normalize and validate. Fallback to single payment_method for full amount.
    split_payments = []
    if body.payments:
        for p in body.payments:
            m = (p.get("method") or "").lower()
            amt = float(p.get("amount") or 0)
            if m not in PAYMENT_METHODS:
                raise HTTPException(status_code=400, detail=f"Invalid payment method '{m}'")
            if amt > 0:
                split_payments.append({"method": m, "amount": round(amt, 2)})
    if not split_payments:
        split_payments = [{"method": payment_method, "amount": grand_total}]
    total_paid = round(sum(p["amount"] for p in split_payments), 2)
    if abs(total_paid - grand_total) > 0.5:
        raise HTTPException(status_code=400, detail=f"Payments ({total_paid}) don't match total ({grand_total})")
    primary_method = split_payments[0]["method"] if len(split_payments) == 1 else "split"

    update = {
        "end_time": iso(end),
        "duration_minutes": duration_minutes,
        "table_amount": table_amount,
        "discount": discount,
        "tax_percent": tax_percent,
        "tax_amount": tax_amount,
        "grand_total": grand_total,
        "grand_total_exact": grand_total_exact,
        "status": "completed",
        "frames": frames,
        "current_frame": None,
        "invoice_no": invoice_no,
        "ended_at": iso(end),
        "payment_method": primary_method,
        "payments": split_payments,
        "payment_notes": body.payment_notes or "",
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
    s = await db.sessions.find_one(
        {"id": session_id},
        {"_id": 0}
    )
    await _session_with_details(s)
    return s

# ---- Frames ----
@api.post("/sessions/{session_id}/frames/start")
async def start_frame(session_id: str, body: FrameStart, user=Depends(require_permission("manage_sessions"))):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})

    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")

    if s.get("current_frame"):
        raise HTTPException(
            status_code=400,
            detail="A frame is already running. End it first."
        )

    now = now_utc()

    # If the session is paused because the previous frame ended,
    # resume it now and record the pause duration.
    paused_seconds = s.get("paused_seconds", 0)

    if s.get("is_paused") and s.get("pause_started_at"):
        pause_started_at = datetime.fromisoformat(s["pause_started_at"])
        paused_seconds += (now - pause_started_at).total_seconds()

    frame_no = len(s.get("frames", [])) + 1

    frame = {
        "id": str(uuid.uuid4()),
        "frame_number": frame_no,
        "player_a": "",
        "player_b": "",
        "start_time": iso(now),
        "end_time": None,
        "winner": None,
        "loser": None,
        "paid_by": None,
        "notes": "",
        "duration_minutes": 0,
        "paused_seconds": 0,
    }

    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "current_frame": frame,
                "is_paused": False,
                "pause_started_at": None,
                "paused_seconds": paused_seconds,
                "pause_reason": None,
            }
        },
    )

    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    await _session_with_details(s)
    return s

@api.post("/sessions/{session_id}/frames/end")
async def end_frame(session_id: str, body: FrameEnd, user=Depends(require_permission("manage_sessions"))):
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})

    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")

    frame = s.get("current_frame")

    if not frame:
        raise HTTPException(
            status_code=400,
            detail="No active frame. Start one first."
        )

    now = now_utc()

    frame["player_a"] = body.player_a or ""
    frame["player_b"] = body.player_b or ""
    frame["winner"] = body.winner or ""

    if body.winner == body.player_a:
        frame["loser"] = body.player_b or ""
    elif body.winner == body.player_b:
        frame["loser"] = body.player_a or ""
    else:
        frame["loser"] = ""

    frame["paid_by"] = body.paid_by or ""
    frame["notes"] = body.notes or ""
    frame["end_time"] = iso(now)

    # Calculate frame duration.
    # If the session was manually paused during this frame,
    # include the current pause in the frame's paused time.
    elapsed = (
        datetime.fromisoformat(frame["end_time"])
        - datetime.fromisoformat(frame["start_time"])
    ).total_seconds()

    frame_paused = float(frame.get("paused_seconds", 0))

    if s.get("is_paused") and s.get("pause_started_at"):
        pause_started_at = datetime.fromisoformat(s["pause_started_at"])
        frame_paused += (now - pause_started_at).total_seconds()

    dur_sec = max(0, elapsed - frame_paused)

    frame["duration_minutes"] = int(dur_sec / 60)
    frame["amount"] = round(
        (dur_sec / 3600.0) * float(s.get("rate_used", 0)),
        2,
    )

    frames = s.get("frames", []) + [frame]

    # Ending a frame pauses the SESSION.
    # The session stays active and the table remains occupied.
    await db.sessions.update_one(
        {"id": session_id},
        {
            "$set": {
                "frames": frames,
                "current_frame": None,
                "is_paused": True,
                "pause_started_at": iso(now),
                "pause_reason": "FRAME_END",
            }
        },
    )

    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    await _session_with_details(s)
    return s

@api.post("/sessions/{session_id}/frames/stop")
async def stop_frame(session_id: str, user=Depends(require_permission("manage_sessions"))):
    """Cancel current frame without a winner (rare)."""
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    if not s or s["status"] != "active":
        raise HTTPException(status_code=400, detail="Session is not active")
    await db.sessions.update_one({"id": session_id}, {"$set": {"current_frame": None}})
    s = await db.sessions.find_one({"id": session_id}, {"_id": 0})
    await _session_with_details(s)
    return s


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
async def dashboard_stats(user=Depends(get_current_user)):
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    tables, active, completed_today, food_orders_today = await asyncio.gather(
        timed_dashboard_query(
            "tables",
            db.tables.find(
                {},
                {"_id": 0, "status": 1}
            ).to_list(1000),
        ),
        timed_dashboard_query(
            "active_sessions",
            db.sessions.count_documents({"status": "active"}),
        ),
        timed_dashboard_query(
            "completed_sessions_today",
            db.sessions.find(
                {
                    "status": "completed",
                    "ended_at": {"$gte": iso(today_start)}
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
                    "paid_at": {"$gte": iso(today_start)}
                },
                {
                    "_id": 0,
                    "final_total": 1,
                    "total": 1
                }
            ).to_list(1000),
        ),
    )

    table_revenue_today = round(
    sum(
        float(s.get("grand_total", 0))
        for s in completed_today
    ),2)

    available = sum(
        1 for t in tables
        if t["status"] == "available"
    )

    occupied = sum(
        1 for t in tables
        if t["status"] == "running"
    )

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

    today_revenue = round(
    table_revenue_today + food_only_snacks_revenue,
    2
)

    today_snacks_revenue = round(
        sum(
            float(s.get("snacks_amount", 0))
            for s in completed_today
        ) + food_only_snacks_revenue,
        2
    )
    today_sessions = len(completed_today) + active
    return {
        "today_revenue": today_revenue,
        "active_sessions": active,
        "available_tables": available,
        "occupied_tables": occupied,
        "snacks_revenue": today_snacks_revenue,
        "today_sessions": today_sessions,
        "total_tables": len(tables),
    }

@api.get("/dashboard/charts")
async def dashboard_charts(user=Depends(get_current_user)):
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
async def dashboard_recent(user=Depends(get_current_user)):
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
async def reports(period: str = Query("daily"), start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_permission("view_reports"))):
    now = datetime.now(timezone.utc)
    if start and end:
        d_start = datetime.fromisoformat(start)
        d_end = datetime.fromisoformat(end)
    elif period == "weekly":
        d_start = now - timedelta(days=7)
        d_end = now
    elif period == "monthly":
        d_start = now - timedelta(days=30)
        d_end = now
    else:
        d_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        d_end = now
    sessions = await db.sessions.find(
    {
        "status": "completed",
        "ended_at": {
            "$gte": iso(d_start),
            "$lte": iso(d_end)
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
                "$lte": iso(d_end)
            }
        },
        {"_id": 0}
    ).to_list(5000)

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
        + food_only_revenue,
        2
    )

    avg_duration = round(
        sum(s.get("duration_minutes", 0) for s in sessions) / total_sessions,
        1
    ) if total_sessions else 0
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
    user=Depends(get_current_user)
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
        return datetime.fromisoformat(d.replace("Z", "+00:00"))
    except Exception:
        return datetime.strptime(d, "%Y-%m-%d").replace(tzinfo=timezone.utc)

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
        if start: q["date"]["$gte"] = iso(_parse_date(start))
        if end: q["date"]["$lte"] = iso(_parse_date(end))
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
    now = datetime.now(timezone.utc)
    if start and end:
        return _parse_date(start), _parse_date(end)
    if period == "yesterday":
        s = (now - timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
        return s, s + timedelta(days=1)
    if period == "weekly":
        return now - timedelta(days=7), now
    if period == "monthly":
        return now - timedelta(days=30), now
    # today
    return now.replace(hour=0, minute=0, second=0, microsecond=0), now

@api.get("/reports/pnl")
async def profit_and_loss(period: str = "monthly", start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_permission("view_profit"))):
    d_start, d_end = _period_range(period, start, end)
    # Revenue = completed sessions in range
    sessions = await db.sessions.find(
        {"status": "completed", "ended_at": {"$gte": iso(d_start), "$lte": iso(d_end)}}, {"_id": 0}
    ).to_list(10000)
    table_revenue = round(sum(s.get("table_amount", 0) for s in sessions), 2)
    snack_revenue = round(sum(s.get("snacks_amount", 0) for s in sessions), 2)
    food_orders = await db.food_orders.find(
        {
            "status": "completed",
            "paid_at": {
                "$gte": iso(d_start),
                "$lte": iso(d_end)
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

    gross_revenue = round(
        table_revenue + food_only_revenue,
        2
    )
    # Expenses in range
    exps = await db.expenses.find(
        {"date": {"$gte": iso(d_start), "$lte": iso(d_end)}}, {"_id": 0}
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
    # Monthly trend (last 6 months)
    trend = []
    for i in range(5, -1, -1):
        m_end = (now_utc().replace(day=1) - timedelta(days=1)) if i > 0 else now_utc()
        # simpler: compute back N months from now
        pass
    # Use 6 buckets going back
    trend = []
    cursor = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for i in range(5, -1, -1):
        # month starting `i` months ago
        year = cursor.year
        month = cursor.month - i
        while month <= 0:
            month += 12; year -= 1
        m_start = cursor.replace(year=year, month=month)
        next_month = m_start.replace(day=28) + timedelta(days=4)
        m_end = next_month - timedelta(days=next_month.day)
        m_end = m_end.replace(hour=23, minute=59, second=59)
        rev = await db.sessions.find(
            {"status": "completed", "ended_at": {"$gte": iso(m_start), "$lte": iso(m_end)}}, {"_id": 0}
        ).to_list(5000)
        exp_rows = await db.expenses.find(
            {"date": {"$gte": iso(m_start), "$lte": iso(m_end)}}, {"_id": 0}
        ).to_list(5000)
        r = sum(x.get("grand_total", 0) for x in rev)
        ex = sum(x.get("amount", 0) for x in exp_rows)
        trend.append({
            "month": m_start.strftime("%b"),
            "revenue": round(r, 2),
            "expenses": round(ex, 2),
            "profit": round(r - ex, 2),
        })
    return {
        "period": period,
        "start": iso(d_start), "end": iso(d_end),
        "table_revenue": table_revenue,
        "food_only_revenue": food_only_revenue,
        "food_only_orders": len(food_orders),
        "snack_revenue": snack_revenue,
        "other_income": 0.0,
        "gross_revenue": gross_revenue,
        "total_expenses": total_expenses,
        "net_profit": net_profit,
        "margin_percent": margin,
        "expense_breakdown": expense_breakdown,
        "revenue_sources": [
            {"name": "Table", "value": table_revenue},
            {"name": "Snacks", "value": snack_revenue},
        ],
        "monthly_trend": trend,
    }

@api.get("/reports/expenses")
async def report_expenses(period: str = "monthly", start: Optional[str] = None, end: Optional[str] = None, user=Depends(require_permission("view_expenses"))):
    d_start, d_end = _period_range(period, start, end)
    exps = await db.expenses.find(
        {"date": {"$gte": iso(d_start), "$lte": iso(d_end)}}, {"_id": 0}
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
    # Monthly trend (6 months)
    trend = []
    cursor = now_utc().replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    for i in range(5, -1, -1):
        year = cursor.year; month = cursor.month - i
        while month <= 0: month += 12; year -= 1
        m_start = cursor.replace(year=year, month=month)
        next_month = m_start.replace(day=28) + timedelta(days=4)
        m_end = (next_month - timedelta(days=next_month.day)).replace(hour=23, minute=59, second=59)
        exs = await db.expenses.find({"date": {"$gte": iso(m_start), "$lte": iso(m_end)}}, {"_id": 0}).to_list(5000)
        trend.append({"month": m_start.strftime("%b"), "amount": round(sum(x.get("amount", 0) for x in exs), 2)})
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
                "$lte": iso(d_end)
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
                "$lte": iso(d_end)
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
    return {"message": "Supreme Snooker Club API", "club": CLUB_NAME}

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

    admin_email = os.environ.get("ADMIN_EMAIL", "supremepoolandsnooker@gmail.com")
    admin_pw = os.environ.get("ADMIN_PASSWORD", "SupremeSnookerClub2ndfloor")
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

    # Backfill: any staff without permissions gets defaults
    await db.users.update_many(
        {"role": "staff", "permissions": {"$exists": False}},
        {"$set": {"permissions": DEFAULT_STAFF_PERMISSIONS.copy()}},
    )
    # Backfill: add any newly-added permission keys defaulting to False on existing users
    all_staff = await db.users.find({"role": "staff"}, {"_id": 0}).to_list(500)
    for u in all_staff:
        perms = u.get("permissions") or {}
        missing = {k: False for k in ALL_PERMISSIONS if k not in perms}
        if missing:
            merged = {**perms, **missing}
            await db.users.update_one({"id": u["id"]}, {"$set": {"permissions": merged}})

    # Indexes
    await db.expenses.create_index("date")
    await db.expenses.create_index("category")

    await db.payments.create_index("created_at")
    await db.payments.create_index("session_id")

    await db.vendors.create_index("name")

    # Auth
    await db.users.create_index("id")

    # Sessions
    await db.sessions.create_index(
        [("status", 1), ("ended_at", -1)]
    )
    await db.sessions.create_index("start_time")
    await db.sessions.create_index("table_id")

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

    if await db.snacks.count_documents({}) == 0:
        snacks = [
            {"name": "Coke", "category": "Cold Drink", "price": 40, "stock_quantity": 50},
            {"name": "Coffee", "category": "Hot Drink", "price": 50, "stock_quantity": 100},
            {"name": "Chips", "category": "Snack", "price": 20, "stock_quantity": 80},
            {"name": "Burger", "category": "Food", "price": 120, "stock_quantity": 25},
            {"name": "Sandwich", "category": "Food", "price": 90, "stock_quantity": 30},
            {"name": "Water", "category": "Cold Drink", "price": 20, "stock_quantity": 100},
            {"name": "Tea", "category": "Hot Drink", "price": 30, "stock_quantity": 80},
            {"name": "French Fries", "category": "Snack", "price": 80, "stock_quantity": 40},
        ]
        for s in snacks:
            s["id"] = str(uuid.uuid4())
            s["created_at"] = iso(now_utc())
        await db.snacks.insert_many(snacks)
        logger.info("Seeded default snacks")

@app.on_event("startup")
async def on_startup():
    await seed()
    await ensure_performance_indexes()

@app.on_event("shutdown")
async def on_shutdown():
    client.close()
