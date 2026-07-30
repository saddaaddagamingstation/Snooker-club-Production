import { useEffect, useMemo, useState } from "react";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Plus, Search, Trash2, Pencil, X, Building2, RefreshCw, Play, Wallet } from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { key: "list", label: "Expense List" },
  { key: "add", label: "Add Expense" },
  { key: "categories", label: "Categories" },
  { key: "recurring", label: "Recurring" },
  { key: "vendors", label: "Vendors" },
];

export default function Expenses() {
  const { can } = useAuth();
  const canManage = can("manage_expenses");
  const [tab, setTab] = useState("list");

  return (
    <div className="space-y-6" data-testid="expenses-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">Books</div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Expenses</h1>
          <p className="text-gray-400 mt-2 text-sm">Track every rupee going out · vendors, recurring bills and categories.</p>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap border-b border-[#262626]">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} data-testid={`exp-tab-${t.key}`}
            className={`px-4 py-2.5 text-sm font-semibold rounded-t-lg -mb-px border-b-2 transition-all ${tab === t.key ? "border-green-600 text-white" : "border-transparent text-gray-500 hover:text-gray-300"}`}>{t.label}</button>
        ))}
      </div>

      {tab === "list" && <ExpenseList canManage={canManage} />}
      {tab === "add" && <AddExpense canManage={canManage} onSaved={() => setTab("list")} />}
      {tab === "categories" && <Categories canManage={canManage} />}
      {tab === "recurring" && <Recurring canManage={canManage} />}
      {tab === "vendors" && <Vendors canManage={canManage} />}
    </div>
  );
}

/* ---------- Expense List ---------- */
function ExpenseList({ canManage }) {
  const [items, setItems] = useState([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [cats, setCats] = useState({});
  const [edit, setEdit] = useState(null);

  const load = async () => {
    const params = {};
    if (cat) params.category = cat;
    const { data } = await api.get("/expenses", { params });
    setItems(data);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [cat]);
  useEffect(() => { api.get("/expenses/categories").then((r) => setCats(r.data.categories || {})); }, []);

  const filtered = items.filter((e) => !q || `${e.category} ${e.subcategory} ${e.vendor_name} ${e.notes}`.toLowerCase().includes(q.toLowerCase()));
  const total = filtered.reduce((s, e) => s + Number(e.amount || 0), 0);

  const remove = async (id) => {
    if (!window.confirm("Delete this expense?")) return;
    await api.delete(`/expenses/${id}`); toast.success("Deleted"); load();
  };

  return (
    <div className="space-y-4" data-testid="expense-list">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search…" data-testid="exp-search" className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700" />
        </div>
        <select value={cat} onChange={(e) => setCat(e.target.value)} data-testid="exp-filter-cat" className="h-11 px-4 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700">
          <option value="">All categories</option>
          {Object.keys(cats).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatBox label="Total" value={inr(total)} />
        <StatBox label="Entries" value={filtered.length} />
        <StatBox label="Categories" value={new Set(filtered.map((x) => x.category)).size} />
        <StatBox label="Vendors" value={new Set(filtered.map((x) => x.vendor_name).filter(Boolean)).size} />
      </div>

      <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 font-bold border-b border-[#262626]">
                <th className="py-3 px-4">Date</th><th className="py-3 px-4">Category</th><th className="py-3 px-4">Vendor</th><th className="py-3 px-4">Method</th><th className="py-3 px-4 text-right">Amount</th><th className="py-3 px-4"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-[#1c1c1c] hover:bg-[#0f0f0f]">
                  <td className="py-2.5 px-4 text-gray-400">{new Date(e.date).toLocaleDateString()}</td>
                  <td className="py-2.5 px-4"><div className="font-semibold">{e.category}</div><div className="text-xs text-gray-500">{e.subcategory}</div></td>
                  <td className="py-2.5 px-4 text-gray-400">{e.vendor_name || "—"}</td>
                  <td className="py-2.5 px-4"><span className="text-xs uppercase px-2 py-0.5 rounded-full bg-[#1c1c1c] border border-[#262626] tracking-wider font-bold">{e.payment_method}</span></td>
                  <td className="py-2.5 px-4 text-right font-bold font-mono text-red-400">−{inr(e.amount)}</td>
                  <td className="py-2.5 px-4 text-right">
                    {canManage && (
                      <div className="flex gap-1 justify-end">
                        <button onClick={() => setEdit(e)} data-testid={`edit-exp-${e.id}`} className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:text-white text-gray-400 flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => remove(e.id)} data-testid={`del-exp-${e.id}`} className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:text-red-400 text-gray-400 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && <tr><td colSpan="6" className="text-center py-10 text-gray-500">No expenses recorded yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {edit && <EditExpenseModal expense={edit} categories={cats} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </div>
  );
}

/* ---------- Add Expense ---------- */
function AddExpense({ canManage, onSaved }) {
  const [cats, setCats] = useState({});
  const [vendors, setVendors] = useState([]);
  const [f, setF] = useState({
    date: new Date().toISOString().slice(0, 10),
    category: "", subcategory: "", amount: "",
    payment_method: "cash", vendor_id: "", vendor_name: "",
    notes: "", bill_url: "", recurring: false, recurring_frequency: "monthly",
  });

  useEffect(() => {
    api.get("/expenses/categories").then((r) => setCats(r.data.categories || {}));
    api.get("/vendors").then((r) => setVendors(r.data)).catch(() => {});
  }, []);
  const subcats = f.category ? (cats[f.category] || []) : [];

  const submit = async (e) => {
    e.preventDefault();
    if (!canManage) return toast.error("You don't have permission");
    if (!f.category || !f.amount) return toast.error("Category and amount are required");
    try {
      await api.post("/expenses", { ...f, amount: parseFloat(f.amount) });
      toast.success("Expense recorded");
      setF({ ...f, amount: "", notes: "", bill_url: "" });
      onSaved?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  return (
    <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-[#141414] border border-[#262626] rounded-2xl p-6" data-testid="add-expense-form">
      <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="form-input" data-testid="exp-date" required /></Field>
      <Field label="Amount (₹)"><input type="number" step="0.01" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="form-input" data-testid="exp-amount" required /></Field>
      <Field label="Category">
        <select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value, subcategory: "" })} data-testid="exp-category" className="form-input" required>
          <option value="">Select…</option>
          {Object.keys(cats).map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </Field>
      <Field label="Sub-category">
        <select value={f.subcategory} onChange={(e) => setF({ ...f, subcategory: e.target.value })} data-testid="exp-subcat" className="form-input" disabled={!subcats.length}>
          <option value="">—</option>
          {subcats.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
      </Field>
      <Field label="Payment Method">
        <select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} data-testid="exp-method" className="form-input">
          {["cash", "upi", "card", "bank", "credit"].map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </select>
      </Field>
      <Field label="Vendor">
        <select value={f.vendor_id} onChange={(e) => { const v = vendors.find((x) => x.id === e.target.value); setF({ ...f, vendor_id: e.target.value, vendor_name: v?.name || "" }); }} data-testid="exp-vendor" className="form-input">
          <option value="">— None —</option>
          {vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
        </select>
      </Field>
      <Field label="Bill URL (optional)"><input type="url" value={f.bill_url} onChange={(e) => setF({ ...f, bill_url: e.target.value })} data-testid="exp-bill" className="form-input" placeholder="https://…" /></Field>
      <Field label="Notes"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} data-testid="exp-notes" className="form-input" /></Field>
      <div className="md:col-span-2 flex items-center gap-3">
        <label className="flex items-center gap-2 text-sm text-gray-300">
          <input type="checkbox" checked={f.recurring} onChange={(e) => setF({ ...f, recurring: e.target.checked })} data-testid="exp-recurring" className="w-4 h-4 accent-green-600" /> Mark this as a recurring expense
        </label>
        {f.recurring && (
          <select value={f.recurring_frequency} onChange={(e) => setF({ ...f, recurring_frequency: e.target.value })} className="h-10 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white">
            <option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option>
          </select>
        )}
      </div>
      <div className="md:col-span-2">
        <button type="submit" data-testid="save-expense" disabled={!canManage} className="h-12 px-6 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-40 text-white font-semibold">Save Expense</button>
      </div>
      <style>{`.form-input{width:100%;height:44px;padding:0 14px;border-radius:10px;background:#0f0f0f;border:1px solid #262626;color:#fff;outline:none}.form-input:focus{border-color:#15803d}`}</style>
    </form>
  );
}

/* ---------- Categories ---------- */
function Categories({ canManage }) {
  const [cats, setCats] = useState({});
  const [newCat, setNewCat] = useState("");
  const [newSub, setNewSub] = useState("");
  const load = () => api.get("/expenses/categories").then((r) => setCats(r.data.categories || {}));
  useEffect(() => { load(); }, []);
  const add = async () => {
    if (!newCat || !newSub) return toast.error("Fill both fields");
    await api.post("/expenses/categories", { category: newCat, subcategory: newSub });
    toast.success("Added"); setNewSub(""); load();
  };
  return (
    <div className="space-y-4">
      {canManage && (
        <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5 flex flex-wrap gap-3 items-end">
          <div className="flex-1 min-w-[180px]"><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Category</div><input value={newCat} onChange={(e) => setNewCat(e.target.value)} data-testid="new-cat" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" placeholder="e.g. Maintenance" /></div>
          <div className="flex-1 min-w-[180px]"><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Sub-category</div><input value={newSub} onChange={(e) => setNewSub(e.target.value)} data-testid="new-sub" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" placeholder="e.g. AC Service" /></div>
          <button onClick={add} data-testid="add-cat" className="h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Add</button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {Object.entries(cats).map(([c, subs]) => (
          <div key={c} className="bg-[#141414] border border-[#262626] rounded-2xl p-5">
            <div className="font-bold text-white">{c}</div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {subs.length === 0 && <span className="text-xs text-gray-600">No sub-categories</span>}
              {subs.map((s) => <span key={s} className="text-[11px] px-2 py-1 rounded-full bg-[#0f0f0f] border border-[#262626] text-gray-300">{s}</span>)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---------- Recurring ---------- */
function Recurring({ canManage }) {
  const [items, setItems] = useState([]);
  const [cats, setCats] = useState({});
  const [vendors, setVendors] = useState([]);
  const [add, setAdd] = useState(false);
  const [f, setF] = useState({ name: "", category: "", subcategory: "", amount: "", payment_method: "cash", vendor_id: "", vendor_name: "", frequency: "monthly", day_of_month: 1, active: true, notes: "" });
  const load = () => api.get("/recurring-expenses").then((r) => setItems(r.data));
  useEffect(() => { load(); api.get("/expenses/categories").then((r) => setCats(r.data.categories || {})); api.get("/vendors").then((r) => setVendors(r.data)).catch(() => {}); }, []);

  const save = async (e) => {
    e.preventDefault();
    await api.post("/recurring-expenses", { ...f, amount: parseFloat(f.amount), day_of_month: parseInt(f.day_of_month) });
    toast.success("Recurring created"); setAdd(false); load();
  };
  const remove = async (id) => { if (!window.confirm("Delete recurring?")) return; await api.delete(`/recurring-expenses/${id}`); load(); };
  const runDue = async () => { const { data } = await api.post("/recurring-expenses/run-due"); toast.success(`Generated ${data.generated} entries`); load(); };

  return (
    <div className="space-y-4">
      {canManage && (
        <div className="flex gap-3 flex-wrap">
          <button onClick={() => setAdd(true)} data-testid="add-recurring" className="h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Add Recurring</button>
          <button onClick={runDue} data-testid="run-due" className="h-11 px-5 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white font-semibold flex items-center gap-2"><Play className="w-4 h-4" /> Generate Due Now</button>
        </div>
      )}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((r) => (
          <div key={r.id} className="bg-[#141414] border border-[#262626] rounded-2xl p-5">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-bold">{r.name}</div>
                <div className="text-xs text-gray-500">{r.category} · {r.subcategory}</div>
                <div className="text-xs text-gray-500 mt-1">Next: {r.next_run ? new Date(r.next_run).toLocaleDateString() : "—"} · {r.frequency}</div>
              </div>
              <div className="text-right">
                <div className="text-xl font-bold font-mono text-red-400">{inr(r.amount)}</div>
                {canManage && <button onClick={() => remove(r.id)} className="mt-2 text-gray-500 hover:text-red-400 text-xs"><Trash2 className="w-4 h-4" /></button>}
              </div>
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-gray-500 col-span-full text-center py-10">No recurring expenses configured.</div>}
      </div>

      {add && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setAdd(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-[#141414] border border-[#262626] rounded-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#262626]"><h3 className="text-lg font-bold flex items-center gap-2"><RefreshCw className="w-4 h-4 text-green-400" /> New Recurring Expense</h3><button onClick={() => setAdd(false)} className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button></div>
            <form onSubmit={save} className="p-5 grid grid-cols-2 gap-3">
              <Field label="Name" cls="col-span-2"><input required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} data-testid="rec-name" className="form-input" placeholder="e.g. Monthly Rent" /></Field>
              <Field label="Category"><select required value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} data-testid="rec-cat" className="form-input"><option value="">Select…</option>{Object.keys(cats).map((c) => <option key={c} value={c}>{c}</option>)}</select></Field>
              <Field label="Sub-category"><input value={f.subcategory} onChange={(e) => setF({ ...f, subcategory: e.target.value })} className="form-input" /></Field>
              <Field label="Amount"><input required type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} data-testid="rec-amount" className="form-input" /></Field>
              <Field label="Frequency"><select value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} className="form-input"><option value="monthly">Monthly</option><option value="weekly">Weekly</option><option value="yearly">Yearly</option></select></Field>
              <Field label="Day of month"><input type="number" min="1" max="28" value={f.day_of_month} onChange={(e) => setF({ ...f, day_of_month: e.target.value })} className="form-input" /></Field>
              <Field label="Payment"><select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} className="form-input">{["cash", "upi", "card", "bank", "credit"].map((m) => <option key={m}>{m}</option>)}</select></Field>
              <Field label="Vendor" cls="col-span-2"><select value={f.vendor_id} onChange={(e) => { const v = vendors.find((x) => x.id === e.target.value); setF({ ...f, vendor_id: e.target.value, vendor_name: v?.name || "" }); }} className="form-input"><option value="">— None —</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></Field>
              <div className="col-span-2"><button type="submit" data-testid="save-recurring" className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Create</button></div>
              <style>{`.form-input{width:100%;height:44px;padding:0 12px;border-radius:10px;background:#0f0f0f;border:1px solid #262626;color:#fff;outline:none}.form-input:focus{border-color:#15803d}`}</style>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- Vendors ---------- */
function Vendors({ canManage }) {
  const [items, setItems] = useState([]);
  const [modal, setModal] = useState(null); // {edit, form}
  const load = () => api.get("/vendors").then((r) => setItems(r.data));
  useEffect(() => { load(); }, []);
  const save = async (f) => {
    if (modal.edit) await api.put(`/vendors/${modal.edit.id}`, f);
    else await api.post("/vendors", f);
    toast.success("Saved"); setModal(null); load();
  };
  const remove = async (id) => { if (!window.confirm("Delete vendor?")) return; await api.delete(`/vendors/${id}`); load(); };

  return (
    <div className="space-y-4">
      {canManage && <button onClick={() => setModal({ edit: null, form: { name: "", contact: "", phone: "", email: "", address: "", category: "", notes: "" } })} data-testid="add-vendor" className="h-11 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Add Vendor</button>}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {items.map((v) => (
          <div key={v.id} className="bg-[#141414] border border-[#262626] rounded-2xl p-5" data-testid={`vendor-${v.name}`}>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0"><div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-gray-500" /><div className="font-bold truncate">{v.name}</div></div>
                {v.category && <div className="text-xs text-gray-500 mt-1">{v.category}</div>}
                {v.phone && <div className="text-xs text-gray-400 mt-2 font-mono">{v.phone}</div>}
                {v.email && <div className="text-xs text-gray-400 truncate">{v.email}</div>}
              </div>
              {canManage && <div className="flex gap-1">
                <button onClick={() => setModal({ edit: v, form: v })} className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:text-white text-gray-400 flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                <button onClick={() => remove(v.id)} className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:text-red-400 text-gray-400 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
              </div>}
            </div>
          </div>
        ))}
        {items.length === 0 && <div className="text-gray-500 col-span-full text-center py-10">No vendors yet.</div>}
      </div>
      {modal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-[#141414] border border-[#262626] rounded-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#262626]"><h3 className="text-lg font-bold">{modal.edit ? "Edit" : "Add"} Vendor</h3><button onClick={() => setModal(null)} className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button></div>
            <form onSubmit={(e) => { e.preventDefault(); save(modal.form); }} className="p-5 space-y-3" data-testid="vendor-form">
              {[["Name", "name", true], ["Phone", "phone", false], ["Email", "email", false], ["Category", "category", false], ["Contact person", "contact", false], ["Address", "address", false], ["Notes", "notes", false]].map(([label, k, req]) => (
                <div key={k}><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{label}</div><input required={req} value={modal.form[k] || ""} data-testid={`v-${k}`} onChange={(e) => setModal({ ...modal, form: { ...modal.form, [k]: e.target.value } })} className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" /></div>
              ))}
              <button type="submit" data-testid="v-save" className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Save</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children, cls = "" }) {
  return <div className={cls}><div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{label}</div>{children}</div>;
}
function StatBox({ label, value }) {
  return <div className="bg-[#141414] border border-[#262626] rounded-2xl p-4"><div className="text-xs uppercase tracking-wider text-gray-500 font-bold">{label}</div><div className="text-xl font-bold font-mono mt-1">{value}</div></div>;
}

function EditExpenseModal({ expense, categories, onClose, onSaved }) {
  const [f, setF] = useState({
    date: (expense.date || "").slice(0, 10),
    category: expense.category, subcategory: expense.subcategory || "",
    amount: expense.amount, payment_method: expense.payment_method || "cash",
    vendor_name: expense.vendor_name || "", notes: expense.notes || "", bill_url: expense.bill_url || "",
  });
  const subcats = f.category ? (categories[f.category] || []) : [];
  const save = async (e) => {
    e.preventDefault();
    try { await api.put(`/expenses/${expense.id}`, { ...f, amount: parseFloat(f.amount) }); toast.success("Updated"); onSaved(); }
    catch (err) { toast.error(formatApiErrorDetail(err.response?.data?.detail)); }
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-[#141414] border border-[#262626] rounded-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#262626]"><h3 className="text-lg font-bold flex items-center gap-2"><Wallet className="w-4 h-4 text-green-400" /> Edit Expense</h3><button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button></div>
        <form onSubmit={save} className="p-5 grid grid-cols-2 gap-3" data-testid="edit-expense-form">
          <Field label="Date"><input type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} className="form-input" /></Field>
          <Field label="Amount"><input type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} className="form-input" /></Field>
          <Field label="Category"><select value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="form-input">{Object.keys(categories).map((c) => <option key={c}>{c}</option>)}</select></Field>
          <Field label="Sub-category"><select value={f.subcategory} onChange={(e) => setF({ ...f, subcategory: e.target.value })} className="form-input"><option value="">—</option>{subcats.map((s) => <option key={s}>{s}</option>)}</select></Field>
          <Field label="Payment"><select value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })} className="form-input">{["cash", "upi", "card", "bank", "credit"].map((m) => <option key={m}>{m}</option>)}</select></Field>
          <Field label="Vendor"><input value={f.vendor_name} onChange={(e) => setF({ ...f, vendor_name: e.target.value })} className="form-input" /></Field>
          <Field label="Notes" cls="col-span-2"><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} className="form-input" /></Field>
          <div className="col-span-2"><button type="submit" data-testid="update-exp" className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Update</button></div>
          <style>{`.form-input{width:100%;height:44px;padding:0 12px;border-radius:10px;background:#0f0f0f;border:1px solid #262626;color:#fff;outline:none}.form-input:focus{border-color:#15803d}`}</style>
        </form>
      </div>
    </div>
  );
}
