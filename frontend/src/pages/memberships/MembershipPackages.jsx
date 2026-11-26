import { useEffect, useState } from "react";
import { toast } from "sonner";
import api, { inr, formatApiErrorDetail } from "@/lib/api";

export default function MembershipPackages() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const load = async () => {
    try {
      const r = await api.get("/membership-admin/packages");
      setItems(r.data || []);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { load(); }, []);
  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs uppercase tracking-[.25em] text-green-500 font-bold mb-2">Membership configuration</p>
        <h2 className="text-3xl font-bold">Membership Packages</h2>
        <p className="text-gray-400 mt-2">Fixed PS5 membership plans. All plans are valid for 30 days and allow a maximum of 2 hours of play per day.</p>
      </div>
      {loading ? <p className="text-gray-400">Loading packages…</p> : (
        <div className="grid sm:grid-cols-2 xl:grid-cols-4 gap-4">
          {items.map((p) => (
            <div key={p.id} className="rounded-2xl border border-[#303030] bg-[#141414] p-5">
              <div className="text-sm text-green-400 font-semibold">{p.name}</div>
              <div className="text-3xl font-bold mt-2">{inr(p.price)}</div>
              <div className="text-lg font-semibold mt-1">{p.total_hours} hours</div>
              <div className="text-sm text-gray-400 mt-3 space-y-1">
                <div>30-day validity</div><div>Maximum 2 hours/day</div><div>PS5 only</div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="rounded-xl border border-amber-700/30 bg-amber-900/10 p-4 text-sm text-gray-300">
        Package balances are consumed by actual PS5 membership play time. Unused hours expire after 30 days. The daily 2-hour cap and total purchased-hour balance are enforced independently.
      </div>
    </div>
  );
}
