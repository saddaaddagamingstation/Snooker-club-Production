
import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { toast } from "sonner";
import api, { formatApiErrorDetail } from "@/lib/api";

export default function MembershipGameRecords() {
  const [rows, setRows] = useState([]);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api
      .get("/membership-admin/game-records")
      .then((r) => setRows(r.data || []))
      .catch((e) =>
        toast.error(
          formatApiErrorDetail(e.response?.data?.detail)
        )
      );
  }, []);

  const filtered = rows.filter((x) =>
    `${x.member_name || ""} ${x.member_id || ""} ${x.table_number || ""} ${x.plan || ""}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );

  const columns = [
    { label: "Date", width: "10%" },
    { label: "Member", width: "14%" },
    { label: "Member ID", width: "12%" },
    { label: "Package", width: "12%" },
    { label: "Table", width: "8%" },
    { label: "Start", width: "11%" },
    { label: "End", width: "11%" },
    { label: "Duration", width: "10%" },
    { label: "Status", width: "12%" },
  ];

  return (
    <div className="w-full min-w-0 space-y-6">

      {/* Page Header */}
      <div>
        <p className="text-xs uppercase tracking-[.25em] text-green-500 font-bold mb-2">
          Usage History
        </p>

        <h2 className="text-3xl font-bold tracking-tight">
          Game Records
        </h2>

        <p className="text-gray-400 mt-2 text-sm">
          Membership sessions and table-play history.
        </p>
      </div>

      {/* Search Bar */}
      <div className="relative w-full">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500 pointer-events-none" />

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search member, ID or table..."
          className="!w-full !h-11 !pl-10 !pr-4 !bg-[#111111] !border !border-[#262626] !rounded-lg !text-sm !text-white placeholder:!text-gray-500 outline-none focus:!border-green-700 focus:!ring-1 focus:!ring-green-700/30 transition-colors"
        />
      </div>

      {/* Records Table */}
      <div className="w-full min-w-0 overflow-hidden rounded-xl border border-[#262626] bg-[#0d0d0d]">

        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[1050px] table-fixed text-sm">

            <colgroup>
              {columns.map((col) => (
                <col key={col.label} style={{ width: col.width }} />
              ))}
            </colgroup>

            <thead className="bg-[#171717]">
              <tr>
                {columns.map((col) => (
                  <th
                    key={col.label}
                    className="px-3.5 py-4 text-left text-xs font-semibold text-gray-400 whitespace-nowrap border-b border-[#262626]"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>
              {filtered.map((r) => (
                <tr
                  key={r.id}
                  className="border-b border-[#202020] last:border-0 hover:bg-[#151515] transition-colors"
                >
                  <td className="px-3.5 py-4 text-gray-400 whitespace-nowrap">
                    {r.start_time
                      ? new Date(r.start_time).toLocaleDateString("en-IN")
                      : "—"}
                  </td>

                  <td className="px-3.5 py-4 font-medium text-gray-200 truncate">
                    {r.member_name || "—"}
                  </td>

                  <td className="px-3.5 py-4 font-mono text-xs text-gray-400 truncate">
                    {r.member_id || "—"}
                  </td>

                  <td className="px-3.5 py-4 text-gray-300 truncate">
                    {r.plan || "—"}
                  </td>

                  <td className="px-3.5 py-4 text-gray-300 whitespace-nowrap">
                    {r.table_number || "—"}
                  </td>

                  <td className="px-3.5 py-4 text-gray-400 whitespace-nowrap">
                    {r.start_time
                      ? new Date(r.start_time).toLocaleTimeString("en-IN")
                      : "—"}
                  </td>

                  <td className="px-3.5 py-4 text-gray-400 whitespace-nowrap">
                    {r.end_time
                      ? new Date(r.end_time).toLocaleTimeString("en-IN")
                      : "Active"}
                  </td>

                  <td className="px-3.5 py-4 text-gray-300 whitespace-nowrap">
                    {r.duration_minutes || 0} min
                  </td>

                  <td className="px-3.5 py-4 whitespace-nowrap">
                    <span
                      className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
                        r.status === "active"
                          ? "bg-green-500/10 text-green-400"
                          : "bg-gray-500/10 text-gray-400"
                      }`}
                    >
                      {r.status || "—"}
                    </span>

                    {r.membership_exhausted && (
                      <span className="block text-[10px] text-orange-400 mt-1">
                        Limit reached
                      </span>
                    )}
                  </td>
                </tr>
              ))}

              {!filtered.length && (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-12 text-center text-sm text-gray-500"
                  >
                    {search
                      ? "No matching game records found."
                      : "No membership game records found."}
                  </td>
                </tr>
              )}
            </tbody>

          </table>
        </div>

        {/* Table Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[#262626] bg-[#111111]">
          <p className="text-xs text-gray-500">
            Showing {filtered.length} of {rows.length} records
          </p>

          <p className="text-xs text-gray-500">
            Game Records
          </p>
        </div>

      </div>
    </div>
  );
}
