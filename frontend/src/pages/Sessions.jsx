import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/lib/auth";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import {
  Clock,
  Plus,
  Pause,
  Square,
  Trash2,
  X,
  Receipt,
  RotateCw,
} from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";

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
  if (progress < 0.25) return { border: "border-green-500/70", shadow: "shadow-[0_0_26px_rgba(34,197,94,0.13)]", text: "text-green-300", header: "from-green-500/10" };
  if (progress < 0.5) return { border: "border-yellow-400/70", shadow: "shadow-[0_0_26px_rgba(250,204,21,0.13)]", text: "text-yellow-300", header: "from-yellow-500/10" };
  if (progress < 0.75) return { border: "border-orange-500/70", shadow: "shadow-[0_0_26px_rgba(249,115,22,0.13)]", text: "text-orange-300", header: "from-orange-500/10" };
  return { border: "border-red-500/70", shadow: "shadow-[0_0_26px_rgba(239,68,68,0.15)]", text: "text-red-300", header: "from-red-500/10" };
}


export default function Sessions({ gameType = null } = {}) {
  const [sessions, setSessions] = useState([]);
  const { can } = useAuth();
  const [snacks, setSnacks] = useState([]);
  const [, setTick] = useState(0);
  const [addSnack, setAddSnack] = useState(null); // session
  const [endModal, setEndModal] = useState(null); // session
  const [billingSessionId, setBillingSessionId] = useState(null); //currently in billing mode
  const [billingResumeSessionId, setBillingResumeSessionId] = useState(null);
  const [clearSessionTarget, setClearSessionTarget] = useState(null);
  const [exhaustionTarget, setExhaustionTarget] = useState(null);
  const [timerPromptTarget, setTimerPromptTarget] = useState(null);
  const dismissedExhaustionIdRef = useRef(null);
  const dismissedTimerPromptIdRef = useRef(null);
  const notifiedTimerPromptIdRef = useRef(null);
  const navigate = useNavigate();

  const load = async () => {
    const [s, sn] = await Promise.all([
      api.get("/sessions/active"),
      api.get("/snacks"),
    ]);
    setSessions(s.data);
    setSnacks(sn.data);
    const scopedSessions = gameType
      ? (s.data || []).filter((x) => String(x.game_type || "").toLowerCase() === String(gameType).toLowerCase())
      : (s.data || []);
    const pendingTimerPrompts = can("manage_sessions")
      ? scopedSessions.filter((x) => x.game_timer_enabled && x.timer_mode === "awaiting_decision")
      : [];
    if (pendingTimerPrompts.length === 0) dismissedTimerPromptIdRef.current = null;
    const timerPrompt = pendingTimerPrompts.find((x) => x.id !== dismissedTimerPromptIdRef.current);
    setTimerPromptTarget(timerPrompt || null);
    if (timerPrompt && notifiedTimerPromptIdRef.current !== timerPrompt.id) {
      notifiedTimerPromptIdRef.current = timerPrompt.id;
      toast.info(`Game time finished · Table ${timerPrompt.table_number}`, {
        description: `${timerPrompt.table?.table_name || "Table"} · ${(timerPrompt.game_type || "snooker").replaceAll("_", " ")}`,
        duration: 10000,
        action: {
          label: "Open Sessions",
          onClick: () => navigate("/sessions"),
        },
      });
    }
    if (!timerPrompt) notifiedTimerPromptIdRef.current = null;
    const exhausted = can("manage_sessions")
      ? scopedSessions.find((x) => x.membership_exhausted && x.id !== dismissedExhaustionIdRef.current)
      : null;
    if (exhausted) setExhaustionTarget(exhausted);
    else setExhaustionTarget(null);
  };
  const visibleSessions = useMemo(
    () => gameType
      ? sessions.filter((session) => String(session.game_type || "").toLowerCase() === String(gameType).toLowerCase())
      : sessions,
    [sessions, gameType],
  );

  useEffect(() => {
    load();
    const t1 = setInterval(load, 5000);
    const t2 = setInterval(() => setTick((x) => x + 1), 1000);
    return () => {
      clearInterval(t1);
      clearInterval(t2);
    };
  }, []);

  const addSnackToSession = async (sessionId, snackId, qty) => {
    try {
      await api.post(`/sessions/${sessionId}/snacks`, {
        snack_id: snackId,
        quantity: qty,
      });

      toast.success("Snack added");

      await load(); // Refresh stock and session

      // DON'T close the popup
      // setAddSnack(null);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const removeSnack = async (sessionId, idx) => {
    try {
      await api.delete(`/sessions/${sessionId}/snacks/${idx}`);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
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

      const { data } = await api.get("/sessions/active");
      setSessions(data);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const continueTimer = async (session) => {
    try {
      await api.post(`/sessions/${session.id}/timer/continue`);
      toast.success("Count-up timer started · ₹5 per minute");
      dismissedTimerPromptIdRef.current = session.id;
      setTimerPromptTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const extendTimer = async (session, durationMinutes) => {
    try {
      await api.post(`/sessions/${session.id}/timer/extend`, { duration_minutes: durationMinutes });
      toast.success(`${durationMinutes}-minute timer started`);
      dismissedTimerPromptIdRef.current = session.id;
      setTimerPromptTarget(null);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const endExpiredTimer = async (session) => {
    dismissedTimerPromptIdRef.current = session.id;
    setTimerPromptTarget(null);
    await openEndModal(session);
  };

  const clearSession = async (sessionId) => {
    try {
      await api.delete(`/sessions/${sessionId}`);

      toast.success("Session cleared");

      setClearSessionTarget(null);

      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const openEndModal = async (session) => {
    try {
      // Pause only if billing opened a running session. If it was
      // already paused manually, preserve that state when billing is cancelled.
      const billingCausedPause = !session.is_paused;

      if (billingCausedPause) {
        await api.post(`/sessions/${session.id}/pause?reason=BILLING`);
      }

      await load();

      const refreshed = (await api.get("/sessions/active")).data.find(
        (x) => x.id === session.id,
      );

      if (!refreshed) {
        throw new Error("Session not found");
      }

      setBillingResumeSessionId(billingCausedPause ? session.id : null);

      // Preview the whole session at session level.
      const { data } = await api.post(
        `/sessions/${session.id}/finalize-preview`,
        {},
      );

      setBillingSessionId(session.id);

      setEndModal({
        session: data,
        snapshot: data.freeze_snapshot,
      });
    } catch (e) {
      console.error(e);

      toast.error(
        e.response?.data?.detail || e.message || "Unable to open billing",
      );
    }
  };
  const endSession = async (
    sessionId,
    discount,
    taxPercent,
    paymentsList,
    paymentNotes,
    snapshot,
  ) => {
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
      await load();
      navigate(`/bill/${data.id}`);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };


  return (
    <div className="space-y-6" data-testid="sessions-page">
      <div>
        <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">
          Live Floor
        </div>
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
          {gameType === "ps5" ? "PS5 Live Sessions" : "Active Sessions"}
        </h1>
        <p className="text-gray-400 mt-2 text-sm">
          {visibleSessions.length} session{visibleSessions.length !== 1 && "s"} running right
          now.
        </p>
      </div>

      {visibleSessions.length === 0 && (
        <div className="bg-[#141414] border border-dashed border-[#262626] rounded-2xl p-12 text-center">
          <Clock className="w-10 h-10 mx-auto text-gray-600" />
          <p className="text-gray-400 mt-4">
            No active sessions. Start one from the Tables page.
          </p>
          <button
            onClick={() => navigate("/tables")}
            className="mt-5 h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold"
            data-testid="goto-tables-btn"
          >
            Go to Tables
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {visibleSessions.map((s) => {
          const e = computeBill(
            s.start_time,
            s.rate_used,
            s.paused_seconds,
            s.is_paused,
            s.pause_started_at,
          );
          const tableAmount = s.billing_type === "membership" ? 0 : (s.game_timer_enabled ? Number(s.table_amount || 0) : e.tableAmount);
          const timerDisplay = s.game_timer_enabled ? formatGameTimer(s) : e.display;
          const timerColor = countdownColor(s);
          const snacksAmount = (s.snacks || []).reduce(
            (total, item) =>
              total +
              Number(
                item.subtotal ??
                  Number(item.price || 0) * Number(item.quantity || 0),
              ),
            0,
          );
          const bill = tableAmount + snacksAmount;
          const membershipRemaining = s.membership_state
            ? Math.max(0, Math.floor(Number(s.membership_state.remaining_seconds_today || 0) - (!s.is_paused && s.membership_state.as_of ? (Date.now() - new Date(s.membership_state.as_of).getTime()) / 1000 : 0)))
            : 0;
          return (
            <div
              key={s.id}
              data-testid={`active-session-${s.table_number}`}
              className={`relative bg-[#141414] border ${timerColor?.border || "border-amber-500/30"} rounded-2xl overflow-hidden ${timerColor?.shadow || "shadow-[0_0_30px_rgba(245,158,11,0.05)]"}`}
            >
              <div className={`p-6 border-b border-[#262626] flex items-center justify-between gap-4 flex-wrap bg-gradient-to-r ${timerColor?.header || "from-amber-500/5"} to-transparent`}>
                <div>
                  <div className="text-xs uppercase tracking-[0.2em] text-amber-400 font-bold flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-amber-400 pulse-dot inline-block" />{" "}
                    LIVE
                  </div>
                  <div className="text-2xl font-bold mt-1">
                    Table {s.table_number}{" "}
                    <span className="text-gray-500 text-base font-normal">
                      · {s.table?.table_name}
                    </span>
                  </div>
                  <div className="text-sm text-gray-400 mt-1">
                    {s.customer_name || "Walk-in"} · {s.billing_type === "membership" ? `${s.membership_state?.plan || "Membership"} · ${s.membership_state?.member_name || "Member"}` : s.game_timer_enabled ? `${(s.game_type || "snooker").replaceAll("_", " ")} · ${s.player_count ? `${s.player_count} players` : "Package"}${s.rd_selected ? " · R.D." : ""}` : `@${inr(s.rate_used)}/hr`}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-xs uppercase tracking-wider text-gray-500">
                    {s.billing_type === "membership" ? "Daily time left" : s.game_timer_enabled ? (s.timer_mode === "countdown" ? "Time remaining" : s.timer_mode === "awaiting_decision" ? "Timer finished" : "Extra time") : "Elapsed"}
                  </div>
                  <div className={`text-3xl font-mono font-bold ${timerColor?.text || "text-amber-300"}`}>
                    {s.billing_type === "membership" ? `${String(Math.floor(membershipRemaining / 60)).padStart(2, "0")}:${String(membershipRemaining % 60).padStart(2, "0")}` : timerDisplay}
                  </div>
                </div>
              </div>
              {s.game_timer_enabled && (
                <div className="px-6 pt-3 text-xs text-gray-400">
                  {s.game_type === "pool" ? `Pool fixed packages · 30 min ₹${s.pricing_snapshot?.pool?.package_30 ?? 130} / 60 min ₹${s.pricing_snapshot?.pool?.package_60 ?? 250}` : `₹${s.pricing_snapshot?.[s.game_type]?.extra_minute ?? 5}/min after each initial 30-minute block · R.D. ${s.rd_selected ? `₹${s.rd_amount ?? s.pricing_snapshot?.rd_price ?? 20} included once` : "not selected"}`}
                </div>
              )}
              {s.game_type === "ps5" && s.ps5_auto_end_at && (
                <div className="px-6 pt-3 text-sm text-amber-300">
                  <span className="font-semibold">Reservation cutoff:</span>{" "}
                  This walk-in will automatically end at{" "}
                  {new Date(s.ps5_auto_end_at).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}{" "}
                  (15 minutes before the next confirmed reservation).
                </div>
              )}
              {s.billing_type === "membership" && (
                <div className="px-6 pt-4 text-sm text-gray-300">
                  <span className="text-green-400 font-semibold">Membership play</span>
                  <span className="mx-2">·</span>
                  {Math.floor((s.membership_state?.used_seconds_today || 0) / 60)} min used of {s.membership_state?.daily_minutes || 0} min today
                  <span className="mx-2">·</span>
                  Expires {s.membership_state?.expires_at ? new Date(s.membership_state.expires_at).toLocaleDateString("en-IN") : "—"}
                </div>
              )}
              <div className="p-6 grid grid-cols-3 gap-3">
                <Stat label="Table" value={inr(tableAmount)} />
                <Stat label="Snacks" value={inr(snacksAmount)} />
                <Stat label="Est. Bill" value={inr(bill)} accent="green" />
              </div>

              <div className="px-6 pb-4">
                <div className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2">
                  Snacks ({s.snacks?.length || 0})
                </div>
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {(!s.snacks || s.snacks.length === 0) && (
                    <div className="text-sm text-gray-600 italic">
                      No snacks added.
                    </div>
                  )}
                  {s.snacks?.map((it, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between text-sm p-2 rounded-lg bg-[#0f0f0f] border border-[#1c1c1c]"
                    >
                      <span>
                        {it.name}{" "}
                        <span className="text-gray-500">× {it.quantity}</span>
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-mono">{inr(it.subtotal)}</span>
                        {can("manage_sessions") && (
                          <button
                            onClick={() => removeSnack(s.id, i)}
                            className="text-gray-500 hover:text-red-400"
                            data-testid={`remove-snack-${i}`}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="p-6 pt-2 flex gap-3">
                {can("manage_sessions") && <>
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
                    onClick={async () => {
                      try {
                        await openEndModal(s);
                      } catch (e) {
                        toast.error(formatApiErrorDetail(e.response?.data?.detail));
                      }
                    }}
                    data-testid={`end-session-${s.table_number}`}
                    className="flex-1 h-11 rounded-xl bg-red-900/40 hover:bg-red-900/60 border border-red-800 text-red-100 font-semibold flex items-center justify-center gap-2"
                  >
                    <Square className="w-4 h-4" />
                    End & Bill
                  </button>
                </>}

                {can("clear_session") && (
                  <button
                    onClick={() => setClearSessionTarget(s)}
                    data-testid={`clear-session-${s.table_number}`}
                    className="flex-1 h-11 rounded-xl bg-gray-500/10 hover:bg-gray-500/20 border border-gray-500/30 text-gray-300 hover:text-white font-semibold flex items-center justify-center gap-2"
                  >
                    <Trash2 className="w-4 h-4" />
                    Clear
                  </button>
                )}
              </div>
              {can("manage_sessions") && timerPromptTarget?.id === s.id && (
                <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-md p-4 sm:p-6">
                  <div className="w-full max-w-md scale-[0.88] origin-center rounded-2xl border border-amber-500/50 bg-[#111111]/95 p-5 sm:p-6 space-y-4 shadow-[0_18px_60px_rgba(0,0,0,0.75)]">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-amber-400 font-bold">
                      <span className="h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
                      Game time completed
                    </div>
                    <h3 className="text-xl font-bold">Continue playing?</h3>
                    <div className="grid grid-cols-3 gap-2 rounded-xl border border-[#303030] bg-[#191919] p-3">
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500">Table No.</div>
                        <div className="font-semibold text-white">{s.table_number}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500">Table Name</div>
                        <div className="font-semibold text-white truncate">{s.table?.table_name || `Table ${s.table_number}`}</div>
                      </div>
                      <div>
                        <div className="text-[10px] uppercase tracking-wider text-gray-500">Game</div>
                        <div className="font-semibold text-white capitalize">{(s.game_type || "snooker").replaceAll("_", " ")}</div>
                      </div>
                    </div>
                    <p className="text-sm text-gray-300">
                      Selected time has ended. The completed block is frozen. Renew the timer or stop and generate the bill.
                    </p>
                    <div className="grid grid-cols-2 gap-3">
                      <button onClick={() => extendTimer(s, 30)} className="h-11 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Add 30 min</button>
                      <button onClick={() => extendTimer(s, 60)} className="h-11 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Add 60 min</button>
                    </div>
                    {["snooker", "mini_snooker"].includes(s.game_type) && (
                      <button onClick={() => continueTimer(s)} className="w-full h-11 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 font-semibold">
                        Continue normally · ₹5/min
                      </button>
                    )}
                    <button onClick={() => endExpiredTimer(s)} className="w-full h-11 rounded-xl bg-red-900/50 hover:bg-red-900/70 border border-red-800 text-red-100 font-semibold">
                      Stop and generate bill
                    </button>
                    <button onClick={() => navigate("/sessions")} className="w-full h-10 rounded-xl border border-[#3a3a3a] bg-[#202020] hover:bg-[#292929] text-gray-200 font-semibold">
                      Go to Sessions
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>


      {can("manage_sessions") && exhaustionTarget && (
        <div className="fixed inset-0 z-[70] bg-black/80 flex items-center justify-center p-4">
          <div className="w-full max-w-md rounded-2xl border border-amber-500/40 bg-[#141414] p-6 space-y-4">
            <h3 className="text-xl font-bold text-amber-300">Daily membership time finished</h3>
            <p className="text-sm text-gray-300">
              {exhaustionTarget.membership_state?.member_name || exhaustionTarget.customer_name || "Member"} has used today's membership allowance on Table {exhaustionTarget.table_number}.
              The membership timer is paused. Choose how to proceed.
            </p>
            <div className="flex gap-3">
              <button
                className="flex-1 h-11 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold"
                onClick={async () => {
                  try {
                    dismissedExhaustionIdRef.current = exhaustionTarget.id;
                    await api.post(`/sessions/${exhaustionTarget.id}/continue-normal`);
                    toast.success("Membership finished. Normal billing started.");
                    setExhaustionTarget(null);
                    await load();
                  } catch (e) {
                    toast.error(formatApiErrorDetail(e.response?.data?.detail));
                  }
                }}
              >Continue with normal billing</button>
              <button
                className="flex-1 h-11 rounded-xl border border-[#444] bg-[#222] text-white font-semibold"
                onClick={async () => {
                  const target = exhaustionTarget;
                  dismissedExhaustionIdRef.current = target.id;
                  setExhaustionTarget(null);
                  try { await openEndModal(target); }
                  catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
                }}
              >Stop and close</button>
            </div>
          </div>
        </div>
      )}

      {can("manage_sessions") && addSnack && (
        <Modal
          title={`Add snack · Table ${addSnack.table_number}`}
          onClose={() => setAddSnack(null)}
        >
          <SnackPicker
            snacks={snacks}
            onPick={(snack, qty) =>
              addSnackToSession(addSnack.id, snack.id, qty)
            }
          />
        </Modal>
      )}

      {clearSessionTarget && (
        <Modal
          title="Clear Session?"
          onClose={() => setClearSessionTarget(null)}
        >
          <div className="p-5">
            <p className="text-white font-semibold text-base">
              Clear Table {clearSessionTarget.table_number}?
            </p>

            <p className="text-gray-400 text-sm mt-2 leading-6">
              This will permanently delete this active session. No bill will be
              generated and it will not appear in session history.
            </p>

            <p className="text-amber-400 text-sm mt-3">
              Any snacks added to this session will be returned to inventory.
            </p>

            <div className="flex gap-3 mt-6">
              <button
                type="button"
                onClick={() => setClearSessionTarget(null)}
                className="flex-1 h-11 rounded-xl border border-[#303030] bg-[#1a1a1a] hover:bg-[#222] text-gray-300 font-semibold"
              >
                No
              </button>

              <button
                type="button"
                onClick={() => clearSession(clearSessionTarget.id)}
                className="flex-1 h-11 rounded-xl bg-red-900/50 hover:bg-red-900/70 border border-red-800 text-red-100 font-semibold"
              >
                Yes, Clear
              </button>
            </div>
          </div>
        </Modal>
      )}
      {endModal && (
        <Modal
          title="End session & generate bill"
          onClose={async () => {
            try {
              if (
                billingResumeSessionId &&
                billingResumeSessionId === billingSessionId
              ) {
                await api.post(`/sessions/${billingSessionId}/resume`);
              }
            } catch (e) {
              console.error(e);
            }

            if (endModal?.session?.game_timer_enabled && endModal.session.timer_mode === "awaiting_decision") {
              dismissedTimerPromptIdRef.current = null;
            }
            setBillingSessionId(null);
            setBillingResumeSessionId(null);
            setEndModal(null);

            await load();
          }}
        >
          <EndForm
            session={endModal.session}
            snapshot={endModal.snapshot}
            onSubmit={(d, t, payments, n) =>
              endSession(
                endModal.session.id,
                d,
                t,
                payments,
                n,
                endModal.snapshot,
              )
            }
          />
        </Modal>
      )}
    </div>
  );
}

function Stat({ label, value, accent }) {
  return (
    <div
      className={`p-3 rounded-xl bg-[#0f0f0f] border ${accent === "green" ? "border-green-700/30" : "border-[#262626]"}`}
    >
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-bold">
        {label}
      </div>
      <div
        className={`text-lg font-bold font-mono mt-1 ${accent === "green" ? "text-green-400" : "text-white"}`}
      >
        {value}
      </div>
    </div>
  );
}

function Modal({ title, onClose, children }) {
  return (
    <div
      data-testid="session-modal-backdrop"
      className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-3 sm:p-4"
      onClick={onClose}
    >
      <div
        data-testid="session-modal-content"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg bg-[#141414] border border-[#262626] rounded-2xl flex flex-col max-h-[90vh] overflow-hidden"
      >
        <div className="flex items-center justify-between p-5 border-b border-[#262626] shrink-0">
          <h3 className="text-lg font-bold">{title}</h3>
          <button
            data-testid="session-modal-close"
            onClick={onClose}
            className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

function SnackPicker({ snacks, onPick }) {
  const [q, setQ] = useState("");
  const list = useMemo(
    () => snacks.filter((s) => s.name.toLowerCase().includes(q.toLowerCase())),
    [snacks, q],
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
                  disabled={s.stock_quantity <= 0}
                  onClick={() => onPick(s, qty[s.id] || 1)}
                  data-testid={`add-${s.name}`}
                  className={`h-10 px-4 rounded-lg text-white text-sm font-semibold transition-colors ${
                    s.stock_quantity <= 0
                      ? "bg-red-700 hover:bg-red-700 cursor-not-allowed"
                      : "bg-green-700 hover:bg-green-800"
                  }`}
                >
                  {s.stock_quantity <= 0 ? "Out of Stock" : "Add"}
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function formatClock(totalSeconds) {
  const seconds = Math.max(0, Math.floor(totalSeconds || 0));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

function formatGameTimer(session) {
  if (session.timer_mode === "awaiting_decision") return "00:00:00";
  if (session.is_paused) {
    if (session.timer_mode === "countdown") return formatClock(session.timer_remaining_seconds);
    const elapsed = (session.game_billing_segments || []).filter((x) => x.kind === "countup").reduce((sum, x) => sum + Number(x.elapsed_seconds || 0), 0);
    return formatClock(elapsed);
  }
  if (session.timer_mode === "countdown") {
    const elapsed = session.timer_started_at ? (Date.now() - new Date(session.timer_started_at).getTime()) / 1000 : 0;
    return formatClock(Math.max(0, Number(session.timer_remaining_seconds || 0) - elapsed));
  }
  if (session.timer_mode === "countup") {
    const segments = session.game_billing_segments || [];
    const elapsed = segments.filter((x) => x.kind === "countup").reduce((sum, x) => {
      const live = x.started_at ? Math.max(0, (Date.now() - new Date(x.started_at).getTime()) / 1000) : 0;
      return sum + Number(x.elapsed_seconds || 0) + live;
    }, 0);
    return formatClock(elapsed);
  }
  return "00:00:00";
}

function computeBill(
  startIso,
  rate,
  pausedSeconds = 0,
  isPaused = false,
  pauseStartedAt = null,
) {
  const now = Date.now();
  const start = startIso ? new Date(startIso).getTime() : now;
  let seconds = Math.max(0, (now - start) / 1000 - Number(pausedSeconds || 0));

  if (isPaused && pauseStartedAt) {
    seconds -= Math.max(0, (now - new Date(pauseStartedAt).getTime()) / 1000);
  }

  seconds = Math.max(0, Math.floor(seconds));
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const sec = seconds % 60;
  const display =
    `${String(h).padStart(2, "0")}:` +
    `${String(m).padStart(2, "0")}:` +
    `${String(sec).padStart(2, "0")}`;
  const hoursPrecise = seconds / 3600;
  const tableAmount = Math.round(hoursPrecise * Number(rate || 0) * 100) / 100;

  return { seconds, minutes: Math.floor(seconds / 60), hoursPrecise, display, tableAmount };
}

function EndForm({ session, snapshot, onSubmit }) {
  const [discount, setDiscount] = useState(0);
  const [tax, setTax] = useState(0);
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState(false);
  const [singleMethod, setSingleMethod] = useState("cash");
  const [amounts, setAmounts] = useState({
    cash: "",
    upi: "",
    card: "",
    bank: "",
    credit: "",
  });

  // Ephemeral freeze snapshot — held only in this modal's state. Discarded on close.
  const freezeSecs = snapshot?.duration_seconds ?? 0;
  const h = Math.floor(freezeSecs / 3600);
  const m = Math.floor((freezeSecs % 3600) / 60);
  const sec = freezeSecs % 60;
  const frozenDisplay = `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  const tableAmount = Number(snapshot?.table_amount ?? 0);
  const snacksAmount = Number(
    snapshot?.snacks_amount ?? session.snacks_amount ?? 0,
  );
  const subtotal = tableAmount + snacksAmount - Number(discount || 0);
  const taxAmount = (subtotal * Number(tax || 0)) / 100;
  const totalExact = subtotal + taxAmount;
  const total = totalExact;
  const METHODS = [
    { k: "cash", label: "Cash" },
    { k: "upi", label: "UPI" },
    { k: "card", label: "Card" },
    { k: "bank", label: "Bank" },
    { k: "credit", label: "Credit" },
  ];

  const enteredTotal = Object.values(amounts).reduce(
    (s, v) => s + Number(v || 0),
    0,
  );

  const remaining = total - enteredTotal;

  const balanced = Math.abs(remaining) < 0.01;

  const submit = () => {
    let payments;
    if (split) {
      if (!balanced)
        return toast.error(`Payments don't match. Remaining ₹${remaining}`);
      payments = Object.entries(amounts)
        .filter(([, v]) => Number(v) > 0)
        .map(([m, v]) => ({ method: m, amount: Number(v) }));
      if (payments.length === 0)
        return toast.error("Enter at least one payment amount");
    } else {
      payments = [{ method: singleMethod, amount: total }];
    }
    onSubmit(discount, tax, payments, notes);
  };

  return (
    <div className="flex flex-col min-h-0 flex-1" data-testid="end-form-frozen">
      {/* Scrollable body */}
      <div className="px-5 py-5 pr-7 space-y-4 overflow-y-auto flex-1">

        <div className="grid grid-cols-2 gap-3">
          <Stat label="Duration" value={frozenDisplay} />
          <Stat label="Table" value={inr(tableAmount)} />
          <Stat label="Snacks" value={inr(snacksAmount)} />
          <Stat label="Subtotal" value={inr(tableAmount + snacksAmount)} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
              Discount (₹)
            </div>
            <input
              data-testid="end-discount"
              type="number"
              min="0"
              value={discount}
              onChange={(ev) => setDiscount(ev.target.value)}
              className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700"
            />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
              Tax (%)
            </div>
            <input
              data-testid="end-tax"
              type="number"
              min="0"
              value={tax}
              onChange={(ev) => setTax(ev.target.value)}
              className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700"
            />
          </div>
        </div>

        <div className="flex items-center justify-between p-3 rounded-xl bg-[#0f0f0f] border border-[#262626]">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
              Split payment
            </div>
            <div className="text-[11px] text-gray-500">
              Combine multiple methods for one bill
            </div>
          </div>
          <button
            type="button"
            data-testid="toggle-split"
            onClick={() => setSplit((v) => !v)}
            className={`w-11 h-6 rounded-full flex items-center transition-colors ${split ? "bg-green-600 justify-end" : "bg-[#262626] justify-start"}`}
          >
            <div className="w-5 h-5 rounded-full bg-white mx-0.5" />
          </button>
        </div>

        {!split && (
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
              Payment Method
            </div>
            <div className="grid grid-cols-5 gap-1.5">
              {METHODS.map((m) => (
                <button
                  key={m.k}
                  type="button"
                  onClick={() => setSingleMethod(m.k)}
                  data-testid={`method-${m.k}`}
                  className={`h-11 rounded-lg text-xs font-bold uppercase tracking-wider border transition-all ${singleMethod === m.k ? "bg-green-700 border-green-700 text-white" : "bg-[#0f0f0f] border-[#262626] text-gray-400 hover:border-green-700/40"}`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {split && (
          <div className="space-y-2 fade-up">
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold">
              Split Amounts
            </div>
            {METHODS.map((m) => (
              <div key={m.k} className="flex items-center gap-3">
                <label className="w-20 text-xs font-bold uppercase tracking-wider text-gray-400">
                  {m.label}
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={amounts[m.k]}
                  onChange={(ev) =>
                    setAmounts({ ...amounts, [m.k]: ev.target.value })
                  }
                  data-testid={`split-${m.k}`}
                  className="flex-1 h-10 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700 font-mono"
                />
              </div>
            ))}
            <div
              className={`p-3 rounded-lg text-sm flex items-center justify-between border ${balanced ? "border-green-700/40 bg-green-700/10 text-green-300" : enteredTotal > total ? "border-red-700/40 bg-red-700/10 text-red-300" : "border-amber-500/40 bg-amber-500/10 text-amber-300"}`}
              data-testid="split-remaining"
            >
              <span className="font-semibold">
                {balanced
                  ? "Balanced ✓"
                  : enteredTotal > total
                    ? "Overpaid"
                    : "Remaining"}
              </span>
              <span className="font-mono font-bold">
                {inr(Math.abs(remaining))}
              </span>
            </div>
          </div>
        )}

        <div>
          <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2">
            Notes (optional)
          </div>
          <input
            data-testid="end-notes"
            value={notes}
            onChange={(ev) => setNotes(ev.target.value)}
            placeholder="Ref no., customer note…"
            className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700"
          />
        </div>
      </div>

      {/* Sticky footer: total + submit — always visible */}
      <div className="p-5 pt-4 border-t border-[#262626] bg-[#141414] shrink-0 space-y-3">
        <div className="p-3 rounded-xl bg-green-700/10 border border-green-700/30 flex items-center justify-between">
          <div>
            <div className="text-[10px] uppercase tracking-wider text-green-300/80 font-bold">
              Grand Total
            </div>
            <div
              className="text-2xl font-bold font-mono text-green-400"
              data-testid="frozen-total"
            >
              {inr(total)}
            </div>
          </div>
          <Receipt className="w-7 h-7 text-green-400" />
        </div>
        <button
          onClick={submit}
          data-testid="confirm-end-session"
          className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold"
        >
          End Session & Generate Bill
        </button>
      </div>
    </div>
  );
}
