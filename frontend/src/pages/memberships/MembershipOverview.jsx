import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Users, UserCheck, UserX, IndianRupee, Plus, Clock3 } from "lucide-react";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import { toast } from "sonner";

export default function MembershipOverview() {
  const [data,setData] = useState(null);
  const load = async () => { try { const r=await api.get("/membership-admin/overview"); setData(r.data); } catch(e) { toast.error(formatApiErrorDetail(e.response?.data?.detail)); } };
  useEffect(()=>{load();},[]);
  const cards = data ? [
    ["Total Members",data.total_members,Users,"text-white"],
    ["Active Members",data.active_members,UserCheck,"text-green-400"],
    ["Expired Members",data.expired_members,UserX,"text-amber-400"],
    ["New Membership Value",inr(data.monthly_collection),IndianRupee,"text-green-400"],
  ] : [];
  return <div className="space-y-7">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-xs uppercase tracking-[.25em] text-green-500 font-bold mb-2">Overview</p><h2 className="text-3xl font-bold">Membership Dashboard</h2><p className="text-gray-400 mt-2">Track members, packages and daily play activity.</p></div><Link to="/memberships/members?add=1" className="inline-flex items-center gap-2 rounded-lg bg-green-700 hover:bg-green-800 px-4 py-3 font-semibold"><Plus className="w-4 h-4"/> Add Member</Link></div>
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">{cards.map(([label,value,Icon,color])=><div key={label} className="rounded-2xl border border-[#262626] bg-[#141414] p-5"><div className="flex justify-between items-center"><span className="text-xs text-gray-500 uppercase tracking-wider font-bold">{label}</span><Icon className={`w-5 h-5 ${color}`}/></div><div className={`text-3xl font-bold mt-4 ${color}`}>{value}</div></div>)}</div>
    <div className="grid grid-cols-1 xl:grid-cols-2 gap-5"><section className="rounded-2xl border border-[#262626] bg-[#141414] p-5"><h3 className="font-bold text-lg mb-4">Recently Added Members</h3>{(data?.recent_members||[]).length ? data.recent_members.map(m=><div key={m.id} className="flex justify-between gap-3 py-3 border-t border-[#262626]"><div><div className="font-medium">{m.member_name}</div><div className="text-xs text-gray-500">{m.member_id || m.id} · {m.package_name || m.plan}</div></div><div className="text-xs text-gray-400">{m.activated_at ? new Date(m.activated_at).toLocaleDateString("en-IN") : "—"}</div></div>) : <p className="text-sm text-gray-500">No members yet.</p>}</section>
    <section className="rounded-2xl border border-[#262626] bg-[#141414] p-5"><h3 className="font-bold text-lg mb-4 flex items-center gap-2"><Clock3 className="w-4 h-4 text-amber-400"/> Expiring Soon</h3>{(data?.expiring_soon||[]).length ? data.expiring_soon.map(m=><div key={m.id} className="flex justify-between gap-3 py-3 border-t border-[#262626]"><div><div className="font-medium">{m.member_name}</div><div className="text-xs text-gray-500">{m.phone || "No phone"}</div></div><div className="text-xs text-amber-400">{new Date(m.expires_at).toLocaleDateString("en-IN")}</div></div>) : <p className="text-sm text-gray-500">No memberships expiring in the next 7 days.</p>}</section></div>
  </div>;
}
