import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, Gamepad2, Plus, RefreshCw, XCircle } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail, inr } from "@/lib/api";

const money = (n) => inr(Number(n || 0));
const localInput = (date) => {
  const d = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return d.toISOString().slice(0, 16);
};
const fmt = (value) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

export default function PS5Bookings() {
  const [tables, setTables] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [pricing, setPricing] = useState({ players: { 1: 129, 2: 199, 3: 299, 4: 369 } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const initialStart = useMemo(() => { const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0); d.setHours(d.getHours() + 1); return d; }, []);
  const [form, setForm] = useState({ table_id: "", start_at: localInput(initialStart), end_at: localInput(new Date(initialStart.getTime() + 60 * 60000)), customer_name: "", phone: "", player_count: 1, notes: "" });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [t, b, p] = await Promise.all([api.get("/tables"), api.get("/ps5-bookings"), api.get("/settings/game-pricing")]);
      setTables((t.data || []).filter((x) => String(x.game_type || "").toLowerCase() === "ps5"));
      setBookings(b.data || []);
      setPricing(p.data?.ps5 || { players: { 1: 129, 2: 199, 3: 299, 4: 369 } });
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail || "Could not load PS5 bookings")); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { load(); const timer = setInterval(load, 30000); return () => clearInterval(timer); }, [load]);

  const hourlyRate = Number(pricing.players?.[String(form.player_count)] ?? ({ 1: 129, 2: 199, 3: 299, 4: 369 }[form.player_count]));
  const durationHours = Math.max(0, (new Date(form.end_at).getTime() - new Date(form.start_at).getTime()) / 3600000);
  const estimated = hourlyRate * durationHours;

  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return toast.error("Enter the customer name");
    if (new Date(form.end_at) <= new Date(form.start_at)) return toast.error("End time must be after start time");
    setSaving(true);
    try {
      const payload = { ...form, table_id: form.table_id || null, start_at: new Date(form.start_at).toISOString(), end_at: new Date(form.end_at).toISOString() };
      const { data } = await api.post("/ps5-bookings", payload);
      toast.success(`Booked ${data.table_number} for ${form.customer_name}`);
      setForm((f) => ({ ...f, table_id: "", customer_name: "", phone: "", notes: "" }));
      await load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail || "Booking failed")); }
    finally { setSaving(false); }
  };

  const cancel = async (id) => {
    if (!window.confirm("Cancel this PS5 booking?")) return;
    try { await api.post(`/ps5-bookings/${id}/cancel`); toast.success("Booking cancelled"); await load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail || "Could not cancel booking")); }
  };

  return <div className="space-y-6" data-testid="ps5-bookings-page">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><div className="flex items-center gap-2 text-green-400"><Gamepad2 className="w-5 h-5"/><span className="text-xs uppercase tracking-[.18em] font-bold">Console reservations</span></div><h1 className="text-2xl font-bold text-white mt-1">PS5 Bookings</h1><p className="text-sm text-gray-400 mt-1">Reserve a station in advance. Auto-assignment skips stations with overlapping bookings or active sessions.</p></div>
      <button onClick={load} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#303030] bg-[#151515] text-sm text-gray-200 hover:bg-[#202020]"><RefreshCw className="w-4 h-4"/>Refresh</button>
    </div>

    {tables.length > 0 ? (
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
        {tables.map((station) => (
          <div key={station.id} className="rounded-xl border border-[#292929] bg-[#121212] p-3">
            <div className="text-xs text-gray-500">PS5 Station</div>
            <div className="font-semibold mt-1 truncate">{station.table_number}</div>
            <div className={`text-xs mt-1 ${station.status === "available" ? "text-green-400" : "text-amber-400"}`}>{station.status}</div>
          </div>
        ))}
      </div>
    ) : (
      <div className="rounded-xl border border-dashed border-[#353535] bg-[#121212] p-5 text-sm text-amber-400">
        No PS5 stations configured. Add a station from Game Tables → Add PS5.
      </div>
    )}

    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(300px,.8fr)] gap-5">
      <form onSubmit={submit} className="rounded-2xl border border-[#292929] bg-[#121212] p-5 space-y-4">
        <div className="flex items-center gap-2 font-semibold"><Plus className="w-4 h-4 text-green-400"/>New booking</div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="Customer name"><input required value={form.customer_name} onChange={(e)=>setForm({...form,customer_name:e.target.value})} className="booking-input" placeholder="Customer name"/></Field>
          <Field label="Phone (optional)"><input value={form.phone} onChange={(e)=>setForm({...form,phone:e.target.value})} className="booking-input" placeholder="Mobile number"/></Field>
          <Field label="Start date & time"><input required type="datetime-local" value={form.start_at} onChange={(e)=>setForm({...form,start_at:e.target.value})} className="booking-input"/></Field>
          <Field label="End date & time"><input required type="datetime-local" value={form.end_at} min={form.start_at} onChange={(e)=>setForm({...form,end_at:e.target.value})} className="booking-input"/></Field>
          <Field label="Players"><select value={form.player_count} onChange={(e)=>setForm({...form,player_count:Number(e.target.value)})} className="booking-input">{[1,2,3,4].map(n=><option key={n} value={n}>{n} {n===1?"player":"players"} · {money(pricing.players?.[String(n)] ?? [129,199,299,369][n-1])}/hour</option>)}</select></Field>
          <Field label="Station assignment"><select value={form.table_id} onChange={(e)=>setForm({...form,table_id:e.target.value})} className="booking-input"><option value="">Auto-assign any available PS5</option>{tables.map(t=><option key={t.id} value={t.id}>{t.table_number} · {t.table_name}</option>)}</select></Field>
        </div>
        <Field label="Notes (optional)"><textarea rows={2} value={form.notes} onChange={(e)=>setForm({...form,notes:e.target.value})} className="booking-input h-auto" placeholder="Any booking notes"/></Field>
        <div className="rounded-xl border border-green-800/40 bg-green-950/20 p-4 flex items-center justify-between gap-3"><div><div className="text-xs text-gray-400">Estimated booking charge</div><div className="text-xs text-gray-500 mt-1">{durationHours.toFixed(2)} hours × {money(hourlyRate)}/hour</div></div><div className="text-xl font-bold text-green-400">{money(estimated)}</div></div>
        <button disabled={saving || !tables.length} className="w-full rounded-xl bg-green-700 hover:bg-green-600 disabled:opacity-50 py-3 font-semibold">{saving ? "Confirming…" : "Confirm booking"}</button>
        {!tables.length && <p className="text-xs text-amber-400">No PS5 stations found. Add a station from Game Tables → Add PS5 first.</p>}
      </form>

      <section className="rounded-2xl border border-[#292929] bg-[#121212] p-5">
        <div className="flex items-center gap-2 font-semibold mb-4"><CalendarDays className="w-4 h-4 text-green-400"/>Upcoming bookings</div>
        {loading ? <p className="text-sm text-gray-500">Loading bookings…</p> : bookings.length === 0 ? <p className="text-sm text-gray-500">No confirmed bookings yet.</p> : <div className="space-y-3 max-h-[620px] overflow-y-auto pr-1">{bookings.map(b=><div key={b.id} className="rounded-xl border border-[#292929] bg-[#0d0d0d] p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-semibold truncate">{b.customer_name}</div><div className="text-xs text-green-400 mt-1">{b.table_number} · {b.player_count} {b.player_count===1?"player":"players"}</div></div><button onClick={()=>cancel(b.id)} title="Cancel booking" className="text-gray-500 hover:text-red-400"><XCircle className="w-4 h-4"/></button></div><div className="text-xs text-gray-400 mt-2">{fmt(b.start_at)} – {fmt(b.end_at)}</div><div className="text-sm font-semibold mt-2">{money(b.amount)}</div>{b.phone && <div className="text-xs text-gray-500 mt-1">{b.phone}</div>}</div>)}</div>}
      </section>
    </div>
    <style>{`.booking-input{width:100%;height:42px;padding:9px 11px;border-radius:9px;background:#0b0b0b;border:1px solid #303030;color:#f5f5f5;outline:none}.booking-input:focus{border-color:#15803d}.booking-input option{background:#111;color:#fff}`}</style>
  </div>;
}
function Field({label,children}) { return <label className="block"><span className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{label}</span>{children}</label>; }
