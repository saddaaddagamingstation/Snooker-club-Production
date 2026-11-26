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
  ChevronDown,
  Gamepad2,
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
  if (session.game_timer_enabled) {
    const fmt = (value) => {
      const seconds = Math.max(0, Math.floor(value || 0));
      const h = Math.floor(seconds / 3600);
      const m = Math.floor((seconds % 3600) / 60);
      const sec = seconds % 60;
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    };
    if (session.timer_mode === "awaiting_decision") return "00:00:00";
    if (session.timer_mode === "countdown") {
      const elapsed = !session.is_paused && session.timer_started_at
        ? (Date.now() - new Date(session.timer_started_at).getTime()) / 1000
        : 0;
      return fmt(Math.max(0, Number(session.timer_remaining_seconds || 0) - elapsed));
    }
    if (session.timer_mode === "countup") {
      const seconds = (session.game_billing_segments || [])
        .filter((x) => x.kind === "countup")
        .reduce((sum, x) => sum + Number(x.elapsed_seconds || 0) + (!session.is_paused && x.started_at ? Math.max(0, (Date.now() - new Date(x.started_at).getTime()) / 1000) : 0), 0);
      return fmt(seconds);
    }
  }
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

function countdownColor(session) {
  if (!session) return null;
  let total = 0;
  let remaining = 0;
  if (session.billing_type === "membership" && session.membership_state) {
    total = Number(session.membership_state.daily_minutes || 0) * 60;
    const liveElapsed = !session.is_paused && session.membership_state.as_of
      ? Math.max(0, (Date.now() - new Date(session.membership_state.as_of).getTime()) / 1000) : 0;
    remaining = Math.max(0, Number(session.membership_state.remaining_seconds_today || 0) - liveElapsed);
  } else if (session.timer_mode === "countdown") {
    const segs = session.game_billing_segments || [];
    const last = [...segs].reverse().find((x) => x.kind === "fixed");
    total = Number(last?.duration_seconds || Number(last?.duration_minutes || 0) * 60);
    const liveElapsed = !session.is_paused && session.timer_started_at
      ? Math.max(0, (Date.now() - new Date(session.timer_started_at).getTime()) / 1000) : 0;
    remaining = Math.max(0, Number(session.timer_remaining_seconds || 0) - liveElapsed);
  } else return null;
  if (!total) return null;
  const elapsedSeconds = Math.max(0, total - remaining);
  const progress = Math.min(1, elapsedSeconds / total);
  if (progress < 0.25) return { border: "border-green-500/70", shadow: "shadow-[0_0_22px_rgba(34,197,94,0.14)]", panel: "bg-green-500/5", text: "text-green-300" };
  if (progress < 0.5) return { border: "border-yellow-400/70", shadow: "shadow-[0_0_22px_rgba(250,204,21,0.14)]", panel: "bg-yellow-500/5", text: "text-yellow-300" };
  if (progress < 0.75) return { border: "border-orange-500/70", shadow: "shadow-[0_0_22px_rgba(249,115,22,0.14)]", panel: "bg-orange-500/5", text: "text-orange-300" };
  return { border: "border-red-500/70", shadow: "shadow-[0_0_22px_rgba(239,68,68,0.16)]", panel: "bg-red-500/5", text: "text-red-300" };
}


export default function Tables() {
  const { can } = useAuth();
  const navigate = useNavigate();
  const isAdmin = can("manage_tables");
  const canSession = can("manage_sessions");
  const [tables, setTables] = useState([]);
  const [sessions, setSessions] = useState([]);
  const [pricing, setPricing] = useState(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [gameFilter, setGameFilter] = useState("all");
  const [searchParams] = useSearchParams();
  const foodOrderId = searchParams.get("food_order");
  const [modal, setModal] = useState(null); // regular table create/edit
  const [ps5Modal, setPs5Modal] = useState(false);
  const [startModal, setStartModal] = useState(null); // table object
  useTimer();

  const load = async () => {
    const [t, s, p] = await Promise.all([
      api.get("/tables"),
      api.get("/sessions/active"),
      api.get("/settings/game-pricing").catch(() => ({ data: null })),
    ]);
    setTables(t.data);
    setSessions(s.data);
    if (p.data) setPricing(p.data);
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
    const matchGame = gameFilter === "all" || String(t.game_type || "snooker").toLowerCase() === gameFilter;
    return matchSearch && matchFilter && matchGame;
  });

  const save = async (form) => {
    try {
      if (modal?.edit) {
        await api.put(`/tables/${modal.edit.id}`, {
          ...form,
          hourly_rate: Number(form.hourly_rate ?? 300),
          game_type: form.game_type || "snooker",
        });
        toast.success("Table updated");
      } else {
        await api.post("/tables", {
          ...form,
          hourly_rate: Number(form.hourly_rate || 300),
          game_type: form.game_type || "snooker",
        });
        toast.success("Table added");
      }
      setModal(null);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const savePS5Station = async (form) => {
    try {
      await api.post("/ps5-stations", {
        table_number: form.table_number.trim(),
        table_name: form.table_name.trim(),
        status: form.status,
      });
      toast.success("PS5 station added");
      setPs5Modal(false);
      await load();
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
            player_count: Number(form.player_count || 2),
            rd_selected: Boolean(form.rd_selected),
            duration_minutes: Number(form.duration_minutes || 30),
          },
        );

        data = response.data;

        toast.success(`Table ${data.table_number} started with food order`);
      } else {
        const response = await api.post("/sessions/start", {
          table_id: startModal.id,
          customer_name: form.customer_name,
          billing_type: String(startModal?.game_type || "snooker").toLowerCase() === "ps5"
            ? (form.billing_type || "normal")
            : "normal",
          membership_id: String(startModal?.game_type || "snooker").toLowerCase() === "ps5" && form.billing_type === "membership"
            ? form.membership_id
            : null,
          player_count: Number(form.player_count || (form.billing_type === "membership" ? 1 : 2)),
          rd_selected: Boolean(form.rd_selected),
          duration_minutes: Number(form.duration_minutes || 30),
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
            Game Tables
          </h1>
          <p className="text-gray-400 mt-2 text-sm">
            {tables.length} tables ·{" "}
            {tables.filter((t) => t.status === "available").length} available
          </p>
        </div>
        {isAdmin && (
          <div className="flex flex-wrap gap-2">
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
                    game_type: "snooker",
                  },
                })
              }
              className="h-12 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Table
            </button>
            <button
              data-testid="add-ps5-btn"
              onClick={() => setPs5Modal(true)}
              className="h-12 px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold flex items-center gap-2"
            >
              <Gamepad2 className="w-4 h-4" /> Add PS5
            </button>
          </div>
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
        <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
          <label className="relative">
            <span className="sr-only">Filter by game</span>
            <select
              aria-label="Filter by game"
              data-testid="game-filter"
              value={gameFilter}
              onChange={(e) => setGameFilter(e.target.value)}
              className="h-11 min-w-[150px] appearance-none rounded-lg border border-[#262626] bg-[#141414] pl-3 pr-9 text-sm font-medium text-white outline-none transition-colors focus:border-green-600"
            >
              <option value="all">All Games</option>
              <option value="snooker">Snooker</option>
              <option value="mini_snooker">Mini Snooker</option>
              <option value="ps5">PS5</option>
              <option value="pool">Pool</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          </label>
          <label className="relative">
            <span className="sr-only">Filter by status</span>
            <select
              aria-label="Filter by status"
              data-testid="status-filter"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="h-11 min-w-[150px] appearance-none rounded-lg border border-[#262626] bg-[#141414] pl-3 pr-9 text-sm font-medium capitalize text-white outline-none transition-colors focus:border-green-600"
            >
              <option value="all">All Status</option>
              <option value="available">Available</option>
              <option value="running">Running</option>
              <option value="reserved">Reserved</option>
              <option value="maintenance">Maintenance</option>
            </select>
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
          </label>
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
            const timerColor = active ? countdownColor(active) : null;
            return (
              <div
                key={t.id}
                data-testid={`table-card-${t.table_number}`}
                className={`relative overflow-hidden rounded-2xl bg-[#141414] border p-6 flex flex-col justify-between min-h-[220px] transition-all ${t.status === "running" ? `${timerColor?.border || "border-amber-500/40"} ${timerColor?.shadow || "shadow-[0_0_24px_rgba(245,158,11,0.12)]"}` : "border-[#262626] hover:border-green-700/40"}`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold">
                      {t.table_name} · {(t.game_type || "snooker").replaceAll("_", " ")}
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
                  <div className={`mt-4 p-3 rounded-xl ${timerColor?.panel || "bg-amber-500/5"} border ${timerColor?.border || "border-amber-500/20"}`}>
                    <div className={`flex items-center gap-2 text-xs ${timerColor?.text || "text-amber-300/80"}`}>
                      <Clock className="w-3.5 h-3.5 pulse-dot" /> RUNNING
                    </div>
                    <div className={`text-2xl font-mono font-bold mt-1 ${timerColor?.text || "text-amber-300"}`}>
                      {elapsed(active)}
                    </div>
                    {active.customer_name && (
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        {active.customer_name}
                      </div>
                    )}
                  </div>
                ) : isPaused ? (
                  <div className={`mt-4 p-3 rounded-xl ${timerColor?.panel || "bg-amber-500/5"} border ${timerColor?.border || "border-amber-500/20"}`}>
                    <div className={`flex items-center gap-2 text-xs ${timerColor?.text || "text-amber-300/80"}`}>
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
                      {(t.game_type || "snooker") === "pool" ? "Fixed Packages" : "Starting 30-Minute Rate"}
                    </div>
                    <div className="text-xl font-bold font-mono text-green-400 mt-1">
                      {(t.game_type || "snooker") === "ps5"
                        ? `₹${Math.min(...[1, 2, 3, 4].map((n) => Number(pricing?.ps5?.players?.[String(n)] ?? ({ 1: 129, 2: 199, 3: 299, 4: 369 }[n]))))}–₹${Math.max(...[1, 2, 3, 4].map((n) => Number(pricing?.ps5?.players?.[String(n)] ?? ({ 1: 129, 2: 199, 3: 299, 4: 369 }[n]))))} / hour`
                        : (t.game_type || "snooker") === "pool"
                          ? `₹${pricing?.pool?.package_30 ?? 130} / ₹${pricing?.pool?.package_60 ?? 250}`
                          : (t.game_type || "snooker") === "mini_snooker"
                            ? `From ₹${pricing?.mini_snooker?.players?.["2"] ?? 110}`
                            : `From ₹${pricing?.snooker?.players?.["2"] ?? 170}`}
                    </div>
                    <div className="text-xs text-gray-500 mt-1">
                      {(t.game_type || "snooker") === "ps5"
                        ? "Hourly rate depends on player count"
                        : (t.game_type || "snooker") === "pool"
                          ? "30 min / 60 min"
                          : "Depends on player count"}
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
      {ps5Modal && (
        <Modal title="Add PS5 Station" onClose={() => setPs5Modal(false)}>
          <PS5StationForm onSubmit={savePS5Station} />
        </Modal>
      )}
      {startModal && (
        <Modal
          title={`Start session on ${startModal.table_number}`}
          onClose={() => setStartModal(null)}
          wide
        >
          <StartSessionForm
            table={startModal}
            onSubmit={startSession}
            foodOrderId={foodOrderId}
            pricing={pricing}
          />
        </Modal>
      )}
    </div>
  );
}

function Modal({ title, onClose, children, wide = false }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className={`w-full ${wide ? "max-w-2xl" : "max-w-md"} max-h-[92vh] overflow-y-auto bg-[#141414] border border-[#262626] rounded-2xl shadow-2xl`}
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
      <Field label="Game Type">
        <select
          value={f.game_type || "snooker"}
          onChange={(e) => setF({ ...f, game_type: e.target.value })}
          data-testid="form-game-type"
          className="form-input"
        >
          <option value="snooker">Snooker</option>
          <option value="mini_snooker">Mini Snooker</option>
          <option value="pool">Pool</option>
          {f.game_type === "ps5" && <option value="ps5">PS5</option>}
        </select>
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

function PS5StationForm({ onSubmit }) {
  const [f, setF] = useState({
    table_number: "",
    table_name: "",
    status: "available",
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(f);
      }}
      className="space-y-4"
      data-testid="ps5-station-form"
    >
      <Field label="Station Number">
        <input
          required
          value={f.table_number}
          onChange={(e) => setF({ ...f, table_number: e.target.value })}
          placeholder="PS5-1"
          data-testid="ps5-station-number"
          className="form-input"
        />
      </Field>
      <Field label="Station Name">
        <input
          required
          value={f.table_name}
          onChange={(e) => setF({ ...f, table_name: e.target.value })}
          placeholder="PS5-1"
          data-testid="ps5-station-name"
          className="form-input"
        />
      </Field>
      <Field label="Status">
        <select
          value={f.status}
          onChange={(e) => setF({ ...f, status: e.target.value })}
          data-testid="ps5-station-status"
          className="form-input"
        >
          <option value="available">Available</option>
          <option value="maintenance">Maintenance</option>
        </select>
      </Field>
      <button
        type="submit"
        data-testid="ps5-station-submit"
        className="w-full h-12 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold"
      >
        Add PS5 Station
      </button>
      <style>{`.form-input{width:100%;height:46px;padding:0 14px;border-radius:10px;background:#0f0f0f;border:1px solid #262626;color:#fff;outline:none}.form-input:focus{border-color:#2563eb}`}</style>
    </form>
  );
}

function StartSessionForm({ table, onSubmit, foodOrderId, pricing }) {
  const gameType = table.game_type || "snooker";
  const isPS5 = String(gameType).toLowerCase() === "ps5";
  const isPool = gameType === "pool";
  const [f, setF] = useState({
    customer_name: "",
    billing_type: "normal",
    membership_id: "",
    player_count: 2,
    rd_selected: false,
    duration_minutes: 30,
  });
  const [memberships, setMemberships] = useState([]);
  const refreshMemberships = async () => {
    const r = await api.get("/memberships");
    setMemberships(r.data || []);
  };
  useEffect(() => {
    if (foodOrderId || !isPS5) return;
    refreshMemberships().catch(() => setMemberships([]));
  }, [foodOrderId, isPS5]);
  const selectedMembership = memberships.find((m) => m.id === f.membership_id);
  const baseRates = pricing?.[gameType]?.players || (gameType === "mini_snooker"
    ? { 2: 110, 3: 120, 4: 130, 5: 140, 6: 150 }
    : { 2: 170, 3: 170, 4: 180, 5: 220, 6: 260 });
  const extraMinuteRate = Number(pricing?.[gameType]?.extra_minute ?? 5);
  const rdPrice = Number(pricing?.rd_price ?? 20);
  const pool30 = Number(pricing?.pool?.package_30 ?? 130);
  const pool60 = Number(pricing?.pool?.package_60 ?? 250);
  const ps5HourlyRate = Number(
    pricing?.ps5?.players?.[String(f.player_count)] ??
    ({ 1: 129, 2: 199, 3: 299, 4: 369 }[f.player_count])
  );
  const previewAmount = isPS5
    ? (ps5HourlyRate * f.duration_minutes) / 60
    : isPool
      ? (f.duration_minutes === 60 ? pool60 : pool30)
      : Number(baseRates[f.player_count]) + Math.max(0, f.duration_minutes - 30) * extraMinuteRate + (f.rd_selected ? rdPrice : 0);
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ ...f, game_type: gameType });
      }}
      className="space-y-3"
      data-testid="start-session-form"
    >
      {!foodOrderId && isPS5 && (
        <Field label="Billing Type">
          <select
            value={f.billing_type}
            onChange={(e) => setF({ ...f, billing_type: e.target.value, membership_id: "", player_count: e.target.value === "membership" ? 1 : 2 })}
            className="form-input"
          >
            <option value="normal">Timer-based billing</option>
            <option value="membership">Membership</option>
          </select>
        </Field>
      )}
      {f.billing_type === "normal" || foodOrderId ? (
        <div className="space-y-2.5">
          <div className="p-3 rounded-xl bg-[#0f0f0f] border border-[#262626]">
            <div className="text-xs uppercase tracking-wider text-gray-500">Game</div>
            <div className="text-xl font-bold text-green-400 mt-1 capitalize">{gameType.replaceAll("_", " ")}</div>
            {isPS5 ? (
              <div className="text-xs text-gray-400 mt-1">₹{ps5HourlyRate}/hour · countdown billed proportionally</div>
            ) : isPool ? (
              <div className="text-xs text-gray-400 mt-1">30 min ₹{pool30} · 60 min ₹{pool60}</div>
            ) : (
              <div className="text-xs text-gray-400 mt-1">First 30-minute block by player count; additional time ₹{extraMinuteRate}/min</div>
            )}
          </div>
          {isPS5 ? (
            <>
            <Field label="Number of Players">
              <select value={f.player_count} onChange={(e) => setF({ ...f, player_count: Number(e.target.value) })} className="form-input">
                {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>)}
              </select>
            </Field>
            <Field label="Initial Countdown Duration">
              <select
                value={f.duration_minutes}
                onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })}
                className="form-input"
              >
                {[10, 20, 30, 40, 60, 90, 120, 150, 180].map((n) => (
                  <option key={n} value={n}>{n} minutes</option>
                ))}
              </select>
            </Field>
            </>
          ) : isPool ? (
            <Field label="Initial Package">
              <select
                value={f.duration_minutes}
                onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })}
                className="form-input"
              >
                <option value={30}>30 minutes — ₹{pool30}</option>
                <option value={60}>60 minutes — ₹{pool60}</option>
              </select>
            </Field>
          ) : (
            <>
              <Field label="Number of Players">
                <select
                  value={f.player_count}
                  onChange={(e) => setF({ ...f, player_count: Number(e.target.value) })}
                  className="form-input"
                >
                  {[2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n} players</option>)}
                </select>
              </Field>
              <Field label="Initial Timer Duration">
                <select
                  value={f.duration_minutes}
                  onChange={(e) => setF({ ...f, duration_minutes: Number(e.target.value) })}
                  className="form-input"
                >
                  {[30, 60, 90, 120, 150, 180].map((n) => (
                    <option key={n} value={n}>{n} minutes</option>
                  ))}
                </select>
              </Field>
              <label className="flex items-center gap-3 p-3 rounded-xl bg-[#0f0f0f] border border-[#262626] text-sm">
                <input
                  type="checkbox"
                  checked={f.rd_selected}
                  onChange={(e) => setF({ ...f, rd_selected: e.target.checked })}
                  className="w-4 h-4 accent-green-600"
                />
                <span className="flex-1">R.D. add-on</span>
                <span className="font-semibold text-amber-300">+₹{rdPrice} once</span>
              </label>
            </>
          )}
          <div className="p-2.5 rounded-xl bg-green-900/10 border border-green-700/30 flex items-center justify-between">
            <span className="text-sm text-gray-300">Initial block charge</span>
            <span className="text-lg font-bold text-green-400">{inr(previewAmount)}</span>
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
              {memberships.filter((m) => !m.is_expired && m.remaining_seconds_today > 0 && m.remaining_total_seconds > 0).map((m) => (
                <option key={m.id} value={m.id}>{m.member_name} · {m.plan} · {Math.floor(m.remaining_seconds_today / 60)} min left</option>
              ))}
            </select>
          </Field>
          <Field label="Number of Players">
            <select value={f.player_count} onChange={(e) => setF({ ...f, player_count: Number(e.target.value) })} className="form-input">
              {[1, 2, 3, 4].map((n) => <option key={n} value={n}>{n} {n === 1 ? "player" : "players"}</option>)}
            </select>
          </Field>
          <div className="p-3 rounded-xl bg-amber-900/10 border border-amber-700/30 text-sm space-y-1">
            <div className="font-semibold text-amber-300">Additional player charge per session</div>
            <div>{f.player_count === 1 ? "1 player — Included" : `${f.player_count} players — +₹${({2:70,3:170,4:240}[f.player_count])}`}</div>
            <div className="text-xs text-gray-400">Member is included. The extra-player fee is charged once when the session ends.</div>
          </div>
          {selectedMembership && (
            <div className="p-4 rounded-xl bg-[#0f0f0f] border border-green-800/50 text-sm space-y-1">
              <div className="font-semibold text-green-400">{selectedMembership.plan} Membership</div>
              <div>Package balance: {Math.floor((selectedMembership.remaining_total_seconds || 0) / 3600)}h {Math.floor(((selectedMembership.remaining_total_seconds || 0) % 3600) / 60)}m of {selectedMembership.total_hours || 0} hours</div>
              <div>Daily limit: maximum 2 hours</div>
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
      <button
        type="submit"
        disabled={isPS5 && f.billing_type === "membership" && !f.membership_id}
        data-testid="confirm-start-session"
        className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white font-semibold"
      >
        Start {gameType.replaceAll("_", " ")} Timer
      </button>
      <style>{`.form-input{width:100%;height:42px;padding:8px 12px;border-radius:10px;background:#0f0f0f;border:1px solid #262626;color:#fff;outline:none}.form-input:focus{border-color:#15803d}`}</style>
    </form>
  );
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">
        {label}
      </div>
      {children}
    </div>
  );
}
