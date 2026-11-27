import { useCallback, useEffect, useMemo, useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  CalendarDays, Gamepad2, Plus, RefreshCw, XCircle, LayoutDashboard,
  Users, Monitor, CalendarCheck, ChevronLeft, ChevronRight, CheckCircle2, Timer
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail, inr } from "@/lib/api";

const money = (n) => inr(Number(n || 0));
const DURATION_OPTIONS = [30, 60, 90, 120];
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (date, time) => new Date(`${date}T${time}:00`);
const fmt = (value) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function getBookingConflict(station, start, end, bookings, activeSessions) {
  if (["maintenance", "running"].includes(String(station.status || "").toLowerCase())) {
    return { type: "station", label: station.status === "maintenance" ? "Maintenance" : "Currently running" };
  }
  const active = activeSessions.find(s => s.table_id === station.id);
  if (active) return { type: "session", label: `In session · ${active.customer_name || "Playing"}` };
  const conflict = bookings.find(b => b.table_id === station.id && b.status === "confirmed" &&
    new Date(b.start_at) < end && new Date(b.end_at) > start);
  if (conflict) return { type: "booking", label: `Booked · ${conflict.customer_name}`, booking: conflict };
  return null;
}

export default function PS5Bookings() {
  const navigate = useNavigate();
  const [tables, setTables] = useState([]);
  const [bookings, setBookings] = useState([]);
  const [activeSessions, setActiveSessions] = useState([]);
  const [memberships, setMemberships] = useState([]);
  const [pricing, setPricing] = useState({ players: { 1: 129, 2: 199, 3: 299, 4: 369 } });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [availabilityDate, setAvailabilityDate] = useState(dateKey(new Date()));
  const initialTime = useMemo(() => {
    const d = new Date();
    d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    d.setHours(d.getHours() + 1);
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }, []);
  const [form, setForm] = useState({
    table_id: "", start_date: dateKey(new Date()), start_time: initialTime,
    duration_minutes: 60, customer_name: "", phone: "", player_count: 1,
    billing_type: "normal", membership_id: "", notes: ""
  });

  const startAt = useMemo(() => localDateTime(form.start_date, form.start_time), [form.start_date, form.start_time]);
  const endAt = useMemo(() => new Date(startAt.getTime() + Number(form.duration_minutes) * 60000), [startAt, form.duration_minutes]);
  const selectedMember = memberships.find(m => m.id === form.membership_id);
  const hourlyRate = Number(pricing.players?.[String(form.player_count)] ?? ({ 1: 129, 2: 199, 3: 299, 4: 369 }[form.player_count]));
  const estimated = form.billing_type === "membership" ? 0 : hourlyRate * Number(form.duration_minutes) / 60;

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setLoading(true);
    try {
      const [t, b, p, m, s] = await Promise.all([
        api.get("/tables"), api.get("/ps5-bookings"), api.get("/settings/game-pricing"),
        api.get("/memberships"), api.get("/sessions/active")
      ]);
      const rows = Array.isArray(t.data) ? t.data : (t.data?.tables || []);
      const ps5 = rows.filter(x => String(x.game_type || "").toLowerCase() === "ps5");
      setTables(ps5);
      setBookings(Array.isArray(b.data) ? b.data : []);
      setPricing(p.data?.ps5 || { players: { 1: 129, 2: 199, 3: 299, 4: 369 } });
      setMemberships((m.data || []).filter(x => !x.is_expired && x.remaining_total_seconds > 0));
      setActiveSessions(Array.isArray(s.data) ? s.data.filter(x => ps5.some(t => t.id === x.table_id)) : []);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail || "Could not load PS5 bookings and availability"));
    } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => load(true), 30000);
    return () => clearInterval(timer);
  }, [load]);

  const stationAvailability = useMemo(() => {
    const start = localDateTime(form.start_date, form.start_time);
    const end = new Date(start.getTime() + Number(form.duration_minutes) * 60000);
    return tables.map(station => ({ station, conflict: getBookingConflict(station, start, end, bookings, activeSessions) }));
  }, [tables, bookings, activeSessions, form.start_date, form.start_time, form.duration_minutes]);

  const dayBookings = useMemo(() => bookings.filter(b => dateKey(new Date(b.start_at)) === availabilityDate && ["confirmed", "started"].includes(b.status)), [bookings, availabilityDate]);
  const isPastSelection = startAt.getTime() < Date.now();

  const changeForm = (patch) => setForm(f => ({ ...f, ...patch }));
  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return toast.error("Enter the customer name");
    if (Number.isNaN(startAt.getTime())) return toast.error("Choose a valid date and time");
    if (isPastSelection) return toast.error("Booking start time cannot be in the past");
    if (form.billing_type === "membership" && !form.membership_id) return toast.error("Select a membership");
    const selected = stationAvailability.find(x => x.station.id === form.table_id);
    if (form.table_id && (!selected || selected.conflict)) return toast.error("That station is not free for the selected time and duration. Choose another station or time.");
    if (!form.table_id && !stationAvailability.some(x => !x.conflict)) return toast.error("No PS5 station is free for the selected time and duration.");

    setSaving(true);
    try {
      const payload = {
        table_id: form.table_id || null,
        start_at: startAt.toISOString(), end_at: endAt.toISOString(),
        customer_name: form.customer_name.trim(), phone: form.phone,
        player_count: Number(form.player_count), notes: form.notes,
        membership_id: form.billing_type === "membership" ? form.membership_id : null
      };
      const { data } = await api.post("/ps5-bookings", payload);
      toast.success(`Booked ${data.table_number} for ${form.customer_name}`);
      const next = new Date(endAt);
      changeForm({ table_id: "", start_date: dateKey(next), start_time: `${pad(next.getHours())}:${pad(next.getMinutes())}`, customer_name: "", phone: "", membership_id: "", notes: "" });
      setAvailabilityDate(dateKey(next));
      await load(true);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail || "Booking failed"));
      await load(true);
    } finally { setSaving(false); }
  };

  const startBooking = async (booking) => {
    if (!window.confirm(`Start ${booking.table_number} now for ${booking.customer_name}? Early start is allowed.`)) return;
    try {
      await api.post("/sessions/start", {
        table_id: booking.table_id, booking_id: booking.id,
        customer_name: booking.customer_name, notes: booking.notes || "",
        player_count: Number(booking.player_count || 1),
        billing_type: booking.membership_id ? "membership" : "normal",
        membership_id: booking.membership_id || null
      });
      toast.success(`Session started on ${booking.table_number}`);
      await load(true);
      navigate("/sessions");
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail || "Could not start booking")); }
  };

  const cancel = async (id) => {
    if (!window.confirm("Cancel this PS5 booking?")) return;
    try { await api.post(`/ps5-bookings/${id}/cancel`); toast.success("Booking cancelled"); await load(true); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail || "Could not cancel booking")); }
  };

  const shiftDay = (amount) => {
    const d = new Date(`${availabilityDate}T00:00:00`);
    d.setDate(d.getDate() + amount);
    setAvailabilityDate(dateKey(d));
  };

  return <div className="ps5-shell" data-testid="ps5-bookings-page">
    <aside className="ps5-subnav">
      <div className="ps5-subnav-heading">PS5 MANAGEMENT</div>
      <a href="#ps5-overview" className="ps5-nav-item"><LayoutDashboard/> <span>PS5 Overview</span></a>
      <a href="#booking-calendar" className="ps5-nav-item active"><CalendarDays/><span>Bookings &amp; Calendar</span></a>
      <NavLink to="/sessions" className="ps5-nav-item"><Timer/><span>Live Sessions</span></NavLink>
      <NavLink to="/tables" className="ps5-nav-item"><Monitor/><span>PS5 Stations</span></NavLink>
      <NavLink to="/memberships" className="ps5-nav-item"><Users/><span>Membership Reservations</span></NavLink>
      <div className="ps5-subnav-note"><Gamepad2/><span>Manage stations, reservations and live play from one place.</span></div>
    </aside>

    <main className="ps5-main space-y-6">
      <header id="ps5-overview" className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-green-400"><Gamepad2 className="w-5 h-5"/><span className="text-xs uppercase tracking-[.18em] font-bold">Console reservations</span></div>
          <h1 className="text-2xl font-bold text-white mt-1">Bookings &amp; Calendar</h1>
          <p className="text-sm text-gray-400 mt-1">Check each station's availability before confirming a reservation.</p>
        </div>
        <button onClick={() => load()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#303030] bg-[#151515] text-sm text-gray-200 hover:bg-[#202020]"><RefreshCw className="w-4 h-4"/>Refresh</button>
      </header>

      <section className="grid grid-cols-2 xl:grid-cols-4 gap-3">
        <Stat icon={Monitor} label="Total PS5 stations" value={tables.length}/>
        <Stat icon={CheckCircle2} label="Free for selected slot" value={stationAvailability.filter(x => !x.conflict).length} green/>
        <Stat icon={CalendarCheck} label="Bookings on selected day" value={dayBookings.length}/>
        <Stat icon={Gamepad2} label="Live sessions" value={activeSessions.length}/>
      </section>

      <section className="rounded-2xl border border-[#292929] bg-[#121212] p-5" id="booking-calendar">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
          <div><h2 className="font-semibold flex items-center gap-2"><CalendarDays className="w-4 h-4 text-green-400"/>Station availability calendar</h2><p className="text-xs text-gray-500 mt-1">Choose a date, then inspect each station's booked and free time.</p></div>
          <div className="flex items-center gap-2">
            <button onClick={() => shiftDay(-1)} className="p-2 rounded-lg border border-[#303030] hover:bg-[#202020]" aria-label="Previous day"><ChevronLeft className="w-4 h-4"/></button>
            <input aria-label="Availability date" type="date" value={availabilityDate} onChange={e=>{setAvailabilityDate(e.target.value);changeForm({start_date:e.target.value,table_id:""});}} className="booking-input date-control"/>
            <button onClick={() => shiftDay(1)} className="p-2 rounded-lg border border-[#303030] hover:bg-[#202020]" aria-label="Next day"><ChevronRight className="w-4 h-4"/></button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-[11px] text-gray-400 mb-4">
          <Legend color="bg-green-500" label="Free"/><Legend color="bg-red-500" label="Booked"/><Legend color="bg-amber-500" label="Live session / unavailable"/><Legend color="bg-gray-600" label="Past time"/>
        </div>
        {!tables.length ? <p className="text-sm text-amber-400">No PS5 stations configured. Add them from PS5 Stations.</p> : <div className="space-y-3">
          {tables.map(station => <StationTimeline key={station.id} station={station} date={availabilityDate} bookings={bookings} activeSessions={activeSessions} onSelect={(time) => {changeForm({start_date: availabilityDate,start_time:time,table_id:station.id});}} selectedTime={form.start_date===availabilityDate && form.table_id===station.id ? form.start_time : ""} duration={Number(form.duration_minutes)}/>) }
        </div>}
      </section>

      <div className="grid 2xl:grid-cols-[minmax(0,1.2fr)_minmax(320px,.8fr)] gap-5">
        <form onSubmit={submit} className="rounded-2xl border border-[#292929] bg-[#121212] p-5 space-y-4" id="new-booking-form">
          <div className="flex items-center gap-2 font-semibold"><Plus className="w-4 h-4 text-green-400"/>New reservation</div>
          <div className="grid sm:grid-cols-2 gap-3">
            <Field label="Customer name"><input required value={form.customer_name} onChange={e=>changeForm({customer_name:e.target.value})} className="booking-input" placeholder="Customer name"/></Field>
            <Field label="Phone (optional)"><input value={form.phone} onChange={e=>changeForm({phone:e.target.value})} className="booking-input" placeholder="Mobile number"/></Field>
            <Field label="Booking date"><input required type="date" min={dateKey(new Date())} value={form.start_date} onChange={e=>{changeForm({start_date:e.target.value});setAvailabilityDate(e.target.value);}} className="booking-input"/></Field>
            <Field label="Start time"><input required type="time" step="900" value={form.start_time} onChange={e=>changeForm({start_time:e.target.value})} className="booking-input"/></Field>
            <Field label="Duration">
              <select value={form.duration_minutes} onChange={e=>changeForm({duration_minutes:Number(e.target.value)})} className="booking-input">{DURATION_OPTIONS.map(n=><option key={n} value={n}>{n} minutes</option>)}</select>
            </Field>
            <Field label="Number of players">
              <select value={form.player_count} onChange={e=>changeForm({player_count:Number(e.target.value)})} className="booking-input">{[1,2,3,4].map(n=><option key={n} value={n}>{n} {n===1?"player":"players"}</option>)}</select>
            </Field>
            <Field label="Station selection">
              <select value={form.table_id} onChange={e=>{changeForm({table_id:e.target.value});}} className="booking-input">
                <option value="">Auto-assign any free station</option>
                {stationAvailability.map(({station,conflict})=><option key={station.id} value={station.id} disabled={!!conflict}>{station.table_number} · {conflict ? conflict.label : "Free for selected time"}</option>)}
              </select>
            </Field>
            <Field label="Booking type">
              <select value={form.billing_type} onChange={e=>changeForm({billing_type:e.target.value,membership_id:""})} className="booking-input"><option value="normal">Regular paid booking</option><option value="membership">Membership booking</option></select>
            </Field>
            {form.billing_type === "membership" && <Field label="Select member">
              <select required value={form.membership_id} onChange={e=>changeForm({membership_id:e.target.value})} className="booking-input"><option value="">Choose active membership</option>{memberships.map(m=><option key={m.id} value={m.id}>{m.member_name} · {m.plan} · {(m.remaining_total_seconds/3600).toFixed(1)}h left</option>)}</select>
            </Field>}
          </div>

          <div className="rounded-xl border border-[#303030] bg-[#0d0d0d] p-3">
            <div className="flex flex-wrap justify-between gap-2 text-sm"><span className="text-gray-400">Selected time</span><strong>{fmt(startAt)} – {fmt(endAt)}</strong></div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs">
              {(() => { const chosen=stationAvailability.find(x=>x.station.id===form.table_id); return <span className={chosen?.conflict ? "text-red-400" : "text-green-400"}>{form.table_id ? (chosen?.conflict ? `Unavailable: ${chosen.conflict.label}` : "Station is free for this slot") : "A free station will be assigned automatically"}</span>; })()}
              <span className="text-gray-500">{form.duration_minutes} min · {form.player_count} {form.player_count===1?"player":"players"}</span>
            </div>
          </div>
          <Field label="Notes (optional)"><textarea rows={2} value={form.notes} onChange={e=>changeForm({notes:e.target.value})} className="booking-input h-auto" placeholder="Any booking notes"/></Field>
          <div className="rounded-xl border border-green-800/40 bg-green-950/20 p-4 flex items-center justify-between gap-3">
            <div><div className="text-xs text-gray-400">{form.billing_type === "membership" ? "Due when the actual session ends" : "Estimated booking charge"}</div><div className="text-xs text-gray-500 mt-1">{form.duration_minutes} min · ends {fmt(endAt)}</div>{form.billing_type === "membership" && selectedMember && <div className="text-xs text-gray-500 mt-1">No membership time is deducted until session start. Extra-player fee follows membership rules.</div>}{form.billing_type === "normal" && <div className="text-xs text-gray-500 mt-1">{money(hourlyRate)}/hour</div>}</div>
            <div className="text-xl font-bold text-green-400">{form.billing_type === "membership" ? "₹0 advance" : money(estimated)}</div>
          </div>
          <button disabled={saving || !tables.length || isPastSelection || (form.table_id && !!stationAvailability.find(x=>x.station.id===form.table_id)?.conflict)} className="w-full rounded-xl bg-green-700 hover:bg-green-600 disabled:opacity-50 py-3 font-semibold">{saving ? "Confirming…" : "Confirm booking"}</button>
        </form>

        <section className="rounded-2xl border border-[#292929] bg-[#121212] p-5">
          <div className="flex items-center justify-between gap-2 mb-4"><div className="font-semibold flex items-center gap-2"><CalendarCheck className="w-4 h-4 text-green-400"/>Reservations</div><span className="text-xs text-gray-500">{bookings.length} records</span></div>
          {loading ? <p className="text-sm text-gray-500">Loading bookings…</p> : bookings.length === 0 ? <p className="text-sm text-gray-500">No bookings yet.</p> : <div className="space-y-3 max-h-[760px] overflow-y-auto pr-1">{bookings.map(b=><div key={b.id} className="rounded-xl border border-[#292929] bg-[#0d0d0d] p-3">
            <div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="font-semibold truncate">{b.customer_name}</div><div className="text-xs text-green-400 mt-1">{b.table_number} · {b.player_count} {b.player_count===1?"player":"players"} · {b.duration_minutes} min</div><div className={`text-[11px] uppercase mt-1 ${statusClass(b.status)}`}>{String(b.status || "confirmed").replace("_"," ")}</div></div>
              {b.status === "confirmed" && <div className="flex items-center gap-3"><button onClick={()=>startBooking(b)} className="text-xs font-semibold text-green-400 hover:text-green-300">Start now</button><button onClick={()=>cancel(b.id)} title="Cancel booking" className="text-gray-500 hover:text-red-400"><XCircle className="w-4 h-4"/></button></div>}
            </div><div className="text-xs text-gray-400 mt-2">{fmt(b.start_at)} – {fmt(b.end_at)}</div><div className="text-sm font-semibold mt-2">{b.membership_id ? `Membership: ${b.membership_name || "Linked member"} · No advance deduction` : money(b.amount)}</div>{b.phone && <div className="text-xs text-gray-500 mt-1">{b.phone}</div>}
          </div>)}</div>}
        </section>
      </div>
    </main>
    <style>{`
      .ps5-shell{display:grid;grid-template-columns:230px minmax(0,1fr);gap:22px;align-items:start;color:#f5f5f5}
      .ps5-subnav{position:sticky;top:18px;min-height:calc(100vh - 36px);padding:18px 12px;border:1px solid #292929;border-radius:16px;background:#101010;display:flex;flex-direction:column;gap:6px}
      .ps5-subnav-heading{font-size:10px;font-weight:800;letter-spacing:.16em;color:#737373;padding:4px 10px 12px}
      .ps5-nav-item{display:flex;align-items:center;gap:11px;padding:11px 10px;border-radius:9px;color:#a3a3a3;font-size:13px;font-weight:600;text-decoration:none;transition:.15s}
      .ps5-nav-item svg{width:17px;height:17px;flex:none}.ps5-nav-item:hover{background:#1c1c1c;color:#fff}.ps5-nav-item.active{background:#12351f;color:#4ade80}
      .ps5-subnav-note{margin-top:auto;padding:12px 9px 4px;border-top:1px solid #292929;display:flex;gap:8px;align-items:flex-start;color:#737373;font-size:11px;line-height:1.5}.ps5-subnav-note svg{width:15px;height:15px;flex:none;color:#4ade80}
      .ps5-main{min-width:0}.booking-input{width:100%;height:42px;padding:9px 11px;border-radius:9px;background:#0b0b0b;border:1px solid #303030;color:#f5f5f5;outline:none}.booking-input:focus{border-color:#15803d}.booking-input option{background:#111;color:#fff}.booking-input.h-auto{height:auto}.date-control{width:auto;min-width:150px}
      .timeline-wrap{overflow-x:auto;padding-bottom:4px}.timeline-grid{display:grid;grid-template-columns:120px repeat(48,minmax(17px,1fr));min-width:1050px;gap:2px;align-items:center}.timeline-name{position:sticky;left:0;background:#121212;z-index:2;font-size:12px;font-weight:700;padding:8px 6px}.timeline-cell{height:27px;border-radius:4px;border:1px solid #292929;background:#153522;cursor:pointer;min-width:0}.timeline-cell:hover{outline:1px solid #86efac;outline-offset:1px}.timeline-cell.busy{background:#512323;border-color:#713434;cursor:not-allowed}.timeline-cell.live{background:#684313;border-color:#91611c;cursor:not-allowed}.timeline-cell.past{background:#242424;border-color:#333;cursor:not-allowed}.timeline-cell.selected{outline:2px solid #4ade80;outline-offset:1px}.timeline-hour{font-size:9px;color:#777;text-align:left;overflow:visible;white-space:nowrap;padding:0 1px 5px}
      @media(max-width:1100px){.ps5-shell{grid-template-columns:1fr}.ps5-subnav{position:static;min-height:0;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px}.ps5-subnav-heading,.ps5-subnav-note{grid-column:1/-1}.ps5-subnav-note{margin-top:6px}}
      @media(max-width:520px){.ps5-subnav{grid-template-columns:1fr 1fr}.ps5-nav-item{font-size:11px;padding:10px 7px;gap:7px}.ps5-nav-item svg{width:15px;height:15px}}
    `}</style>
  </div>;
}

function StationTimeline({station,date,bookings,activeSessions,onSelect,selectedTime,duration}) {
  const now = new Date();
  const cells = Array.from({length:48},(_,i)=>{
    const hour=Math.floor(i/2), minute=(i%2)*30;
    const start=new Date(`${date}T${pad(hour)}:${pad(minute)}:00`);
    const end=new Date(start.getTime()+30*60000);
    const conflict=getBookingConflict(station,start,end,bookings,activeSessions);
    const past=start<now;
    const live=conflict?.type==="session" || conflict?.type==="station";
    const booked=conflict?.type==="booking";
    const key=`${pad(hour)}:${pad(minute)}`;
    const isSelected=selectedTime===key;
    return {key,hour,minute,conflict,past,live,booked,isSelected};
  });
  const selectedStart=selectedTime ? localDateTime(date,selectedTime) : null;
  const selectedEnd=selectedStart ? new Date(selectedStart.getTime()+duration*60000) : null;
  const selectedConflict=selectedStart ? getBookingConflict(station,selectedStart,selectedEnd,bookings,activeSessions) : null;
  return <div className="rounded-xl border border-[#292929] bg-[#0d0d0d] p-3">
    <div className="flex flex-wrap items-center justify-between gap-2 mb-2"><div className="flex items-center gap-2"><Monitor className="w-4 h-4 text-green-400"/><span className="font-semibold text-sm">{station.table_number}</span><span className="text-xs text-gray-500">{station.table_name}</span></div><span className={`text-[11px] ${selectedTime && selectedConflict ? "text-red-400" : "text-green-400"}`}>{selectedTime ? (selectedConflict ? selectedConflict.label : "Free for selected duration") : "Select a free start time"}</span></div>
    <div className="timeline-wrap"><div className="timeline-grid">
      <div className="timeline-name text-gray-500">Time</div>
      {cells.map((c,i)=><div key={`h${c.key}`} className="timeline-hour">{c.minute===0 && c.hour%2===0 ? `${pad(c.hour)}:00` : ""}</div>)}
      <div className="timeline-name text-gray-400">{station.table_number}</div>
      {cells.map(c=>{
        const disabled=!!c.conflict || c.past;
        const cls=`timeline-cell ${c.past?"past":c.live?"live":c.booked?"busy":""} ${c.isSelected?"selected":""}`;
        const title=c.past?`${c.key} · Past`:c.conflict?`${c.key} · ${c.conflict.label}`:`${c.key} · Free`;
        return <button key={c.key} type="button" disabled={disabled} title={title} aria-label={title} className={cls} onClick={()=>onSelect(c.key)}/>;
      })}
    </div></div>
    {selectedTime && selectedConflict && <p className="text-[11px] text-red-400 mt-2">This station is not available for the selected start time and duration. Choose a different free slot.</p>}
  </div>;
}

function Stat({icon:Icon,label,value,green}) { return <div className="rounded-xl border border-[#292929] bg-[#121212] p-4"><div className="flex items-center justify-between gap-2"><span className="text-xs text-gray-500">{label}</span><Icon className={`w-4 h-4 ${green?"text-green-400":"text-gray-500"}`}/></div><div className={`text-2xl font-bold mt-2 ${green?"text-green-400":"text-white"}`}>{value}</div></div>; }
function Legend({color,label}) { return <span className="inline-flex items-center gap-1.5"><i className={`w-2.5 h-2.5 rounded-sm ${color}`}/>{label}</span>; }
function Field({label,children}) { return <label className="block"><span className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{label}</span>{children}</label>; }
function statusClass(status) { return ({confirmed:"text-blue-400",started:"text-green-400",no_show:"text-red-400",completed:"text-gray-500"}[status] || "text-gray-400"); }
