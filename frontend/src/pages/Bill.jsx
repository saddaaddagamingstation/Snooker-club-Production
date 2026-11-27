import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import api, { inr } from "@/lib/api";
import {
  Printer,
  Download,
  MessageCircle,
  ArrowLeft,
  Circle,
} from "lucide-react";
import html2pdf from "html2pdf.js";

export default function Bill() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [s, setS] = useState(null);
  const [club, setClub] = useState("Sadda Adda Snooker");
  const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
  const [customerPhone, setCustomerPhone] = useState("");

  useEffect(() => {
    api.get(`/sessions/${id}`).then((r) => setS(r.data));
    api
      .get("/club")
      .then((r) => setClub(r.data.name))
      .catch(() => {});
  }, [id]);

  if (!s) return <div className="text-gray-400">Loading…</div>;
  const hours = Math.floor(s.duration_minutes / 60);
  const minutes = s.duration_minutes % 60;
  const gameTypeLabel = {
    snooker: "Snooker",
    mini_snooker: "Mini Snooker",
    pool: "Pool",
    ps5: "PS5",
  }[String(s.game_type || "").toLowerCase()] || s.game_type || "Game";

  const rdAmount = s.rd_selected
    ? Number(s.rd_amount ?? s.pricing_snapshot?.rd_price ?? 0)
    : 0;
  const tableChargeDisplay = s.game_timer_enabled
    ? Math.max(0, Number(s.table_amount || 0) - rdAmount)
    : Number(s.table_amount || 0);

  const billingTypeLabel =
    s.billing_type === "membership"
      ? `Membership${s.membership_plan ? ` · ${s.membership_plan}` : ""}`
      : "Regular";

  const playerCountLabel =
    Number(s.player_count) > 0 ? `${s.player_count} player${Number(s.player_count) === 1 ? "" : "s"}` : null;

  const groupedSnacks = Object.values(
    (s.snacks || []).reduce((acc, item) => {
      const key = item.name;

      if (!acc[key]) {
        acc[key] = {
          ...item,
          quantity: Number(item.quantity || 1),
          subtotal: Number(item.subtotal || item.price),
        };
      } else {
        acc[key].quantity += Number(item.quantity || 1);
        acc[key].subtotal += Number(item.subtotal || item.price);
      }

      return acc;
    }, {}),
  );

  const downloadInvoicePdf = async () => {
    const element = document.getElementById("printable-bill");

    if (!element) {
      alert("Invoice not found.");
      return;
    }

    const invoiceNumber = String(s.invoice_no || id).replace(
      /[^a-zA-Z0-9_-]/g,
      "_",
    );
    const filename = `${invoiceNumber}.pdf`;

    try {
      await html2pdf()
        .set({
          margin: [4, 4, 4, 4],
          filename,
          image: {
            type: "jpeg",
            quality: 0.98,
          },
          html2canvas: {
            scale: 2,
            useCORS: true,
            backgroundColor: "#ffffff",
            onclone: (clonedDoc) => {
              const clonedBill = clonedDoc.getElementById("printable-bill");

              if (!clonedBill) return;

              const compactPrintStyle = clonedDoc.createElement("style");
              compactPrintStyle.textContent = `
                @page { size: A4 portrait; margin: 4mm !important; }
                #printable-bill {
                  box-sizing: border-box !important;
                  width: 100% !important;
                  max-width: 100% !important;
                  padding: 6mm !important;
                  border-radius: 0 !important;
                  font-size: 10px !important;
                  line-height: 1.2 !important;
                }
                #printable-bill .text-2xl { font-size: 18px !important; line-height: 1.2 !important; }
                #printable-bill .text-4xl { font-size: 25px !important; line-height: 1.1 !important; }
                #printable-bill .pb-6 { padding-bottom: 8px !important; }
                #printable-bill .py-6 { padding-top: 8px !important; padding-bottom: 8px !important; }
                #printable-bill .pt-4 { padding-top: 8px !important; }
                #printable-bill .mt-8 { margin-top: 8px !important; }
                #printable-bill .mt-2 { margin-top: 3px !important; }
                #printable-bill .gap-6 { gap: 8px !important; }
                #printable-bill .gap-3 { gap: 8px !important; }
                #printable-bill .space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 4px !important; }
                #printable-bill .space-y-1.5 > :not([hidden]) ~ :not([hidden]) { margin-top: 3px !important; }
                #printable-bill th { padding-bottom: 4px !important; }
                #printable-bill td { padding-top: 4px !important; padding-bottom: 4px !important; }
                #printable-bill tr { break-inside: avoid !important; page-break-inside: avoid !important; }
                #printable-bill table { font-size: 10px !important; }
              `;
              clonedDoc.head.appendChild(compactPrintStyle);

              const forceStyle = (element, property, value) => {
                element.style.setProperty(property, value, "important");
              };

              forceStyle(clonedBill, "background-color", "#ffffff");
              forceStyle(clonedBill, "color", "#000000");
              forceStyle(clonedBill, "opacity", "1");
              forceStyle(clonedBill, "animation", "none");
              forceStyle(clonedBill, "transform", "none");
              forceStyle(clonedBill, "box-shadow", "none");

              clonedBill.querySelectorAll("*").forEach((el) => {
                forceStyle(el, "background-color", "#ffffff");
                forceStyle(el, "color", "#000000");
                forceStyle(el, "border-color", "#dddddd");
                forceStyle(el, "opacity", "1");
                forceStyle(el, "animation", "none");
                forceStyle(el, "text-shadow", "none");
              });
            },
          },
          jsPDF: {
            unit: "mm",
            format: "a4",
            orientation: "portrait",
          },
        })
        .from(element)
        .save();
    } catch (error) {
      console.error("Invoice PDF generation failed:", error);
      alert("Could not generate the invoice PDF. Please try again.");
    }
  };

  const shareWA = () => {
    setCustomerPhone("");
    setShowWhatsAppModal(true);
  };

  const sendWhatsAppBill = () => {
    const phone = customerPhone.replace(/\D/g, "");

    if (phone.length !== 10) {
      alert("Enter a valid 10-digit mobile number.");
      return;
    }

    const message = `Hello! Thank you for visiting ${club}. Your invoice ${s.invoice_no} is ready. Please find your bill attached.`;

    const whatsappUrl = `https://wa.me/91${phone}?text=${encodeURIComponent(message)}`;

    const whatsappWindow = window.open(whatsappUrl, "_blank");

    if (!whatsappWindow) {
      alert("Please allow popups for CUE OPS.");
      return;
    }

    setShowWhatsAppModal(false);
    window.print();
  };

  return (
    <div className="space-y-6 max-w-3xl mx-auto" data-testid="bill-page">
      <style>{`
        @page { size: A4 portrait; margin: 4mm; }
        @media print {
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          body { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
          [data-testid="bill-page"] { display: block !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 !important; }
          [data-testid="bill-page"] > :not(#printable-bill) { display: none !important; }
          #printable-bill {
            box-sizing: border-box !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 6mm !important;
            margin: 0 !important;
            border: 1px solid #ddd !important;
            border-radius: 0 !important;
            box-shadow: none !important;
            font-size: 10px !important;
            line-height: 1.2 !important;
            break-inside: avoid !important;
            page-break-inside: avoid !important;
          }
          #printable-bill .text-2xl { font-size: 18px !important; line-height: 1.2 !important; }
          #printable-bill .text-4xl { font-size: 25px !important; line-height: 1.1 !important; }
          #printable-bill .pb-6 { padding-bottom: 8px !important; }
          #printable-bill .py-6 { padding-top: 8px !important; padding-bottom: 8px !important; }
          #printable-bill .pt-4 { padding-top: 8px !important; }
          #printable-bill .mt-8 { margin-top: 8px !important; }
          #printable-bill .mt-2 { margin-top: 3px !important; }
          #printable-bill .gap-6 { gap: 8px !important; }
          #printable-bill .gap-3 { gap: 8px !important; }
          #printable-bill .space-y-2 > :not([hidden]) ~ :not([hidden]) { margin-top: 4px !important; }
          #printable-bill .space-y-1.5 > :not([hidden]) ~ :not([hidden]) { margin-top: 3px !important; }
          #printable-bill th { padding-bottom: 4px !important; }
          #printable-bill td { padding-top: 4px !important; padding-bottom: 4px !important; }
          #printable-bill tr { break-inside: avoid !important; page-break-inside: avoid !important; }
          #printable-bill table { font-size: 10px !important; }
        }
      `}</style>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <button
          onClick={() => navigate(-1)}
          className="h-11 px-4 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white flex items-center gap-2"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex gap-2 flex-wrap">
          <button
            onClick={() => window.print()}
            data-testid="print-bill"
            className="h-11 px-4 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white flex items-center gap-2"
          >
            <Printer className="w-4 h-4" /> Print
          </button>
          <button
            onClick={() => {
              const invoiceNumber = String(s.invoice_no || id).replace(
                /[^a-zA-Z0-9_-]/g,
                "_",
              );

              const originalTitle = document.title;
              document.title = invoiceNumber;

              window.print();

              setTimeout(() => {
                document.title = originalTitle;
              }, 1000);
            }}
            data-testid="download-pdf"
            className="h-11 px-4 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] border border-[#262626] text-white flex items-center gap-2"
          >
            <Download className="w-4 h-4" /> PDF
          </button>
          <button
            onClick={shareWA}
            data-testid="share-whatsapp"
            className="h-11 px-4 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center gap-2"
          >
            <MessageCircle className="w-4 h-4" /> WhatsApp
          </button>
        </div>
      </div>

      <div
        id="printable-bill"
        className="bg-[#141414] border border-[#262626] rounded-2xl p-8 fade-up"
      >
        <div className="flex items-start justify-between border-b border-[#262626] pb-6">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-700 flex items-center justify-center">
              <Circle className="w-6 h-6 fill-white/20" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold">
                Tax Invoice
              </div>
              <div className="text-2xl font-bold tracking-tight">{club}</div>
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
              Invoice No
            </div>
            <div className="font-mono font-bold">{s.invoice_no}</div>
            <div className="text-xs text-gray-500 mt-2">
              {new Date(s.ended_at).toLocaleString()}
            </div>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-6 py-6 border-b border-[#262626]">
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
              Customer
            </div>
            <div className="font-semibold mt-1">
              {s.customer_name || "Walk-in"}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
              Table
            </div>
            <div className="font-semibold mt-1">
              {s.table_number} · {s.table?.table_name}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
              Start
            </div>
            <div className="font-mono text-sm mt-1">
              {new Date(s.start_time).toLocaleString()}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
              End
            </div>
            <div className="font-mono text-sm mt-1">
              {new Date(s.end_time).toLocaleString()}
            </div>
          </div>

          <div>
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
              Game
            </div>
            <div className="font-semibold mt-1">{gameTypeLabel}</div>
          </div>
          <div className="text-right">
            <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
              Billing
            </div>
            <div className="font-semibold mt-1">{billingTypeLabel}</div>
          </div>
          {playerCountLabel && (
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
                Players
              </div>
              <div className="font-semibold mt-1">{playerCountLabel}</div>
            </div>
          )}
          {s.rd_selected && (
            <div className="text-right">
              <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
                R.D.
              </div>
              <div className="font-semibold mt-1 text-green-400">Selected</div>
            </div>
          )}
        </div>

        <div className="py-6 border-b border-[#262626]">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wider text-gray-500 font-bold">
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Rate</th>
                <th className="pb-2 text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t border-[#262626]">
                <td className="py-2.5">
                  Table {s.table_number} · Game session
                  {s.billing_type === "membership" ? " (Membership)" : ""}
                </td>
                <td className="py-2.5 text-right font-mono">
                  {hours}h {minutes}m
                </td>
                <td className="py-2.5 text-right font-mono">
                  Session charge
                </td>
                <td className="py-2.5 text-right font-mono font-bold">
                  {inr(tableChargeDisplay)}
                </td>
              </tr>
              {groupedSnacks.map((it, i) => (
                <tr key={`sn-${i}`} className="border-t border-[#262626]">
                  <td className="py-2.5">{it.name}</td>
                  <td className="py-2.5 text-right font-mono">{it.quantity}</td>
                  <td className="py-2.5 text-right font-mono">
                    {inr(it.price)}
                  </td>
                  <td className="py-2.5 text-right font-mono font-bold">
                    {inr(it.subtotal)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="py-6 space-y-2 text-sm">
          <div data-testid="bill-table-charge">
            <Row label="Table Charge" value={inr(tableChargeDisplay)} />
          </div>
          {s.rd_selected && (
            <div data-testid="bill-rd-charge">
              <Row label="R.D. Add-on" value={inr(rdAmount)} />
            </div>
          )}
          <Row label="Snacks Total" value={inr(s.snacks_amount)} />
          <Row label="Discount" value={`- ${inr(s.discount)}`} />
          <Row label={`Tax (${s.tax_percent}%)`} value={inr(s.tax_amount)} />
        </div>
        {s.payments && s.payments.length > 0 && (
          <div className="border-t border-[#262626] pt-4 pb-2">
            <div className="text-xs uppercase tracking-[0.2em] text-gray-500 font-bold mb-2">
              Payment Details
            </div>
            <div className="space-y-1.5 text-sm">
              {s.payments.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <span className="text-gray-300 uppercase tracking-wider text-xs font-bold">
                    {p.method}
                  </span>
                  <span className="font-mono">{inr(p.amount)}</span>
                </div>
              ))}
              <div className="flex items-center justify-between pt-2 mt-2 border-t border-[#262626]">
                <span className="text-green-400 uppercase tracking-wider text-xs font-bold">
                  Status
                </span>
                <span className="text-green-400 font-bold text-xs uppercase tracking-wider">
                  Paid
                </span>
              </div>
            </div>
          </div>
        )}
        {(s.payment_notes || s.ended_by_name) && (
          <div className="border-t border-[#262626] pt-4 pb-2 space-y-2 text-sm">
            {s.payment_notes && (
              <Row label="Payment Note" value={s.payment_notes} />
            )}
            {s.ended_by_name && (
              <Row label="Processed By" value={s.ended_by_name} />
            )}
          </div>
        )}
        <div className="pt-4 border-t border-[#262626] flex items-center justify-between">
          <div className="text-sm uppercase tracking-[0.2em] font-bold text-gray-400">
            Grand Total
          </div>
          <div
            className="text-4xl font-bold font-mono text-green-400"
            data-testid="bill-grand-total"
          >
            {inr(s.grand_total)}
          </div>
        </div>
        <div className="mt-8 text-center text-xs text-gray-500">
          Thank you for playing at {club}. Rack 'em up again soon.
        </div>
      </div>

      {/* WhatsApp Number Popup */}
      {showWhatsAppModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div className="w-full max-w-md rounded-2xl border border-[#303030] bg-[#141414] p-6 shadow-2xl">
            <div className="mb-5">
              <h2 className="text-xl font-bold text-white">
                Send Bill on WhatsApp
              </h2>
              <p className="mt-1 text-sm text-gray-400">
                Enter the customer's WhatsApp number.
              </p>
            </div>

            <label className="mb-2 block text-sm font-medium text-gray-300">
              Mobile Number
            </label>

            <div className="flex gap-2">
              <div className="flex h-12 items-center gap-2 rounded-xl border border-[#333] bg-[#1c1c1c] px-3 text-white">
                <span>🇮🇳</span>
                <span className="font-semibold">+91</span>
              </div>

              <input
                type="tel"
                inputMode="numeric"
                autoFocus
                maxLength={10}
                placeholder="Enter 10-digit number"
                value={customerPhone}
                onChange={(e) =>
                  setCustomerPhone(
                    e.target.value.replace(/\D/g, "").slice(0, 10),
                  )
                }
                className="h-12 min-w-0 flex-1 rounded-xl border border-[#333] bg-[#1c1c1c] px-4 text-white outline-none focus:border-green-600"
              />
            </div>

            <p className="mt-2 text-xs text-gray-500">
              {customerPhone.length}/10 digits
            </p>

            <div className="mt-6 flex gap-3">
              <button
                type="button"
                onClick={() => setShowWhatsAppModal(false)}
                className="h-11 flex-1 rounded-xl border border-[#333] text-gray-300 hover:bg-[#222]"
              >
                Cancel
              </button>

              <button
                type="button"
                onClick={sendWhatsAppBill}
                disabled={customerPhone.length !== 10}
                className="h-11 flex-1 rounded-xl bg-green-700 font-semibold text-white hover:bg-green-800 disabled:cursor-not-allowed disabled:opacity-40"
              >
                Send Bill
              </button>
            </div>
          </div>
        </div>
      )}
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
