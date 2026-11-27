
import { useEffect, useState } from "react";
import api from "@/lib/api";
import { toast } from "sonner";

export const pad = (n) => String(n).padStart(2, "0");

export const dateKey = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const dateTime = (date, time) =>
  new Date(`${date}T${time}:00`);

export const money = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    maximumFractionDigits: 2,
  })}`;

export const formatDateTime = (value) =>
  value
    ? new Date(value).toLocaleString("en-IN", {
        dateStyle: "medium",
        timeStyle: "short",
      })
    : "—";

export const clockLabel = (hour, minute = 0) => {
  const h = hour % 12 || 12;
  return `${h}${minute ? `:${pad(minute)}` : ""} ${
    hour < 12 ? "AM" : "PM"
  }`;
};

export const timeOptions = Array.from({ length: 96 }, (_, i) => {
  const h = Math.floor(i / 4);
  const m = (i % 4) * 15;
  const value = `${pad(h)}:${pad(m)}`;

  return {
    value,
    label: `${clockLabel(h, m)} (${value})`,
  };
});

export function usePS5Data(interval = 30000) {
  const [data, setData] = useState({
    stations: [],
    bookings: [],
    sessions: [],
    memberships: [],
    pricing: {
      players: { 1: 129, 2: 199, 3: 299, 4: 369 },
    },
  });

  const [loading, setLoading] = useState(true);

  const load = async (quiet = false) => {
    if (!quiet) setLoading(true);

    try {
      const [t, b, s, m, p] = await Promise.all([
        api.get("/tables"),
        api.get("/ps5-bookings"),
        api.get("/sessions/active"),
        api.get("/memberships"),
        api.get("/settings/game-pricing"),
      ]);

      const rows = Array.isArray(t.data)
        ? t.data
        : t.data?.tables || [];

      const stations = rows.filter(
        (x) => String(x.game_type || "").toLowerCase() === "ps5"
      );

      setData({
        stations,
        bookings: Array.isArray(b.data) ? b.data : [],
        sessions: (
          Array.isArray(s.data) ? s.data : []
        ).filter((x) =>
          stations.some((t) => t.id === x.table_id)
        ),
        memberships: (m.data || []).filter(
          (x) =>
            !x.is_expired &&
            Number(x.remaining_total_seconds || 0) > 0
        ),
        pricing:
          p.data?.ps5 || {
            players: { 1: 129, 2: 199, 3: 299, 4: 369 },
          },
      });
    } catch (e) {
      toast.error(
        e.response?.data?.detail || "Could not load PS5 data"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();

    const t = setInterval(() => load(true), interval);

    return () => clearInterval(t);
  }, []);

  return { ...data, loading, refresh: load };
}

export function conflictFor(
  station,
  start,
  end,
  bookings,
  sessions
) {
  if (
    String(station.status || "").toLowerCase() === "maintenance"
  ) {
    return { kind: "maintenance", label: "Maintenance" };
  }

  const active = sessions.find(
    (s) => s.table_id === station.id
  );

  if (active) {
    return {
      kind: "live",
      label: `Live · ${active.customer_name || "Playing"}`,
    };
  }

  if (
    String(station.status || "").toLowerCase() === "running"
  ) {
    return { kind: "live", label: "Currently running" };
  }

  const b = bookings.find(
    (x) =>
      x.table_id === station.id &&
      x.status === "confirmed" &&
      new Date(x.start_at) < end &&
      new Date(x.end_at) > start
  );

  return b
    ? {
        kind: "booked",
        label: `Booked · ${b.customer_name}`,
        booking: b,
      }
    : null;
}
