import { useEffect, useState } from "react";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Calendar, Download, FileText, TrendingUp, TrendingDown, Wallet, IndianRupee, PieChart as PieIcon } from "lucide-react";
import { ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, PieChart, Pie, Cell, Legend, LineChart, Line } from "recharts";
import { toast } from "sonner";

const PERIODS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "weekly", label: "This Week" },
  { key: "monthly", label: "This Month" },
];
const COLORS = ["#15803d", "#f59e0b", "#3b82f6", "#a855f7", "#ef4444", "#10b981", "#eab308", "#0ea5e9"];

export default function Reports() {
  const { can } = useAuth();
  const tabs = [
    { key: "overview", label: "Overview", perm: "view_reports" },
    { key: "revenue", label: "Revenue", perm: "view_revenue" },
    { key: "expenses", label: "Expenses", perm: "view_expenses" },
    { key: "pnl", label: "Profit & Loss", perm: "view_profit" },
    { key: "payments", label: "Payments", perm: "view_revenue" },
    { key: "sessions", label: "Sessions", perm: "view_reports" },
    { key: "snacks", label: "Snacks", perm: "view_reports" },
  ].filter((t) => can(t.perm));

  const [tab, setTab] = useState(tabs[0]?.key || "overview");
  const [period, setPeriod] = useState("monthly");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");

  const params = () => {
    const p = { period };
    if (start) p.start = new Date(start).toISOString();
    if (end) p.end = new Date(end).toISOString();
    return p;
  };

  return (
    <div className="space-y-6" data-testid="reports-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">Analytics</div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Reports</h1>
          <p className="text-gray-400 mt-2 text-sm">Financial and operational analytics — tap a tab to switch view.</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-[#262626]">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`rep-tab-${t.key}`}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg -mb-px border-b-2 transition-all ${tab === t.key ? "border-green-600 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>{t.label}</button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex gap-2 flex-wrap">
          {PERIODS.map((p) => (
            <button key={p.key} onClick={() => { setPeriod(p.key); setStart(""); setEnd(""); }} data-testid={`period-${p.key}`}
              className={`h-11 px-4 rounded-xl border text-sm font-semibold ${period === p.key && !start ? "bg-green-700 border-green-700 text-white" : "bg-[#141414] border-[#262626] text-gray-400 hover:text-white"}`}>{p.label}</button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-500" />
          <input type="date" value={start} onChange={(e) => setStart(e.target.value)} data-testid="date-start" className="h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white text-sm" />
          <span className="text-gray-500">→</span>
          <input type="date" value={end} onChange={(e) => setEnd(e.target.value)} data-testid="date-end" className="h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white text-sm" />
        </div>
      </div>

      {tab === "overview" && <OverviewTab params={params()} />}
      {tab === "revenue" && <RevenueTab params={params()} />}
      {tab === "expenses" && <ExpensesTab params={params()} />}
      {tab === "pnl" && <PnlTab params={params()} />}
      {tab === "payments" && <PaymentsTab params={params()} />}
      {tab === "sessions" && <SessionsTab params={params()} />}
      {tab === "snacks" && <SnacksTab params={params()} />}
    </div>
  );
}

/* --- Tabs --- */
function useReport(url, params) {
  const [data, setData] = useState(null);
  useEffect(() => {
    api.get(url, { params }).then((r) => setData(r.data)).catch((e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)));
  }, [url, JSON.stringify(params)]);
  return data;
}

function KpiCard({ icon: Icon, label, value, accent = "green", sub }) {
  const cls = { green: "text-green-400", red: "text-red-400", blue: "text-blue-400", amber: "text-amber-400", fuchsia: "text-fuchsia-400" }[accent];
  return (
    <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5">
      <div className="flex items-center justify-between"><span className="text-xs uppercase tracking-wider text-gray-500 font-bold">{label}</span>{Icon && <Icon className={`w-4 h-4 ${cls}`} />}</div>
      <div className={`text-2xl sm:text-3xl font-bold font-mono mt-2 ${cls}`}>{value}</div>
      {sub && <div className="text-xs text-gray-500 mt-1">{sub}</div>}
    </div>
  );
}
function Panel({ title, children }) { return <div className="bg-[#141414] border border-[#262626] rounded-2xl p-6"><h3 className="text-lg font-bold mb-4">{title}</h3>{children}</div>; }

function exportCSV(rows, filename) {
  const csv = rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(",")).join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  const a = document.createElement("a"); a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

/* Overview */
function OverviewTab({ params }) {
  const d = useReport("/reports", params);
  const { can } = useAuth();
  if (!d) return <div className="text-gray-400">Loading…</div>;
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {can("view_revenue") && <KpiCard icon={IndianRupee} label="Revenue" value={inr(d.total_revenue)} />}
        <KpiCard label="Sessions" value={d.total_sessions} accent="blue" />
        {can("view_revenue") && <KpiCard label="Snack Revenue" value={inr(d.snack_revenue)} accent="amber" />}
        <KpiCard label="Avg Duration" value={`${d.avg_duration_min}m`} accent="blue" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {can("view_revenue") && <Panel title="Best Tables"><div className="h-64"><ResponsiveContainer><BarChart data={d.best_tables}><CartesianGrid stroke="#262626" /><XAxis dataKey="table" stroke="#737373" fontSize={11} /><YAxis stroke="#737373" fontSize={11} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Bar dataKey="revenue" fill="#15803d" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>}
        <Panel title="Best-Selling Snacks"><div className="h-64"><ResponsiveContainer><BarChart data={d.best_snacks} layout="vertical"><CartesianGrid stroke="#262626" /><XAxis type="number" stroke="#737373" fontSize={11} /><YAxis type="category" dataKey="name" stroke="#737373" fontSize={11} width={90} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Bar dataKey="qty" fill="#f59e0b" radius={[0, 6, 6, 0]} /></BarChart></ResponsiveContainer></div></Panel>
      </div>
    </div>
  );
}

/* Revenue */
function RevenueTab({ params }) {
  const d = useReport("/reports", params);
  if (!d) return <div className="text-gray-400">Loading…</div>;
  const rows = [["Invoice", "Date", "Table", "Customer", "Duration", "Table Amt", "Snacks", "Total"], ...d.sessions.map((s) => [s.invoice_no, s.ended_at, s.table_number, s.customer_name, s.duration_minutes, s.table_amount, s.snacks_amount, s.grand_total])];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={IndianRupee} label="Total Revenue" value={inr(d.total_revenue)} />
        <KpiCard label="Table Revenue" value={inr(d.table_revenue)} accent="blue" />
        <KpiCard label="Snack Revenue" value={inr(d.snack_revenue)} accent="amber" />
        <KpiCard label="Total Customers" value={d.total_customers} accent="fuchsia" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => exportCSV(rows, `revenue-${Date.now()}.csv`)} data-testid="export-rev-csv" className="h-11 px-5 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white font-semibold flex items-center gap-2"><Download className="w-4 h-4" /> Excel</button>
        <button onClick={() => window.print()} data-testid="export-rev-pdf" className="h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> PDF</button>
      </div>
      <Panel title="Bills">
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-[#262626]"><th className="py-3 px-2">Invoice</th><th className="py-3 px-2">Date</th><th className="py-3 px-2">Table</th><th className="py-3 px-2 text-right">Total</th></tr></thead><tbody>{d.sessions.map((s) => <tr key={s.id} className="border-b border-[#1c1c1c]"><td className="py-2.5 px-2 font-mono text-xs">{s.invoice_no}</td><td className="py-2.5 px-2 text-gray-400">{new Date(s.ended_at).toLocaleString()}</td><td className="py-2.5 px-2">{s.table_number}</td><td className="py-2.5 px-2 text-right font-bold text-green-400 font-mono">{inr(s.grand_total)}</td></tr>)}</tbody></table></div>
      </Panel>
    </div>
  );
}

/* Expenses */
function ExpensesTab({ params }) {
  const d = useReport("/reports/expenses", params);
  if (!d) return <div className="text-gray-400">Loading…</div>;
  const rows = [["Date", "Category", "Sub", "Vendor", "Method", "Amount", "Notes"], ...d.expenses.map((e) => [e.date, e.category, e.subcategory, e.vendor_name, e.payment_method, e.amount, e.notes])];
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={Wallet} label="Total Expenses" value={inr(d.total)} accent="red" />
        <KpiCard label="Entries" value={d.count} accent="blue" />
        <KpiCard label="Categories" value={d.by_category.length} accent="amber" />
        <KpiCard label="Vendors" value={d.vendor_spending.length} accent="fuchsia" />
      </div>
      <div className="flex gap-2">
        <button onClick={() => exportCSV(rows, `expenses-${Date.now()}.csv`)} data-testid="export-exp-csv" className="h-11 px-5 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white font-semibold flex items-center gap-2"><Download className="w-4 h-4" /> Excel</button>
        <button onClick={() => window.print()} className="h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> PDF</button>
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="By Category"><div className="h-64"><ResponsiveContainer><PieChart><Pie data={d.by_category} dataKey="amount" nameKey="category" outerRadius={80} innerRadius={45} paddingAngle={2}>{d.by_category.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} /></PieChart></ResponsiveContainer></div></Panel>
        <Panel title="Monthly Trend"><div className="h-64"><ResponsiveContainer><LineChart data={d.monthly_trend}><CartesianGrid stroke="#262626" /><XAxis dataKey="month" stroke="#737373" fontSize={11} /><YAxis stroke="#737373" fontSize={11} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Line type="monotone" dataKey="amount" stroke="#ef4444" strokeWidth={2} dot={{ fill: "#ef4444" }} /></LineChart></ResponsiveContainer></div></Panel>
      </div>
      <Panel title="Top Vendors">
        <div className="space-y-2">{d.vendor_spending.map((v) => <div key={v.vendor} className="flex items-center justify-between p-3 rounded-lg bg-[#0f0f0f] border border-[#1c1c1c]"><span>{v.vendor}</span><span className="font-bold font-mono text-red-400">{inr(v.amount)}</span></div>)}{d.vendor_spending.length === 0 && <div className="text-gray-500 text-sm">No vendor spending yet.</div>}</div>
      </Panel>
      <Panel title="Largest Expenses">
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-[#262626]"><th className="py-3 px-2">Date</th><th className="py-3 px-2">Category</th><th className="py-3 px-2">Vendor</th><th className="py-3 px-2 text-right">Amount</th></tr></thead><tbody>{d.largest.map((e) => <tr key={e.id} className="border-b border-[#1c1c1c]"><td className="py-2.5 px-2 text-gray-400">{new Date(e.date).toLocaleDateString()}</td><td className="py-2.5 px-2">{e.category} <span className="text-gray-500">· {e.subcategory}</span></td><td className="py-2.5 px-2 text-gray-400">{e.vendor_name || "—"}</td><td className="py-2.5 px-2 text-right font-bold text-red-400 font-mono">−{inr(e.amount)}</td></tr>)}</tbody></table></div>
      </Panel>
    </div>
  );
}

/* P&L */
function PnlTab({ params }) {
  const d = useReport("/reports/pnl", params);
  if (!d) return <div className="text-gray-400">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={TrendingUp} label="Gross Revenue" value={inr(d.gross_revenue)} />
        <KpiCard icon={TrendingDown} label="Total Expenses" value={inr(d.total_expenses)} accent="red" />
        <KpiCard label="Net Profit" value={inr(d.net_profit)} accent={d.net_profit >= 0 ? "green" : "red"} />
        <KpiCard icon={PieIcon} label="Margin" value={`${d.margin_percent}%`} accent={d.margin_percent >= 0 ? "green" : "red"} />
      </div>
      <Panel title="Revenue Composition">
        <div className="grid grid-cols-2 gap-4 text-sm">
          <Row label="Table Revenue" value={inr(d.table_revenue)} />
          <Row label="Snack Revenue" value={inr(d.snack_revenue)} />
          <Row label="Other Income" value={inr(d.other_income)} />
          <Row label="Gross Revenue" value={inr(d.gross_revenue)} bold />
        </div>
      </Panel>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Revenue vs Expenses"><div className="h-64"><ResponsiveContainer><BarChart data={d.monthly_trend}><CartesianGrid stroke="#262626" /><XAxis dataKey="month" stroke="#737373" fontSize={11} /><YAxis stroke="#737373" fontSize={11} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Legend wrapperStyle={{ fontSize: 11 }} /><Bar dataKey="revenue" fill="#15803d" radius={[4, 4, 0, 0]} /><Bar dataKey="expenses" fill="#ef4444" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
        <Panel title="Monthly Profit"><div className="h-64"><ResponsiveContainer><LineChart data={d.monthly_trend}><CartesianGrid stroke="#262626" /><XAxis dataKey="month" stroke="#737373" fontSize={11} /><YAxis stroke="#737373" fontSize={11} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Line type="monotone" dataKey="profit" stroke="#22c55e" strokeWidth={3} dot={{ fill: "#22c55e" }} /></LineChart></ResponsiveContainer></div></Panel>
        <Panel title="Expense Breakdown"><div className="h-64"><ResponsiveContainer><PieChart><Pie data={d.expense_breakdown} dataKey="amount" nameKey="category" outerRadius={80} innerRadius={45}>{d.expense_breakdown.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} /></PieChart></ResponsiveContainer></div></Panel>
        <Panel title="Revenue Sources"><div className="h-64"><ResponsiveContainer><PieChart><Pie data={d.revenue_sources} dataKey="value" nameKey="name" outerRadius={80} innerRadius={45}>{d.revenue_sources.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} /></PieChart></ResponsiveContainer></div></Panel>
      </div>
      <div className="flex gap-2">
        <button onClick={() => window.print()} data-testid="export-pnl-pdf" className="h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"><FileText className="w-4 h-4" /> Export PDF</button>
      </div>
    </div>
  );
}

/* Payments */
function PaymentsTab({ params }) {
  const d = useReport("/reports/payments", params);
  if (!d) return <div className="text-gray-400">Loading…</div>;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <KpiCard label="Total" value={inr(d.total)} />
        {d.by_method
  .filter((m) => Number(m.amount) > 0)
  .map((m) => (
    <KpiCard
      key={m.method}
      label={m.method.toUpperCase()}
      value={inr(m.amount)}
      accent={
        m.method === "cash"
          ? "green"
          : m.method === "upi"
          ? "blue"
          : m.method === "card"
          ? "amber"
          : m.method === "credit"
          ? "red"
          : "fuchsia"
      }
    />
))}
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Panel title="Payment Method Split"><div className="h-64"><ResponsiveContainer><PieChart><Pie data={d.by_method} dataKey="amount" nameKey="method" outerRadius={80} innerRadius={45}>{d.by_method.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}</Pie><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Legend wrapperStyle={{ fontSize: 11, color: "#a3a3a3" }} /></PieChart></ResponsiveContainer></div></Panel>
        <Panel title="Daily Collection (14d)"><div className="h-64"><ResponsiveContainer><BarChart data={d.daily}><CartesianGrid stroke="#262626" /><XAxis dataKey="date" stroke="#737373" fontSize={10} /><YAxis stroke="#737373" fontSize={11} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Bar dataKey="amount" fill="#15803d" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div></Panel>
      </div>
      <Panel title={`Payments (${d.count})`}>
        <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-[#262626]"><th className="py-3 px-2">Date</th><th className="py-3 px-2">Invoice</th><th className="py-3 px-2">Table</th><th className="py-3 px-2">Method</th><th className="py-3 px-2 text-right">Amount</th></tr></thead><tbody>{d.payments.map((p) => <tr key={p.id} className="border-b border-[#1c1c1c]"><td className="py-2.5 px-2 text-gray-400">{new Date(p.created_at).toLocaleString()}</td><td className="py-2.5 px-2 font-mono text-xs">{p.invoice_no}</td><td className="py-2.5 px-2">{p.table_number}</td><td className="py-2.5 px-2"><span className="text-xs uppercase px-2 py-0.5 rounded-full bg-[#1c1c1c] border border-[#262626] font-bold">{p.method}</span></td><td className="py-2.5 px-2 text-right font-bold text-green-400 font-mono">{inr(p.amount)}</td></tr>)}{d.payments.length === 0 && <tr><td colSpan="5" className="text-center py-8 text-gray-500">No payments in this period.</td></tr>}</tbody></table></div>
      </Panel>
    </div>
  );
}

/* Sessions & Snacks */
function SessionsTab({ params }) {
  const d = useReport("/reports", params);
  if (!d) return <div className="text-gray-400">Loading…</div>;
  return (
    <Panel title={`Sessions (${d.total_sessions})`}>
      <div className="overflow-x-auto"><table className="w-full text-sm"><thead><tr className="text-left text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-[#262626]"><th className="py-3 px-2">Invoice</th><th className="py-3 px-2">Date</th><th className="py-3 px-2">Table</th><th className="py-3 px-2">Customer</th><th className="py-3 px-2 text-right">Duration</th></tr></thead><tbody>{d.sessions.map((s) => <tr key={s.id} className="border-b border-[#1c1c1c]"><td className="py-2.5 px-2 font-mono text-xs">{s.invoice_no}</td><td className="py-2.5 px-2 text-gray-400">{new Date(s.ended_at).toLocaleString()}</td><td className="py-2.5 px-2">{s.table_number}</td><td className="py-2.5 px-2 text-gray-400">{s.customer_name || "Walk-in"}</td><td className="py-2.5 px-2 text-right font-mono">{s.duration_minutes}m</td></tr>)}</tbody></table></div>
    </Panel>
  );
}
function SnacksTab({ params }) {
  const d = useReport("/reports", params);
  if (!d) return <div className="text-gray-400">Loading…</div>;
  return (
    <Panel title="Best-Selling Snacks">
      <div className="h-72"><ResponsiveContainer><BarChart data={d.best_snacks}><CartesianGrid stroke="#262626" /><XAxis dataKey="name" stroke="#737373" fontSize={11} /><YAxis stroke="#737373" fontSize={11} /><Tooltip contentStyle={{ background: "#0a0a0a", border: "1px solid #262626", borderRadius: 12 }} /><Bar dataKey="qty" fill="#f59e0b" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>
    </Panel>
  );
}

function Row({ label, value, bold }) {
  return <div className={`flex items-center justify-between p-3 rounded-lg bg-[#0f0f0f] border border-[#1c1c1c] ${bold ? "border-green-700/40 bg-green-700/5" : ""}`}><span className="text-gray-400">{label}</span><span className={`font-mono ${bold ? "font-bold text-green-400" : ""}`}>{value}</span></div>;
}
