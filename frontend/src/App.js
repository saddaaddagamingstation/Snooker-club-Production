import "@/App.css";
import "@/index.css";
import { lazy } from "react";
import AppLoadingScreen from "@/components/states/AppLoadingScreen";
import PageState from "@/components/states/PageState";
import {
  BrowserRouter,
  Routes,
  Route,
  Navigate,
} from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import AppLayout from "@/components/AppLayout";

// Login can stay loaded immediately
import Login from "@/pages/Login";

// Lazy-load protected application pages
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Tables = lazy(() => import("@/pages/Tables"));
const Sessions = lazy(() => import("@/pages/Sessions"));
const Snacks = lazy(() => import("@/pages/Snacks"));
const FoodOrders = lazy(() => import("@/pages/FoodOrders"));
const Reports = lazy(() => import("@/pages/Reports"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Staff = lazy(() => import("@/pages/Staff"));
const Bill = lazy(() => import("@/pages/Bill"));

function Protected({ children, perm }) {
  const { user, authStatus, can, refresh } = useAuth();

  // Initial authentication check
  if (authStatus === "checking") {
    return <AppLoadingScreen />;
  }

  // Backend unavailable or network failure
  if (authStatus === "unavailable") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]">
        <PageState
          type="error"
          title="Unable to connect"
          description="We couldn't verify your login. Check your internet connection and try again."
          onRetry={refresh}
          actionLabel="Retry connection"
        />
      </div>
    );
  }

  // User is not logged in
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Permission check
  if (perm && !can(perm)) {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster
          theme="dark"
          position="top-right"
          richColors
          closeButton
        />

  
          <Routes>
            <Route path="/login" element={<Login />} />

            <Route
              element={
                <Protected>
                  <AppLayout />
                </Protected>
              }
            >
              <Route
                path="/"
                element={<Navigate to="/dashboard" replace />}
              />

              <Route
                path="/dashboard"
                element={<Dashboard />}
              />

              <Route
                path="/tables"
                element={<Tables />}
              />

              <Route
                path="/sessions"
                element={
                  <Protected perm="manage_sessions">
                    <Sessions />
                  </Protected>
                }
              />

              <Route
                path="/snacks"
                element={<Snacks />}
              />

              <Route
                path="/reports"
                element={
                  <Protected perm="view_reports">
                    <Reports />
                  </Protected>
                }
              />

              <Route
                path="/expenses"
                element={
                  <Protected perm="view_expenses">
                    <Expenses />
                  </Protected>
                }
              />

              <Route
                path="/staff"
                element={
                  <Protected perm="manage_users">
                    <Staff />
                  </Protected>
                }
              />

              <Route
                path="/bill/:id"
                element={<Bill />}
              />

              <Route
                path="/food-orders"
                element={<FoodOrders />}
              />
            </Route>

            <Route
              path="*"
              element={<Navigate to="/dashboard" replace />}
            />
          </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}