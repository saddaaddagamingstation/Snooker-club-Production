import "@/App.css";
import "@/index.css";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import Login from "@/pages/Login";
import Dashboard from "@/pages/Dashboard";
import Tables from "@/pages/Tables";
import Sessions from "@/pages/Sessions";
import Snacks from "@/pages/Snacks";
import FoodOrders from "@/pages/FoodOrders";
import Reports from "@/pages/Reports";
import Expenses from "@/pages/Expenses";
import Staff from "@/pages/Staff";
import Bill from "@/pages/Bill";
import AppLayout from "@/components/AppLayout";

function Protected({ children, perm }) {
  const { user, can } = useAuth();
  if (user === undefined) return <div className="min-h-screen flex items-center justify-center text-gray-400">Loading…</div>;
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(perm)) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Toaster theme="dark" position="top-right" richColors closeButton />
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route element={<Protected><AppLayout /></Protected>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/tables" element={<Tables />} />
            <Route path="/sessions" element={<Protected perm="manage_sessions"><Sessions /></Protected>} />
            <Route path="/snacks" element={<Snacks />} />
            <Route path="/reports" element={<Protected perm="view_reports"><Reports /></Protected>} />
            <Route path="/expenses" element={<Protected perm="view_expenses"><Expenses /></Protected>} />
            <Route path="/staff" element={<Protected perm="manage_users"><Staff /></Protected>} />
            <Route path="/bill/:id" element={<Bill />} />
            <Route path="/food-orders" element={<FoodOrders />} />
          </Route>
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}
