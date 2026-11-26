import { useEffect, useState } from "react";
import { Plus, Pencil, Ban, CheckCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import api, { inr, formatApiErrorDetail } from "@/lib/api";

const blank = {
  name: "",
  price: "",
  daily_minutes: "",
  description: "",
  is_active: true,
};

export default function MembershipPackages() {
  const [items, setItems] = useState([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      const r = await api.get("/membership-admin/packages");
      setItems(r.data || []);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const body = {
        ...form,
        price: Number(form.price),
        daily_minutes: Number(form.daily_minutes),
      };

      if (editing) {
        await api.put(`/membership-admin/packages/${editing}`, body);
      } else {
        await api.post("/membership-admin/packages", body);
      }

      toast.success(editing ? "Package updated" : "Package created");

      setShow(false);
      setEditing(null);
      setForm(blank);
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const edit = (p) => {
    setEditing(p.id);

    setForm({
      name: p.name,
      price: String(p.price),
      daily_minutes: String(p.daily_minutes),
      description: p.description || "",
      is_active: p.is_active,
    });

    setShow(true);
  };

  const deactivate = async (id) => {
    if (
      !window.confirm(
        "Deactivate this package? Existing members will keep their current terms.",
      )
    )
      return;

    try {
      await api.post(`/membership-admin/packages/${id}/deactivate`);

      toast.success("Package deactivated");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const activate = async (id) => {
    try {
      await api.post(`/membership-admin/packages/${id}/activate`);

      toast.success("Package activated");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };
  const deletePackage = async (id) => {
    if (
      !window.confirm(
        "Permanently delete this package? This is allowed only if no membership records exist.",
      )
    )
      return;

    try {
      await api.delete(`/membership-admin/packages/${id}`);

      toast.success("Package deleted successfully");
      await load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex justify-between items-end gap-3 flex-wrap">
        <div>
          <p className="text-xs uppercase tracking-[.25em] text-green-500 font-bold mb-2">
            Configuration
          </p>

          <h2 className="text-3xl font-bold">Packages</h2>

          <p className="text-gray-400 mt-2">
            Manage prices and daily play allowances.
          </p>
        </div>

        <button
          onClick={() => {
            setEditing(null);
            setForm(blank);
            setShow(true);
          }}
          className="bg-green-700 hover:bg-green-800 rounded-lg px-4 py-3 font-semibold flex gap-2 items-center"
        >
          <Plus className="w-4 h-4" />
          Add Package
        </button>
      </div>

      {/* Add / Edit Form */}
      {show && (
        <form
          onSubmit={save}
          className="rounded-2xl border border-[#303030] bg-[#141414] p-5 grid sm:grid-cols-2 gap-4"
        >
          <label className="text-sm text-gray-400">
            Package name
            <input
              required
              className="mt-2 w-full form-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>

          <label className="text-sm text-gray-400">
            Price (₹)
            <input
              required
              type="number"
              min="0"
              className="mt-2 w-full form-input"
              value={form.price}
              onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </label>

          <label className="text-sm text-gray-400">
            Daily minutes
            <input
              required
              type="number"
              min="1"
              className="mt-2 w-full form-input"
              value={form.daily_minutes}
              onChange={(e) =>
                setForm({
                  ...form,
                  daily_minutes: e.target.value,
                })
              }
            />
          </label>

          <label className="text-sm text-gray-400">
            Description
            <input
              className="mt-2 w-full form-input"
              value={form.description}
              onChange={(e) =>
                setForm({
                  ...form,
                  description: e.target.value,
                })
              }
            />
          </label>

          <div className="sm:col-span-2 flex gap-2">
            <button
              disabled={saving}
              className="bg-green-700 rounded-lg px-5 py-2.5 font-semibold disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save Package"}
            </button>

            <button
              type="button"
              onClick={() => setShow(false)}
              className="bg-[#262626] rounded-lg px-5 py-2.5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}

      {/* Package Cards */}
      <div className="grid sm:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((p) => (
          <div
            key={p.id}
            className="rounded-2xl border border-[#262626] bg-[#141414] p-5"
          >
            <div className="flex justify-between items-center gap-2">
              <h3 className="text-xl font-bold">{p.name}</h3>

              <span
                className={
                  p.is_active
                    ? "text-green-400 text-xs font-semibold"
                    : "text-gray-500 text-xs font-semibold"
                }
              >
                {p.is_active ? "ACTIVE" : "INACTIVE"}
              </span>
            </div>

            <div className="text-3xl font-bold mt-5">{inr(p.price)}</div>

            <div className="text-gray-400 mt-2">
              {p.daily_minutes} minutes per day
            </div>

            <p className="text-sm text-gray-500 mt-2">{p.description}</p>

            <div className="flex gap-2 mt-5 flex-wrap">
              <button
                onClick={() => edit(p)}
                className="px-3 py-2 rounded-lg bg-[#242424] text-sm flex gap-2 items-center"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </button>

              {p.is_active ? (
                <button
                  onClick={() => deactivate(p.id)}
                  className="px-3 py-2 rounded-lg bg-[#242424] text-sm text-amber-400 flex gap-2 items-center"
                >
                  <Ban className="w-4 h-4" />
                  Deactivate
                </button>
              ) : (
                <button
                  onClick={() => activate(p.id)}
                  className="px-3 py-2 rounded-lg bg-green-900/40 text-sm text-green-400 flex gap-2 items-center"
                >
                  <CheckCircle className="w-4 h-4" />
                  Activate
                </button>
              )}
              <button
                onClick={() => deletePackage(p.id)}
                className="px-3 py-2 rounded-lg bg-red-900/20 text-sm text-red-400 hover:bg-red-900/40 flex gap-2 items-center"
              >
                <Trash2 className="w-4 h-4" />
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <style>{`
        .form-input {
          height: 44px;
          padding: 0 12px;
          border-radius: 9px;
          background: #0f0f0f;
          border: 1px solid #303030;
          color: white;
          outline: none;
        }

        .form-input:focus {
          border-color: #15803d;
        }
      `}</style>
    </div>
  );
}
