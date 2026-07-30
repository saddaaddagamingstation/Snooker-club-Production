"""Snooker Club Backend Tests - covers auth, tables, snacks, sessions, dashboard, reports, users."""
import os
import re
import time
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values

frontend_env = dotenv_values("/app/frontend/.env")
BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or frontend_env.get("REACT_APP_BACKEND_URL") or "").rstrip("/")
if not BASE_URL:
    raise RuntimeError("REACT_APP_BACKEND_URL is missing")
API = f"{BASE_URL}/api"

credentials_text = Path("/app/memory/test_credentials.md").read_text(encoding="utf-8")
credential_pairs = re.findall(r"(?ims)Email:\s*`([^`]+)`.*?Password:\s*`([^`]+)`", credentials_text)
if len(credential_pairs) < 2:
    raise RuntimeError("Admin and staff credentials are missing from /app/memory/test_credentials.md")
ADMIN = {"email": credential_pairs[0][0], "password": credential_pairs[0][1]}
STAFF = {"email": credential_pairs[1][0], "password": credential_pairs[1][1]}


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def staff_token():
    r = requests.post(f"{API}/auth/login", json=STAFF, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


def auth(tok):
    return {"Authorization": f"Bearer {tok}"}


# ---- Auth ----
class TestAuth:
    def test_login_admin(self):
        r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert "access_token" in d and d["user"]["role"] == "admin"

    def test_login_staff(self):
        r = requests.post(f"{API}/auth/login", json=STAFF, timeout=30)
        assert r.status_code == 200
        assert r.json()["user"]["role"] == "staff"

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN["email"], "password": "wrong"}, timeout=30)
        assert r.status_code == 401

    def test_me(self, admin_token):
        r = requests.get(f"{API}/auth/me", headers=auth(admin_token), timeout=30)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN["email"]

    def test_me_no_token(self):
        r = requests.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401


# ---- Tables ----
class TestTables:
    def test_list_tables(self, admin_token):
        r = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30)
        assert r.status_code == 200
        tables = r.json()
        assert isinstance(tables, list) and len(tables) >= 5

    def test_staff_cannot_create_table(self, staff_token):
        r = requests.post(f"{API}/tables", headers=auth(staff_token),
                          json={"table_number": "TX", "table_name": "X", "hourly_rate": 100}, timeout=30)
        assert r.status_code == 403

    def test_admin_create_update_delete_table(self, admin_token):
        body = {"table_number": "TEST_T99", "table_name": "TEST_Table", "hourly_rate": 250}
        r = requests.post(f"{API}/tables", headers=auth(admin_token), json=body, timeout=30)
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        r2 = requests.put(f"{API}/tables/{tid}", headers=auth(admin_token), json={"hourly_rate": 350}, timeout=30)
        assert r2.status_code == 200 and r2.json()["hourly_rate"] == 350
        r3 = requests.delete(f"{API}/tables/{tid}", headers=auth(admin_token), timeout=30)
        assert r3.status_code == 200


# ---- Snacks ----
class TestSnacks:
    def test_list_snacks(self, admin_token):
        r = requests.get(f"{API}/snacks", headers=auth(admin_token), timeout=30)
        assert r.status_code == 200 and len(r.json()) >= 1

    def test_staff_cannot_create_snack(self, staff_token):
        r = requests.post(f"{API}/snacks", headers=auth(staff_token),
                          json={"name": "X", "category": "C", "price": 10}, timeout=30)
        assert r.status_code == 403


# ---- Sessions full flow ----
class TestSessions:
    def test_full_session_flow(self, admin_token, staff_token):
        # find an available table
        tables = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30).json()
        avail = next((t for t in tables if t["status"] == "available"), None)
        assert avail, "No available table"
        rate = avail["hourly_rate"]

        # start
        r = requests.post(f"{API}/sessions/start", headers=auth(staff_token),
                          json={"table_id": avail["id"], "customer_name": "TEST_Cust"}, timeout=30)
        assert r.status_code == 200, r.text
        s = r.json()
        assert s["rate_used"] == rate and s["status"] == "active"
        sid = s["id"]

        # cannot start again on same table
        r2 = requests.post(f"{API}/sessions/start", headers=auth(staff_token),
                           json={"table_id": avail["id"]}, timeout=30)
        assert r2.status_code == 400

        # active list
        ra = requests.get(f"{API}/sessions/active", headers=auth(staff_token), timeout=30)
        assert ra.status_code == 200 and any(x["id"] == sid for x in ra.json())

        # add snack
        snacks = requests.get(f"{API}/snacks", headers=auth(staff_token), timeout=30).json()
        snk = snacks[0]
        r3 = requests.post(f"{API}/sessions/{sid}/snacks", headers=auth(staff_token),
                           json={"snack_id": snk["id"], "quantity": 2}, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["snacks_amount"] == snk["price"] * 2

        # remove snack
        r4 = requests.delete(f"{API}/sessions/{sid}/snacks/0", headers=auth(staff_token), timeout=30)
        assert r4.status_code == 200 and r4.json()["snacks_amount"] == 0

        # re-add for billing
        requests.post(f"{API}/sessions/{sid}/snacks", headers=auth(staff_token),
                      json={"snack_id": snk["id"], "quantity": 1}, timeout=30)

        # end
        time.sleep(1)
        r5 = requests.post(f"{API}/sessions/{sid}/end", headers=auth(staff_token),
                           json={"discount": 10, "tax_percent": 5}, timeout=30)
        assert r5.status_code == 200, r5.text
        e = r5.json()
        assert e["status"] == "completed" and "invoice_no" in e and e["grand_total"] > 0

        # table back to available
        tcheck = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30).json()
        t_now = next(t for t in tcheck if t["id"] == avail["id"])
        assert t_now["status"] == "available"


# ---- Dashboard & Reports ----
class TestDashboard:
    def test_stats(self, admin_token):
        r = requests.get(f"{API}/dashboard/stats", headers=auth(admin_token), timeout=30)
        assert r.status_code == 200
        for k in ["today_revenue", "active_sessions", "available_tables", "occupied_tables", "snacks_revenue", "today_sessions"]:
            assert k in r.json()

    def test_charts(self, admin_token):
        r = requests.get(f"{API}/dashboard/charts", headers=auth(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        assert len(d["daily"]) == 7 and "snack_sales" in d and "peak_hours" in d

    def test_reports(self, admin_token):
        for p in ["daily", "weekly", "monthly"]:
            r = requests.get(f"{API}/reports?period={p}", headers=auth(admin_token), timeout=30)
            assert r.status_code == 200
            d = r.json()
            assert "total_revenue" in d and "best_tables" in d and "best_snacks" in d


# ---- Users (admin only) ----
class TestUsers:
    def test_staff_cannot_list_users(self, staff_token):
        r = requests.get(f"{API}/users", headers=auth(staff_token), timeout=30)
        assert r.status_code == 403

    def test_admin_list_users(self, admin_token):
        r = requests.get(f"{API}/users", headers=auth(admin_token), timeout=30)
        assert r.status_code == 200 and len(r.json()) >= 2

    def test_admin_cannot_delete_self(self, admin_token):
        me = requests.get(f"{API}/auth/me", headers=auth(admin_token), timeout=30).json()
        r = requests.delete(f"{API}/users/{me['id']}", headers=auth(admin_token), timeout=30)
        assert r.status_code == 400

    def test_create_and_delete_user(self, admin_token):
        body = {"name": "TEST_user", "email": "test_user_tmp@snooker.com", "password": "pw12345", "role": "staff"}
        # cleanup if exists
        users = requests.get(f"{API}/users", headers=auth(admin_token), timeout=30).json()
        for u in users:
            if u["email"] == body["email"]:
                requests.delete(f"{API}/users/{u['id']}", headers=auth(admin_token), timeout=30)
        r = requests.post(f"{API}/users", headers=auth(admin_token), json=body, timeout=30)
        assert r.status_code == 200, r.text
        uid = r.json()["id"]
        r2 = requests.delete(f"{API}/users/{uid}", headers=auth(admin_token), timeout=30)
        assert r2.status_code == 200


# ---- BUG FIX 1: Permission revoke with SAME staff token ----
class TestPermissionRevoke:
    def _staff_id(self, admin_token):
        users = requests.get(f"{API}/users", headers=auth(admin_token), timeout=30).json()
        return next(u["id"] for u in users if u["email"] == STAFF["email"])

    def test_grant_then_revoke_view_reports(self, admin_token, staff_token):
        sid = self._staff_id(admin_token)
        # Grant view_reports (plus default manage_sessions)
        r = requests.put(f"{API}/users/{sid}/permissions", headers=auth(admin_token),
                         json={"permissions": {"manage_sessions": True, "view_reports": True}}, timeout=30)
        assert r.status_code == 200
        assert r.json()["permissions"]["view_reports"] is True
        # Staff with SAME token can now access reports
        r2 = requests.get(f"{API}/reports?period=daily", headers=auth(staff_token), timeout=30)
        assert r2.status_code == 200, f"After grant expected 200, got {r2.status_code}: {r2.text}"
        # Revoke: omit view_reports -> should normalize to False
        r3 = requests.put(f"{API}/users/{sid}/permissions", headers=auth(admin_token),
                          json={"permissions": {"manage_sessions": True}}, timeout=30)
        assert r3.status_code == 200
        assert r3.json()["permissions"]["view_reports"] is False
        # Same token should now be 403
        r4 = requests.get(f"{API}/reports?period=daily", headers=auth(staff_token), timeout=30)
        assert r4.status_code == 403, f"After revoke expected 403, got {r4.status_code}"

    def test_grant_then_revoke_manage_tables(self, admin_token, staff_token):
        sid = self._staff_id(admin_token)
        # Grant manage_tables
        r = requests.put(f"{API}/users/{sid}/permissions", headers=auth(admin_token),
                         json={"permissions": {"manage_sessions": True, "manage_tables": True}}, timeout=30)
        assert r.status_code == 200
        # Same staff token can create/delete a table
        body = {"table_number": "TEST_PERM_T", "table_name": "TEST_perm", "hourly_rate": 100}
        r2 = requests.post(f"{API}/tables", headers=auth(staff_token), json=body, timeout=30)
        assert r2.status_code == 200, r2.text
        tid = r2.json()["id"]
        requests.delete(f"{API}/tables/{tid}", headers=auth(staff_token), timeout=30)
        # Revoke
        r3 = requests.put(f"{API}/users/{sid}/permissions", headers=auth(admin_token),
                         json={"permissions": {"manage_sessions": True}}, timeout=30)
        assert r3.status_code == 200
        # Same token should now be 403
        r4 = requests.post(f"{API}/tables", headers=auth(staff_token), json=body, timeout=30)
        assert r4.status_code == 403


# ---- FEATURE 2 & 3: Frame amounts + Split payments ----
class TestFramesAndSplitPayments:
    def _get_avail_table(self, admin_token):
        tables = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30).json()
        return next(t for t in tables if t["status"] == "available")

    def test_frame_amounts_present(self, admin_token, staff_token):
        t = self._get_avail_table(admin_token)
        r = requests.post(f"{API}/sessions/start", headers=auth(staff_token),
                          json={"table_id": t["id"], "customer_name": "TEST_Frame"}, timeout=30)
        assert r.status_code == 200
        sid = r.json()["id"]
        rate = r.json()["rate_used"]
        # start & end frame
        requests.post(f"{API}/sessions/{sid}/frames/start", headers=auth(staff_token),
                      json={"player_a": "A", "player_b": "B"}, timeout=30)
        time.sleep(1)
        r2 = requests.post(f"{API}/sessions/{sid}/frames/end", headers=auth(staff_token),
                           json={"winner": "A", "loser": "B", "paid_by": "A"}, timeout=30)
        assert r2.status_code == 200
        frames = r2.json()["frames"]
        assert len(frames) >= 1
        f = frames[0]
        for k in ("amount", "duration_minutes", "winner", "loser", "paid_by"):
            assert k in f, f"frame missing {k}"
        # amount uses precise elapsed frame seconds, even though duration_minutes remains a display field.
        elapsed_seconds = (
            __import__("datetime").datetime.fromisoformat(f["end_time"])
            - __import__("datetime").datetime.fromisoformat(f["start_time"])
        ).total_seconds()
        expected = round((elapsed_seconds / 3600.0) * rate, 2)
        assert 0.5 <= elapsed_seconds <= 4.0
        assert f["amount"] == expected
        assert f["amount"] > 0
        assert f["amount"] != round(rate / 60.0, 2)
        # end with single payment (legacy) to clean up
        r3 = requests.post(f"{API}/sessions/{sid}/end", headers=auth(staff_token),
                           json={"payment_method": "cash"}, timeout=30)
        assert r3.status_code == 200
        # GET session must contain frames[] with amount
        g = requests.get(f"{API}/sessions/{sid}", headers=auth(staff_token), timeout=30).json()
        assert g["frames"] and "amount" in g["frames"][0]

    def test_split_payment_success(self, admin_token, staff_token):
        t = self._get_avail_table(admin_token)
        sid = requests.post(f"{API}/sessions/start", headers=auth(staff_token),
                            json={"table_id": t["id"], "customer_name": "TEST_Split"}, timeout=30).json()["id"]
        # Add a snack so the rounded bill is large enough for two positive payment rows.
        snack = requests.get(f"{API}/snacks", headers=auth(staff_token), timeout=30).json()[0]
        add = requests.post(f"{API}/sessions/{sid}/snacks", headers=auth(staff_token),
                            json={"snack_id": snack["id"], "quantity": 1}, timeout=30)
        assert add.status_code == 200
        time.sleep(2)
        # Peek total by ending with an invalid split first? No, do a proper split.
        # Compute expected grand_total by ending with equal split of a known amount.
        # Simpler: fetch session to compute current expected total via minutes.
        # Actually easiest: send X+Y = actual grand_total. But we don't know it until end.
        # Strategy: end with payments summing to the total we compute after fetching.
        # But grand_total is computed at end. So: end with a wrong split first to detect the total from error message.
        r_bad = requests.post(f"{API}/sessions/{sid}/end", headers=auth(staff_token),
                              json={"payments": [{"method": "cash", "amount": 1.0}]}, timeout=30)
        assert r_bad.status_code == 400
        msg = r_bad.json()["detail"]
        assert "don't match total" in msg or "match total" in msg
        # Extract expected total
        import re
        m = re.search(r"total \(([\d.]+)\)", msg)
        assert m, f"unexpected error format: {msg}"
        total = float(m.group(1))
        half = round(total / 2, 2)
        remain = round(total - half, 2)
        r_ok = requests.post(f"{API}/sessions/{sid}/end", headers=auth(staff_token),
                             json={"payments": [{"method": "cash", "amount": half},
                                                {"method": "upi", "amount": remain}]}, timeout=30)
        assert r_ok.status_code == 200, r_ok.text
        e = r_ok.json()
        assert e["payment_method"] == "split"
        assert len(e["payments"]) == 2
        assert abs(sum(p["amount"] for p in e["payments"]) - total) < 0.5
        # payments collection has 2 rows for this session
        # We can't hit mongo directly here; check reports/payments count via time window is complex.
        # Instead verify via reports listing containing both methods.
        rp = requests.get(f"{API}/reports/payments?period=daily", headers=auth(admin_token), timeout=30)
        assert rp.status_code == 200
        payments_for_session = [p for p in rp.json()["payments"] if p.get("session_id") == sid]
        assert len(payments_for_session) == 2
        methods = sorted([p["method"] for p in payments_for_session])
        assert methods == ["cash", "upi"]

    def test_overpayment_rejected(self, admin_token, staff_token):
        t = self._get_avail_table(admin_token)
        sid = requests.post(f"{API}/sessions/start", headers=auth(staff_token),
                            json={"table_id": t["id"]}, timeout=30).json()["id"]
        time.sleep(1)
        r = requests.post(f"{API}/sessions/{sid}/end", headers=auth(staff_token),
                          json={"payments": [{"method": "cash", "amount": 999999}]}, timeout=30)
        assert r.status_code == 400
        assert "match total" in r.json()["detail"]
        # session still active — clean up with legacy
        r2 = requests.post(f"{API}/sessions/{sid}/end", headers=auth(staff_token),
                           json={"payment_method": "cash"}, timeout=30)
        assert r2.status_code == 200

    def test_legacy_single_method_regression(self, admin_token, staff_token):
        t = self._get_avail_table(admin_token)
        sid = requests.post(f"{API}/sessions/start", headers=auth(staff_token),
                            json={"table_id": t["id"]}, timeout=30).json()["id"]
        time.sleep(1)
        r = requests.post(f"{API}/sessions/{sid}/end", headers=auth(staff_token),
                          json={"payment_method": "cash"}, timeout=30)
        assert r.status_code == 200
        e = r.json()
        assert e["payment_method"] == "cash"
        assert len(e["payments"]) == 1
        assert e["payments"][0]["method"] == "cash"


# ---- ITERATION 7: ephemeral finalize snapshot, fresh reopen, snapshot end, rounding/split ----
class TestFinalizePreviewAndRounding:
    def _avail(self, admin_token):
        tables = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30).json()
        return next(t for t in tables if t["status"] == "available")

    def _start(self, admin_token, staff_token, customer):
        table = self._avail(admin_token)
        response = requests.post(
            f"{API}/sessions/start",
            headers=auth(staff_token),
            json={"table_id": table["id"], "customer_name": customer},
            timeout=30,
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_finalize_preview_is_ephemeral_and_fresh(self, admin_token, staff_token):
        started = self._start(admin_token, staff_token, "TEST_Iter7Ephemeral")
        sid = started["id"]
        time.sleep(2)
        first_response = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        )
        assert first_response.status_code == 200, first_response.text
        first_data = first_response.json()
        assert first_data["status"] == "active"
        expected_keys = {
            "end_time", "duration_seconds", "duration_minutes", "table_amount",
            "snacks_amount", "grand_total_exact", "grand_total",
        }
        first = first_data["freeze_snapshot"]
        assert expected_keys == set(first)
        assert isinstance(first["duration_seconds"], int)
        assert isinstance(first["duration_minutes"], int)
        assert isinstance(first["grand_total"], int)
        assert first["duration_seconds"] >= 1
        assert first["table_amount"] > 0
        assert first["grand_total"] == int(round(first["grand_total_exact"]))
        assert not any(key.startswith("preview_") for key in first_data)

        persisted = requests.get(
            f"{API}/sessions/{sid}", headers=auth(staff_token), timeout=30
        )
        assert persisted.status_code == 200, persisted.text
        assert persisted.json()["status"] == "active"
        assert "freeze_snapshot" not in persisted.json()
        assert not any(key.startswith("preview_") for key in persisted.json())

        time.sleep(4)
        second_response = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        )
        assert second_response.status_code == 200, second_response.text
        second = second_response.json()["freeze_snapshot"]
        assert second["end_time"] != first["end_time"]
        assert second["duration_seconds"] > first["duration_seconds"]
        assert second["table_amount"] > first["table_amount"]

        ended = requests.post(
            f"{API}/sessions/{sid}/end",
            headers=auth(staff_token),
            json={"payment_method": "cash", "freeze_snapshot": second},
            timeout=30,
        )
        assert ended.status_code == 200, ended.text
        invoice = ended.json()
        assert invoice["status"] == "completed"
        assert invoice["end_time"] == second["end_time"]
        assert invoice["duration_minutes"] == second["duration_minutes"]
        assert invoice["table_amount"] == second["table_amount"]
        assert invoice["grand_total"] == second["grand_total"]

    def test_end_with_snapshot_uses_snapshot_not_current_time(self, admin_token, staff_token):
        started = self._start(admin_token, staff_token, "TEST_Iter7SnapshotEnd")
        sid = started["id"]
        time.sleep(2)
        preview = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        ).json()["freeze_snapshot"]
        time.sleep(4)
        ended = requests.post(
            f"{API}/sessions/{sid}/end",
            headers=auth(staff_token),
            json={"payment_method": "cash", "freeze_snapshot": preview},
            timeout=30,
        )
        assert ended.status_code == 200, ended.text
        invoice = ended.json()
        assert invoice["end_time"] == preview["end_time"]
        assert invoice["duration_minutes"] == preview["duration_minutes"]
        assert invoice["table_amount"] == preview["table_amount"]
        assert invoice["grand_total"] == preview["grand_total"]

    def test_end_without_snapshot_computes_fresh(self, admin_token, staff_token):
        started = self._start(admin_token, staff_token, "TEST_Iter7FreshEnd")
        sid = started["id"]
        time.sleep(2)
        preview = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        ).json()["freeze_snapshot"]
        time.sleep(4)
        ended = requests.post(
            f"{API}/sessions/{sid}/end",
            headers=auth(staff_token),
            json={"payment_method": "cash"},
            timeout=30,
        )
        assert ended.status_code == 200, ended.text
        invoice = ended.json()
        assert invoice["end_time"] != preview["end_time"]
        assert invoice["table_amount"] > preview["table_amount"]

    def test_split_payment_with_ephemeral_snapshot_and_rounding(self, admin_token, staff_token):
        started = self._start(admin_token, staff_token, "TEST_Iter7SplitSnapshot")
        sid = started["id"]
        snack = requests.get(f"{API}/snacks", headers=auth(staff_token), timeout=30).json()[0]
        added = requests.post(
            f"{API}/sessions/{sid}/snacks",
            headers=auth(staff_token),
            json={"snack_id": snack["id"], "quantity": 1},
            timeout=30,
        )
        assert added.status_code == 200, added.text
        time.sleep(2)
        snapshot = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        ).json()["freeze_snapshot"]
        total = snapshot["grand_total"]
        assert isinstance(total, int) and total >= 2
        cash = total // 2
        upi = total - cash
        payload = {
            "payment_method": "cash",
            "payments": [{"method": "cash", "amount": cash}, {"method": "upi", "amount": upi}],
            "freeze_snapshot": snapshot,
        }
        ended = requests.post(
            f"{API}/sessions/{sid}/end", headers=auth(staff_token), json=payload, timeout=30
        )
        assert ended.status_code == 200, ended.text
        invoice = ended.json()
        assert invoice["payment_method"] == "split"
        assert invoice["payments"] == payload["payments"]
        assert invoice["table_amount"] == snapshot["table_amount"]
        assert invoice["grand_total"] == snapshot["grand_total"]
        assert invoice["grand_total"] == int(round(invoice["grand_total_exact"]))


# ---- BUG FIX (iter 5): precise seconds-based session billing ----
class TestPreciseSecondsBilling:
    def _available_300_table(self, admin_token):
        tables = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30).json()
        return next(t for t in tables if t["status"] == "available" and float(t["hourly_rate"]) == 300)

    def _start(self, table, staff_token, customer):
        response = requests.post(
            f"{API}/sessions/start",
            headers=auth(staff_token),
            json={"table_id": table["id"], "customer_name": customer},
            timeout=30,
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_finalize_preview_scales_with_precise_seconds(self, admin_token, staff_token):
        table = self._available_300_table(admin_token)
        started = self._start(table, staff_token, "TEST_PrecisePreview")
        sid = started["id"]
        time.sleep(5)
        preview = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        )
        assert preview.status_code == 200, preview.text
        data = preview.json()
        snapshot = data["freeze_snapshot"]
        elapsed_seconds = (
            __import__("datetime").datetime.fromisoformat(snapshot["end_time"])
            - __import__("datetime").datetime.fromisoformat(data["start_time"])
        ).total_seconds()
        expected = round(elapsed_seconds / 3600.0 * 300, 2)
        assert 4.5 <= elapsed_seconds <= 8.0
        assert snapshot["duration_seconds"] == int(elapsed_seconds)
        assert snapshot["table_amount"] == expected
        assert 0.37 <= snapshot["table_amount"] <= 0.67
        assert snapshot["table_amount"] != 5.0
        ended = requests.post(
            f"{API}/sessions/{sid}/end",
            headers=auth(staff_token),
            json={"payment_method": "cash", "freeze_snapshot": snapshot},
            timeout=30,
        )
        assert ended.status_code == 200, ended.text
        assert ended.json()["table_amount"] == snapshot["table_amount"]

    def test_end_without_preview_uses_precise_seconds(self, admin_token, staff_token):
        table = self._available_300_table(admin_token)
        started = self._start(table, staff_token, "TEST_PreciseDirectEnd")
        sid = started["id"]
        time.sleep(5)
        ended = requests.post(
            f"{API}/sessions/{sid}/end", headers=auth(staff_token), json={"payment_method": "cash"}, timeout=30
        )
        assert ended.status_code == 200, ended.text
        data = ended.json()
        elapsed_seconds = (
            __import__("datetime").datetime.fromisoformat(data["end_time"])
            - __import__("datetime").datetime.fromisoformat(data["start_time"])
        ).total_seconds()
        expected = round(elapsed_seconds / 3600.0 * 300, 2)
        assert 4.5 <= elapsed_seconds <= 8.0
        assert data["table_amount"] == expected
        assert 0.37 <= data["table_amount"] <= 0.67
        assert data["table_amount"] != 5.0


# ---- BUG FIX (iter 6): frontend split contract and precise frame auto-close ----
class TestIteration6SplitAndFramePrecision:
    def _available_table(self, admin_token):
        tables = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30).json()
        return next(t for t in tables if t["status"] == "available")

    def _start(self, table, staff_token, customer):
        response = requests.post(
            f"{API}/sessions/start",
            headers=auth(staff_token),
            json={"table_id": table["id"], "customer_name": customer},
            timeout=30,
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_split_payload_with_concrete_primary_method_and_persistence(self, admin_token, staff_token):
        table = self._available_table(admin_token)
        started = self._start(table, staff_token, "TEST_Iter6SplitContract")
        sid = started["id"]
        snack = requests.get(f"{API}/snacks", headers=auth(staff_token), timeout=30).json()[0]
        added = requests.post(
            f"{API}/sessions/{sid}/snacks",
            headers=auth(staff_token),
            json={"snack_id": snack["id"], "quantity": 1},
            timeout=30,
        )
        assert added.status_code == 200, added.text
        preview = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        )
        assert preview.status_code == 200, preview.text
        preview_data = preview.json()
        snapshot = preview_data["freeze_snapshot"]
        total = int(snapshot["grand_total"])
        cash = max(1, total // 2)
        upi = total - cash
        assert upi > 0
        payload = {
            "payment_method": "cash",
            "payments": [{"method": "cash", "amount": cash}, {"method": "upi", "amount": upi}],
            "discount": 0,
            "tax_percent": 0,
            "freeze_snapshot": snapshot,
        }
        ended = requests.post(
            f"{API}/sessions/{sid}/end", headers=auth(staff_token), json=payload, timeout=30
        )
        assert ended.status_code == 200, ended.text
        data = ended.json()
        assert data["payment_method"] == "split"
        assert data["payments"] == payload["payments"]
        fetched = requests.get(f"{API}/sessions/{sid}", headers=auth(staff_token), timeout=30)
        assert fetched.status_code == 200
        stored = fetched.json()
        assert stored["payment_method"] == "split"
        assert stored["payments"] == payload["payments"]

    def test_mismatched_split_returns_contract_error_and_remains_active(self, admin_token, staff_token):
        table = self._available_table(admin_token)
        started = self._start(table, staff_token, "TEST_Iter6Mismatch")
        sid = started["id"]
        bad = requests.post(
            f"{API}/sessions/{sid}/end",
            headers=auth(staff_token),
            json={
                "payment_method": "cash",
                "payments": [{"method": "cash", "amount": 100}, {"method": "upi", "amount": 100}],
            },
            timeout=30,
        )
        assert bad.status_code == 400
        detail = bad.json()["detail"]
        assert re.fullmatch(r"Payments \([\d.]+\) don't match total \([\d.]+\)", detail), detail
        active = requests.get(f"{API}/sessions/{sid}", headers=auth(staff_token), timeout=30).json()
        assert active["status"] == "active"
        cleanup = requests.post(
            f"{API}/sessions/{sid}/end", headers=auth(staff_token), json={"payment_method": "cash"}, timeout=30
        )
        assert cleanup.status_code == 200, cleanup.text

    def test_auto_closed_running_frame_uses_precise_seconds(self, admin_token, staff_token):
        table = self._available_table(admin_token)
        started = self._start(table, staff_token, "TEST_Iter6AutoClose")
        sid = started["id"]
        rate = float(started["rate_used"])
        frame_started = requests.post(
            f"{API}/sessions/{sid}/frames/start",
            headers=auth(staff_token),
            json={"player_a": "A", "player_b": "B"},
            timeout=30,
        )
        assert frame_started.status_code == 200, frame_started.text
        time.sleep(2)
        ended = requests.post(
            f"{API}/sessions/{sid}/end", headers=auth(staff_token), json={"payment_method": "cash"}, timeout=30
        )
        assert ended.status_code == 200, ended.text
        frame = ended.json()["frames"][-1]
        elapsed_seconds = (
            __import__("datetime").datetime.fromisoformat(frame["end_time"])
            - __import__("datetime").datetime.fromisoformat(frame["start_time"])
        ).total_seconds()
        expected = round(elapsed_seconds / 3600.0 * rate, 2)
        assert 1.5 <= elapsed_seconds <= 5.0
        assert frame["auto_closed"] is True
        assert frame["amount"] == expected
        assert frame["amount"] > 0
        assert frame["amount"] != round(rate / 60.0, 2)



# ---- ITERATION 7 edge cases: snapshot integrity and running-frame consistency ----
class TestIteration7SnapshotIntegrity:
    def _start(self, admin_token, staff_token, customer):
        tables = requests.get(f"{API}/tables", headers=auth(admin_token), timeout=30).json()
        table = next(t for t in tables if t["status"] == "available")
        response = requests.post(
            f"{API}/sessions/start",
            headers=auth(staff_token),
            json={"table_id": table["id"], "customer_name": customer},
            timeout=30,
        )
        assert response.status_code == 200, response.text
        return response.json()

    def test_rejects_client_tampered_freeze_snapshot(self, admin_token, staff_token):
        started = self._start(admin_token, staff_token, "TEST_Iter7TamperedSnapshot")
        invalid_snapshot = {
            "end_time": started["start_time"],
            "duration_seconds": -3600,
            "duration_minutes": -60,
            "table_amount": -100.0,
            "snacks_amount": 0,
            "grand_total_exact": -100.0,
            "grand_total": -100,
        }
        response = requests.post(
            f"{API}/sessions/{started['id']}/end",
            headers=auth(staff_token),
            json={"payment_method": "cash", "freeze_snapshot": invalid_snapshot},
            timeout=30,
        )
        assert response.status_code in (400, 422), (
            f"Client-tampered snapshot must be rejected, got {response.status_code}: {response.text}"
        )

    def test_running_frame_closes_at_snapshot_time(self, admin_token, staff_token):
        started = self._start(admin_token, staff_token, "TEST_Iter7FrameSnapshot")
        sid = started["id"]
        frame_started = requests.post(
            f"{API}/sessions/{sid}/frames/start",
            headers=auth(staff_token),
            json={"player_a": "A", "player_b": "B"},
            timeout=30,
        )
        assert frame_started.status_code == 200, frame_started.text
        time.sleep(2)
        snapshot_response = requests.post(
            f"{API}/sessions/{sid}/finalize-preview", headers=auth(staff_token), timeout=30
        )
        assert snapshot_response.status_code == 200, snapshot_response.text
        snapshot = snapshot_response.json()["freeze_snapshot"]
        time.sleep(3)
        ended = requests.post(
            f"{API}/sessions/{sid}/end",
            headers=auth(staff_token),
            json={"payment_method": "cash", "freeze_snapshot": snapshot},
            timeout=30,
        )
        assert ended.status_code == 200, ended.text
        invoice = ended.json()
        frame = invoice["frames"][-1]
        assert invoice["table_amount"] == snapshot["table_amount"]
        assert frame["end_time"] == snapshot["end_time"], (
            "Auto-closed frame must end at the frozen billing timestamp so its itemized amount "
            "matches the frozen table charge"
        )
        assert round(sum(float(item["amount"]) for item in invoice["frames"]), 2) == invoice["table_amount"]


# ---- Reset staff perms after suite ----
@pytest.fixture(scope="session", autouse=True)
def _reset_staff_perms(admin_token):
    yield
    users = requests.get(f"{API}/users", headers=auth(admin_token), timeout=30).json()
    sid = next((u["id"] for u in users if u["email"] == STAFF["email"]), None)
    if sid:
        requests.put(f"{API}/users/{sid}/permissions", headers=auth(admin_token),
                     json={"permissions": {"manage_sessions": True}}, timeout=30)

