import { Outlet, NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import {
  LayoutDashboard,
  Grid3x3,
  Timer,
  UtensilsCrossed,
  ClipboardList,
  BarChart3,
  Users,
  LogOut,
  Menu,
  X,
  Wallet,
  Settings,
} from "lucide-react";
import { useState, useEffect, useRef } from "react";
import api from "@/lib/api";
import { toast } from "sonner";
import PageSkeleton from "@/components/states/PageSkeleton";
import { Suspense } from "react";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", perm: null },
  { to: "/tables", icon: Grid3x3, label: "Tables", perm: null },
  { to: "/memberships", icon: Users, label: "Membership", perm: "manage_sessions" },
  { to: "/sessions", icon: Timer, label: "Sessions", perm: "manage_sessions" },
  { to: "/snacks", icon: UtensilsCrossed, label: "Snacks", perm: null },
  { to: "/food-orders", icon: ClipboardList, label: "Food Orders", perm: null },
  { to: "/expenses", icon: Wallet, label: "Expenses", perm: "view_expenses" },
  { to: "/reports", icon: BarChart3, label: "Reports", perm: "view_reports" },
  { to: "/staff", icon: Users, label: "Staff", perm: "manage_users" },
  { to: "/settings", icon: Settings, label: "Settings", perm: "manage_settings" },
];

export default function AppLayout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [club, setClub] = useState("Sadda Adda Snooker");

  const audioContextRef = useRef(null);

  useEffect(() => {
    const unlockAudio = async () => {
      try {
        const AudioContextClass = window.AudioContext || window.webkitAudioContext;
        if (!AudioContextClass) return;
        if (!audioContextRef.current || audioContextRef.current.state === "closed") {
          audioContextRef.current = new AudioContextClass();
        }
        if (audioContextRef.current.state !== "running") await audioContextRef.current.resume();
      } catch (error) {
        console.warn("Could not unlock timer alert audio", error);
      }
    };
    window.addEventListener("cueops-unlock-timer-audio", unlockAudio);
    return () => window.removeEventListener("cueops-unlock-timer-audio", unlockAudio);
  }, []);

  const playTimerAlertSound = () => {
    if (localStorage.getItem("cueops_timer_alerts_enabled") === "false") return;
    if (localStorage.getItem("cueops_timer_alert_sound") === "false") return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      if (!audioContextRef.current || audioContextRef.current.state === "closed") {
        audioContextRef.current = new AudioContextClass();
      }
      const ctx = audioContextRef.current;
      if (ctx.state !== "running") {
        ctx.resume().catch(() => {});
        return;
      }
      const startAt = ctx.currentTime;
      [0, 0.22, 0.44].forEach((offset) => {
        const oscillator = ctx.createOscillator();
        const gain = ctx.createGain();
        oscillator.type = "sine";
        oscillator.frequency.value = 880;
        gain.gain.setValueAtTime(0.0001, startAt + offset);
        gain.gain.exponentialRampToValueAtTime(0.18, startAt + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, startAt + offset + 0.17);
        oscillator.connect(gain);
        gain.connect(ctx.destination);
        oscillator.start(startAt + offset);
        oscillator.stop(startAt + offset + 0.18);
      });
    } catch (error) {
      console.warn("Timer alert sound could not play", error);
    }
  };

  // Background listener only; no alert button is rendered in the global header.
  useEffect(() => {
    if (!user?.id || !can("manage_sessions")) return undefined;
    let alive = true;
    let running = false;
    const deliver = async () => {
      if (!alive || running) return;
      if (localStorage.getItem("cueops_timer_alerts_enabled") === "false") return;
      running = true;
      try {
        const { data } = await api.get("/timer-alerts/pending");
        for (const candidate of data || []) {
          if (!alive || localStorage.getItem("cueops_timer_alerts_enabled") === "false") break;
          const claim = await api.post(`/timer-alerts/${candidate.id}/claim`);
          if (!claim.data?.claimed || !claim.data?.alert) continue;
          if (!alive || localStorage.getItem("cueops_timer_alerts_enabled") === "false") break;
          const alert = claim.data.alert;
          const title = `Timer Alert – ${alert.remaining_display} remaining`;
          const body = [
            `Game: ${alert.game_type}`,
            `Table: ${alert.table_number}`,
            `Frame: ${alert.frame_number}`,
            `Remaining: ${alert.remaining_display}`,
            "",
            "Please inform the customer.",
          ].join("\n");
          toast.warning(title, { description: body, duration: 15000 });
          if (
            localStorage.getItem("cueops_timer_alert_desktop") === "true" &&
            "Notification" in window && Notification.permission === "granted"
          ) {
            try {
              const notification = new Notification(title, {
                body,
                tag: `cueops-timer-${alert.timer_block_id}`,
                renotify: false,
                requireInteraction: true,
              });
              notification.onclick = () => { window.focus(); notification.close(); };
            } catch (error) {
              console.warn("Desktop timer notification could not be shown", error);
            }
          }
          playTimerAlertSound();
        }
      } catch (error) {
        // Keep the app shell running if alert polling temporarily fails.
      } finally {
        running = false;
      }
    };
    deliver();
    const interval = window.setInterval(deliver, 3000);
    return () => { alive = false; window.clearInterval(interval); };
  }, [user?.id, can]);

  useEffect(() => {
    api.get("/club").then((r) => setClub(r.data.name)).catch(() => {});
  }, []);

  const items = navItems.filter((i) => !i.perm || can(i.perm));
  const handleLogout = () => { logout(); navigate("/login"); };
  const closeMenu = () => setOpen(false);

  return (
    <div className="min-h-screen flex bg-[#0A0A0A] text-white">
      <aside
        id="mobile-navigation"
        data-testid="sidebar"
        aria-label="Main navigation"
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-56 bg-[#0d0d0d] border-r border-[#1c1c1c] flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <Link to="/dashboard" onClick={closeMenu} aria-label="Cue Ops - Go to dashboard" className="p-4 flex items-center gap-3 border-b border-[#1c1c1c] cursor-pointer hover:bg-[#111111] transition-colors">
          <div className="relative w-9 h-9 rounded-full bg-white flex items-center justify-center shadow-[0_0_18px_rgba(21,128,61,0.4)] shrink-0">
            <img src="logo.png" alt="Cue Ops" className="w-7 h-7 object-contain" />
          </div>
          <div className="min-w-0"><div className="text-[25px] uppercase tracking-[0.05em] text-white font-bold">Cue Ops</div></div>
        </Link>

        <nav aria-label="Primary navigation" className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map(({ to, icon: Icon, label }) => (
            <NavLink key={to} to={to} data-testid={`nav-${label.toLowerCase()}`} onClick={closeMenu}
              className={({ isActive }) => `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${isActive ? "bg-green-700/15 text-green-400 border border-green-700/30" : "text-gray-400 hover:bg-[#1c1c1c] hover:text-white border border-transparent"}`}>
              <Icon aria-hidden="true" className="w-5 h-5 shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-[#1c1c1c]">
          <div className="px-3 py-2.5 mb-2 rounded-lg bg-[#141414] border border-[#262626]" aria-label={`Signed in as ${user?.name || "user"}`}>
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Signed in</div>
            <div className="text-sm font-semibold text-white truncate">{user?.name}</div>
            <div className="text-xs text-green-500 capitalize font-medium">{user?.role}</div>
          </div>
          <button type="button" data-testid="logout-btn" aria-label="Sign out" onClick={handleLogout} className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#1c1c1c] hover:bg-red-900/30 hover:text-red-300 text-gray-300 text-sm font-medium transition-all border border-[#262626] hover:border-red-900/50">
            <LogOut aria-hidden="true" className="w-4 h-4" /><span>Sign out</span>
          </button>
        </div>
      </aside>

      {open && <button type="button" aria-label="Close navigation menu" data-testid="mobile-menu-overlay" className="fixed inset-0 bg-black/60 z-30 lg:hidden cursor-default" onClick={closeMenu} />}

      <div className="flex-1 flex flex-col min-w-0">
        <header className="relative sticky top-0 z-20 bg-[#0A0A0A]/90 backdrop-blur border-b border-[#1c1c1c] px-4 lg:px-8 py-3 h-16 flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button type="button" data-testid="mobile-menu" aria-label={open ? "Close navigation menu" : "Open navigation menu"} aria-expanded={open} aria-controls="mobile-navigation" onClick={() => setOpen(!open)} className="lg:hidden p-2 rounded-lg bg-[#141414] border border-[#262626] hover:bg-[#1c1c1c] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0A0A0A]">
              {open ? <X aria-hidden="true" className="w-5 h-5" /> : <Menu aria-hidden="true" className="w-5 h-5" />}
            </button>
          </div>
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"><div className="text-2xl font-bold tracking-tight whitespace-nowrap" aria-label={`Club: ${club}`}>{club}</div></div>
          <div />
        </header>

        <main id="main-content" className="flex-1 p-4 sm:p-6 lg:p-10 max-w-[1600px] w-full mx-auto">
          <Suspense fallback={<PageSkeleton />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}
