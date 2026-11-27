import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
} from "react";
import api, {
  formatApiErrorDetail,
  getStoredToken,
  clearStoredToken,
  storeToken,
} from "./api";

const AuthContext = createContext(null);

const ADMIN_PERMS = {
  view_dashboard: true,
  view_tables: true, manage_tables: true,
  view_ps5: true, manage_ps5: true,
  view_memberships: true, manage_memberships: true,
  view_sessions: true, manage_sessions: true, clear_session: true,
  view_snacks: true, manage_snacks: true,
  view_food_orders: true, manage_food_orders: true,
  view_expenses: true, manage_expenses: true,
  view_revenue: true, view_profit: true, view_reports: true,
  view_settings: true, manage_users: true, manage_settings: true,
};

const MANAGE_TO_VIEW = {
  manage_tables: "view_tables",
  manage_ps5: "view_ps5",
  manage_memberships: "view_memberships",
  manage_sessions: "view_sessions",
  manage_snacks: "view_snacks",
  manage_food_orders: "view_food_orders",
  manage_expenses: "view_expenses",
  manage_settings: "view_settings",
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined);
  const [authStatus, setAuthStatus] = useState("checking");

  const logout = useCallback(() => {
    clearStoredToken();
    setUser(null);
    setAuthStatus("unauthenticated");
  }, []);

  const refresh = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setAuthStatus("unauthenticated");
      return false;
    }
    setAuthStatus((current) => current === "unavailable" ? "checking" : current);
    try {
      const { data } = await api.get("/auth/me");
      setUser(data);
      setAuthStatus("authenticated");
      return true;
    } catch (error) {
      if (error.response?.status === 401) {
        clearStoredToken();
        setUser(null);
        setAuthStatus("unauthenticated");
      } else {
        setAuthStatus((current) => current === "checking" ? "unavailable" : current);
      }
      return false;
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && getStoredToken()) refresh();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [refresh]);

  const login = async (email, password, remember = true) => {
    try {
      const { data } = await api.post("/auth/login", { email, password });
      storeToken(data.access_token, remember);
      setUser(data.user);
      setAuthStatus("authenticated");
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: formatApiErrorDetail(error.response?.data?.detail) || error.message,
      };
    }
  };

  const can = useCallback((perm) => {
    if (!user) return false;
    if (user.role === "admin") return true;
    const permissions = user.permissions || {};
    if (permissions[perm]) return true;
    return Object.entries(MANAGE_TO_VIEW).some(([manage, view]) => view === perm && permissions[manage]);
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, authStatus, login, logout, setUser, can, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
export { ADMIN_PERMS };