import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { inr, inrRounded } from "@/lib/api";
import { Printer, Download, MessageCircle, ArrowLeft, Circle } from "lucide-react";

export default function Bill() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  const [club, setClub] = useState("Cue Lounge");

  useEffect(() => {
    api.get(`/sessions/${id}`).then((r) => setS(r.data));
    api.get("/club").then((r) => setClub(r.data.name)).catch(() => {});
  }, [id]);

  if (!s) return <div className="text-gray-400">Loading…</div>;
  const hours = Math.floor(s.duration_minutes / 60);
  const minutes = s.duration_minutes % 60;

  const shareWA = () => {
    const frameLines = (s.frames || []).map((f) => `  Frame ${f.frame_number} · ${f.duration_minutes}m · ${inr(f.amount || 0)}`);
    const payLines = (s.payments || []).map((p) => `  ${p.method.toUpperCase()}: ${inr(p.amount)}`);
    const lines = [
      `*${club}*`,
      `Invoice: ${s.invoice_no}`,
      `Date: ${new Date(s.ended_at).toLocaleString()}`,
      `Customer: ${s.customer_name || "Walk-in"}`,
      `Table: ${s.table_number} · ${s.duration_minutes} min @ ${inr(s.rate_used)}/hr`,
      ...(frameLines.length ? ["", "Frame Charges:", ...frameLines] : []),
      `Table charge: ${inr(s.table_amount)}`,
      `Snacks: ${inr(s.snacks_amount)}`,
      `Discount: ${inr(s.discount)} | Tax: ${inr(s.tax_amount)}`,
      `*Grand Total: ${inrRounded(s.grand_total)}*`,
      ...(payLines.length ? ["", "Payment:", ...payLines, "Status: PAID"] : []),
    ];
    window.open(`https://wa.me/?text=${encodeURIComponent(lines.join("\n"))}`, "_blank");
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto" data-testid="bill-page">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button onClick={() => navigate(-1)} className="h-11 px-4 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white flex items-center gap-2"><ArrowLeft className="w-4 h-4" /> Back</button>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => window.print()} data-testid="print-bill" className="h-11 px-4 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white flex items-center gap-2"><Printer className="w-4 h-4" /> Print</button>
          <button onClick={() => window.print()} data-testid="download-pdf" className="h-11 px-4 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white flex items-center gap-2"><Download className="w-4 h-4" /> PDF</button>
          <button onClick={shareWA} data-testid="share-whatsapp" className="h-11 px-4 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"><MessageCircle className="w-4 h-4" /> WhatsApp</button>
        </div>
      </div>

      <div id="printable-bill" className="bg-[#141414] border border-[#262626] rounded-2xl p-8 fade-up">
        <div className="flex items-start justify-between border-b border-[#262626] pb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-700 flex items-center justify-center">
              <Circle className="w-6 h-6 fill-white/20" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold">Tax Invoice</div>
              <div className="text-2xl font-bold tracking-tight">{club}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Invoice No</div>
            <div className="font-mono font-bold">{s.invoice_no}</div>
            <div className="text-xs text-gray-500 mt-2">{new Date(s.ended_at).toLocaleString()}</div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 py-6 border-b border-[#262626]">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Customer</div>
            <div className="font-semibold mt-1">{s.customer_name || "Walk-in"}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Table</div>
            <div className="font-semibold mt-1">{s.table_number} · {s.table?.table_name}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">Start</div>
            <div className="font-mono text-sm mt-1">{new Date(s.start_time).toLocaleString()}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">End</div>
            <div className="font-mono text-sm mt-1">{new Date(s.end_time).toLocaleString()}</div>
          </div>
        </div>

        <div className="py-6 border-b border-[#262626]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 font-bold">
                <th className="pb-2">Description</th><th className="pb-2 text-right">Qty</th><th className="pb-2 text-right">Rate</th><th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(s.frames || []).map((f) => (
                <tr key={f.id} className="border-t border-[#262626]">
                  <td className="py-2.5">Frame {f.frame_number}{f.winner && <span className="text-gray-500 text-xs"> · {f.winner} beat {f.loser}</span>}</td>
                  <td className="py-2.5 text-right font-mono">{f.duration_minutes}m</td>
                  <td className="py-2.5 text-right font-mono">{inr(s.rate_used)}/hr</td>
                  <td className="py-2.5 text-right font-mono font-bold">{inr(f.amount || 0)}</td>
                </tr>
              ))}
              {(!s.frames || s.frames.length === 0) && (
                <tr className="border-t border-[#262626]">
                  <td className="py-2.5">Table {s.table_number} · {hours}h {minutes}m</td>
                  <td className="py-2.5 text-right font-mono">1</td>
                  <td className="py-2.5 text-right font-mono">{inr(s.rate_used)}/hr</td>
                  <td className="py-2.5 text-right font-mono font-bold">{inr(s.table_amount)}</td>
                </tr>
              )}
              {s.snacks?.map((it, i) => (
                <tr key={`sn-${i}`} className="border-t border-[#262626]">
                  <td className="py-2.5">{it.name}</td>
                  <td className="py-2.5 text-right font-mono">{it.quantity}</td>
                  <td className="py-2.5 text-right font-mono">{inr(it.price)}</td>
                  <td className="py-2.5 text-right font-mono font-bold">{inr(it.subtotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="py-6 space-y-2 text-sm">
          <div data-testid="bill-table-charge"><Row label="Table Charge" value={inr(s.table_amount)} /></div>
          <Row label="Snacks Total" value={inr(s.snacks_amount)} />
          <Row label="Discount" value={`- ${inr(s.discount)}`} />
          <Row label={`Tax (${s.tax_percent}%)`} value={inr(s.tax_amount)} />
        </div>
        {s.payments && s.payments.length > 0 && (
          <div className="border-t border-[#262626] pt-4 pb-2">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold mb-2">Payment Details</div>
            <div className="space-y-1.5 text-sm">
              {s.payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-300 uppercase tracking-wider text-xs font-bold">{p.method}</span>
                  <span className="font-mono">{inr(p.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-[#262626]">
                <span className="text-green-400 uppercase tracking-wider text-xs font-bold">Status</span>
                <span className="text-green-400 font-bold text-xs uppercase tracking-wider">Paid</span>
              </div>
            </div>
          </div>
        )}
        <div className="pt-4 border-t border-[#262626] flex items-center justify-between">
          <div className="text-sm uppercase tracking-[0.2em] font-bold text-gray-400">Grand Total</div>
          <div className="text-4xl font-bold font-mono text-green-400" data-testid="bill-grand-total">{inrRounded(s.grand_total)}</div>
        </div>
        <div className="mt-8 text-center text-xs text-gray-500">Thank you for playing at {club}. Rack 'em up again soon.</div>
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-gray-400">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
