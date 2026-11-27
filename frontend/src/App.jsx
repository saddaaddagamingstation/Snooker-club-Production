import "@/App.css";
import "@/index.css";
import { lazy } from "react";
import AppLoadingScreen from "@/components/states/AppLoadingScreen";
import PageState from "@/components/states/PageState";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import AppLayout from "@/components/AppLayout";
import Login from "@/pages/Login";

const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Tables = lazy(() => import("@/pages/Tables"));
const Sessions = lazy(() => import("@/pages/Sessions"));
const Snacks = lazy(() => import("@/pages/Snacks"));
const FoodOrders = lazy(() => import("@/pages/FoodOrders"));
const Reports = lazy(() => import("@/pages/Reports"));
const Expenses = lazy(() => import("@/pages/Expenses"));
const Staff = lazy(() => import("@/pages/Staff"));
const Settings = lazy(() => import("@/pages/Settings"));
const Bill = lazy(() => import("@/pages/Bill"));
const MembershipLayout = lazy(() => import("@/pages/memberships/MembershipLayout"));
const MembershipOverview = lazy(() => import("@/pages/memberships/MembershipOverview"));
const MembershipPackages = lazy(() => import("@/pages/memberships/MembershipPackages"));
const MembershipMembers = lazy(() => import("@/pages/memberships/MembershipMembers"));
const MembershipGameRecords = lazy(() => import("@/pages/memberships/MembershipGameRecords"));
const PS5Layout = lazy(() => import("@/pages/ps5/PS5Layout"));
const PS5Overview = lazy(() => import("@/pages/ps5/PS5Overview"));
const PS5BookingPage = lazy(() => import("@/pages/ps5/PS5BookingPage"));
const PS5Reservations = lazy(() => import("@/pages/ps5/PS5Reservations"));
const PS5LiveSessions = lazy(() => import("@/pages/ps5/PS5LiveSessions"));

function Protected({ children, perm }) {
  const { user, authStatus, can, refresh } = useAuth();
  if (authStatus === "checking") return <AppLoadingScreen />;
  if (authStatus === "unavailable") return <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A]"><PageState type="error" title="Unable to connect" description="We couldn't verify your login. Check your internet connection and try again." onRetry={refresh} actionLabel="Retry connection" /></div>;
  if (!user) return <Navigate to="/login" replace />;
  if (perm && !can(perm)) return <Navigate to="/dashboard" replace />;
  return children;
}

export default function App() {
  return <AuthProvider><BrowserRouter><Toaster theme="dark" position="top-right" richColors closeButton /><Routes>
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
      <Route path="/settings" element={<Protected perm="manage_settings"><Settings /></Protected>} />
      <Route path="/bill/:id" element={<Bill />} />
      <Route path="/food-orders" element={<FoodOrders />} />
    </Route>
    <Route path="/ps5" element={<Protected perm="manage_sessions"><PS5Layout /></Protected>}>
      <Route index element={<PS5Overview />} />
      <Route path="bookings" element={<PS5BookingPage />} />
      <Route path="reservations" element={<PS5Reservations />} />
      <Route path="live" element={<PS5LiveSessions />} />
    </Route>
    <Route path="/ps5-bookings" element={<Navigate to="/ps5/bookings" replace />} />
    <Route path="/memberships" element={<Protected perm="manage_sessions"><MembershipLayout /></Protected>}>
      <Route index element={<MembershipOverview />} />
      <Route path="packages" element={<MembershipPackages />} />
      <Route path="members" element={<MembershipMembers />} />
      <Route path="game-records" element={<MembershipGameRecords />} />
    </Route>
    <Route path="*" element={<Navigate to="/dashboard" replace />} />
  </Routes></BrowserRouter></AuthProvider>;
}
