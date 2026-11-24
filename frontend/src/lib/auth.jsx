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
  manage_tables: true,
  manage_snacks: true,
  manage_sessions: true,
  manage_expenses: true,
  view_expenses: true,
  view_revenue: true,
  view_profit: true,
  view_reports: true,
  manage_users: true,
  manage_settings: true,
  clear_session: true,
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

    // Retry an unavailable initial authentication check.
    // Don't interrupt an already authenticated user during background refresh.
    setAuthStatus((current) =>
      current === "unavailable" ? "checking" : current,
    );

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
        setAuthStatus((current) =>
          current === "checking" ? "unavailable" : current,
        );
      }

      return false;
    }
  }, []);

  // Run authentication check when the app starts
  useEffect(() => {
    refresh();
  }, [refresh]);

  // Recheck authentication when the user returns to the app
  useEffect(() => {
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible" && getStoredToken()) {
        refresh();
      }
    };

    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [refresh]);

  const login = async (email, password, remember = true) => {
    try {
      const { data } = await api.post("/auth/login", {
        email,
        password,
      });

      storeToken(data.access_token, remember);
      setUser(data.user);
      setAuthStatus("authenticated");

      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error:
          formatApiErrorDetail(error.response?.data?.detail) || error.message,
      };
    }
  };

  const can = (perm) => {
    if (!user) return false;
    if (user.role === "admin") return true;

    return !!(user.permissions || {})[perm];
  };

  return (
    <AuthContext.Provider
      value={{ user, authStatus, login, logout, setUser, can, refresh }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
export { ADMIN_PERMS };
