import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  CalendarDays, Plus, ChevronLeft, ChevronRight, Clock3
} from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail, inr } from "@/lib/api";

const money = (n) => inr(Number(n || 0));
const DURATION_OPTIONS = [30, 60, 90, 120, 180, 240, 300, 360];
const formatDuration = (minutes) => {
  if (minutes === 30) return "30 minutes";
  if (minutes < 60) return `${minutes} minutes`;
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return remainder ? `${hours} hour 30 minutes` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
};
const pad = (n) => String(n).padStart(2, "0");
const dateKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localDateTime = (date, time) => new Date(`${date}T${time}:00`);
const fmt = (value) => new Date(value).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });

function getActiveSessionReleaseTime(session) {
  if (!session?.game_timer_enabled || session.is_paused) return null;
  if (session.timer_mode === "awaiting_decision") {
    return session.timer_expired_at ? new Date(session.timer_expired_at) : null;
  }
  if (session.timer_mode !== "countdown" || !session.timer_started_at) return null;
  const startedAt = new Date(session.timer_started_at);
  if (Number.isNaN(startedAt.getTime())) return null;
  return new Date(startedAt.getTime() + Number(session.timer_remaining_seconds || 0) * 1000);
}

function getBookingConflict(station, start, end, bookings, activeSessions) {
  if (String(station.status || "").toLowerCase() === "maintenance") {
    return { type: "station", label: "Maintenance" };
  }
  const active = activeSessions.find(s => s.table_id === station.id);
  if (active) {
    const expectedEnd = getActiveSessionReleaseTime(active);
    const availableAt = expectedEnd ? new Date(expectedEnd.getTime() + 15 * 60000) : null;
    if (!availableAt || start < availableAt) {
      return { type: "session", label: `In session · ${active.customer_name || "Playing"}` };
    }
  } else if (String(station.status || "").toLowerCase() === "running") {
    return { type: "station", label: "Currently running" };
  }
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
  const membershipDailyLimitSeconds = selectedMember
    ? Math.min(Number(selectedMember.daily_minutes || 120), 120) * 60
    : 120 * 60;
  const membershipUsedSeconds = selectedMember
    ? Number(selectedMember.daily_usage?.[form.start_date] || 0)
    : 0;
  const membershipReservedSeconds = selectedMember
    ? bookings
        .filter(b => b.membership_id === selectedMember.id && b.status === "confirmed")
        .reduce((total, b) => {
          const bookingStart = new Date(b.start_at);
          const bookingEnd = new Date(b.end_at);
          const dayStart = localDateTime(form.start_date, "00:00");
          const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
          return total + Math.max(0, Math.min(bookingEnd, dayEnd) - Math.max(bookingStart, dayStart)) / 1000;
        }, 0)
    : 0;
  const membershipRemainingMinutes = Math.max(
    0,
    Math.floor((membershipDailyLimitSeconds - membershipUsedSeconds - membershipReservedSeconds) / 60)
  );
  const availableDurations = form.billing_type === "membership"
    ? [...new Set([
        ...DURATION_OPTIONS.filter(n => n <= 120 && n <= membershipRemainingMinutes),
        ...(membershipRemainingMinutes > 0 ? [membershipRemainingMinutes] : [])
      ])].sort((a, b) => a - b)
    : DURATION_OPTIONS;
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

  const isPastSelection = startAt.getTime() < Date.now();

  const changeForm = (patch) => setForm(f => {
    const next = { ...f, ...patch };
    if (next.billing_type === "membership") {
      const member = memberships.find(m => m.id === next.membership_id);
      if (member) {
        const limitSeconds = Math.min(Number(member.daily_minutes || 120), 120) * 60;
        const usedSeconds = Number(member.daily_usage?.[next.start_date] || 0);
        const reservedSeconds = bookings
          .filter(b => b.membership_id === member.id && b.status === "confirmed")
          .reduce((total, b) => {
            const bookingStart = new Date(b.start_at);
            const bookingEnd = new Date(b.end_at);
            const dayStart = localDateTime(next.start_date, "00:00");
            const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);
            return total + Math.max(0, Math.min(bookingEnd, dayEnd) - Math.max(bookingStart, dayStart)) / 1000;
          }, 0);
        const remaining = Math.max(0, Math.floor((limitSeconds - usedSeconds - reservedSeconds) / 60));
        if (next.duration_minutes > remaining) {
          next.duration_minutes = [120, 90, 60, 30].find(n => n <= remaining) || remaining || 30;
        }
      }
    }
    return next;
  });
  const submit = async (e) => {
    e.preventDefault();
    if (!form.customer_name.trim()) return toast.error("Enter the customer name");
    if (form.phone && !/^\d{10}$/.test(form.phone)) return toast.error("Phone number must be exactly 10 digits");
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





  return <div className="ps5-shell" data-testid="ps5-bookings-page">
    <main className="ps5-main space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">PS5 Bookings</h1>
          <p className="text-xs text-gray-400 mt-0.5">Create reservations and manage existing bookings.</p>
        </div>
        <button type="button" onClick={() => load()} className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-[#303030] bg-[#151515] text-sm text-gray-200 hover:bg-[#202020]"><span>Refresh</span></button>
      </div>

      <div className="w-full min-w-0 flex justify-center">
        <form onSubmit={submit} style={{ width: "100%", maxWidth: "1040px", marginInline: "auto" }} className="min-w-0 rounded-2xl border border-[#292929] bg-[#121212] p-5 space-y-4" id="new-booking-form">
          <div className="flex items-center gap-2 font-semibold"><Plus className="w-4 h-4 text-green-400"/>New reservation</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-x-4 gap-y-4">
            <Field label="Billing type">
              <select value={form.billing_type} onChange={e=>changeForm({billing_type:e.target.value,membership_id:""})} className="booking-input"><option value="normal">Regular paid booking</option><option value="membership">Membership booking</option></select>
            </Field>
            {form.billing_type === "membership" && <Field label="Select member">
              <MemberPicker
                members={memberships}
                selectedId={form.membership_id}
                onSelect={member => changeForm({
                  membership_id: member.id,
                  customer_name: member.member_name || "",
                  phone: String(member.phone || "").replace(/\D/g, "").slice(-10)
                })}
              />
            </Field>}
            <Field label="Customer name"><input required value={form.customer_name} onChange={e=>changeForm({customer_name:e.target.value})} className="booking-input" placeholder="Customer name"/></Field>
            <Field label="Phone (optional)"><input type="tel" inputMode="numeric" autoComplete="tel-national" maxLength={10} pattern="[0-9]{10}" value={form.phone} onChange={e=>changeForm({phone:e.target.value.replace(/\D/g, "").slice(0, 10)})} className="booking-input" placeholder="10-digit mobile number"/></Field>
            <Field label="Booking date">
              <DatePicker value={form.start_date} minDate={dateKey(new Date())} onChange={value=>changeForm({start_date:value,table_id:""})}/>
            </Field>
            <Field label="Start time">
              <TimePicker value={form.start_time} onChange={value=>changeForm({start_time:value})}/>
            </Field>
            <Field label="Duration">
              <select value={form.duration_minutes} onChange={e=>changeForm({duration_minutes:Number(e.target.value)})} className="booking-input">{(availableDurations.length ? availableDurations : []).map(n=><option key={n} value={n}>{formatDuration(n)}</option>)}</select>
              {form.billing_type === "membership" && selectedMember && <span className="block text-[11px] text-gray-500 mt-1">Daily allowance remaining for {form.start_date}: {membershipRemainingMinutes} minutes (maximum 120 minutes per day).</span>}
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
          </div>
          <Field label="Notes (optional)"><textarea rows={2} value={form.notes} onChange={e=>changeForm({notes:e.target.value})} className="booking-input h-auto" placeholder="Any booking notes"/></Field>
          <div className="rounded-xl border border-green-800/40 bg-green-950/20 p-2.5 flex items-center justify-between gap-3">
            <div><div className="text-xs text-gray-400">{form.billing_type === "membership" ? "Due when the actual session ends" : "Estimated booking charge"}</div><div className="text-xs text-gray-500 mt-1">{form.duration_minutes} min · ends {fmt(endAt)}</div>{form.billing_type === "membership" && selectedMember && <div className="text-xs text-gray-500 mt-1">No membership time is deducted until session start. Extra-player fee follows membership rules.</div>}{form.billing_type === "normal" && <div className="text-xs text-gray-500 mt-1">{money(hourlyRate)}/hour</div>}</div>
            <div className="text-xl font-bold text-green-400">{form.billing_type === "membership" ? "₹0 advance" : money(estimated)}</div>
          </div>
          <button disabled={saving || !tables.length || isPastSelection || (form.billing_type === "membership" && (membershipRemainingMinutes <= 0 || form.duration_minutes > membershipRemainingMinutes)) || (form.table_id && !!stationAvailability.find(x=>x.station.id===form.table_id)?.conflict) || (!form.table_id && !stationAvailability.some(x => !x.conflict))} className="w-full rounded-xl bg-green-700 hover:bg-green-600 disabled:opacity-50 py-2 font-semibold">{saving ? "Confirming…" : "Confirm booking"}</button>
        </form>

      </div>
    </main>
    <style>{`
      .ps5-shell{display:block;width:100%;max-width:100%;min-width:0;overflow-x:clip;color:#f5f5f5}
      
      .ps5-main{display:block;width:100%;max-width:100%;min-width:0;overflow-x:clip}.ps5-main *{min-width:0;max-width:100%}.booking-input{width:100%;height:38px;padding:7px 10px;border-radius:9px;background:#0b0b0b;border:1px solid #303030;color:#f5f5f5;outline:none}.booking-input:focus{border-color:#15803d}.booking-input option{background:#111;color:#fff}.booking-input.h-auto{height:auto;min-height:56px;padding:7px 10px}.date-control{width:auto;min-width:150px}
      @media (min-width: 768px) and (min-height: 700px){.ps5-shell{height:calc(100vh - 120px);overflow:hidden}.ps5-main{height:100%;overflow:hidden}}
    `}</style>
  </div>;
}


function MemberPicker({ members, selectedId, onSelect }) {
  const [search, setSearch] = useState("");
  const [open, setOpen] = useState(false);
  const selected = members.find(member => member.id === selectedId);
  const normalizedSearch = search.trim().toLowerCase();
  const filteredMembers = members.filter(member => {
    const searchable = [member.member_name, member.phone, member.id, member.plan]
      .filter(Boolean).join(" ").toLowerCase();
    return searchable.includes(normalizedSearch);
  });

  return (
    <div className="relative w-full">
      <button type="button" onClick={() => setOpen(value => !value)}
        className="booking-input flex items-center justify-between gap-2 text-left"
        aria-haspopup="listbox" aria-expanded={open}>
        <span className="truncate">{selected
          ? `${selected.member_name} · ${selected.phone || "No phone"} · ${selected.plan || "Membership"}`
          : "Search and select a member"}</span>
        <ChevronRight className={`w-4 h-4 shrink-0 text-gray-400 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>

      {open && <div className="absolute left-0 right-0 top-[calc(100%+6px)] z-[80] overflow-hidden rounded-xl border border-[#383838] bg-[#171717] shadow-2xl">
        <div className="border-b border-[#303030] p-2">
          <input autoFocus type="search" value={search}
            onChange={event => setSearch(event.target.value)}
            placeholder="Search by name, phone number or member ID..."
            className="booking-input"
            aria-label="Search memberships by name, phone number or member ID" />
          <div className="px-1 pt-2 text-[10px] text-gray-500">
            {filteredMembers.length} of {members.length} members · Search by name, phone, ID or plan
          </div>
        </div>
        <div className="max-h-64 overflow-y-auto overscroll-contain" role="listbox" aria-label="Active members">
          {filteredMembers.length ? filteredMembers.map(member => <button key={member.id}
            type="button" role="option" aria-selected={member.id === selectedId}
            onClick={() => { onSelect(member); setSearch(""); setOpen(false); }}
            className={`block w-full border-b border-[#292929] px-3 py-2.5 text-left last:border-b-0 hover:bg-[#242424] ${member.id === selectedId ? "bg-green-950/40" : ""}`}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate text-sm font-semibold text-gray-100">{member.member_name || "Unnamed member"}</span>
              <span className="shrink-0 text-[10px] text-green-400">{(Number(member.remaining_total_seconds || 0) / 3600).toFixed(1)}h left</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-gray-400">
              <span>{member.phone || "No phone number"}</span><span>{member.plan || "Membership"}</span>
            </div>
            <div className="mt-1 break-all font-mono text-[10px] text-gray-600">ID: {member.id}</div>
          </button>) : <div className="px-3 py-6 text-center text-xs text-gray-500">No matching member found</div>}
        </div>
      </div>}
    </div>
  );
}

function DatePicker({value,minDate,onChange}) {
  const [open,setOpen]=useState(false);
  const [month,setMonth]=useState(()=>{const d=new Date(`${value}T12:00:00`);return new Date(d.getFullYear(),d.getMonth(),1);});
  const selected=new Date(`${value}T12:00:00`);
  const firstDay=new Date(month.getFullYear(),month.getMonth(),1).getDay();
  const offset=(firstDay+6)%7;
  const daysInMonth=new Date(month.getFullYear(),month.getMonth()+1,0).getDate();
  const cells=Array.from({length:Math.ceil((offset+daysInMonth)/7)*7},(_,i)=>i-offset+1);
  const monthLabel=month.toLocaleDateString("en-US",{month:"long",year:"numeric"});
  const choose=(day)=>{
    const d=new Date(month.getFullYear(),month.getMonth(),day);
    const key=dateKey(d);
    if(key<minDate)return;
    onChange(key);setOpen(false);
  };
  return <div className="relative">
    <button type="button" onClick={()=>setOpen(v=>!v)} className="booking-input flex items-center justify-between text-left">
      <span>{selected.toLocaleDateString("en-IN",{day:"2-digit",month:"long",year:"numeric"})}</span><CalendarDays className="w-4 h-4 text-green-400"/>
    </button>
    {open && <div className="absolute left-0 top-[calc(100%+8px)] z-50 w-[310px] max-w-[calc(100vw-48px)] rounded-xl border border-[#333] bg-[#171717] p-4 shadow-2xl">
      <div className="flex items-center justify-between mb-4">
        <button type="button" onClick={()=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()-1,1))} className="p-2 rounded-lg hover:bg-[#292929]" aria-label="Previous month"><ChevronLeft className="w-4 h-4"/></button>
        <strong className="text-sm">{monthLabel}</strong>
        <button type="button" onClick={()=>setMonth(m=>new Date(m.getFullYear(),m.getMonth()+1,1))} className="p-2 rounded-lg hover:bg-[#292929]" aria-label="Next month"><ChevronRight className="w-4 h-4"/></button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center text-[10px] font-semibold text-gray-500 mb-2">{["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map(x=><span key={x}>{x}</span>)}</div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((day,i)=>day<1||day>daysInMonth?<span key={i}/>:<button key={i} type="button" disabled={dateKey(new Date(month.getFullYear(),month.getMonth(),day))<minDate} onClick={()=>choose(day)} className={`h-9 rounded-lg text-xs transition-colors disabled:opacity-20 disabled:cursor-not-allowed ${dateKey(new Date(month.getFullYear(),month.getMonth(),day))===value?"bg-green-700 text-white font-bold":"hover:bg-[#303030] text-gray-200"}`}>{day}</button>)}
      </div>
      <button type="button" onClick={()=>{const today=dateKey(new Date());if(today>=minDate){onChange(today);setMonth(new Date());setOpen(false);}}} className="mt-3 w-full text-xs text-green-400 hover:text-green-300">Today</button>
    </div>}
  </div>;
}


function TimePicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [hour, setHour] = useState("07");
  const [minute, setMinute] = useState("15");
  const [period, setPeriod] = useState("AM");

  const toParts = (time) => {
    const [h, m] = String(time || "19:15").split(":").map(Number);
    return {
      hour: String((h % 12) || 12).padStart(2, "0"),
      minute: String(m).padStart(2, "0"),
      period: h >= 12 ? "PM" : "AM"
    };
  };

  const display = (time) => {
    const p = toParts(time);
    return `${p.hour}:${p.minute} ${p.period}`;
  };

  const openPicker = () => {
    const p = toParts(value);
    setHour(p.hour);
    setMinute(p.minute);
    setPeriod(p.period);
    setOpen(true);
  };

  const save = () => {
    const h = Math.min(12, Math.max(1, Number(hour) || 12)) % 12
      + (period === "PM" ? 12 : 0);
    const m = Math.min(59, Math.max(0, Number(minute) || 0));

    onChange(`${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        onClick={openPicker}
        className="booking-input flex items-center justify-between text-left"
      >
        <span className="font-medium tracking-wide">{display(value)}</span>
        <Clock3 className="w-4 h-4 text-green-400" />
      </button>

      {open && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Choose booking start time"
            style={{
              width: "min(420px, calc(100vw - 32px))",
              maxWidth: "420px",
              flex: "0 1 420px",
              alignSelf: "center"
            }}
            className="rounded-xl border border-[#3a3a3a] bg-[#f4f4f4] text-[#171717] shadow-2xl p-5"
          >
            <div className="text-[11px] tracking-[.18em] font-bold text-gray-600 mb-4">
              ENTER TIME
            </div>

            <div className="grid grid-cols-[1fr_auto_1fr_auto] gap-2 items-center">
              <div>
                <input
                  aria-label="Hour"
                  inputMode="numeric"
                  value={hour}
                  onChange={(e) => setHour(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  onBlur={() => setHour(String(Math.min(12, Math.max(1, Number(hour) || 12))).padStart(2, "0"))}
                  className="w-full h-14 rounded-md border-2 border-violet-500 bg-white text-center text-3xl text-black outline-none"
                />
                <div className="text-xs text-gray-500 mt-1">Hour</div>
              </div>

              <span className="text-3xl font-semibold">:</span>

              <div>
                <input
                  aria-label="Minute"
                  inputMode="numeric"
                  value={minute}
                  onChange={(e) => setMinute(e.target.value.replace(/\D/g, "").slice(0, 2))}
                  onBlur={() => setMinute(String(Math.min(59, Math.max(0, Number(minute) || 0))).padStart(2, "0"))}
                  className="w-full h-14 rounded-md bg-[#dedede] text-center text-3xl text-black outline-none focus:ring-2 focus:ring-violet-500"
                />
                <div className="text-xs text-gray-500 mt-1">Minute</div>
              </div>

              <div className="flex flex-col rounded-md border border-gray-400 overflow-hidden text-xs font-semibold">
                {["AM", "PM"].map((x) => (
                  <button
                    key={x}
                    type="button"
                    onClick={() => setPeriod(x)}
                    className={`px-3 h-7 ${
                      period === x
                        ? "bg-violet-100 text-violet-700"
                        : "bg-white text-gray-600"
                    }`}
                  >
                    {x}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between mt-5">
              <Clock3 className="w-4 h-4 text-gray-500" />
              <div className="flex gap-5 text-sm font-bold">
                <button type="button" onClick={() => setOpen(false)} className="text-violet-700">
                  CANCEL
                </button>
                <button type="button" onClick={save} className="text-violet-700">
                  OK
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Field({label,children}) { return <label className="block"><span className="block text-[11px] uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{label}</span>{children}</label>; }
