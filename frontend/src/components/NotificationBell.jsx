import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bell, Play, Square, UtensilsCrossed, IndianRupee, CheckCheck } from "lucide-react";
import { toast } from "sonner";
import api from "@/lib/api";

const KIND_META = {
  session_started: { icon: Play, color: "text-green-400", ring: "bg-green-500/10" },
  session_ended: { icon: Square, color: "text-blue-400", ring: "bg-blue-500/10" },
  snack_added: { icon: UtensilsCrossed, color: "text-amber-400", ring: "bg-amber-500/10" },
  big_bill: { icon: IndianRupee, color: "text-fuchsia-400", ring: "bg-fuchsia-500/10" },
};

function timeAgo(iso) {
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NotificationBell() {
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const seenIdsRef = useRef(new Set());
  const firstLoadRef = useRef(true);
  const wrapRef = useRef(null);
  const location = useLocation();

  useEffect(() => { setOpen(false); }, [location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  useEffect(() => {
    const load = async () => {
      try {
        const { data } = await api.get("/notifications");
        const newList = data.notifications || [];
        if (!firstLoadRef.current) {
          for (const n of newList) {
            if (!seenIdsRef.current.has(n.id) && !n.read) {
              toast.message(n.title, { description: n.body });
            }
          }
        }
        firstLoadRef.current = false;
        seenIdsRef.current = new Set(newList.map((n) => n.id));
        setItems(newList);
        setUnread(data.unread || 0);
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 8000);
    return () => clearInterval(t);
  }, []);

  const markAllRead = async () => {
    try {
      await api.post("/notifications/read-all");
      setUnread(0);
      const { data } = await api.get("/notifications");
      setItems(data.notifications || []);
    } catch { /* ignore */ }
  };

  return (
    <div className="relative" data-testid="notification-bell-wrap" ref={wrapRef}>
      <button
        data-testid="notification-bell"
        onClick={() => { setOpen((v) => !v); if (unread > 0) markAllRead(); }}
        className="relative w-11 h-11 rounded-xl bg-[#141414] border border-[#262626] hover:border-green-700/40 flex items-center justify-center text-gray-300 hover:text-white transition-colors"
      >
        <Bell className="w-5 h-5" />
        {unread > 0 && (
          <span data-testid="notification-badge" className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1.5 rounded-full bg-green-600 text-white text-[10px] font-bold flex items-center justify-center shadow-[0_0_10px_rgba(21,128,61,0.6)] pulse-dot">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-[360px] max-w-[92vw] z-50 bg-[#0f0f0f] border border-[#262626] rounded-2xl shadow-2xl overflow-hidden fade-up" data-testid="notification-tray">
          <div className="flex items-center justify-between p-4 border-b border-[#262626]">
            <div>
              <div className="font-bold">Notifications</div>
              <div className="text-xs text-gray-500">Live · updates every 8s</div>
            </div>
            <button onClick={markAllRead} data-testid="mark-all-read" className="text-xs text-green-500 hover:text-green-400 font-semibold flex items-center gap-1"><CheckCheck className="w-3.5 h-3.5" /> Mark all read</button>
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {items.length === 0 && (
              <div className="p-8 text-center text-sm text-gray-500">No activity yet. Start a session to see notifications.</div>
            )}
            {items.map((n) => {
              const meta = KIND_META[n.kind] || KIND_META.session_started;
              const Icon = meta.icon;
              return (
                <div key={n.id} className={`p-4 border-b border-[#1c1c1c] flex gap-3 ${!n.read ? "bg-[#141414]" : ""}`} data-testid={`notif-${n.kind}`}>
                  <div className={`w-9 h-9 rounded-lg ${meta.ring} border border-[#262626] flex items-center justify-center shrink-0`}>
                    <Icon className={`w-4 h-4 ${meta.color}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold truncate">{n.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{n.body}</div>
                    <div className="text-[10px] text-gray-600 mt-1 uppercase tracking-wider font-bold">{timeAgo(n.created_at)}</div>
                  </div>
                  {!n.read && <span className="w-2 h-2 rounded-full bg-green-500 mt-2 shrink-0" />}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
