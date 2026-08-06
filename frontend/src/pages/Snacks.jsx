import { useEffect, useState } from "react";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Plus, Search, Pencil, Trash2, X, UtensilsCrossed } from "lucide-react";
import {Select, SelectContent, SelectItem, SelectTrigger, SelectValue,} from "@/components/ui/select";
import { toast } from "sonner";

export default function Snacks() {
  const { can, user } = useAuth();
  const isAdmin = can("manage_snacks");
  console.log("manage_snacks =", can("manage_snacks"));
  console.log("user =", user);
  const [snacks, setSnacks] = useState([]);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [stockFilter, setStockFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [categoryModal, setCategoryModal] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [categories, setCategories] = useState([]);
  
  const loadCategories = async () => {
  const { data } = await api.get("/categories");
  setCategories(data);};

  const load = async () => { const { data } = await api.get("/snacks"); setSnacks(data); };
  useEffect(() => {
  load();
  loadCategories();}, []);

  const filtered = snacks.filter((s) => {
  const matchesSearch =
    !q || s.name.toLowerCase().includes(q.toLowerCase());

  const matchesCategory =
    cat === "all" || s.category === cat;

  const matchesStock =
    stockFilter === "all" ||
    (stockFilter === "in" && s.stock_quantity > 5) ||
    (stockFilter === "low" &&
      s.stock_quantity >= 1 &&
      s.stock_quantity <= 5) ||
    (stockFilter === "out" && s.stock_quantity === 0);

  return matchesSearch && matchesCategory && matchesStock;
});

  const save = async (form) => {
    try {
      const body = { ...form, price: Number(form.price), stock_quantity: Number(form.stock_quantity) };
      if (modal.edit) await api.put(`/snacks/${modal.edit.id}`, body);
      else await api.post("/snacks", body);
      toast.success("Saved");
      setModal(null); load();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  const remove = async (id) => {
    if (!window.confirm("Delete this snack?")) return;
    await api.delete(`/snacks/${id}`); toast.success("Deleted"); load();
  };

const saveCategory = async () => {
  try {
    await api.post("/categories", {
      name: categoryName,
    });

    toast.success("Category added");

    await loadCategories();

    setCategoryName("");
    setCategoryModal(false);

  } catch (e) {
    toast.error(formatApiErrorDetail(e.response?.data?.detail));
  }
};

  return (
    <div className="space-y-6" data-testid="snacks-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">Menu</div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Snacks & Drinks</h1>
          <p className="text-gray-400 mt-2 text-sm">{snacks.length} items on the menu</p>
        </div>
        {isAdmin && (
  <div className="flex items-center gap-2">
    <button
      data-testid="add-snack-btn"
      onClick={() =>
        setModal({
          edit: null,
          form: {
            name: "",
            category: "Snack",
            price: 0,
            stock_quantity: 0,
            image_url: "",
          },
        })
      }
      className="h-12 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"
    >
      <Plus className="w-4 h-4" />
      Add Snack
    </button>

    <button
      data-testid="add-category-btn"
      onClick={() => setCategoryModal(true)}
      className="h-12 px-5 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold flex items-center gap-2"
    >
      <Plus className="w-4 h-4" />
      Category
    </button>
  </div>
)}
      </div>
        <div className="flex items-center gap-3 flex-wrap">
         <div className="relative flex-1 min-w-[240px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />
          <input data-testid="snacks-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search snacks…" className="w-full h-11 pl-10 pr-4 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700" />
        </div>
        <Select
          value={cat}
          onValueChange={setCat}
        >
          <SelectTrigger
            data-testid="snacks-filter-category"
            className="w-[180px] h-11 bg-[#0f0f0f] border border-[#262626] text-white"
          >
            <SelectValue placeholder="All Categories" />
          </SelectTrigger>

          <SelectContent>
            <SelectItem value="all">All Categories</SelectItem>

            {categories.map((c) => (
              <SelectItem key={c.id} value={c.name}>
                {c.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
<Select
  value={stockFilter}
  onValueChange={setStockFilter}
>
  <SelectTrigger className="w-[180px] h-11 bg-[#0f0f0f] border border-[#262626] text-white">
    <SelectValue placeholder="All Stock" />
  </SelectTrigger>

  <SelectContent>
    <SelectItem value="all">All Stock</SelectItem>
    <SelectItem value="in">In Stock</SelectItem>
    <SelectItem value="low">Low Stock</SelectItem>
    <SelectItem value="out">Out of Stock</SelectItem>
  </SelectContent>
</Select>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4">
        {filtered.length > 0 ? (filtered.map((s) => (
          <div key={s.id} data-testid={`snack-card-${s.name}`} className="rounded-2xl bg-[#141414] border border-[#262626] overflow-hidden hover:border-green-700/40 transition-colors">
            <div className="aspect-square bg-[#0f0f0f] flex items-center justify-center relative overflow-hidden">
              {s.image_url ? <img src={s.image_url} alt={s.name} className="w-full h-full object-cover" /> :
                <UtensilsCrossed className="w-10 h-10 text-gray-700" />}
              <span className="absolute top-2 left-2 text-[10px] px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-gray-300 uppercase font-bold tracking-wider">{s.category}</span>
            </div>
            <div className="p-4">
              <div className="font-bold text-sm truncate">{s.name}</div>
              <div
                  className={`inline-flex items-center px-2 py-1 mt-1 rounded-full text-[11px] font-semibold border ${
                    s.stock_quantity <= 0
                      ? "bg-red-500/10 text-red-400 border-red-500/30"
                      : s.stock_quantity <= 5
                      ? "bg-yellow-500/10 text-yellow-400 border-yellow-500/30"
                      : "bg-green-500/10 text-green-400 border-green-500/30"
                  }`}
                >
                  {s.stock_quantity <= 0
                    ? "Out of Stock"
                    : s.stock_quantity <= 5
                    ? `Low Stock (${s.stock_quantity})`
                    : `In Stock (${s.stock_quantity})`}
                </div>
              <div className="mt-2 flex items-center justify-between">
                <span className="text-xl font-bold font-mono text-green-400">{inr(s.price)}</span>
                {isAdmin && (
                  <div className="flex gap-1">
                    <button data-testid={`edit-snack-${s.name}`} onClick={() => setModal({ edit: s, form: s })} className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:text-white text-gray-400 flex items-center justify-center"><Pencil className="w-3.5 h-3.5" /></button>
                    <button data-testid={`delete-snack-${s.name}`} onClick={() => remove(s.id)} className="w-8 h-8 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:text-red-400 text-gray-400 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5" /></button>
                  </div>
                )}
              </div>
            </div>
          </div>
                ))
      ) : (
        <div className="col-span-full flex items-center justify-center py-20">
          <div className="text-center">
            <h3 className="text-xl font-semibold text-white">
              No results found
            </h3>
            <p className="mt-2 text-gray-400">
              Try changing your search or filters.
            </p>
          </div>
        </div>
      )}
    </div>
      {categoryModal && (
  <div
    className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
    onClick={() => setCategoryModal(false)}
  >
    <div
      onClick={(e) => e.stopPropagation()}
      className="w-full max-w-sm bg-[#141414] border border-[#262626] rounded-2xl p-5"
    >
      <h3 className="text-lg font-bold mb-4">
        Add Category
      </h3>

      <input
        value={categoryName}
        onChange={(e) => setCategoryName(e.target.value)}
        placeholder="Category Name"
        className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-blue-700"
      />

      <button
        onClick={saveCategory}
        className="w-full h-11 mt-4 rounded-xl bg-blue-700 hover:bg-blue-800 text-white font-semibold"
      >
        Save
      </button>
    </div>
  </div>
)}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={() => setModal(null)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-[#141414] border border-[#262626] rounded-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#262626]">
              <h3 className="text-lg font-bold">{modal.edit ? "Edit Snack" : "Add Snack"}</h3>
              <button onClick={() => setModal(null)} className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); save(modal.form); }} className="p-5 space-y-3" data-testid="snack-form">
              {[
                ["Name", "name", "text"],
                ["Price (₹)", "price", "number"],
                ["Stock", "stock_quantity", "number"],
                ["Image URL (optional)", "image_url", "url"],
              ].map(([label, k, type]) => (
                <div key={k}>
                  <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{label}</div>
                  <input type={type} value={modal.form[k] ?? ""} data-testid={`form-${k}`} onChange={(e) => setModal({ ...modal, form: { ...modal.form, [k]: e.target.value } })} className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" />
                </div>
              ))}
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">
                  Category
                </div>

                <select
                  value={modal.form.category}
                  onChange={(e) =>
                    setModal({
                      ...modal,
                      form: {
                        ...modal.form,
                        category: e.target.value,
                      },
                    })
                  }
                  className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700"
                >
                  <option value="">Select Category</option>

                  {categories.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <button type="submit" data-testid="snack-submit" className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Save</button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
