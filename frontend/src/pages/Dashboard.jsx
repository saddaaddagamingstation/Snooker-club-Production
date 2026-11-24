import { useEffect, useState } from "react";
import api, { inr } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import DashboardSkeleton from "@/components/states/DashboardSkeleton";
import {
  IndianRupee,
  Activity,
  Layers,
  CircleDot,
  UtensilsCrossed,
  ClipboardCheck,
  TrendingUp,
  Coffee,
  Trophy,
  Play,
} from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";
import { Link } from "react-router-dom";
import AddFoodModal from "@/components/AddFoodModal";
import PageState from "@/components/states/PageState";

const COLORS = ["#15803d", "#f59e0b", "#3b82f6", "#a855f7", "#ef4444"];

function StatCard({ icon: Icon, label, value, hint, accent = "green" }) {
  const accentMap = {
    green:
      "from-green-700/20 to-transparent text-green-400 border-green-700/30",
    amber:
      "from-amber-700/20 to-transparent text-amber-400 border-amber-700/30",
    blue: "from-blue-700/20 to-transparent text-blue-400 border-blue-700/30",
    red: "from-red-700/20 to-transparent text-red-400 border-red-700/30",
  };
  const iconColor = accentMap[accent]
    .split(" ")
    .find((c) => c.startsWith("text-"));
  return (
    <div
      data-testid={`stat-${label.toLowerCase().replace(/\s+/g, "-")}`}
      className="relative overflow-hidden bg-[#141414] border border-[#262626] rounded-2xl px-7 py-6 hover:border-[#333] transition-colors fade-up flex flex-col h-full min-h-[168px] justify-between"
    >
      <div
        className={`absolute -top-12 -right-12 w-40 h-40 rounded-full bg-gradient-to-br ${accentMap[accent]} opacity-30 blur-2xl pointer-events-none`}
      />
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-[#1c1c1c] border border-[#262626] flex items-center justify-center shrink-0">
          <Icon className={`w-5 h-5 ${iconColor}`} />
        </div>
        <span className="text-[11px] uppercase tracking-[0.2em] text-gray-400 font-bold leading-tight">
          {label}
        </span>
      </div>
      <div>
        <div className="text-[38px] xl:text-[40px] font-bold tracking-tight font-mono leading-none tabular-nums whitespace-nowrap">
          {value}
        </div>
        {hint && (
          <div className="mt-2 text-sm text-gray-500 leading-tight truncate">
            {hint}
          </div>
        )}
      </div>
    </div>
  );
}

function RevenueHeroCard({ total }) {
  return (
    <div
      data-testid="stat-todays-revenue"
      className="relative overflow-hidden bg-gradient-to-br from-[#0f1f14] via-[#141414] to-[#141414] border border-green-700/30 rounded-2xl p-7 lg:p-8 hover:border-green-700/50 transition-colors fade-up flex flex-col justify-between h-full min-h-[360px]"
    >
      <div className="absolute -top-24 -right-20 w-96 h-96 rounded-full bg-gradient-to-br from-green-600/25 to-transparent opacity-40 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-20 w-80 h-80 rounded-full bg-gradient-to-tr from-green-700/15 to-transparent opacity-30 blur-3xl pointer-events-none" />
      <div className="flex items-center gap-3 relative">
        <div className="w-12 h-12 rounded-xl bg-green-700/15 border border-green-700/40 flex items-center justify-center shrink-0">
          <IndianRupee className="w-6 h-6 text-green-400" />
        </div>
        <div>
          <div className="text-sm uppercase tracking-[0.22em] text-green-400 font-bold">
            Today's Revenue
          </div>
          <div className="text-xs text-gray-500 uppercase tracking-wider mt-0.5">
            Total Revenue Today
          </div>
        </div>
      </div>
      <div className="relative">
        <div className="text-[52px] xl:text-[64px] font-bold tracking-tight font-mono leading-none text-green-400 tabular-nums whitespace-nowrap">
          {inr(total)}
        </div>
        <div className="mt-3 text-xs text-gray-500 uppercase tracking-[0.18em] font-bold">
          Combined game + snack collection
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { can } = useAuth();

  const [stats, setStats] = useState(null);
  const [charts, setCharts] = useState(null);
  const [recent, setRecent] = useState({ sessions: [], bills: [] });
  const [showAddFood, setShowAddFood] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const showRevenue = can("view_revenue");
  
  const load = async () => {
    try {
      const [s, c, r] = await Promise.all([
        api.get("/dashboard/stats"),
        api.get("/dashboard/charts"),
        api.get("/dashboard/recent"),
      ]);

      setStats(s.data);
      setCharts(c.data);
      setRecent(r.data);
      setLoadError(false);

      return true;
    } catch (error) {
      console.error("Dashboard load failed:", error);

      // Only show a full-page error if initial loading failed.
      if (stats === null) {
        setLoadError(true);
      }

      return false;
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    load();

    const interval = setInterval(load, 30000);

    return () => clearInterval(interval);
  }, []);

  
  if (isLoading) {
    return <DashboardSkeleton />;
  }

  if (loadError && stats === null) {
    return (
      <PageState
        type="error"
        title="Dashboard unavailable"
        description="We couldn't load your dashboard. Check your connection and try again."
        onRetry={load}
        actionLabel="Retry"
      />
    );
  }

  return (
    <div className="space-y-8" data-testid="dashboard-page">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight">
            Today's Performance
          </h1>
          <p className="text-gray-400 mt-2">
            Live snapshot of your club. Auto-refreshes every 30s.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowAddFood(true)}
            className="px-5 h-12 rounded-xl border border-[#333] bg-[#141414] hover:bg-[#1c1c1c] text-white font-semibold flex items-center gap-2 transition-all"
            data-testid="add-food-btn"
          >
            <UtensilsCrossed className="w-4 h-4" />
            Add Food
          </button>

          <Link
            to="/tables"
            className="px-5 h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2 transition-all"
            data-testid="quick-start-table-btn"
          >
            <Play className="w-4 h-4" />
            Start Table
          </Link>

          <Link
            to="/sessions"
            className="px-5 h-12 rounded-xl border border-[#333] bg-[#141414] hover:bg-[#1c1c1c] text-white font-semibold flex items-center gap-2 transition-all"
            data-testid="view-sessions-btn"
          >
            <Activity className="w-4 h-4" />
            View Sessions
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr] gap-6 auto-rows-fr">
        {showRevenue && (
          <div className="sm:col-span-2 lg:col-span-1 lg:row-span-2">
            <RevenueHeroCard total={stats?.today_revenue || 0} />
          </div>
        )}
        <StatCard
          icon={Activity}
          label="Active Sessions"
          value={stats?.active_sessions ?? "—"}
          accent="amber"
          hint="Currently running"
        />
        <StatCard
          icon={Layers}
          label="Available Tables"
          value={stats?.available_tables ?? "—"}
          accent="green"
          hint={`of ${stats?.total_tables ?? 0} tables`}
        />
        {showRevenue && (
          <StatCard
            icon={Trophy}
            label="Game Revenue"
            value={inr(
              (stats?.today_revenue || 0) - (stats?.snacks_revenue || 0),
            )}
            accent="green"
            hint="Today's Game Revenue"
          />
        )}
        {showRevenue && (
          <StatCard
            icon={Coffee}
            label="Snack Revenue"
            value={inr(stats?.snacks_revenue)}
            accent="amber"
            hint="Today's Snack Revenue"
          />
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {showRevenue && (
          <div className="lg:col-span-2 bg-[#141414] border border-[#262626] rounded-2xl p-6">
            <div className="flex items-center justify-between mb-6">
              <div>
                <h3 className="text-lg font-bold">Daily Revenue · 7-day</h3>
                <p className="text-sm text-gray-500">Revenue trajectory in ₹</p>
              </div>
              <TrendingUp className="w-5 h-5 text-green-500" />
            </div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={charts?.daily || []}>
                  <defs>
                    <linearGradient id="rev" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22c55e" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="#22c55e" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
                  <XAxis dataKey="date" stroke="#737373" fontSize={12} />
                  <YAxis stroke="#737373" fontSize={12} />
                  <Tooltip
                    contentStyle={{
                      background: "#0a0a0a",
                      border: "1px solid #262626",
                      borderRadius: 12,
                    }}
                    labelStyle={{ color: "#fff" }}
                  />
                  <Area
                    type="monotone"
                    dataKey="revenue"
                    stroke="#22c55e"
                    fill="url(#rev)"
                    strokeWidth={2}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        <div
          className={`bg-[#141414] border border-[#262626] rounded-2xl p-6 ${showRevenue ? "" : "lg:col-span-3"}`}
        >
          <h3 className="text-lg font-bold mb-2">Top Snacks</h3>
          <p className="text-sm text-gray-500 mb-4">Best sellers all-time</p>
          <div className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={charts?.snack_sales || []}
                  dataKey="qty"
                  nameKey="name"
                  outerRadius={75}
                  innerRadius={45}
                  paddingAngle={3}
                >
                  {(charts?.snack_sales || []).map((_, i) => (
                    <Cell key={i} fill={COLORS[i % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "#0a0a0a",
                    border: "1px solid #262626",
                    borderRadius: 12,
                  }}
                />
                <Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6">
        <h3 className="text-lg font-bold mb-2">Peak Hours</h3>
        <p className="text-sm text-gray-500 mb-4">Sessions started by hour</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={charts?.peak_hours || []}>
              <CartesianGrid strokeDasharray="3 3" stroke="#262626" />
              <XAxis dataKey="hour" stroke="#737373" fontSize={11} />
              <YAxis stroke="#737373" fontSize={11} />
              <Tooltip
                contentStyle={{
                  background: "#0a0a0a",
                  border: "1px solid #262626",
                  borderRadius: 12,
                }}
              />
              <Bar dataKey="sessions" fill="#15803d" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6">
          <h3 className="text-lg font-bold mb-4">Recent Sessions</h3>
          <div className="space-y-2">
            {recent.sessions.length === 0 && (
              <div className="text-gray-500 text-sm">No sessions yet.</div>
            )}
            {recent.sessions.map((s) => (
              <div
                key={s.id}
                className="flex items-center justify-between p-3 rounded-lg bg-[#0f0f0f] border border-[#1c1c1c]"
              >
                <div>
                  <div className="font-semibold text-sm">
                    Table {s.table_number}{" "}
                    {s.customer_name && (
                      <span className="text-gray-500">· {s.customer_name}</span>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">
                    {new Date(s.start_time).toLocaleString()}
                  </div>
                </div>
                <span
                  className={`text-xs px-2 py-1 rounded-full uppercase font-bold ${s.status === "active" ? "bg-amber-500/10 text-amber-400" : "bg-green-500/10 text-green-400"}`}
                >
                  {s.status}
                </span>
              </div>
            ))}
          </div>
        </div>
        <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6">
          <h3 className="text-lg font-bold mb-4">Recent Bills</h3>
          <div className="space-y-2">
            {!showRevenue && (
              <div className="text-gray-500 text-sm">
                Financial info hidden. Ask an admin for the "View Revenue"
                permission.
              </div>
            )}
            {showRevenue && recent.bills.length === 0 && (
              <div className="text-gray-500 text-sm">No bills yet.</div>
            )}
            {showRevenue &&
              recent.bills.map((s) => (
                <Link
                  to={`/bill/${s.id}`}
                  key={s.id}
                  className="flex items-center justify-between p-3 rounded-lg bg-[#0f0f0f] border border-[#1c1c1c] hover:border-green-700/40 transition-colors"
                >
                  <div>
                    <div className="font-semibold text-sm font-mono">
                      {s.invoice_no}
                    </div>
                    <div className="text-xs text-gray-500">
                      Table {s.table_number} · {s.duration_minutes} min
                    </div>
                  </div>
                  <div className="font-bold font-mono text-green-400">
                    {inr(s.grand_total)}
                  </div>
                </Link>
              ))}
          </div>
        </div>
      </div>

      <AddFoodModal open={showAddFood} onClose={() => setShowAddFood(false)} />
    </div>
  );
}
