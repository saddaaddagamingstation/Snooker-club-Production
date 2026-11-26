import { useEffect, useState } from "react";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Plus,
  Search,
  Pencil,
  Trash2,
  Circle,
  X,
  Clock,
  Play,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate, useSearchParams } from "react-router-dom";

const STATUS_STYLES = {
  available: "bg-green-500/10 text-green-400 border-green-500/30",
  running: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  reserved: "bg-blue-500/10 text-blue-400 border-blue-500/30",
  maintenance: "bg-red-500/10 text-red-400 border-red-500/30",
};

function useTimer() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function elapsed(session) {
  const startMs = new Date(session.start_time).getTime();

  let pausedSeconds = Number(session.paused_seconds || 0);

  if (session.is_paused && session.pause_started_at) {
    pausedSeconds +=
      (Date.now() - new Date(session.pause_started_at).getTime()) / 1000;
  }

  const seconds = Math.max(
    0,
    Math.floor((Date.now() - startMs) / 1000 - pausedSeconds),
  );

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;

  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function Tables() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const isAdmin = can("manage_tables");
  const canSession = can("manage_sessions");
  const [tables, setTables] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [searchParams] = useSearchParams();
  const foodOrderId = searchParams.get("food_order");
  const [modal, setModal] = useState(null); // {edit?, form}
  const [startModal, setStartModal] = useState(null); // table object
  useTimer();

  const load = async () => {
    const [t, s] = await Promise.all([
      api.get("/tables"),
      api.get("/sessions/active"),
    ]);
    setTables(t.data);
    setSessions(s.data);
  };
  useEffect(() => {
    load();
    const tm = setInterval(load, 10000);
    return () => clearInterval(tm);
  }, []);

  const sessionFor = (tableId) => sessions.find((s) => s.table_id === tableId);

  const filtered = tables.filter((t) => {
    const matchSearch =
      !search ||
      `${t.table_number} ${t.table_name}`
        .toLowerCase()
        .includes(search.toLowerCase());
    const matchFilter = filter === "all" || t.status === filter;
    return matchSearch && matchFilter;
  });

  const save = async (form) => {
    try {
      if (modal?.edit) {
        await api.put(`/tables/${modal.edit.id}`, {
          ...form,
          hourly_rate: Number(form.hourly_rate),
        });
        toast.success("Table updated");
      } else {
        await api.post("/tables", {
          ...form,
          hourly_rate: Number(form.hourly_rate),
        });
        toast.success("Table added");
      }
      setModal(null);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this table?")) return;
    try {
      await api.delete(`/tables/${id}`);
      toast.success("Deleted");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const startSession = async (form) => {
    try {
      let data;

      if (foodOrderId) {
        const response = await api.post(
          `/food-orders/${foodOrderId}/start-table`,
          {
            table_id: startModal.id,
          },
        );

        data = response.data;

        toast.success(`Table ${data.table_number} started with food order`);
      } else {
        const response = await api.post("/sessions/start", {
          table_id: startModal.id,
          customer_name: form.customer_name,
          notes: form.notes,
          billing_type: form.billing_type || "normal",
          membership_id: form.billing_type === "membership" ? form.membership_id : null,
        });

        data = response.data;

        toast.success(`Session started on ${data.table_number}`);
      }

      setStartModal(null);
      navigate("/sessions");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  return (
    <div className="space-y-6" data-testid="tables-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">
            Floor Plan
          </div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Snooker Tables
          </h1>
          <p className="text-gray-400 mt-2 text-sm">
            {tables.length} tables ·{" "}
            {tables.filter((t) => t.status === "available").length} available
          </p>
        </div>
        {isAdmin && (
          <button
            data-testid="add-table-btn"
            onClick={() =>
              setModal({
                edit: null,
                form: {
                  table_number: "",
                  table_name: "",
                  hourly_rate: 300,
                  status: "available",
                },
              })
            }
            className="h-12 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"
          >
            <Plus className="w-4 h-4" /> Add Table
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input
            data-testid="tables-search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search tables…"
            className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {["all", "available", "running", "reserved", "maintenance"].map(
            (s) => (
              <button
                key={s}
                onClick={() => setFilter(s)}
                data-testid={`filter-${s}`}
                className={`px-4 h-11 rounded-lg border text-sm font-semibold capitalize transition-all ${filter === s ? "bg-green-700 border-green-700 text-white" : "bg-[#141414] border-[#262626] text-gray-400 hover:text-white"}`}
              >
                {s}
              </button>
            ),
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5">
        {filtered.length === 0 ? (
          <div className="col-span-full min-h-[280px] flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#141414] border border-[#262626] flex items-center justify-center mb-4">
              <Circle className="w-7 h-7 text-gray-600" />
            </div>

            <div className="text-lg font-semibold text-gray-300">
              {search
                ? "No Tables Found"
                : filter === "all"
                  ? "No Tables"
                  : `No ${filter.charAt(0).toUpperCase() + filter.slice(1)} Tables`}
            </div>

            <div className="text-sm text-gray-500 mt-2">
              {search
                ? "Try a different search."
                : `There are currently no tables in ${filter === "all" ? "the club" : `this category`}.`}
            </div>
          </div>
        ) : (
          filtered.map((t) => {
            const active = sessionFor(t.id);
            const isPaused = active?.is_paused === true;
            const isRunning = active && !isPaused;
            return (
              <div
                key={t.id}
                data-testid={`table-card-${t.table_number}`}
                className={`relative overflow-hidden rounded-2xl bg-[#141414] border p-6 flex flex-col justify-between min-h-[220px] transition-all ${t.status === "running" ? "border-amber-500/40 shadow-[0_0_24px_rgba(245,158,11,0.12)]" : "border-[#262626] hover:border-green-700/40"}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold">
                      {t.table_name}
                    </div>
                    <div className="text-3xl font-bold mt-1 font-mono">
                      {t.table_number}
                    </div>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs uppercase font-bold tracking-wider border ${
                      isPaused
                        ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                        : STATUS_STYLES[t.status]
                    }`}
                  >
                    {isPaused ? "paused" : t.status}
                  </span>
                </div>
                {isRunning ? (
                  <div className="mt-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <div className="flex items-center gap-2 text-xs text-amber-300/80">
                      <Clock className="w-3.5 h-3.5 pulse-dot" /> RUNNING
                    </div>
                    <div className="text-2xl font-mono font-bold mt-1 text-amber-300">
                      {elapsed(active)}
                    </div>
                    {active.customer_name && (
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        {active.customer_name}
                      </div>
                    )}
                  </div>
                ) : isPaused ? (
                  <div className="mt-4 p-3 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <div className="flex items-center gap-2 text-xs text-amber-300/80">
                      <Clock className="w-3.5 h-3.5" /> PAUSED
                    </div>

                    <div className="text-sm text-gray-400 mt-1">
                      {active.current_frame
                        ? "Frame paused"
                        : "No frame running"}
                    </div>
                  </div>
                ) : (
                  <div className="mt-4">
                    <div className="text-xs uppercase tracking-wider text-gray-500">
                      Hourly Rate
                    </div>
                    <div className="text-2xl font-bold font-mono text-green-400 mt-1">
                      {inr(t.hourly_rate)}
                    </div>
                  </div>
                )}
                <div className="mt-4 flex gap-2">
                  {t.status === "available" && canSession && (
                    <button
                      data-testid={`start-session-${t.table_number}`}
                      onClick={() => setStartModal(t)}
                      className="flex-1 h-10 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
                    >
                      <Play className="w-4 h-4" /> Start
                    </button>
                  )}
                  {t.status === "running" && canSession && (
                    <button
                      onClick={() => navigate("/sessions")}
                      className="flex-1 h-10 rounded-lg bg-amber-600/20 border border-amber-500/40 text-amber-300 text-sm font-semibold"
                    >
                      View Session
                    </button>
                  )}
                  {isAdmin && (
                    <>
                      <button
                        data-testid={`edit-table-${t.table_number}`}
                        onClick={() => setModal({ edit: t, form: t })}
                        className="h-10 w-10 rounded-lg bg-[#1c1c1c] border border-[#262626] text-gray-300 hover:text-white flex items-center justify-center"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        data-testid={`delete-table-${t.table_number}`}
                        onClick={() => remove(t.id)}
                        className="h-10 w-10 rounded-lg bg-[#1c1c1c] border border-[#262626] text-gray-300 hover:text-red-400 flex items-center justify-center"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {modal && (
        <Modal
          title={modal.edit ? "Edit Table" : "Add Table"}
          onClose={() => setModal(null)}
        >
          <TableForm initial={modal.form} onSubmit={save} />
        </Modal>
      )}
      {startModal && (
        <Modal
          title={`Start session on ${startModal.table_number}`}
          onClose={() => setStartModal(null)}
        >
          <StartSessionForm
            table={startModal}
            onSubmit={startSession}
            foodOrderId={foodOrderId}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#141414] border border-[#262626] rounded-2xl shadow-2xl"
      >
        <div className="flex items-center justify-between p-5 border-b border-[#262626]">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"
            data-testid="modal-close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

function TableForm({ initial, onSubmit }) {
  const [f, setF] = useState(initial);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
      className="space-y-4"
      data-testid="table-form"
    >
      <Field label="Table Number">
        <input
          required
          value={f.table_number}
          onChange={(e) => setF({ ...f, table_number: e.target.value })}
          data-testid="form-table-number"
          className="form-input"
        />
      </Field>
      <Field label="Table Name">
        <input
          required
          value={f.table_name}
          onChange={(e) => setF({ ...f, table_name: e.target.value })}
          data-testid="form-table-name"
          className="form-input"
        />
      </Field>
      <Field label="Hourly Rate (₹)">
        <input
          required
          type="number"
          min="0"
          value={f.hourly_rate}
          onChange={(e) => setF({ ...f, hourly_rate: e.target.value })}
          data-testid="form-hourly-rate"
          className="form-input"
        />
      </Field>
      <Field label="Status">
        <select
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value })}
          data-testid="form-status"
          className="form-input"
        >
          {["available", "reserved", "maintenance"].map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </Field>
      <button
        type="submit"
        data-testid="form-submit"
        className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold"
      >
        Save
      </button>
      <style>{`.form-input{width:100%;height:46px;padding:0 14px;border-radius:10px;background:#0f0f0f;border:1px solid #262626;color:#fff;outline:none}.form-input:focus{border-color:#15803d}`}</style>
    </form>
  );
}

function StartSessionForm({ table, onSubmit, foodOrderId }) {
  const [f, setF] = useState({ customer_name: "", notes: "", billing_type: "normal", membership_id: "" });
  const [memberships, setMemberships] = useState([]);
  const refreshMemberships = async () => {
    const r = await api.get("/memberships");
    setMemberships(r.data || []);
  };
  useEffect(() => {
    if (foodOrderId) return;
    refreshMemberships().catch(() => setMemberships([]));
  }, [foodOrderId]);
  const selectedMembership = memberships.find((m) => m.id === f.membership_id);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
      className="space-y-4"
      data-testid="start-session-form"
    >
      {!foodOrderId && (
        <Field label="Billing Type">
          <select
            value={f.billing_type}
            onChange={(e) => setF({ ...f, billing_type: e.target.value, membership_id: "" })}
            className="form-input"
          >
            <option value="normal">Normal hourly billing</option>
            <option value="membership">Membership</option>
          </select>
        </Field>
      )}
      {f.billing_type === "normal" || foodOrderId ? (
      <div className="p-4 rounded-xl bg-[#0f0f0f] border border-[#262626]">
        <div className="text-xs uppercase tracking-wider text-gray-500">
          Hourly Rate (locked)
        </div>
        <div className="text-2xl font-bold font-mono text-green-400 mt-1">
          {inr(table.hourly_rate)}
        </div>
        <div className="text-xs text-gray-500 mt-1">
          Auto-fetched from table settings
        </div>
      </div>
      ) : (
        <div className="space-y-3">
          <Field label="Select Membership">
            <select
              value={f.membership_id}
              onChange={(e) => setF({ ...f, membership_id: e.target.value })}
              className="form-input"
              required
            >
              <option value="">Choose member</option>
              {memberships.filter((m) => !m.is_expired && m.remaining_seconds_today > 0).map((m) => (
                <option key={m.id} value={m.id}>{m.member_name} · {m.plan} · {Math.floor(m.remaining_seconds_today / 60)} min left</option>
              ))}
            </select>
          </Field>
          <p className="text-xs text-gray-500">
            New memberships can only be created from Membership Management.
          </p>
          {selectedMembership && (
            <div className="p-4 rounded-xl bg-[#0f0f0f] border border-green-800/50 text-sm space-y-1">
              <div className="font-semibold text-green-400">{selectedMembership.plan} Membership</div>
              <div>Daily allowance: {selectedMembership.daily_minutes} minutes</div>
              <div>Used today: {Math.floor(selectedMembership.used_seconds_today / 60)} minutes</div>
              <div>Remaining today: {Math.floor(selectedMembership.remaining_seconds_today / 60)} minutes</div>
              <div>Expires: {new Date(selectedMembership.expires_at).toLocaleDateString("en-IN")}</div>
            </div>
          )}
          {memberships.length === 0 && <p className="text-sm text-amber-400">No active memberships found. Add a member first.</p>}
        </div>
      )}
      <Field label="Customer Name (optional)">
        <input
          value={f.customer_name}
          onChange={(e) => setF({ ...f, customer_name: e.target.value })}
          data-testid="start-customer-name"
          className="form-input"
          placeholder="Walk-in"
        />
      </Field>
      <Field label="Notes (optional)">
        <textarea
          value={f.notes}
          onChange={(e) => setF({ ...f, notes: e.target.value })}
          data-testid="start-notes"
          className="form-input"
          rows={2}
        />
      </Field>
      <button
        type="submit"
        disabled={f.billing_type === "membership" && !f.membership_id}
        data-testid="confirm-start-session"
        className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white font-semibold"
      >
        Start Session
      </button>
      <style>{`.form-input{width:100%;min-height:46px;padding:10px 14px;border-radius:10px;background:#0f0f0f;border:1px solid #262626;color:#fff;outline:none}.form-input:focus{border-color:#15803d}`}</style>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
        {label}
      </div>
      {children}
    </div>
  );
}
