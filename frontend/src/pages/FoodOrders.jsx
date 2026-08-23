import { useEffect, useState } from "react";
import { Play, RefreshCw, Trash2, UtensilsCrossed } from "lucide-react";
import { useNavigate } from "react-router-dom";
import api, { inr, formatApiErrorDetail } from "@/lib/api";
import { toast } from "sonner";

export default function FoodOrders() {
  const navigate = useNavigate();

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [checkoutOrder, setCheckoutOrder] = useState(null);
  const [discount, setDiscount] = useState(0);
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [saving, setSaving] = useState(false);

  const loadOrders = async () => {
    try {
      setLoading(true);

      const { data } = await api.get("/food-orders/pending");

      setOrders(data);
    } catch (e) {
      toast.error(
        formatApiErrorDetail(e.response?.data?.detail)
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();

    const interval = setInterval(loadOrders, 10000);

    return () => clearInterval(interval);
  }, []);

  const cancelOrder = async (id) => {
    if (!window.confirm("Cancel this food order?")) {
      return;
    }

    try {
      await api.delete(`/food-orders/${id}`);

      toast.success("Food order cancelled");

      loadOrders();
    } catch (e) {
      toast.error(
        formatApiErrorDetail(e.response?.data?.detail)
      );
    }
  };

  const completeFoodOnly = async () => {
  if (!checkoutOrder) return;

  try {
    setSaving(true);

    const { data } = await api.post(
      `/food-orders/${checkoutOrder.id}/complete`,
      {
        discount: Number(discount) || 0,
        payment_method: paymentMethod,
      }
    );

    toast.success(
      `Sale completed · ${inr(data.final_total)}`
    );

    setCheckoutOrder(null);
    setDiscount(0);
    setPaymentMethod("UPI");

    loadOrders();
  } catch (e) {
    toast.error(
      formatApiErrorDetail(e.response?.data?.detail)
    );
  } finally {
    setSaving(false);
  }
};

  return (
    <>
    <div className="space-y-6" data-testid="food-orders-page">

      {/* Header */}
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-2">
            Food & Drinks
          </div>

          <h1 className="text-3xl sm:text-4xl font-bold tracking-tight">
            Pending Orders
          </h1>

          <p className="text-gray-400 mt-2 text-sm">
            Food orders waiting to be attached to a table.
          </p>
        </div>

        <button
          onClick={loadOrders}
          className="w-10 h-10 rounded-xl bg-[#141414] border border-[#262626] hover:bg-[#1c1c1c] flex items-center justify-center"
          title="Refresh"
        >
          <RefreshCw
            className={`w-4 h-4 ${
              loading ? "animate-spin" : ""
            }`}
          />
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

        <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
            Pending Orders
          </div>

          <div className="text-3xl font-bold mt-2">
            {orders.length}
          </div>
        </div>

        <div className="bg-[#141414] border border-[#262626] rounded-2xl p-5">
          <div className="text-xs uppercase tracking-wider text-gray-500 font-bold">
            Pending Food Value
          </div>

          <div className="text-3xl font-bold text-green-400 mt-2">
            {inr(
              orders.reduce(
                (sum, order) => sum + Number(order.total || 0),
                0
              )
            )}
          </div>
        </div>

      </div>

      {/* Orders */}
      <div className="bg-[#141414] border border-[#262626] rounded-2xl overflow-hidden">

        <div className="px-5 py-4 border-b border-[#262626] flex items-center justify-between">
          <div className="font-semibold">
            Orders Waiting for a Table
          </div>

          <div className="text-xs text-gray-500">
            Auto-refreshes every 10 seconds
          </div>
        </div>

        {orders.length === 0 ? (
          <div className="p-14 text-center">
            <div className="text-gray-500">
              No pending food orders
            </div>

            <div className="text-sm text-gray-600 mt-1">
              New food orders will appear here.
            </div>
          </div>
        ) : (
          <div className="divide-y divide-[#262626]">

            {orders.map((order) => (
              <div
                key={order.id}
                className="px-5 py-5 hover:bg-[#181818] transition-colors"
              >

                <div className="flex flex-col lg:flex-row lg:items-center gap-5">

                  {/* Customer */}
                  <div className="lg:w-48 shrink-0">

                    <div className="font-semibold">
                      {order.customer_name || "Walk-in Customer"}
                    </div>

                    <div className="text-[11px] text-gray-600 font-mono mt-1">
                      #{order.id.slice(0, 8)}
                    </div>

                    {order.created_at && (
                      <div className="text-xs text-gray-600 mt-2">
                        {new Date(
                          order.created_at
                        ).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    )}

                  </div>

                  {/* Items */}
                  <div className="flex-1 flex flex-wrap gap-2">

                    {order.items?.map((item, index) => (
                      <div
                        key={`${order.id}-${index}`}
                        className="px-3 py-2 rounded-lg bg-[#0f0f0f] border border-[#262626]"
                      >
                        <div className="text-sm">
                          {item.name}
                        </div>

                        <div className="text-xs text-gray-500">
                          × {item.quantity}
                        </div>
                      </div>
                    ))}

                  </div>

                  {/* Total */}
                  <div className="lg:w-24 shrink-0">

                    <div className="text-xs text-gray-600 uppercase tracking-wider">
                      Total
                    </div>

                    <div className="text-xl font-bold text-green-400 mt-1">
                      {inr(order.total)}
                    </div>

                  </div>

                  {/* Actions */}
<div className="flex gap-2 lg:w-auto shrink-0">

  <button
    onClick={() => {
      setCheckoutOrder(order);
      setDiscount(0);
      setPaymentMethod("UPI");
    }}
    className="h-10 px-4 rounded-xl border border-green-700/40 bg-green-700/10 hover:bg-green-700/20 text-green-400 text-sm font-semibold flex items-center justify-center gap-2"
  >
    <UtensilsCrossed className="w-4 h-4" />
    Food Only
  </button>

  <button
    onClick={() =>
      navigate(
        `/tables?food_order=${order.id}`
      )
    }
    className="h-10 px-4 rounded-xl bg-green-700 hover:bg-green-800 text-white text-sm font-semibold flex items-center justify-center gap-2"
  >
    <Play className="w-4 h-4" />
    Start Table
  </button>

  <button
    onClick={() => cancelOrder(order.id)}
    className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 flex items-center justify-center"
    title="Cancel order"
  >
    <Trash2 className="w-4 h-4" />
  </button>

</div>

                </div>

              </div>
            ))}

          </div>
        )}
            </div>

      {/* Food Only Checkout */}
      {checkoutOrder && (
        <div
          className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !saving && setCheckoutOrder(null)}
        >
          <div
            className="w-full max-w-md bg-[#141414] border border-[#292929] rounded-2xl shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >

            {/* Header */}
            <div className="px-5 py-4 border-b border-[#262626]">
              <div className="text-xs uppercase tracking-[0.2em] text-green-500 font-bold">
                Food Only
              </div>

              <div className="text-xl font-bold mt-1">
                Complete Sale
              </div>

              <div className="text-sm text-gray-500 mt-1">
                {checkoutOrder.customer_name || "Walk-in Customer"}
              </div>
            </div>

            {/* Content */}
            <div className="p-5 space-y-5">

              {/* Order Items */}
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-3">
                  Order
                </div>

                <div className="space-y-2">
                  {checkoutOrder.items?.map((item, index) => (
                    <div
                      key={`${checkoutOrder.id}-${index}`}
                      className="flex justify-between text-sm"
                    >
                      <span className="text-gray-300">
                        {item.name} × {item.quantity}
                      </span>

                      <span className="text-gray-400">
                        {inr(item.subtotal)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Amount */}
              <div className="bg-[#0f0f0f] border border-[#262626] rounded-xl p-4 space-y-3">

                <div className="flex justify-between text-sm">
                  <span className="text-gray-400">
                    Subtotal
                  </span>

                  <span>
                    {inr(checkoutOrder.total)}
                  </span>
                </div>

                {/* Discount */}
                <div className="flex items-center justify-between">
                  <span className="text-gray-400 text-sm">
                    Discount
                  </span>

                  <div className="flex items-center gap-2">
                    <span className="text-gray-500">
                      ₹
                    </span>

                    <input
                      type="number"
                      min="0"
                      max={checkoutOrder.total}
                      value={discount}
                      onChange={(e) => {
                        const value = Number(e.target.value) || 0;

                        setDiscount(
                          Math.min(
                            Math.max(value, 0),
                            Number(checkoutOrder.total)
                          )
                        );
                      }}
                      className="w-24 h-9 px-3 rounded-lg bg-[#1a1a1a] border border-[#333] text-right text-sm text-white focus:outline-none focus:border-green-700"
                    />
                  </div>
                </div>

                {/* Final Total */}
                <div className="border-t border-[#262626] pt-3 flex justify-between">
                  <span className="font-semibold">
                    Total
                  </span>

                  <span className="text-xl font-bold text-green-400">
                    {inr(
                      Math.max(
                        Number(checkoutOrder.total) - discount,
                        0
                      )
                    )}
                  </span>
                </div>

              </div>

              {/* Payment Method */}
              <div>
                <div className="text-xs uppercase tracking-wider text-gray-500 font-bold mb-3">
                  Payment Method
                </div>

                <div className="grid grid-cols-3 gap-2">
                  {["Cash", "UPI", "Card"].map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => setPaymentMethod(method)}
                      className={`h-11 rounded-xl border text-sm font-semibold ${
                        paymentMethod === method
                          ? "bg-green-700/15 border-green-700 text-green-400"
                          : "bg-[#0f0f0f] border-[#262626] text-gray-400 hover:text-white"
                      }`}
                    >
                      {method}
                    </button>
                  ))}
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="px-5 py-4 border-t border-[#262626] flex gap-3">

              <button
                type="button"
                onClick={() => setCheckoutOrder(null)}
                disabled={saving}
                className="flex-1 h-11 rounded-xl border border-[#333] text-sm font-semibold text-gray-300 hover:bg-[#1c1c1c]"
              >
                Back
              </button>

              <button
                type="button"
                onClick={completeFoodOnly}
                disabled={saving}
                className="flex-[1.5] h-11 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-40 text-sm font-bold"
              >
                {saving
                  ? "Processing..."
                  : `Complete · ${inr(
                      Math.max(
                        Number(checkoutOrder.total) - discount,
                        0
                      )
                    )}`}
              </button>

            </div>

          </div>
        </div>
      )}
    </div>
  </>
  );
}
      