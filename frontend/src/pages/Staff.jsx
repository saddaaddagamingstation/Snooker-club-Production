import { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import { Plus, Trash2, X, ShieldCheck, KeyRound, Check, Lock } from "lucide-react";
import { toast } from "sonner";

const PERMISSION_LABELS = {
  view_dashboard: { label: "View Dashboard", desc: "See club overview and dashboard analytics" },
  view_tables: { label: "View Tables", desc: "See snooker tables and their status" },
  manage_tables: { label: "Manage Tables", desc: "Add, edit and delete snooker tables" },
  view_ps5: { label: "View PS5", desc: "See PS5 stations, bookings and live sessions" },
  manage_ps5: { label: "Manage PS5", desc: "Create/cancel bookings and manage PS5 stations and sessions" },
  view_memberships: { label: "View Memberships", desc: "See members, packages and membership game records" },
  manage_memberships: { label: "Manage Memberships", desc: "Create and edit members, packages and membership records" },
  view_sessions: { label: "View Sessions", desc: "See active and past game sessions" },
  manage_sessions: { label: "Manage Sessions", desc: "Start, pause, resume, extend and end sessions; add snacks and frames" },
  clear_session: { label: "Clear Session", desc: "Permanently clear active sessions and their details" },
  view_snacks: { label: "View Snacks", desc: "See snacks, drinks and categories" },
  manage_snacks: { label: "Manage Snacks", desc: "Add, edit and delete snacks, drinks and categories" },
  view_food_orders: { label: "View Food Orders", desc: "See incoming and existing food orders" },
  manage_food_orders: { label: "Manage Food Orders", desc: "Create, complete, cancel and attach food orders" },
  view_expenses: { label: "View Expenses", desc: "See expenses, vendors and expense reports" },
  manage_expenses: { label: "Manage Expenses", desc: "Create, edit and delete expenses, vendors and recurring items" },
  view_revenue: { label: "View Revenue", desc: "See revenue and payment reports" },
  view_profit: { label: "View Profit", desc: "See net profit and P&L reports" },
  view_reports: { label: "View Reports", desc: "Access general operational reports" },
  view_settings: { label: "View Settings", desc: "See club settings and game pricing" },
  manage_users: { label: "Manage Users", desc: "Create, edit and delete team members" },
  manage_settings: { label: "Manage Settings", desc: "Change club-wide settings and game pricing" },
};

export default function Staff() {
  const { user, refresh } = useAuth();
  const [users, setUsers] = useState([]);
  const [modal, setModal] = useState(false);
  const [permModal, setPermModal] = useState(null);
  const [pwModal, setPwModal] = useState(null);
  const [f, setF] = useState({ name: "", email: "", password: "", role: "staff" });

  const load = async () => { const { data } = await api.get("/users"); setUsers(data); };
  useEffect(() => { load(); }, []);

  const create = async () => {
    try { await api.post("/users", f); toast.success("User created"); setModal(false); setF({ name: "", email: "", password: "", role: "staff" }); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  const remove = async (id) => {
    if (!window.confirm("Delete this user?")) return;
    try { await api.delete(`/users/${id}`); toast.success("Deleted"); load(); }
    catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  const savePermissions = async (userId, perms) => {
    try {
      await api.put(`/users/${userId}/permissions`, { permissions: perms });
      toast.success("Permissions updated · staff will see changes within seconds");
      setPermModal(null); load(); refresh?.();
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };
  const resetPassword = async (userId, newPassword) => {
    try {
      const { data } = await api.put(`/users/${userId}/password`, { password: newPassword });
      toast.success(data.message || "Password reset");
      setPwModal(null);
    } catch (e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); }
  };

  return (
    <div className="space-y-6" data-testid="staff-page">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">Team</div>
          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">Staff & Permissions</h1>
          <p className="text-gray-400 mt-2 text-sm">{users.length} member{users.length !== 1 && "s"} · configure what each staff can access</p>
        </div>
        <button data-testid="add-user-btn" onClick={() => setModal(true)} className="h-12 px-5 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"><Plus className="w-4 h-4" /> Add User</button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {users.map((u) => {
          const grantedCount = u.role === "admin" ? Object.keys(PERMISSION_LABELS).length : Object.entries(u.permissions || {}).filter(([, v]) => v).length;
          return (
            <div key={u.id} className="bg-[#141414] border border-[#262626] rounded-2xl p-5" data-testid={`user-${u.email}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-11 h-11 rounded-xl bg-[#1c1c1c] border border-[#262626] flex items-center justify-center shrink-0"><ShieldCheck className={`w-5 h-5 ${u.role === "admin" ? "text-green-400" : "text-blue-400"}`} /></div>
                  <div className="min-w-0">
                    <div className="font-bold truncate">{u.name}</div>
                    <div className="text-xs text-gray-500 truncate">{u.email}</div>
                    <div className={`text-xs mt-0.5 font-bold uppercase tracking-wider ${u.role === "admin" ? "text-green-400" : "text-blue-400"}`}>{u.role}</div>
                  </div>
                </div>
                <div className="flex gap-2 shrink-0 flex-wrap justify-end">
                  {u.role !== "admin" && (
                    <button data-testid={`edit-perms-${u.email}`} onClick={() => setPermModal(u)} className="h-9 px-3 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:border-green-700/40 text-gray-300 text-xs font-semibold flex items-center gap-1.5"><KeyRound className="w-3.5 h-3.5" /> Permissions</button>
                  )}
                  {u.id !== user.id && (
                    <button data-testid={`reset-password-${u.email}`} onClick={() => setPwModal(u)} title="Reset password" className="h-9 px-3 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:border-amber-500/40 hover:text-amber-300 text-gray-300 text-xs font-semibold flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Reset</button>
                  )}
                  {u.id !== user.id && (
                    <button data-testid={`delete-user-${u.email}`} onClick={() => remove(u.id)} className="w-9 h-9 rounded-lg bg-[#1c1c1c] border border-[#262626] hover:text-red-400 text-gray-400 flex items-center justify-center"><Trash2 className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
              <div className="mt-4 pt-4 border-t border-[#1c1c1c]">
                <div className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-2">
                  {u.role === "admin" ? "Full Access" : `Permissions · ${grantedCount}/${Object.keys(PERMISSION_LABELS).length}`}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {Object.entries(PERMISSION_LABELS).map(([k, meta]) => {
                    const has = u.role === "admin" || (u.permissions || {})[k];
                    return (
                      <span key={k} className={`text-[10px] px-2 py-1 rounded-full font-semibold border ${has ? "bg-green-500/10 border-green-500/30 text-green-400" : "bg-[#0f0f0f] border-[#262626] text-gray-600"}`}>{meta.label}</span>
                    );
                  })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setModal(false)}>
          <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-[#141414] border border-[#262626] rounded-2xl">
            <div className="flex items-center justify-between p-5 border-b border-[#262626]">
              <h3 className="text-lg font-bold">Add Team Member</h3>
              <button onClick={() => setModal(false)} className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button>
            </div>
            <form onSubmit={(e) => { e.preventDefault(); create(); }} className="p-5 space-y-3" data-testid="user-form">
              {[["Full Name", "name", "text"], ["Email", "email", "email"], ["Password", "password", "password"]].map(([label, k, type]) => (
                <div key={k}>
                  <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">{label}</div>
                  <input required type={type} value={f[k]} data-testid={`form-${k}`} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700" />
                </div>
              ))}
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Role</div>
                <select value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} data-testid="form-role" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-green-700">
                  <option value="staff">Staff</option>
                  <option value="admin">Admin</option>
                </select>
                <div className="text-xs text-gray-500 mt-1.5">Staff gets default permissions. Configure them after creation.</div>
              </div>
              <button type="submit" data-testid="user-submit" className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Create User</button>
            </form>
          </div>
        </div>
      )}

      {permModal && <PermissionsModal user={permModal} onClose={() => setPermModal(null)} onSave={(p) => savePermissions(permModal.id, p)} />}
      {pwModal && <ResetPasswordModal target={pwModal} onClose={() => setPwModal(null)} onSave={(pw) => resetPassword(pwModal.id, pw)} />}
    </div>
  );
}

function PermissionsModal({ user, onClose, onSave }) {
  const [perms, setPerms] = useState(() => {
    const init = {};
    Object.keys(PERMISSION_LABELS).forEach((k) => { init[k] = !!(user.permissions || {})[k]; });
    return init;
  });
  const manageToView = {
    manage_tables: "view_tables", manage_ps5: "view_ps5",
    manage_memberships: "view_memberships", manage_sessions: "view_sessions",
    manage_snacks: "view_snacks", manage_food_orders: "view_food_orders",
    manage_expenses: "view_expenses", manage_settings: "view_settings",
  };
  const viewToManage = Object.fromEntries(Object.entries(manageToView).map(([manage, view]) => [view, manage]));
  const toggle = (k) => setPerms((p) => {
    if (viewToManage[k] && p[viewToManage[k]]) return p;
    const next = { ...p, [k]: !p[k] };
    if (manageToView[k] && next[k]) next[manageToView[k]] = true;
    return next;
  });

  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-lg bg-[#141414] border border-[#262626] rounded-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#262626]">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2"><KeyRound className="w-4 h-4 text-green-400" /> {user.name}&apos;s Permissions</h3>
            <p className="text-xs text-gray-500 mt-1">View access is enabled by default. Manage access is disabled by default. Enabling Manage also grants View.</p>
          </div>
          <button onClick={onClose} data-testid="close-perms" className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <div className="p-5 space-y-2 max-h-[60vh] overflow-y-auto">
          {Object.entries(PERMISSION_LABELS).map(([k, meta]) => (
            <button key={k} type="button" onClick={() => toggle(k)} disabled={!!(viewToManage[k] && perms[viewToManage[k]])} data-testid={`perm-toggle-${k}`}
              className={`w-full flex items-center justify-between p-4 rounded-xl border transition-all text-left ${perms[k] ? "bg-green-700/10 border-green-700/40" : "bg-[#0f0f0f] border-[#262626] hover:border-[#333]"}`}>
              <div className="pr-3">
                <div className="font-semibold text-sm">{meta.label}</div>
                <div className="text-xs text-gray-500 mt-0.5">{meta.desc}{viewToManage[k] && perms[viewToManage[k]] ? " · Included automatically by Manage" : ""}</div>
              </div>
              <div className={`w-11 h-6 rounded-full flex items-center transition-colors shrink-0 ${perms[k] ? "bg-green-600 justify-end" : "bg-[#262626] justify-start"}`}>
                <div className="w-5 h-5 rounded-full bg-white shadow flex items-center justify-center mx-0.5">
                  {perms[k] && <Check className="w-3 h-3 text-green-700" />}
                </div>
              </div>
            </button>
          ))}
        </div>
        <div className="p-5 border-t border-[#262626] flex gap-3">
          <button onClick={onClose} className="flex-1 h-11 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-gray-300 font-medium">Cancel</button>
          <button onClick={() => onSave(perms)} data-testid="save-perms" className="flex-1 h-11 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Save Permissions</button>
        </div>
      </div>
    </div>
  );
}

function ResetPasswordModal({ target, onClose, onSave }) {
  const [pw, setPw] = useState("");
  const [confirm, setConfirm] = useState("");
  const submit = (e) => {
    e.preventDefault();
    if (pw.length < 4) return toast.error("Password must be at least 4 characters");
    if (pw !== confirm) return toast.error("Passwords do not match");
    onSave(pw);
  };
  const generate = () => {
    const rand = Math.random().toString(36).slice(2, 10);
    setPw(rand); setConfirm(rand);
    navigator.clipboard?.writeText(rand);
    toast.success("Generated & copied to clipboard");
  };
  return (
    <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center p-4" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md bg-[#141414] border border-[#262626] rounded-2xl">
        <div className="flex items-center justify-between p-5 border-b border-[#262626]">
          <div>
            <h3 className="text-lg font-bold flex items-center gap-2"><Lock className="w-4 h-4 text-amber-400" /> Reset Password</h3>
            <p className="text-xs text-gray-500 mt-1">For <span className="text-gray-300 font-semibold">{target.email}</span></p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-[#1c1c1c] flex items-center justify-center"><X className="w-4 h-4" /></button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-3" data-testid="reset-pw-form">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5 flex items-center justify-between">
              <span>New Password</span>
              <button type="button" onClick={generate} className="text-green-500 hover:text-green-400 text-[10px] normal-case tracking-normal" data-testid="pw-generate">Generate strong</button>
            </div>
            <input required minLength={4} type="text" value={pw} onChange={(e) => setPw(e.target.value)} data-testid="new-pw" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-amber-500 font-mono" placeholder="At least 4 characters" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-1.5">Confirm Password</div>
            <input required type="text" value={confirm} onChange={(e) => setConfirm(e.target.value)} data-testid="confirm-pw" className="w-full h-11 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white focus:outline-none focus:border-amber-500 font-mono" />
          </div>
          <div className="text-xs text-amber-300/80 bg-amber-500/10 border border-amber-500/20 p-3 rounded-lg">
            The staff member will need to sign in again with this new password.
          </div>
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 h-11 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-gray-300 font-medium">Cancel</button>
            <button type="submit" data-testid="save-pw" className="flex-1 h-11 rounded-xl bg-amber-600 hover:bg-amber-700 text-white font-semibold">Reset Password</button>
          </div>
        </form>
      </div>
    </div>
  );
}
