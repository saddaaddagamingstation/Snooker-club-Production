import { useEffect, useMemo, useState } from "react";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Plus, Search, Trash2, Pencil, X, Building2, RefreshCw, Play, Wallet, MoreVertical, Archive,} from "lucide-react";
import { toast } from "sonner";

const TABS = [
  { key: "list", label: "Expense List" },
  { key: "add", label: "Add Expense" },
  { key: "categories", label: "Categories" },
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
          <p className="text-gray-400 mt-2 text-sm">Track every rupee going out with organized categories.</p>
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
  const [f, setF] = useState({
  date: new Date().toISOString().slice(0, 10),
  category: "",
  subcategory: "",
  amount: "",
  payment_method: "cash",
  notes: "",
  bill_url: "",
  recurring: false,
  recurring_frequency: "monthly",
});

  useEffect(() => {
    api.get("/expenses/categories").then((r) => setCats(r.data.categories || {}));
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
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const [showAddCategory, setShowAddCategory] = useState(false);
  const [showAddSubcategory, setShowAddSubcategory] = useState(null);

  const [editingCategory, setEditingCategory] = useState(null);
  const [editingSubcategory, setEditingSubcategory] = useState(null);

  const [categoryName, setCategoryName] = useState("");
  const [subcategoryName, setSubcategoryName] = useState("");

  const [menuOpen, setMenuOpen] = useState(null);

  async function loadCategories() {
    try {
      setLoading(true);

      const { data } = await api.get("/expenses/category-management");

      setCategories(data.categories || []);
    } catch (err) {
      toast.error(err.message || "Failed to load categories");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadCategories();
  }, []);

  async function addCategory() {
    const name = categoryName.trim();

    if (!name) {
      toast.error("Enter a category name");
      return;
    }

    try {
      await api.post("/expenses/categories", {
        name,
      });

      toast.success("Category added");

      setCategoryName("");
      setShowAddCategory(false);

      await loadCategories();
    } catch (err) {
      toast.error(err.message || "Failed to add category");
    }
  }

  async function updateCategory() {
    const name = categoryName.trim();

    if (!name) {
      toast.error("Enter a category name");
      return;
    }

    try {
      await api.put(
        `/expenses/categories/${editingCategory.id}`,
        {
          name,
        }
      );

      toast.success("Category updated");

      setEditingCategory(null);
      setCategoryName("");

      await loadCategories();
    } catch (err) {
      toast.error(err.message || "Failed to update category");
    }
  }

  async function archiveCategory(category) {
    const confirmed = window.confirm(
      `Archive "${category.name}"?\n\nExisting expenses will remain safe, but this category will no longer appear for new expenses.`
    );

    if (!confirmed) return;

    try {
      await api.delete(
        `/expenses/categories/${category.id}`
      );

      toast.success("Category archived");

      setMenuOpen(null);

      await loadCategories();
    } catch (err) {
      toast.error(err.message || "Failed to archive category");
    }
  }

  async function addSubcategory() {
    const name = subcategoryName.trim();

    if (!name) {
      toast.error("Enter a sub-category name");
      return;
    }

    try {
      await api.post(
        `/expenses/categories/${showAddSubcategory.id}/subcategories`,
        {
          name,
        }
      );

      toast.success("Sub-category added");

      setSubcategoryName("");
      setShowAddSubcategory(null);

      await loadCategories();
    } catch (err) {
      toast.error(err.message || "Failed to add sub-category");
    }
  }

  async function updateSubcategory() {
    const name = subcategoryName.trim();

    if (!name) {
      toast.error("Enter a sub-category name");
      return;
    }

    try {
      await api.put(
        `/expenses/categories/${editingSubcategory.categoryId}/subcategories/${editingSubcategory.id}`,
        {
          name,
        }
      );

      toast.success("Sub-category updated");

      setEditingSubcategory(null);
      setSubcategoryName("");

      await loadCategories();
    } catch (err) {
      toast.error(
        err.message || "Failed to update sub-category"
      );
    }
  }

  async function archiveSubcategory(category, subcategory) {
    const confirmed = window.confirm(
      `Archive "${subcategory.name}"?`
    );

    if (!confirmed) return;

    try {
      await api.delete(
        `/expenses/categories/${category.id}/subcategories/${subcategory.id}`
      );

      toast.success("Sub-category archived");

      setMenuOpen(null);

      await loadCategories();
    } catch (err) {
      toast.error(
        err.message || "Failed to archive sub-category"
      );
    }
  }

  function openEditCategory(category) {
    setEditingCategory(category);
    setCategoryName(category.name);
    setMenuOpen(null);
  }

  function openEditSubcategory(category, subcategory) {
    setEditingSubcategory({
      ...subcategory,
      categoryId: category.id,
    });

    setSubcategoryName(subcategory.name);
    setMenuOpen(null);
  }

  const filteredCategories = categories.filter((category) => {
    const query = search.trim().toLowerCase();

    if (!query) return true;

    if (category.name.toLowerCase().includes(query)) {
      return true;
    }

    return category.subcategories?.some((sub) =>
      sub.name.toLowerCase().includes(query)
    );
  });

  if (loading) {
    return (
      <div className="py-12 text-center text-sm text-slate-500">
        Loading categories...
      </div>
    );
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Categories
          </h2>

          <p className="mt-1 text-sm text-slate-400">
            Manage expense categories and sub-categories.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            setCategoryName("");
            setShowAddCategory(true);
          }}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500"
        >
          <Plus size={16} />
          Add Category
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <Search
          size={17}
          className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500"
        />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search categories or sub-categories..."
          className="w-full rounded-xl border border-slate-800 bg-slate-950/60 py-2.5 pl-10 pr-4 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-500"
        />
      </div>

      {/* Category grid */}
      {filteredCategories.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-800 py-16 text-center">
          <p className="text-sm text-slate-500">
            No categories found.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {filteredCategories.map((category) => {
            const activeSubs =
              category.subcategories?.filter(
                (sub) => sub.active !== false
              ) || [];

            return (
              <div
                key={category.id}
                className="rounded-2xl border border-slate-800 bg-slate-900/40 p-5"
              >
                {/* Category header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-base font-semibold text-white">
                      {category.name}
                    </h3>

                    <p className="mt-1 text-xs text-slate-500">
                      {activeSubs.length}{" "}
                      {activeSubs.length === 1
                        ? "sub-category"
                        : "sub-categories"}
                    </p>
                  </div>

                  <div className="relative">
                    <button
                      type="button"
                      onClick={() =>
                        setMenuOpen(
                          menuOpen === category.id
                            ? null
                            : category.id
                        )
                      }
                      className="rounded-lg p-2 text-slate-500 hover:bg-slate-800 hover:text-white"
                    >
                      <MoreVertical size={17} />
                    </button>

                    {menuOpen === category.id && (
                      <div className="absolute right-0 z-20 mt-1 w-44 overflow-hidden rounded-xl border border-slate-800 bg-slate-950 shadow-xl">
                        <button
                          type="button"
                          onClick={() =>
                            openEditCategory(category)
                          }
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-slate-900 hover:text-white"
                        >
                          <Pencil size={15} />
                          Edit category
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            setShowAddSubcategory(category);
                            setSubcategoryName("");
                            setMenuOpen(null);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-slate-300 hover:bg-slate-900 hover:text-white"
                        >
                          <Plus size={15} />
                          Add sub-category
                        </button>

                        <button
                          type="button"
                          onClick={() =>
                            archiveCategory(category)
                          }
                          className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm text-red-400 hover:bg-red-500/10"
                        >
                          <Archive size={15} />
                          Archive category
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Subcategories */}
                <div className="mt-4 space-y-2">
                  {activeSubs.length === 0 ? (
                    <p className="text-sm text-slate-600">
                      No sub-categories yet.
                    </p>
                  ) : (
                    activeSubs.map((subcategory) => (
                      <div
                        key={subcategory.id}
                        className="group flex items-center justify-between rounded-xl border border-slate-800/80 bg-slate-950/40 px-3 py-2"
                      >
                        <span className="text-sm text-slate-300">
                          {subcategory.name}
                        </span>

                        <div className="flex items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button
                            type="button"
                            onClick={() =>
                              openEditSubcategory(
                                category,
                                subcategory
                              )
                            }
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-800 hover:text-white"
                            title="Edit"
                          >
                            <Pencil size={14} />
                          </button>

                          <button
                            type="button"
                            onClick={() =>
                              archiveSubcategory(
                                category,
                                subcategory
                              )
                            }
                            className="rounded-lg p-1.5 text-slate-500 hover:bg-red-500/10 hover:text-red-400"
                            title="Archive"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Add subcategory */}
                <button
                  type="button"
                  onClick={() => {
                    setShowAddSubcategory(category);
                    setSubcategoryName("");
                  }}
                  className="mt-4 flex items-center gap-2 text-sm font-medium text-violet-400 hover:text-violet-300"
                >
                  <Plus size={15} />
                  Add sub-category
                </button>
              </div>
            );
          })}
        </div>
      )}

      {/* Add Category Modal */}
      {showAddCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              Add Category
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Create a new expense category.
            </p>

            <input
              autoFocus
              value={categoryName}
              onChange={(e) =>
                setCategoryName(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addCategory();
                }
              }}
              placeholder="Category name"
              className="mt-5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-500"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setShowAddCategory(false)
                }
                className="rounded-xl px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={addCategory}
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500"
              >
                Add Category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Category Modal */}
      {editingCategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              Edit Category
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Renaming this category also updates existing
              expenses.
            </p>

            <input
              autoFocus
              value={categoryName}
              onChange={(e) =>
                setCategoryName(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  updateCategory();
                }
              }}
              className="mt-5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingCategory(null);
                  setCategoryName("");
                }}
                className="rounded-xl px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={updateCategory}
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Subcategory Modal */}
      {showAddSubcategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              Add Sub-category
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Add to{" "}
              <span className="text-slate-300">
                {showAddSubcategory.name}
              </span>
              .
            </p>

            <input
              autoFocus
              value={subcategoryName}
              onChange={(e) =>
                setSubcategoryName(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  addSubcategory();
                }
              }}
              placeholder="Sub-category name"
              className="mt-5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none placeholder:text-slate-600 focus:border-violet-500"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() =>
                  setShowAddSubcategory(null)
                }
                className="rounded-xl px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={addSubcategory}
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500"
              >
                Add Sub-category
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Subcategory Modal */}
      {editingSubcategory && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-md rounded-2xl border border-slate-800 bg-slate-950 p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-white">
              Edit Sub-category
            </h3>

            <p className="mt-1 text-sm text-slate-500">
              Renaming this also updates existing expenses.
            </p>

            <input
              autoFocus
              value={subcategoryName}
              onChange={(e) =>
                setSubcategoryName(e.target.value)
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  updateSubcategory();
                }
              }}
              className="mt-5 w-full rounded-xl border border-slate-800 bg-slate-900 px-3 py-2.5 text-sm text-white outline-none focus:border-violet-500"
            />

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setEditingSubcategory(null);
                  setSubcategoryName("");
                }}
                className="rounded-xl px-4 py-2.5 text-sm text-slate-400 hover:bg-slate-900 hover:text-white"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={updateSubcategory}
                className="rounded-xl bg-violet-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-violet-500"
              >
                Save Changes
              </button>
            </div>
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
          <Field label="Category"><select value={f.category} onChange={(e) =>
  setF({
    ...f,
    category: e.target.value,
    subcategory: "",
  })
} className="form-input">{Object.keys(categories).map((c) => <option key={c}>{c}</option>)}</select></Field>
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
