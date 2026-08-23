import { Outlet, NavLink, Link, useNavigate } from "react-router-dom";
import { useAuth } from "@/lib/auth";
import { LayoutDashboard, Grid3x3, Timer, UtensilsCrossed, ClipboardList, BarChart3, Users, LogOut, Circle, Menu, X, Wallet} from "lucide-react";
import { useState, useEffect } from "react";
import api from "@/lib/api";
import NotificationBell from "@/components/NotificationBell";

const navItems = [
  { to: "/dashboard", icon: LayoutDashboard, label: "Dashboard", perm: null },
  { to: "/tables", icon: Grid3x3, label: "Tables", perm: null },
  { to: "/sessions", icon: Timer, label: "Sessions", perm: "manage_sessions" },
  { to: "/snacks", icon: UtensilsCrossed, label: "Snacks", perm: null },
  { to: "/food-orders", icon: ClipboardList, label: "Food Orders", perm: null },
  { to: "/expenses", icon: Wallet, label: "Expenses", perm: "view_expenses" },
  { to: "/reports", icon: BarChart3, label: "Reports", perm: "view_reports" },
  { to: "/staff", icon: Users, label: "Staff", perm: "manage_users" },
];

export default function AppLayout() {
  const { user, logout, can } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [club, setClub] = useState("Supreme Snooker");

  useEffect(() => {
    api.get("/club").then((r) => setClub(r.data.name)).catch(() => {});
  }, []);

  const items = navItems.filter((i) => !i.perm || can(i.perm));

  return (
    <div className="min-h-screen flex bg-[#0A0A0A] text-white">
      {/* Sidebar */}
      <aside
        data-testid="sidebar"
        className={`fixed lg:sticky top-0 left-0 z-40 h-screen w-56 bg-[#0d0d0d] border-r border-[#1c1c1c] flex flex-col transition-transform ${open ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}
      >
        <Link
          to="/dashboard"
          className="p-4 flex items-center gap-3 border-b border-[#1c1c1c] cursor-pointer hover:bg-[#111111] transition-colors"
        >
          <div className="relative w-9 h-9 rounded-full bg-gradient-to-br from-green-700 to-green-900 flex items-center justify-center shadow-[0_0_18px_rgba(21,128,61,0.4)] shrink-0">
            <Circle className="w-4 h-4 text-white fill-white/20" strokeWidth={2.5} />
          </div>

          <div className="min-w-0">
            <div className="text-[25px] uppercase tracking-[0.05em] text-white-400 font-bold">
              Cue Ops
            </div>
          </div>
        </Link>
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          {items.map(({ to, icon: Icon, label }) => (
            <NavLink
              key={to}
              to={to}
              data-testid={`nav-${label.toLowerCase()}`}
              onClick={() => setOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  isActive
                    ? "bg-green-700/15 text-green-400 border border-green-700/30"
                    : "text-gray-400 hover:bg-[#1c1c1c] hover:text-white border border-transparent"
                }`
              }
            >
              <Icon className="w-5 h-5 shrink-0" />
              {label}
            </NavLink>
          ))}
        </nav>
        <div className="p-3 border-t border-[#1c1c1c]">
          <div className="px-3 py-2.5 mb-2 rounded-lg bg-[#141414] border border-[#262626]">
            <div className="text-[10px] text-gray-500 uppercase tracking-wider font-bold">Signed in</div>
            <div className="text-sm font-semibold text-white truncate">{user?.name}</div>
            <div className="text-xs text-green-500 capitalize font-medium">{user?.role}</div>
          </div>
          <button
            data-testid="logout-btn"
            onClick={() => { logout(); navigate("/login"); }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg bg-[#1c1c1c] hover:bg-red-900/30 hover:text-red-300 text-gray-300 text-sm font-medium transition-all border border-[#262626] hover:border-red-900/50"
          >
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </aside>

      {/* Mobile overlay */}
      {open && <div className="fixed inset-0 bg-black/60 z-30 lg:hidden" onClick={() => setOpen(false)} />}

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="relative sticky top-0 z-20 bg-[#0A0A0A]/90 backdrop-blur border-b border-[#1c1c1c] px-4 lg:px-8 py-3 h-16 flex items-center justify-between gap-3">

  <div className="flex items-center gap-3 min-w-0">
    <button
      data-testid="mobile-menu"
      onClick={() => setOpen(!open)}
      className="lg:hidden p-2 rounded-lg bg-[#141414] border border-[#262626]"
    >
      {open ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
    </button>
  </div>

  {/* Centered club name */}
  <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
    <div className="text-2xl font-bold tracking-tight whitespace-nowrap">
      {club}
    </div>
  </div>

  <div className="flex items-center gap-2">
    <NotificationBell />
  </div>

</header>
        <main className="flex-1 p-4 sm:p-6 lg:p-10 max-w-[1600px] w-full mx-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
