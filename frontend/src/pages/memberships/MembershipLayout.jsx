
import { NavLink, Outlet, Link, useNavigate } from "react-router-dom";
import {
  LayoutDashboard,
  Package,
  Users,
  Gamepad2,
  ArrowLeft,
  LogOut
} from "lucide-react";
import { useAuth } from "@/lib/auth";

const links = [
  { to: "/memberships", end: true, label: "Overview", icon: LayoutDashboard },
  { to: "/memberships/packages", label: "Packages", icon: Package },
  { to: "/memberships/members", label: "Members", icon: Users },
  { to: "/memberships/game-records", label: "Game Records", icon: Gamepad2 },
];

export default function MembershipLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  return (
    <div className="min-h-screen w-full flex bg-[#0A0A0A] text-white overflow-x-hidden">

      {/* Sidebar */}
      <aside className="w-56 shrink-0 bg-[#0d0d0d] border-r border-[#1c1c1c] min-h-screen flex flex-col">
        <div className="p-4 border-b border-[#1c1c1c]">
          <div className="text-xl font-bold">CUE OPS</div>
          <div className="text-xs text-green-500 uppercase tracking-[.2em] mt-1">
            Memberships
          </div>
        </div>

        <nav className="flex-1 px-3 py-4 space-y-1">
          {links.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${
                  isActive
                    ? "bg-green-700/15 text-green-400 border border-green-700/30"
                    : "text-gray-400 hover:bg-[#1c1c1c] hover:text-white border border-transparent"
                }`
              }
            >
              <Icon className="w-5 h-5 shrink-0" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="p-3 border-t border-[#1c1c1c] space-y-2">
          <Link
            to="/dashboard"
            className="flex items-center gap-2 text-sm text-gray-300 hover:text-white px-3 py-2.5 rounded-lg bg-[#1c1c1c]"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Cue Ops
          </Link>

          <div className="text-xs text-gray-500 px-3">
            Signed in as {user?.name || "User"}
          </div>

          <button
            onClick={() => {
              logout();
              navigate("/login");
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-red-300"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 min-w-0 w-0 flex flex-col">
        <header className="h-16 shrink-0 border-b border-[#1c1c1c] flex items-center px-5 sm:px-8">
          <h1 className="font-bold text-xl">Membership Management</h1>
        </header>

        <main className="w-full min-w-0 flex-1 p-5 sm:p-8">
          <div className="w-full max-w-[1600px] mx-auto min-w-0">
            <Outlet />
          </div>
        </main>
      </div>
    </div>
  );
}
