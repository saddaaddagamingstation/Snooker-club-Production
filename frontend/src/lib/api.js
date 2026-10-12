import axios from "axios";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
export const API = `${BACKEND_URL}/api`;

const api = axios.create({ baseURL: API });

// Support both persistent and session-only login.
export const getStoredToken = () =>
  localStorage.getItem("snk_token") ||
  sessionStorage.getItem("snk_token");

export const clearStoredToken = () => {
  localStorage.removeItem("snk_token");
  sessionStorage.removeItem("snk_token");
};

export const storeToken = (token, remember = true) => {
  clearStoredToken();

  if (remember) {
    localStorage.setItem("snk_token", token);
  } else {
    sessionStorage.setItem("snk_token", token);
  }
};

api.interceptors.request.use((cfg) => {
  const token = getStoredToken();

  if (token) {
    cfg.headers = cfg.headers || {};
    cfg.headers.Authorization = `Bearer ${token}`;
  }

  return cfg;
});

export default api;

export function formatApiErrorDetail(detail) {
  if (detail == null) {
    return "Something went wrong. Please try again.";
  }

  if (typeof detail === "string") return detail;

  if (Array.isArray(detail)) {
    return detail
      .map((e) =>
        e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)
      )
      .filter(Boolean)
      .join(" ");
  }

  if (typeof detail.msg === "string") return detail.msg;

  return String(detail);
}

// Display currency with exact paise.
export const inr = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;

export const inrRounded = (n) =>
  `₹${Number(n || 0).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;