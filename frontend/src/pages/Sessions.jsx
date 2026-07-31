import { useEffect, useMemo, useState } from "react";
import api, { inr, inrRounded, formatApiErrorDetail } from "@/lib/api";
import { Clock, Plus, Pause, Square, Trash2, X, Receipt, Trophy, Flag, RotateCw } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

function elapsed(startIso) {
  const ms = Date.now() - new Date(startIso).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return { display: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`, hours: ms / 3600000 };
}

export default function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [snacks, setSnacks] = useState([]);
  const [, setTick] = useState(0);
  const [addSnack, setAddSnack] = useState(null); // session
  const [endModal, setEndModal] = useState(null); // session
  const [billingSessionId, setBillingSessionId] = useState(null); //currently in billing mode
  const navigate = useNavigate();

  const load = async () => {
    const [s, sn] = await Promise.all([api.get("/sessions/active"), api.get("/snacks")]);
    setSessions(s.data); setSnacks(sn.data);
  };
  useEffect(() => { load(); const t1 = setInterval(load, 8000); const t2 = setInterval(() => setTick((x) => x + 1), 1000); return () => { clearInterval(t1); clearInterval(t2); }; }, []);

  const addSnackToSession = async (sessionId, snackId, qty) => {
    try {
      await api.post(`/sessions/${sessionId}/snacks`, { snack_id: snackId, quantity: qty });
      toast.success("Snack added");
      setAddSnack(null); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const removeSnack = async (sessionId, idx) => {
    try { await api.delete(`/sessions/${sessionId}/snacks/${idx}`); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const handlePauseResume = async (session) => {
  try {
    if (session.is_paused) {
      await api.post(`/sessions/${session.id}/resume`);
      toast.success("Session resumed");
    } else {
      await api.post(`/sessions/${session.id}/pause`);
      toast.success("Session paused");
    }

    load();
  } catch (e) {
    toast.error(formatApiErrorDetail(e.response?.data?.detail));
  }
};

  const openEndModal = async (session) => {
    try {

        // Pause session for billing
        await api.post(
            `/sessions/${session.id}/pause?reason=BILLING`
        );

        // Refresh active sessions so timer freezes immediately
        await load();

        // Get billing preview
        const { data } = await api.post(
            `/sessions/${session.id}/finalize-preview`
        );

        setBillingSessionId(session.id);

        setEndModal({
            session: data,
            snapshot: data.freeze_snapshot,
        });

    } catch (e) {
        console.error(e);

        toast.error(
            e.response?.data?.detail ||
            e.message ||
            "Unknown Error"
        );
    }
};
  const endSession = async (sessionId, discount, taxPercent, paymentsList, paymentNotes, snapshot) => {
    try {
      const payments = paymentsList || [{ method: "cash", amount: 0 }];
      const { data } = await api.post(`/sessions/${sessionId}/end`, {
        discount: Number(discount || 0),
        tax_percent: Number(taxPercent || 0),
        payments,
        payment_method: payments[0]?.method || "cash",
        payment_notes: paymentNotes || "",
        freeze_snapshot: snapshot || null,
      });
      toast.success(`Session ended. Bill ${data.invoice_no}`);
      setBillingSessionId(null);
      setEndModal(null);
      navigate(`/bill/${data.id}`);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const startFrame = async (sessionId, playerA, playerB) => {
    try { await api.post(`/sessions/${sessionId}/frames/start`, { player_a: playerA, player_b: playerB }); toast.success("Frame started"); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  const endFrame = async (sessionId, winner, loser, paidBy, notes) => {
    try { await api.post(`/sessions/${sessionId}/frames/end`, { winner, loser, paid_by: paidBy, notes: notes || "" }); toast.success("Frame recorded · next frame auto-started"); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6" data-testid="sessions-page">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">Live Floor</div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Active Sessions</h1>
        <p className="text-gray-400 mt-2 text-sm">{sessions.length} session{sessions.length !== 1 && "s"} running right now.</p>
      </div>

      {sessions.length === 0 && (
        <div className="bg-[#141414] border border-dashed border-[#262626] rounded-2xl p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-gray-600" />
          <p className="text-gray-400 mt-4">No active sessions. Start one from the Tables page.</p>
          <button onClick={() => navigate("/tables")} className="mt-5 h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold" data-testid="goto-tables-btn">Go to Tables</button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {sessions.map((s) => {
          const e = computeBill(
          s.start_time,
          null,
          s.rate_used,
          s.is_paused,
          s.pause_started_at,
          s.paused_seconds
        );
          const tableAmount = e.tableAmount;
          const snacksAmount = s.snacks_amount || 0;
          const bill = tableAmount + snacksAmount;
          return (
            <div key={s.id} data-testid={`active-session-${s.table_number}`} className="bg-[#141414] border border-amber-500/30 rounded-2xl overflow-hidden shadow-[0_0_30px_rgba(245,158,11,0.05)]">
              <div className="p-6 border-b border-[#262626] flex items-center justify-between gap-4 flex-wrap bg-gradient-to-r from-amber-500/5 to-transparent">
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-amber-400 font-bold flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-amber-400 pulse-dot inline-block" /> LIVE</div>
                  <div className="text-2xl font-bold mt-1">Table {s.table_number} <span className="text-gray-500 text-base font-normal">· {s.table?.table_name}</span></div>
                  <div className="text-sm text-gray-400 mt-1">{s.customer_name || "Walk-in"} · @{inr(s.rate_used)}/hr</div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-gray-500">Elapsed</div>
                  <div className="text-3xl font-mono font-bold text-amber-300">{e.display}</div>
                </div>
              </div>
              <div className="p-6 grid grid-cols-3 gap-3">
                <Stat label="Table" value={inr(tableAmount)} />
                <Stat label="Snacks" value={inr(snacksAmount)} />
                <Stat label="Est. Bill" value={inr(bill)} accent="green" />
              </div>
              <div className="px-6 pb-4">
                <FramesSection session={s} onStartFrame={startFrame} onEndFrame={endFrame} />
              </div>
              <div className="px-6 pb-4">
                <div className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2">Snacks ({s.snacks?.length || 0})</div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {(!s.snacks || s.snacks.length === 0) && <div className="text-sm text-gray-600 italic">No snacks added.</div>}
                  {s.snacks?.map((it, i) => (
                    <div key={i} className="flex items-center justify-between text-sm p-2 rounded-lg bg-[#0f0f0f] border border-[#1c1c1c]">
                      <span>{it.name} <span className="text-gray-500">× {it.quantity}</span></span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono">{inr(it.subtotal)}</span>
                        <button onClick={() => removeSnack(s.id, i)} className="text-gray-500 hover:text-red-400" data-testid={`remove-snack-${i}`}><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-6 pt-2 flex gap-3">
                <button
                  onClick={() => setAddSnack(s)}
                  data-testid={`add-snack-${s.table_number}`}
                  className="flex-1 h-11 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white font-semibold flex items-center justify-center gap-2"
                >
                  <Plus className="w-4 h-4" />
                  Add Snack
                </button>

                <button
                  onClick={() => handlePauseResume(s)}
                  data-testid={`pause-session-${s.table_number}`}
                  className="flex-1 h-11 rounded-xl bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/40 text-amber-300 font-semibold flex items-center justify-center gap-2"
                >
                  {s.is_paused ? (
  <>
    <RotateCw className="w-4 h-4" />
    Resume
  </>
) : (
  <>
    <Pause className="w-4 h-4" />
    Pause
  </>
)}
                </button>

                <button
                  onClick={() => openEndModal(s)}
                  data-testid={`end-session-${s.table_number}`}
                  className="flex-1 h-11 rounded-xl bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-100 font-semibold flex items-center justify-center gap-2"
                >
                  <Square className="w-4 h-4" />
                  End & Bill
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {addSnack && (
        <Modal title={`Add snack · Table ${addSnack.table_number}`} onClose={() => setAddSnack(null)}>
          <SnackPicker snacks={snacks} onPick={(snack, qty) => addSnackToSession(addSnack.id, snack.id, qty)} />
        </Modal>
      )}
      {endModal && (
        <Modal
title="End session & generate bill"
onClose={async () => {
    try {
        await api.post(
            `/sessions/${billingSessionId}/resume`
        );
    } catch (e) {
        console.error(e);
    }

    setBillingSessionId(null);
    setEndModal(null);
    load();
}}
>
          <EndForm session={endModal.session} snapshot={endModal.snapshot} onSubmit={(d, t, payments, n) => endSession(endModal.session.id, d, t, payments, n, endModal.snapshot)} />
        </Modal>
      )}
    </div>
  );
}

function FramesSection({ session, onStartFrame, onEndFrame }) {
  const [startOpen, setStartOpen] = useState(false);
  const [endOpen, setEndOpen] = useState(false);
  const [playerA, setPlayerA] = useState("");
  const [playerB, setPlayerB] = useState("");
  const frames = session.frames || [];
  const current = session.current_frame;

  // Stats
  const wins = {}; const losses = {}; const paid = {};
  for (const f of frames) {
    if (f.winner) wins[f.winner] = (wins[f.winner] || 0) + 1;
    if (f.loser) losses[f.loser] = (losses[f.loser] || 0) + 1;
    if (f.paid_by) paid[f.paid_by] = (paid[f.paid_by] || 0) + 1;
  }
  const players = Array.from(new Set([...Object.keys(wins), ...Object.keys(losses), current?.player_a, current?.player_b].filter(Boolean)));

  return (
    <div className="mt-2 p-4 rounded-xl bg-[#0d0d0d] border border-[#262626]">
      <div className="flex items-center justify-between mb-3">
        <div className="text-xs uppercase tracking-wider text-gray-500 font-bold flex items-center gap-2"><Trophy className="w-3.5 h-3.5 text-amber-400" /> Frames · {frames.length} played</div>
        {!current && (
          <button onClick={() => setStartOpen(true)} data-testid={`start-frame-${session.table_number}`} className="text-xs h-8 px-3 rounded-lg bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-1"><Flag className="w-3 h-3" /> Start Frame</button>
        )}
        {current && (
          <button onClick={() => setEndOpen(true)} data-testid={`end-frame-${session.table_number}`} className="text-xs h-8 px-3 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center gap-1"><Trophy className="w-3 h-3" /> Record Winner</button>
        )}
      </div>

      {current && (
        <div className="p-3 rounded-lg bg-amber-500/5 border border-amber-500/20 mb-3">
          <div className="text-xs text-amber-300 font-bold uppercase tracking-wider">Frame {current.frame_number} · running</div>
          <div className="text-sm mt-1 text-gray-300">{current.player_a || "Player A"} <span className="text-gray-500 mx-2">vs</span> {current.player_b || "Player B"}</div>
        </div>
      )}

      {frames.length > 0 && (
        <div className="space-y-1.5 max-h-40 overflow-y-auto text-xs">
          {frames.slice().reverse().map((f) => (
            <div key={f.id} className="flex items-center justify-between p-2 rounded-lg bg-[#141414] border border-[#1c1c1c]">
              <span className="font-mono text-gray-500 w-8">#{f.frame_number}</span>
              <span className="flex-1 text-gray-300 truncate"><Trophy className="w-3 h-3 inline text-amber-400 mr-1" /><b>{f.winner}</b> beat {f.loser}</span>
              <span className="text-gray-600 font-mono mr-2">{f.duration_minutes}m</span>
              <span className="font-bold text-green-400 font-mono">{inr(f.amount || 0)}</span>
            </div>
          ))}
        </div>
      )}

      {players.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {players.map((p) => (
            <span key={p} className="text-[10px] px-2 py-1 rounded-full bg-[#141414] border border-[#262626]">{p} · <span className="text-green-400">W{wins[p] || 0}</span> · <span className="text-red-400">L{losses[p] || 0}</span> · <span className="text-amber-400">Paid {paid[p] || 0}</span></span>
          ))}
        </div>
      )}

      {startOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setStartOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-[#141414] border border-[#262626] rounded-2xl p-5">
            <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Flag className="w-4 h-4 text-green-400" /> Start Frame</h3>
            <div className="space-y-3">
              <div><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Player A</div><input value={playerA} onChange={(e) => setPlayerA(e.target.value)} data-testid="frame-player-a" placeholder="e.g. Rahul" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" /></div>
              <div><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Player B</div><input value={playerB} onChange={(e) => setPlayerB(e.target.value)} data-testid="frame-player-b" placeholder="e.g. Amit" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" /></div>
              <button onClick={() => { onStartFrame(session.id, playerA, playerB); setStartOpen(false); }} data-testid="confirm-start-frame" className="w-full h-11 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Start Frame</button>
            </div>
          </div>
        </div>
      )}

      {endOpen && current && (
        <EndFrameModal current={current} onClose={() => setEndOpen(false)} onEnd={(w, l, p, n) => { onEndFrame(session.id, w, l, p, n); setEndOpen(false); }} />
      )}
    </div>
  );
}

function EndFrameModal({ current, onClose, onEnd }) {
  const players = [current.player_a, current.player_b].filter(Boolean);
  const [winner, setWinner] = useState(players[0] || "");
  const [paidBy, setPaidBy] = useState("");
  const [notes, setNotes] = useState("");
  const loser = players.find((p) => p !== winner) || "";
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-sm bg-[#141414] border border-[#262626] rounded-2xl p-5">
        <h3 className="text-lg font-bold mb-4 flex items-center gap-2"><Trophy className="w-4 h-4 text-amber-400" /> Frame {current.frame_number} Result</h3>
        <div className="space-y-3">
          <div><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Winner</div>
            <div className="grid grid-cols-2 gap-2">{players.map((p) => <button key={p} type="button" onClick={() => setWinner(p)} data-testid={`winner-${p}`} className={`h-11 rounded-lg font-semibold text-sm border ${winner === p ? "bg-green-700 border-green-700 text-white" : "bg-[#0f0f0f] border-[#262626] text-gray-300 hover:border-green-700/40"}`}>{p || "—"}</button>)}</div>
          </div>
          <div><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Who Pays?</div>
            <div className="grid grid-cols-2 gap-2">{players.map((p) => <button key={p} type="button" onClick={() => setPaidBy(p)} data-testid={`paid-${p}`} className={`h-11 rounded-lg font-semibold text-sm border ${paidBy === p ? "bg-amber-600 border-amber-600 text-white" : "bg-[#0f0f0f] border-[#262626] text-gray-300 hover:border-amber-500/40"}`}>{p || "—"}</button>)}</div>
          </div>
          <div><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Notes</div><input value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-amber-500" /></div>
          <button onClick={() => { if (!winner || !paidBy) return toast.error("Choose winner and payer"); onEnd(winner, loser, paidBy, notes); }} data-testid="confirm-end-frame" className="w-full h-11 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold flex items-center justify-center gap-2"><RotateCw className="w-4 h-4" /> Save & Start Next Frame</button>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div className={`p-3 rounded-xl bg-[#0f0f0f] border ${accent === "green" ? "border-green-700/30" : "border-[#262626]"}`}>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">{label}</div>
      <div className={`text-lg font-bold font-mono mt-1 ${accent === "green" ? "text-green-400" : "text-white"}`}>{value}</div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div data-testid="session-modal-backdrop" className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4" onClick={onClose}>
      <div data-testid="session-modal-content" onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-[#141414] border border-[#262626] rounded-2xl flex flex-col max-h-[90vh] overflow-hidden">
        <div className="flex items-center justify-between p-5 border-b border-[#262626] shrink-0">
          <h3 className="text-lg font-bold">{title}</h3>
          <button data-testid="session-modal-close" onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">{children}</div>
      </div>
    </div>
  );
}

function SnackPicker({ snacks, onPick }) {
  const [q, setQ] = useState("");
  const list = useMemo(
    () => snacks.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())),
    [snacks, q]
  );
  const [qty, setQty] = useState({});

  return (
    <div className="flex flex-col h-[60vh]">
      {/* Search */}
      <div className="p-5 pb-4 shrink-0">
        <input
          data-testid="snack-search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search snacks..."
          className="w-full h-11 px-4 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700"
        />
      </div>

      {/* Scrollable List */}
      <div
        className="flex-1 min-h-0 overflow-y-auto px-5 pb-5 pr-2"
        style={{
          scrollbarWidth: "thin",
          scrollbarGutter: "stable",
        }}
      >
        <div className="space-y-2">
          {list.map((s) => (
            <div
              key={s.id}
              className="flex items-center justify-between p-3 rounded-xl bg-[#0f0f0f] border border-[#1c1c1c]"
            >
              <div>
                <div className="font-semibold text-sm">{s.name}</div>
                <div className="text-xs text-gray-500">
                  {s.category} · {inr(s.price)} · stock {s.stock_quantity}
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min="1"
                  defaultValue="1"
                  onChange={(e) =>
                    setQty({
                      ...qty,
                      [s.id]: parseInt(e.target.value) || 1,
                    })
                  }
                  className="w-16 h-10 px-2 rounded-lg bg-[#0a0a0a] border border-[#262626] text-center"
                  data-testid={`qty-${s.name}`}
                />

                <button
                  onClick={() => onPick(s, qty[s.id] || 1)}
                  data-testid={`add-${s.name}`}
                  className="h-10 px-4 rounded-lg bg-green-700 hover:bg-green-800 text-white text-sm font-semibold"
                >
                  Add
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// Shared calculation used by both the live session card and the end/bill modal.
// Returns { seconds, minutes, hoursPrecise, display, tableAmount }.
function computeBill(
  startIso,
  freezeIso,
  rate,
  isPaused = false,
  pauseStartedAt = null,
  pausedSeconds = 0
) {
  const startMs = new Date(startIso).getTime();

  let endMs = freezeIso
    ? new Date(freezeIso).getTime()
    : Date.now();

  let totalPaused = pausedSeconds;

  // If currently paused, include the time since pause started
  if (isPaused && pauseStartedAt) {
    totalPaused +=
      (Date.now() - new Date(pauseStartedAt).getTime()) / 1000;
  }

  const seconds = Math.max(
    0,
    Math.floor((endMs - startMs) / 1000 - totalPaused)
  );

  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;

  const display = `${String(h).padStart(2, "0")}:${String(m).padStart(
    2,
    "0"
  )}:${String(s).padStart(2, "0")}`;

  const hoursPrecise = seconds / 3600;
  const tableAmount = Math.round(hoursPrecise * rate * 100) / 100;

  return {
    seconds,
    minutes: Math.floor(seconds / 60),
    hoursPrecise,
    display,
    tableAmount,
  };
}

function EndForm({ session, snapshot, onSubmit }) {
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState(false);
  const [singleMethod, setSingleMethod] = useState("cash");
  const [amounts, setAmounts] = useState({ cash: 0, upi: 0, card: 0, bank: 0, credit: 0 });

  // Ephemeral freeze snapshot — held only in this modal's state. Discarded on close.
  const freezeSecs = snapshot?.duration_seconds ?? 0;
  const h = Math.floor(freezeSecs / 3600);
  const m = Math.floor((freezeSecs % 3600) / 60);
  const sec = freezeSecs % 60;
  const frozenDisplay = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;  const tableAmount = Number(snapshot?.table_amount ?? 0);
  const snacksAmount = Number(snapshot?.snacks_amount ?? session.snacks_amount ?? 0);
  const subtotal = tableAmount + snacksAmount - Number(discount || 0);
  const taxAmount = subtotal * Number(tax || 0) / 100;
  const totalExact = subtotal + taxAmount;
  const total = Math.round(totalExact);
  const METHODS = [
    { k: "cash", label: "Cash" },
    { k: "upi", label: "UPI" },
    { k: "card", label: "Card" },
    { k: "bank", label: "Bank" },
    { k: "credit", label: "Credit" },
  ];

  const enteredTotal = Math.round(Object.values(amounts).reduce((s, v) => s + Number(v || 0), 0));
  const remaining = total - enteredTotal;
  const balanced = remaining === 0;

  const submit = () => {
    let payments;
    if (split) {
      if (!balanced) return toast.error(`Payments don't match. Remaining ₹${remaining}`);
      payments = Object.entries(amounts).filter(([, v]) => Number(v) > 0).map(([m, v]) => ({ method: m, amount: Math.round(Number(v)) }));
      if (payments.length === 0) return toast.error("Enter at least one payment amount");
    } else {
      payments = [{ method: singleMethod, amount: total }];
    }
    onSubmit(discount, tax, payments, notes);
  };

  return (
    <div className="flex flex-col min-h-0 flex-1" data-testid="end-form-frozen">
      {/* Scrollable body */}
      <div className="px-5 py-5 pr-7 space-y-4 overflow-y-auto flex-1">
        {session.frames?.length > 0 && (
          <div className="p-3 rounded-xl bg-[#0f0f0f] border border-[#262626]">
            <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold mb-2">Frame Breakdown</div>
            <div className="space-y-1 max-h-32 overflow-y-auto text-xs">
              {session.frames.map((f) => (
                <div key={f.id} className="flex items-center justify-between">
                  <span className="text-gray-400">Frame {f.frame_number} · {f.duration_minutes}m</span>
                  <span className="font-bold font-mono text-white">{inr(f.amount || 0)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          <Stat label="Duration" value={frozenDisplay} />
          <Stat label="Table" value={inr(tableAmount)} />
          <Stat label="Snacks" value={inr(snacksAmount)} />
          <Stat label="Subtotal" value={inr(tableAmount + snacksAmount)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Discount (₹)</div>
            <input data-testid="end-discount" type="number" min="0" value={discount} onChange={(ev) => setDiscount(ev.target.value)} className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Tax (%)</div>
            <input data-testid="end-tax" type="number" min="0" value={tax} onChange={(ev) => setTax(ev.target.value)} className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" />
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-xl bg-[#0f0f0f] border border-[#262626]">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Split payment</div>
            <div className="text-[11px] text-gray-500">Combine multiple methods for one bill</div>
          </div>
          <button type="button" data-testid="toggle-split" onClick={() => setSplit((v) => !v)} className={`w-11 h-6 rounded-full flex items-center transition-colors ${split ? "bg-green-600 justify-end" : "bg-[#262626] justify-start"}`}>
            <div className="w-5 h-5 rounded-full bg-white mx-0.5" />
          </button>
        </div>

        {!split && (
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Payment Method</div>
            <div className="grid grid-cols-5 gap-1.5">
              {METHODS.map((m) => (
                <button key={m.k} type="button" onClick={() => setSingleMethod(m.k)} data-testid={`method-${m.k}`}
                  className={`h-11 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all ${singleMethod === m.k ? "bg-green-700 border-green-700 text-white" : "bg-[#0f0f0f] border-[#262626] text-gray-400 hover:border-green-700/40"}`}>{m.label}</button>
              ))}
            </div>
          </div>
        )}

        {split && (
          <div className="space-y-2 fade-up">
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Split Amounts</div>
            {METHODS.map((m) => (
              <div key={m.k} className="flex items-center gap-3">
                <label className="w-20 text-xs font-bold uppercase tracking-wider text-gray-400">{m.label}</label>
                <input type="number" min="0" step="1" value={amounts[m.k]} onChange={(ev) => setAmounts({ ...amounts, [m.k]: ev.target.value })} data-testid={`split-${m.k}`}
                  className="flex-1 h-10 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700 font-mono" />
              </div>
            ))}
            <div className={`p-3 rounded-lg text-sm flex items-center justify-between border ${balanced ? "border-green-700/40 bg-green-700/10 text-green-300" : enteredTotal > total ? "border-red-700/40 bg-red-700/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`} data-testid="split-remaining">
              <span className="font-semibold">{balanced ? "Balanced ✓" : enteredTotal > total ? "Overpaid" : "Remaining"}</span>
              <span className="font-mono font-bold">{inrRounded(Math.abs(remaining))}</span>
            </div>
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">Notes (optional)</div>
          <input data-testid="end-notes" value={notes} onChange={(ev) => setNotes(ev.target.value)} placeholder="Ref no., customer note…" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" />
        </div>
      </div>

      {/* Sticky footer: total + submit — always visible */}
      <div className="p-5 pt-4 border-t border-[#262626] bg-[#141414] shrink-0 space-y-3">
        <div className="p-3 rounded-xl bg-green-700/10 border border-green-700/30 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-green-300/80 font-bold">Grand Total (rounded)</div>
            <div className="text-2xl font-bold font-mono text-green-400" data-testid="frozen-total">{inrRounded(total)}</div>
            {Math.abs(totalExact - total) > 0.01 && <div className="text-[10px] text-gray-500 mt-0.5">exact ₹{totalExact.toFixed(2)}</div>}
          </div>
          <Receipt className="w-7 h-7 text-green-400" />
        </div>
        <button onClick={submit} data-testid="confirm-end-session" className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">End Session & Generate Bill</button>
      </div>
    </div>
  );
}