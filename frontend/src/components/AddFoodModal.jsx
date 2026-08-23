  import { useEffect, useMemo, useState } from "react";
  import { useNavigate } from "react-router-dom";
  import { Minus, Plus, Search, ShoppingCart, Trash2, User, X, }from "lucide-react";
  import api, { inr, formatApiErrorDetail } from "@/lib/api";
  import { toast } from "sonner";

  export default function AddFoodModal({ open, onClose }) {
    const [snacks, setSnacks] = useState([]);
    const [search, setSearch] = useState("");
    const [customerName, setCustomerName] = useState("");
    const [cart, setCart] = useState({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const navigate = useNavigate();
    const [checkoutOpen, setCheckoutOpen] = useState(false);
    const [discount, setDiscount] = useState(0);
    const [paymentMethod, setPaymentMethod] = useState("UPI");

    useEffect(() => {
      if (!open) return;

      const loadSnacks = async () => {
        try {
          setLoading(true);
          const { data } = await api.get("/snacks");
          setSnacks(data);
        } catch (e) {
          toast.error(formatApiErrorDetail(e.response?.data?.detail));
        } finally {
          setLoading(false);
        }
      };

      loadSnacks();
    }, [open]);

    if (!open) return null;

    const filteredSnacks = snacks.filter((snack) => {
      if (snack.stock_quantity <= 0) return false;

      const q = search.trim().toLowerCase();

      if (!q) return true;

      return (
        snack.name.toLowerCase().includes(q) ||
        snack.category?.toLowerCase().includes(q)
      );
    });

    const cartItems = Object.values(cart);

    const total = cartItems.reduce(
      (sum, item) => sum + item.price * item.quantity,
      0
    );

    const addItem = (snack) => {
      setCart((current) => {
        const existing = current[snack.id];
        const quantity = existing?.quantity || 0;

        if (quantity >= snack.stock_quantity) {
          toast.error(`Only ${snack.stock_quantity} available`);
          return current;
        }

        return {
          ...current,
          [snack.id]: {
            snack_id: snack.id,
            name: snack.name,
            price: Number(snack.price),
            quantity: quantity + 1,
          },
        };
      });
    };

    const decreaseItem = (id) => {
      setCart((current) => {
        const item = current[id];

        if (!item) return current;

        if (item.quantity <= 1) {
          const next = { ...current };
          delete next[id];
          return next;
        }

        return {
          ...current,
          [id]: {
            ...item,
            quantity: item.quantity - 1,
          },
        };
      });
    };

    const removeItem = (id) => {
      setCart((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    };

    const saveOrder = async (status) => {
  if (cartItems.length === 0) {
    toast.error("Add at least one item");
    return;
  }

  try {
    setSaving(true);

    const { data } = await api.post("/food-orders", {
      customer_name: customerName.trim(),
      items: cartItems.map((item) => ({
        snack_id: item.snack_id,
        quantity: item.quantity,
      })),
      status,
    });

    if (status === "completed") {
      toast.success(`Food sale completed · ${inr(data.total)}`);
    } else {
      toast.success(`Order saved for later · ${inr(data.total)}`);
    }

    setCart({});
    setCustomerName("");
    setSearch("");
    onClose();
  } catch (e) {
    toast.error(formatApiErrorDetail(e.response?.data?.detail));
  } finally {
    setSaving(false);
  }
};

    const saveAndStartTable = async () => {
      if (cartItems.length === 0) {
        toast.error("Add at least one item");
        return;
      }

      try {
        setSaving(true);

        const { data } = await api.post("/food-orders", {
          customer_name: customerName.trim(),
          items: cartItems.map((item) => ({
            snack_id: item.snack_id,
            quantity: item.quantity,
          })),
          status: "pending",
        });

        toast.success("Food order saved");

        setCart({});
        setCustomerName("");
        setSearch("");
        onClose();

        navigate(`/tables?food_order=${data.id}`);
      } catch (e) {
        toast.error(formatApiErrorDetail(e.response?.data?.detail));
      } finally {
        setSaving(false);
      }
    };

    return (
      <div
        className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
        onClick={onClose}
      >
        <div
          className="w-full max-w-5xl max-h-[90vh] bg-[#141414] border border-[#292929] rounded-2xl shadow-2xl overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="h-16 px-5 border-b border-[#262626] flex items-center justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-green-500 font-bold">
                Quick Sale
              </div>
              <div className="text-lg font-bold">
                Add Food
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-9 h-9 rounded-lg hover:bg-[#1f1f1f] flex items-center justify-center"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 overflow-y-auto max-h-[calc(90vh-140px)]">
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-5">

              {/* Menu */}
              <div className="min-w-0">

                {/* Customer */}
                <div className="mb-4">
                  <div className="text-xs uppercase tracking-wider text-gray-400 font-semibold mb-2 flex items-center gap-2">
                    <User className="w-3.5 h-3.5" />
                    Customer Name
                    <span className="text-gray-600 font-normal">
                      Optional
                    </span>
                  </div>

                  <input
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Walk-in customer"
                    className="w-full h-10 px-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-700"
                  />
                </div>

                {/* Search */}
                <div className="relative mb-4">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-500" />

                  <input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search food & drinks..."
                    className="w-full h-10 pl-10 pr-3 rounded-lg bg-[#0f0f0f] border border-[#262626] text-sm text-white placeholder-gray-600 focus:outline-none focus:border-green-700"
                  />
                </div>

                {/* Products */}
                {loading ? (
                  <div className="py-12 text-center text-sm text-gray-500">
                    Loading menu...
                  </div>
                ) : (
                  <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-4 gap-3">
                    {filteredSnacks.map((snack) => {
                      const quantity =
                        cart[snack.id]?.quantity || 0;

                      return (
                        <button
                          key={snack.id}
                          onClick={() => addItem(snack)}
                          className="text-left rounded-xl bg-[#0f0f0f] border border-[#262626] hover:border-green-700/50 transition-colors overflow-hidden"
                        >
                          <div className="aspect-[1.15] flex items-center justify-center bg-[#111]">
                            {snack.image_url ? (
                              <img
                                src={snack.image_url}
                                alt={snack.name}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <ShoppingCart className="w-7 h-7 text-gray-700" />
                            )}
                          </div>

                          <div className="p-3">
                            <div className="text-[10px] uppercase text-gray-600">
                              {snack.category}
                            </div>

                            <div className="text-sm font-semibold truncate mt-1">
                              {snack.name}
                            </div>

                            <div className="flex items-center justify-between mt-2">
                              <span className="text-sm font-bold text-green-400">
                                {inr(snack.price)}
                              </span>

                              {quantity > 0 && (
                                <span className="text-[11px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400">
                                  ×{quantity}
                                </span>
                              )}
                            </div>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Cart */}
              <div className="rounded-xl bg-[#0f0f0f] border border-[#262626] h-fit">
                <div className="px-4 py-3 border-b border-[#262626] flex justify-between">
                  <span className="font-semibold text-sm">
                    Current Order
                  </span>

                  <span className="text-xs text-gray-500">
                    {cartItems.reduce(
                      (sum, item) => sum + item.quantity,
                      0
                    )}{" "}
                    items
                  </span>
                </div>

                <div className="p-4">
                  {cartItems.length === 0 ? (
                    <div className="py-10 text-center">
                      <ShoppingCart className="w-7 h-7 mx-auto text-gray-700" />
                      <div className="text-xs text-gray-600 mt-2">
                        No items added
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {cartItems.map((item) => (
                        <div
                          key={item.snack_id}
                          className="flex items-center gap-2"
                        >
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium truncate">
                              {item.name}
                            </div>

                            <div className="text-xs text-gray-600">
                              {inr(item.price)}
                            </div>
                          </div>

                          <button
                            onClick={() =>
                              decreaseItem(item.snack_id)
                            }
                            className="w-6 h-6 rounded bg-[#1c1c1c] flex items-center justify-center"
                          >
                            <Minus className="w-3 h-3" />
                          </button>

                          <span className="w-4 text-center text-xs">
                            {item.quantity}
                          </span>

                          <button
                            onClick={() =>
                              addItem(
                                snacks.find(
                                  (s) => s.id === item.snack_id
                                )
                              )
                            }
                            className="w-6 h-6 rounded bg-[#1c1c1c] flex items-center justify-center"
                          >
                            <Plus className="w-3 h-3" />
                          </button>

                          <span className="w-14 text-right text-xs font-semibold">
                            {inr(item.price * item.quantity)}
                          </span>

                          <button
                            onClick={() =>
                              removeItem(item.snack_id)
                            }
                            className="text-gray-600 hover:text-red-400"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ))}

                      <div className="border-t border-[#262626] pt-4 mt-4 flex justify-between">
                        <span className="text-gray-400">
                          Total
                        </span>

                        <span className="text-xl font-bold text-green-400">
                          {inr(total)}
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              </div>

            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-[#262626] flex justify-end gap-3">
            <button
    onClick={onClose}
    disabled={saving}
    className="h-10 px-5 rounded-lg border border-[#333] text-sm font-semibold hover:bg-[#1c1c1c] disabled:opacity-40"
  >
    Cancel
  </button>

  <button
    onClick={() => saveOrder("pending")}
    disabled={saving || cartItems.length === 0}
    className="h-10 px-5 rounded-lg border border-amber-600/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/15 disabled:opacity-40 text-sm font-semibold"
  >
    Save for Later
  </button>

  <button
    onClick={() => { if (cartItems.length === 0) { toast.error("Add at least one item");
    return;
  }

  setDiscount(0);
  setPaymentMethod("UPI");
  setCheckoutOpen(true);
}}
    disabled={saving || cartItems.length === 0}
    className="h-10 px-5 rounded-lg bg-green-700 hover:bg-green-800 disabled:opacity-40 text-sm font-semibold"
  >
    Food Only
  </button>

  <button
    onClick={saveAndStartTable}
    disabled={saving || cartItems.length === 0}
    className="h-10 px-5 rounded-lg bg-white text-black hover:bg-gray-200 disabled:opacity-40 text-sm font-semibold"
  >
    Start Table
  </button>
          </div>
              {/* Food Only Checkout */}
          {checkoutOpen && (
            <div
              className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
              onClick={() => !saving && setCheckoutOpen(false)}
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
                    Customer is not starting a table.
                  </div>
                </div>

                {/* Summary */}
                <div className="p-5 space-y-5">
                  <div className="bg-[#0f0f0f] border border-[#262626] rounded-xl p-4 space-y-3">
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-400">Subtotal</span>
                      <span className="font-semibold">
                        {inr(total)}
                      </span>
                    </div>

                    <div className="flex justify-between items-center gap-4">
                      <span className="text-gray-400 text-sm">
                        Discount
                      </span>

                      <div className="flex items-center gap-2">
                        <span className="text-gray-500">₹</span>

                        <input
                          type="number"
                          min="0"
                          max={total}
                          value={discount}
                          onChange={(e) => {
                            const value = Number(e.target.value) || 0;

                            setDiscount(
                              Math.min(
                                Math.max(value, 0),
                                total
                              )
                            );
                          }}
                          className="w-24 h-9 px-3 rounded-lg bg-[#1a1a1a] border border-[#333] text-right text-sm text-white focus:outline-none focus:border-green-700"
                        />
                      </div>
                    </div>

                    <div className="border-t border-[#262626] pt-3 flex justify-between">
                      <span className="font-semibold">
                        Total
                      </span>

                      <span className="text-xl font-bold text-green-400">
                        {inr(
                          Math.max(total - discount, 0)
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
                          onClick={() =>
                            setPaymentMethod(method)
                          }
                          className={`h-11 rounded-xl border text-sm font-semibold transition-all ${
                            paymentMethod === method
                              ? "bg-green-700/15 border-green-700 text-green-400"
                              : "bg-[#0f0f0f] border-[#262626] text-gray-400 hover:text-white hover:border-[#444]"
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
                    onClick={() => setCheckoutOpen(false)}
                    disabled={saving}
                    className="flex-1 h-11 rounded-xl border border-[#333] text-sm font-semibold text-gray-300 hover:bg-[#1c1c1c] disabled:opacity-40"
                  >
                    Back
                  </button>

                  <button
                    type="button"
                    onClick={async () => {
                      try {
                        setSaving(true);

                        const { data } = await api.post(
                          "/food-orders",
                          {
                            customer_name:
                              customerName.trim(),

                            items: cartItems.map((item) => ({
                              snack_id: item.snack_id,
                              quantity: item.quantity,
                            })),

                            status: "completed",

                            discount:
                              Number(discount) || 0,

                            payment_method:
                              paymentMethod,
                          }
                        );

                        toast.success(
                          `Sale completed · ${inr(
                            data.final_total
                          )}`
                        );

                        setCheckoutOpen(false);
                        setCart({});
                        setCustomerName("");
                        setSearch("");
                        onClose();
                      } catch (e) {
                        toast.error(
                          formatApiErrorDetail(
                            e.response?.data?.detail
                          )
                        );
                      } finally {
                        setSaving(false);
                      }
                    }}
                    disabled={
                      saving || cartItems.length === 0
                    }
                    className="flex-[1.5] h-11 rounded-xl bg-green-700 hover:bg-green-800 disabled:opacity-40 text-sm font-bold"
                  >
                    {saving
                      ? "Processing..."
                      : `Complete · ${inr(
                          Math.max(total - discount, 0)
                        )}`}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    );
}
    