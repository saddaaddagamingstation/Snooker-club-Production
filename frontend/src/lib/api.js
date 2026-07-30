import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API });

api.interceptors.request.use((cfg) => {
  const token = localStorage.getItem("snk_token");
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

export default api;

export function formatApiErrorDetail(detail) {
  if (detail == null) return "Something went wrong. Please try again.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

// Display currency rounded to the nearest rupee
// Examples:
// 100.49 -> ₹100
// 100.50 -> ₹101
// 5231.40 -> ₹5,231
// 5231.50 -> ₹5,232
export const inr = (n) =>
  `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;

// Grand total also rounded to the nearest rupee
export const inrRounded = (n) =>
  `₹${Math.round(Number(n || 0)).toLocaleString("en-IN")}`;