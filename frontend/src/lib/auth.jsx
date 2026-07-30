import { createContext, useContext, useEffect, useState, useCallback } from "react";
import api, { formatApiErrorDetail } from "./api";

const AuthContext = createContext(null);

const ADMIN_PERMS = {
  manage_tables: true, manage_snacks: true, manage_sessions: true,
  manage_expenses: true, view_expenses: true, view_revenue: true, view_profit: true,
  view_reports: true, manage_users: true, manage_settings: true,
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);

  const refresh = useCallback(async () => {
    const token = localStorage.getItem("snk_token");
    if (!token) { setUser(null); return; }
    try { const { data } = await api.get("/auth/me"); setUser(data); }
    catch { localStorage.removeItem("snk_token"); setUser(null); }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  // Live permission sync: refresh on window focus, on visibility change, and every 20s
  useEffect(() => {
    const onFocus = () => { if (localStorage.getItem("snk_token")) refresh(); };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    const t = setInterval(() => { if (localStorage.getItem("snk_token")) refresh(); }, 20000);
    return () => {
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
      clearInterval(t);
    };
  }, [refresh]);

  const login = async (email, password, remember) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      localStorage.setItem("snk_token", data.access_token);
      if (!remember) sessionStorage.setItem("snk_session_only", "1");
      setUser(data.user);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: formatApiErrorDetail(e.response?.data?.detail) || e.message };
    }
  };

  const logout = () => { localStorage.removeItem("snk_token"); setUser(null); };

  const can = (perm) => {
    if (!user) return false;
    if (user.role === "admin") return true;
    return !!(user.permissions || {})[perm];
  };

  return <AuthContext.Provider value={{ user, login, logout, setUser, can, refresh }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
export { ADMIN_PERMS };
