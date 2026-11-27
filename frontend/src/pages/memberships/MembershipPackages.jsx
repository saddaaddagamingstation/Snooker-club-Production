import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, X, Package, Power } from "lucide-react";
import api, { inr, formatApiErrorDetail } from "@/lib/api";

const EMPTY_FORM = {
  name: "",
  price: "",
  total_hours: "",
  daily_minutes: 120,
  validity_days: 30,
  description: "",
  is_active: true,
};

export default function MembershipPackages() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async () => {
    try {
      const r = await api.get("/membership-admin/packages");
      setItems(Array.isArray(r.data) ? r.data : []);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not load packages");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => {
    setEditing(null);
    setForm(EMPTY_FORM);
    setModalOpen(true);
  };

  const openEdit = (pkg) => {
    setEditing(pkg);
    setForm({
      name: pkg.name || "",
      price: String(pkg.price ?? ""),
      total_hours: String(pkg.total_hours ?? ""),
      daily_minutes: Number(pkg.daily_minutes ?? 120),
      validity_days: Number(pkg.validity_days ?? 30),
      description: pkg.description || "",
      is_active: pkg.is_active !== false,
    });
    setModalOpen(true);
  };

  const updateField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }));

  const savePackage = async (event) => {
    event.preventDefault();
    const payload = {
      name: form.name.trim(),
      price: Number(form.price),
      total_hours: Number(form.total_hours),
      daily_minutes: Number(form.daily_minutes),
      validity_days: Number(form.validity_days),
      description: form.description.trim(),
      is_active: Boolean(form.is_active),
    };

    if (!payload.name) return toast.error("Package name is required");
    if (!Number.isFinite(payload.price) || payload.price < 0) return toast.error("Enter a valid package price");
    if (!Number.isInteger(payload.total_hours) || payload.total_hours <= 0) return toast.error("Total hours must be a positive whole number");
    if (!Number.isInteger(payload.daily_minutes) || payload.daily_minutes <= 0) return toast.error("Daily play limit must be greater than zero");
    if (!Number.isInteger(payload.validity_days) || payload.validity_days <= 0) return toast.error("Validity must be a positive whole number of days");

    setSaving(true);
    try {
      if (editing) {
        await api.put(`/membership-admin/packages/${editing.id}`, payload);
        toast.success("Membership package updated");
      } else {
        await api.post("/membership-admin/packages", payload);
        toast.success("Membership package created");
      }
      setModalOpen(false);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not save package");
    } finally {
      setSaving(false);
    }
  };

  const deletePackage = async (pkg) => {
    const confirmed = window.confirm(
      `Delete “${pkg.name}”? This cannot be undone. Packages already assigned to members cannot be deleted; deactivate those instead.`
    );
    if (!confirmed) return;

    setDeletingId(pkg.id);
    try {
      await api.delete(`/membership-admin/packages/${pkg.id}`);
      toast.success("Package deleted");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Could not delete package");
    } finally {
      setDeletingId(null);
    }
  };

  const toggleActive = async (pkg) => {
    const action = pkg.is_active === false ? "activate" : "deactivate";
    try {
      await api.post(`/membership-admin/packages/${pkg.id}/${action}`);
      toast.success(action === "activate" ? "Package activated" : "Package deactivated");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || `Could not ${action} package`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs uppercase tracking-[.25em] text-green-500 font-bold mb-2">Membership configuration</p>
          <h2 className="text-3xl font-bold">Membership Packages</h2>
          <p className="text-gray-400 mt-2">Configure fixed PS5 membership plans, package price and daily play limits.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center justify-center gap-2 rounded-xl bg-green-500 px-4 py-3 text-sm font-semibold text-black hover:bg-green-400">
          <Plus size={17} /> Add Package
        </button>
      </div>

      {loading ? (
        <p className="text-gray-400">Loading packages…</p>
      ) : items.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[#303030] bg-[#111] p-10 text-center">
          <Package className="mx-auto mb-3 text-gray-500" size={30} />
          <p className="font-semibold">No membership packages yet</p>
          <p className="mt-1 text-sm text-gray-500">Create your first package to make it available when adding members.</p>
          <button onClick={openCreate} className="mt-5 rounded-lg bg-green-500 px-4 py-2 text-sm font-semibold text-black">Create package</button>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {items.map((p) => (
            <div key={p.id} className={`rounded-2xl border bg-[#141414] p-5 ${p.is_active === false ? "border-amber-700/40 opacity-75" : "border-[#303030]"}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm font-semibold text-green-400">{p.name}</div>
                <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${p.is_active === false ? "bg-amber-500/10 text-amber-400" : "bg-green-500/10 text-green-400"}`}>
                  {p.is_active === false ? "INACTIVE" : "ACTIVE"}
                </span>
              </div>
              <div className="mt-2 text-3xl font-bold">{inr(p.price)}</div>
              <div className="mt-1 text-lg font-semibold">{p.total_hours} hours</div>
              <div className="mt-3 space-y-1 text-sm text-gray-400">
                <div>{Number(p.validity_days ?? 30)}-day validity</div>
                <div>Maximum {Math.floor(Number(p.daily_minutes ?? 120) / 60)}{Number(p.daily_minutes ?? 120) % 60 ? `h ${Number(p.daily_minutes ?? 120) % 60}m` : " hours"}/day</div>
                <div>PS5 only</div>
                {p.description ? <div className="pt-2 text-gray-500">{p.description}</div> : null}
              </div>
              <div className="mt-5 flex flex-wrap gap-2 border-t border-white/10 pt-4">
                <button onClick={() => openEdit(p)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-200 hover:bg-white/5">
                  <Pencil size={13} /> Edit
                </button>
                <button onClick={() => toggleActive(p)} className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 px-3 py-2 text-xs text-gray-200 hover:bg-white/5">
                  <Power size={13} /> {p.is_active === false ? "Activate" : "Deactivate"}
                </button>
                <button onClick={() => deletePackage(p)} disabled={deletingId === p.id} className="inline-flex items-center gap-1.5 rounded-lg border border-red-500/20 px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 disabled:opacity-50">
                  <Trash2 size={13} /> {deletingId === p.id ? "Deleting…" : "Delete"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) setModalOpen(false); }}>
          <form onSubmit={savePackage} className="my-8 w-full max-w-lg rounded-2xl border border-white/10 bg-[#151515] p-6 shadow-2xl">
            <div className="mb-6 flex items-center justify-between">
              <div>
                <h3 className="text-xl font-bold">{editing ? "Edit Package" : "Add Membership Package"}</h3>
                <p className="mt-1 text-sm text-gray-500">Set the package price and included play time.</p>
              </div>
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white" aria-label="Close">
                <X size={19} />
              </button>
            </div>

            <div className="space-y-4">
              <label className="block text-sm text-gray-300">Package name
                <input autoFocus value={form.name} onChange={(e) => updateField("name", e.target.value)} placeholder="e.g. Bronze" maxLength={40} required className="mt-2 w-full rounded-lg border border-white/10 bg-[#0c0c0c] px-3 py-3 text-white outline-none focus:border-green-500" />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-gray-300">Price (₹)
                  <input type="number" min="0" step="0.01" value={form.price} onChange={(e) => updateField("price", e.target.value)} placeholder="1099" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#0c0c0c] px-3 py-3 text-white outline-none focus:border-green-500" />
                </label>
                <label className="block text-sm text-gray-300">Total hours
                  <input type="number" min="1" step="1" value={form.total_hours} onChange={(e) => updateField("total_hours", e.target.value)} placeholder="10" required className="mt-2 w-full rounded-lg border border-white/10 bg-[#0c0c0c] px-3 py-3 text-white outline-none focus:border-green-500" />
                </label>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <label className="block text-sm text-gray-300">Daily play limit (minutes)
                  <input type="number" min="1" step="1" value={form.daily_minutes} onChange={(e) => updateField("daily_minutes", e.target.value)} required className="mt-2 w-full rounded-lg border border-white/10 bg-[#0c0c0c] px-3 py-3 text-white outline-none focus:border-green-500" />
                  <span className="mt-1 block text-xs text-gray-500">Default: 120 minutes/day.</span>
                </label>
                <label className="block text-sm text-gray-300">Validity (days)
                  <input type="number" min="1" step="1" value={form.validity_days} onChange={(e) => updateField("validity_days", e.target.value)} required className="mt-2 w-full rounded-lg border border-white/10 bg-[#0c0c0c] px-3 py-3 text-white outline-none focus:border-green-500" />
                  <span className="mt-1 block text-xs text-gray-500">Default: 30 days.</span>
                </label>
              </div>
              <label className="block text-sm text-gray-300">Description (optional)
                <textarea value={form.description} onChange={(e) => updateField("description", e.target.value)} rows={2} maxLength={180} placeholder="Short package details" className="mt-2 w-full resize-none rounded-lg border border-white/10 bg-[#0c0c0c] px-3 py-3 text-white outline-none focus:border-green-500" />
              </label>
              <div className="rounded-xl border border-green-500/20 bg-green-500/[0.06] px-4 py-3">
                <div className="text-[11px] font-bold uppercase tracking-wider text-green-400">Package value preview</div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-sm text-gray-400">Effective price per hour</span>
                  <span className="text-lg font-bold text-white">{Number(form.total_hours) > 0 && Number.isFinite(Number(form.price)) ? inr(Number(form.price) / Number(form.total_hours)) : "—"}<span className="ml-1 text-xs font-normal text-gray-500">/ hour</span></span>
                </div>
                <p className="mt-1 text-xs text-gray-500">{Number(form.total_hours) > 0 ? `${form.total_hours} total hours` : "Enter total hours"} · {Number(form.validity_days) > 0 ? `${form.validity_days} days validity` : "Set validity"} · {Number(form.daily_minutes) > 0 ? `${form.daily_minutes} min/day` : "Set daily limit"}</p>
              </div>
              <label className="flex items-center gap-3 text-sm text-gray-300">
                <input type="checkbox" checked={form.is_active} onChange={(e) => updateField("is_active", e.target.checked)} className="h-4 w-4 accent-green-500" />
                Make this package active and available for new members
              </label>
            </div>

            <div className="mt-7 flex justify-end gap-3">
              <button type="button" onClick={() => setModalOpen(false)} className="rounded-lg border border-white/10 px-4 py-2.5 text-sm text-gray-300 hover:bg-white/5">Cancel</button>
              <button type="submit" disabled={saving} className="rounded-lg bg-green-500 px-5 py-2.5 text-sm font-semibold text-black hover:bg-green-400 disabled:cursor-not-allowed disabled:opacity-60">
                {saving ? "Saving…" : editing ? "Save Changes" : "Create Package"}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
