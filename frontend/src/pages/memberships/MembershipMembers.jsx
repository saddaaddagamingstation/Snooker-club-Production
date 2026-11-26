import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import PhoneInput from "react-phone-input-2";
import "react-phone-input-2/lib/style.css";
import api, { formatApiErrorDetail } from "@/lib/api";

const empty = {
  member_name: "",
  phone: "",
  package_id: "",
  payment_method: "cash",
};

const PhoneNumberField = ({ value, onChange, required = true }) => (
  <div
    className="w-full"
    onMouseEnter={(e) => {
      // Remove the browser's native country tooltip (e.g. "India: +91").
      e.currentTarget
        .querySelectorAll(".membership-phone [title]")
        .forEach((element) => element.removeAttribute("title"));
    }}
    onMouseMove={(e) => {
      e.currentTarget
        .querySelectorAll(".membership-phone [title]")
        .forEach((element) => element.removeAttribute("title"));
    }}
  >
    <PhoneInput
      country="in"
      value={(value || "").replace(/\\D/g, "")}
      onChange={(phone) => onChange(phone ? `+${phone}` : "")}
      enableSearch
      countryCodeEditable={false}
      disableSearchIcon={false}
      inputProps={{ required, name: "phone", autoComplete: "tel" }}
      containerClass="membership-phone"
      inputClass="membership-phone-input"
      buttonClass="membership-phone-button"
      dropdownClass="membership-phone-dropdown"
    />
  </div>
);

const getMembershipStatus = (m) => {
  if (m.is_expired) return "expired";

  if (!m.expires_at) return "active";

  const expiry = new Date(m.expires_at);
  if (isNaN(expiry.getTime())) return "active";

  const remaining = Math.ceil(
    (expiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
  );

  if (remaining <= 0) return "expired";
  if (remaining <= 5) return "expiring";

  return "active";
};

export default function MembershipMembers() {
  const [params, setParams] = useSearchParams();

  const [members, setMembers] = useState([]);
  const [packages, setPackages] = useState([]);
  const [form, setForm] = useState(empty);
  const [show, setShow] = useState(params.get("add") === "1");
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [statusFilter, setStatusFilter] = useState("all");
  const [editing, setEditing] = useState(null);
  const [editForm, setEditForm] = useState({
    member_name: "",
    phone: "",
    package_id: "",
  });

  const load = async () => {
    try {
      const [m, p] = await Promise.all([
        api.get("/membership-admin/members"),
        api.get("/membership-admin/packages"),
      ]);

      setMembers(m.data || []);
      setPackages((p.data || []).filter((x) => x.is_active));

      if (!form.package_id && p.data?.length) {
        setForm((v) => ({
          ...v,
          package_id: p.data.find((x) => x.is_active)?.id || "",
        }));
      }
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  useEffect(() => {
    load();
  }, []);

  const open = () => {
    setShow(true);
    setParams({ add: "1" });
  };

  const save = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      await api.post("/membership-admin/members", form);

      toast.success("Member created successfully");
      setShow(false);
      setParams({});
      setForm({
        ...empty,
        package_id: packages[0]?.id || "",
      });

      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (m) => {
    setEditing(m);

    setEditForm({
      member_name: m.member_name || "",
      phone: m.phone || "",
      package_id: m.package_id || "",
    });
  };

  const saveEdit = async (e) => {
    e.preventDefault();

    try {
      await api.put(`/membership-admin/members/${editing.id}`, editForm);

      toast.success("Member updated successfully");
      setEditing(null);
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const deleteMember = async (m) => {
    if (
      !window.confirm(
        `Deactivate membership of ${m.member_name}? Their historical records will be preserved.`,
      )
    )
      return;

    try {
      await api.delete(`/membership-admin/members/${m.id}`);

      toast.success("Member deactivated successfully");
      load();
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  const counts = {
    all: members.length,
    active: members.filter((m) => getMembershipStatus(m) === "active").length,
    expiring: members.filter((m) => getMembershipStatus(m) === "expiring")
      .length,
    expired: members.filter((m) => getMembershipStatus(m) === "expired").length,
  };

  const filters = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "expiring", label: "Expiring Soon" },
    { id: "expired", label: "Expired" },
  ];

  const filtered = members
    .filter((m) => {
      const matchesSearch =
        `${m.member_id || m.id} ${m.member_name} ${m.phone} ${m.package_name || m.plan}`
          .toLowerCase()
          .includes(search.toLowerCase());

      const matchesStatus =
        statusFilter === "all" || getMembershipStatus(m) === statusFilter;

      return matchesSearch && matchesStatus;
    })
    .sort((a, b) => {
      const dateA = new Date(a.expires_at || 0).getTime();
      const dateB = new Date(b.expires_at || 0).getTime();

      if (statusFilter === "expired") {
        return dateB - dateA;
      }

      return dateA - dateB;
    });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap justify-between items-end gap-3">
        <div>
          <p className="text-xs uppercase tracking-[.25em] text-green-500 font-bold mb-2">
            Directory
          </p>
          <h2 className="text-3xl font-bold">Members</h2>
          <p className="text-gray-400 mt-2">
            Member profiles, package terms and validity.
          </p>
        </div>

        <button
          onClick={open}
          className="bg-green-700 hover:bg-green-800 rounded-lg px-4 py-3 font-semibold flex gap-2"
        >
          <Plus className="w-4 h-4" />
          Add Member
        </button>
      </div>

      {show && (
        <form
          onSubmit={save}
          className="rounded-2xl border border-[#303030] bg-[#141414] p-5 grid sm:grid-cols-2 gap-4"
        >
          <h3 className="sm:col-span-2 text-lg font-bold">New Membership</h3>

          <label className="text-sm text-gray-400">
            Full name
            <input
              required
              className="mt-2 w-full field"
              value={form.member_name}
              onChange={(e) =>
                setForm({
                  ...form,
                  member_name: e.target.value,
                })
              }
            />
          </label>

          <label className="text-sm text-gray-400">
            Phone number
            <div className="mt-2">
              <PhoneNumberField
                value={form.phone}
                onChange={(phone) => setForm((current) => ({ ...current, phone }))}
              />
            </div>
          </label>

          <label className="text-sm text-gray-400">
            Package
            <select
              required
              className="mt-2 w-full field"
              value={form.package_id}
              onChange={(e) =>
                setForm({
                  ...form,
                  package_id: e.target.value,
                })
              }
            >
              <option value="">Select package</option>
              {packages.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} · ₹{p.price} · {p.daily_minutes} min/day
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-gray-400">
            Payment method
            <select
              required
              className="mt-2 w-full field"
              value={form.payment_method}
              onChange={(e) =>
                setForm({
                  ...form,
                  payment_method: e.target.value,
                })
              }
            >
              <option value="cash">Cash</option>
              <option value="upi">UPI</option>
              <option value="card">Debit / Credit Card</option>
              <option value="bank">Bank Transfer</option>
              <option value="credit">Credit</option>
            </select>
          </label>

          <div className="sm:col-span-2 flex gap-2">
            <button
              disabled={saving || !packages.length}
              className="bg-green-700 rounded-lg px-5 py-2.5 font-semibold"
            >
              {saving ? "Creating…" : "Create Membership"}
            </button>

            <button
              type="button"
              onClick={() => {
                setShow(false);
                setParams({});
              }}
              className="bg-[#262626] rounded-lg px-5 py-2.5"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4">
          <form
            onSubmit={saveEdit}
            className="w-full max-w-lg rounded-2xl border border-[#303030] bg-[#141414] p-6 space-y-4"
          >
            <div className="flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold">Edit Member</h3>
                <p className="text-sm text-gray-400 mt-1">
                  Member ID: {editing.member_id || editing.id}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setEditing(null)}
                className="text-gray-400 hover:text-white"
              >
                <X />
              </button>
            </div>

            <label className="block text-sm text-gray-400">
              Full name
              <input
                required
                className="field mt-2 w-full"
                value={editForm.member_name}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    member_name: e.target.value,
                  })
                }
              />
            </label>

            <label className="block text-sm text-gray-400">
              Phone number
              <div className="mt-2">
                <PhoneNumberField
                  value={editForm.phone}
                  onChange={(phone) =>
                    setEditForm((current) => ({ ...current, phone }))
                  }
                />
              </div>
            </label>

            <label className="block text-sm text-gray-400">
              Package
              <select
                required
                className="field mt-2 w-full"
                value={editForm.package_id}
                onChange={(e) =>
                  setEditForm({
                    ...editForm,
                    package_id: e.target.value,
                  })
                }
              >
                <option value="">Select package</option>

                {packages.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · ₹{p.price} · {p.daily_minutes} min/day
                  </option>
                ))}
              </select>
            </label>

            <div className="flex gap-2 pt-2">
              <button
                type="submit"
                className="flex-1 bg-green-700 hover:bg-green-800 rounded-lg py-3 font-semibold"
              >
                Save Changes
              </button>

              <button
                type="button"
                onClick={() => setEditing(null)}
                className="bg-[#262626] rounded-lg px-5"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />

        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search member ID, name, phone or package…"
          className="field w-full"
          style={{ paddingLeft: "40px" }}
        />
      </div>

      {/* Membership Filters */}
      <div className="flex flex-wrap gap-2">
        {filters.map((f) => {
          const selected = statusFilter === f.id;

          return (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id)}
              className={`rounded-lg px-4 py-2 text-sm font-semibold border transition-colors ${
                selected
                  ? "bg-green-700 border-green-700 text-white"
                  : "bg-[#141414] border-[#303030] text-gray-400 hover:border-gray-500 hover:text-white"
              }`}
            >
              {f.label}
              <span className="ml-2 opacity-80">{counts[f.id]}</span>
            </button>
          );
        })}
      </div>

      {/* Members Table */}
      <div className="overflow-x-auto rounded-xl border border-[#262626]">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-[#171717] text-gray-400">
            <tr>
              {[
                "Member ID",
                "Name",
                "Phone",
                "Package",
                "Start Date",
                "End Date",
                "Daily Limit",
                "Status",
                "Actions",
              ].map((x) => (
                <th key={x} className="text-left p-3 font-medium">
                  {x}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filtered.map((m) => {
              const status = getMembershipStatus(m);

              return (
                <tr key={m.id} className="border-t border-[#262626]">
                  <td className="p-3 font-mono text-xs">
                    {m.member_id || m.id}
                  </td>

                  <td className="p-3 font-medium">{m.member_name}</td>

                  <td className="p-3">{m.phone || "—"}</td>

                  <td className="p-3">{m.package_name || m.plan}</td>

                  <td className="p-3">
                    {m.activated_at
                      ? new Date(m.activated_at).toLocaleDateString("en-IN")
                      : "—"}
                  </td>

                  <td className="p-3">
                    {m.expires_at
                      ? new Date(m.expires_at).toLocaleDateString("en-IN")
                      : "—"}
                  </td>

                  <td className="p-3">{m.daily_minutes} min</td>

                  <td className="p-3">
                    <span
                      className={
                        status === "expired"
                          ? "text-amber-400"
                          : status === "expiring"
                            ? "text-orange-400"
                            : "text-green-400"
                      }
                    >
                      {status === "expired"
                        ? "EXPIRED"
                        : status === "expiring"
                          ? "EXPIRING SOON"
                          : "ACTIVE"}
                    </span>
                  </td>
                  <td className="p-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEdit(m)}
                        title="Edit member"
                        className="p-2 rounded-lg bg-[#262626] hover:bg-blue-900/40 text-blue-400"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>

                      <button
                        onClick={() => deleteMember(m)}
                        title="Deactivate member"
                        className="p-2 rounded-lg bg-[#262626] hover:bg-red-900/40 text-red-400"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {!filtered.length && (
          <p className="p-6 text-center text-gray-500">No members found.</p>
        )}
      </div>

      <style>{`
        .field {
          height: 44px;
          padding: 0 12px;
          border-radius: 9px;
          background: #0f0f0f;
          border: 1px solid #303030;
          color: white;
          outline: none;
        }

        .field:focus {
          border-color: #15803d;
        }

        .membership-phone {
          width: 100%;
          height: 44px;
        }

        .membership-phone .membership-phone-input {
          width: 100% !important;
          height: 44px !important;
          padding-left: 76px !important;
          border-radius: 9px !important;
          background: #0f0f0f !important;
          border: 1px solid #303030 !important;
          color: white !important;
          outline: none;
          box-shadow: none !important;
        }

        .membership-phone .membership-phone-input:focus {
          border-color: #15803d !important;
          box-shadow: none !important;
        }

        .membership-phone .membership-phone-button,
        .membership-phone .membership-phone-button:hover,
        .membership-phone .membership-phone-button:focus {
          width: 68px !important;
          background: #0f0f0f !important;
          border: 1px solid #303030 !important;
          border-right: 1px solid #303030 !important;
          border-radius: 9px 0 0 9px !important;
        }

        .membership-phone .selected-flag {
          width: 68px !important;
          height: 42px !important;
          padding-left: 14px !important;
          border-radius: 9px 0 0 9px !important;
        }

        .membership-phone .selected-flag:hover,
        .membership-phone .selected-flag:focus {
          background: #0f0f0f !important;
        }

        .membership-phone .membership-phone-dropdown {
          width: 300px !important;
          max-width: min(300px, calc(100vw - 40px)) !important;
          background: #171717 !important;
          color: #f5f5f5 !important;
          border: 1px solid #303030 !important;
          box-shadow: 0 12px 30px rgba(0, 0, 0, 0.45) !important;
        }

        .membership-phone .membership-phone-dropdown .country,
        .membership-phone .membership-phone-dropdown .country span,
        .membership-phone .membership-phone-dropdown .country strong {
          background-color: transparent !important;
          color: #f5f5f5 !important;
        }

        .membership-phone .membership-phone-dropdown .country:hover,
        .membership-phone .membership-phone-dropdown .country.highlight,
        .membership-phone .membership-phone-dropdown .country:hover span,
        .membership-phone .membership-phone-dropdown .country.highlight span,
        .membership-phone .membership-phone-dropdown .country:hover strong,
        .membership-phone .membership-phone-dropdown .country.highlight strong {
          background: #262626 !important;
          background-color: #262626 !important;
          color: #ffffff !important;
        }

        .membership-phone .membership-phone-dropdown .country:focus,
        .membership-phone .membership-phone-dropdown .country:active {
          background: #262626 !important;
          color: #ffffff !important;
          outline: none !important;
        }

        .membership-phone .membership-phone-dropdown .search {
          background: #171717 !important;
          padding: 10px !important;
          border-bottom: 1px solid #303030 !important;
        }

        .membership-phone .membership-phone-dropdown .search-box {
          box-sizing: border-box !important;
          width: 100% !important;
          height: 36px !important;
          background: #0f0f0f !important;
          color: #f5f5f5 !important;
          border: 1px solid #303030 !important;
          border-radius: 6px !important;
          margin: 0 !important;
          outline: none !important;
        }

        .membership-phone .membership-phone-dropdown .search-box:focus {
          border-color: #15803d !important;
          background: #0f0f0f !important;
          color: #ffffff !important;
          box-shadow: none !important;
        }

        .membership-phone .membership-phone-dropdown .search-box::placeholder {
          color: #888888 !important;
        }
      `}</style>
    </div>
  );
}
