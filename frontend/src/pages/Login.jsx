import { useState } from "react";
import { useAuth } from "@/lib/auth";
import { useNavigate, Link } from "react-router-dom";
import { toast } from "sonner";
import { Circle, Eye, EyeOff, Loader2 } from "lucide-react";
import api, { formatApiErrorDetail } from "@/lib/api";

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("admin@snooker.com");
  const [password, setPassword] = useState("admin123");
  const [remember, setRemember] = useState(true);
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [forgotOpen, setForgotOpen] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");

  if (user === undefined) return null;
  if (user) { navigate("/dashboard"); return null; }

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    const res = await login(email, password, remember);
    setBusy(false);
    if (res.ok) { toast.success("Welcome back"); navigate("/dashboard"); }
    else toast.error(res.error || "Login failed");
  };

  const sendForgot = async () => {
    try {
      await api.post("/auth/forgot-password", { email: forgotEmail });
      toast.success("If your email exists, reset link generated. Check server logs.");
      setForgotOpen(false);
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    }
  };

  return (
    <div className="min-h-screen flex flex-col lg:flex-row bg-[#0A0A0A]">
      {/* Left visual */}
      <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden">
        <img
          src="https://images.unsplash.com/photo-1593070962926-4169ebeece92?crop=entropy&cs=srgb&fm=jpg&q=85"
          alt="snooker"
          className="absolute inset-0 w-full h-full object-cover opacity-60"
        />
        <div className="absolute inset-0 bg-gradient-to-tr from-black via-black/70 to-transparent" />
        <div className="relative z-10 p-12 flex flex-col justify-between w-full">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-green-700 flex items-center justify-center shadow-[0_0_30px_rgba(21,128,61,0.6)]">
              <Circle className="w-6 h-6 fill-white/20" />
            </div>
            <div>
              <div className="text-xs uppercase tracking-[0.3em] text-green-400 font-bold">Cue Lounge</div>
              <div className="text-xl font-bold tracking-tight">Snooker Management Suite</div>
            </div>
          </div>
          <div>
            <h1 className="text-5xl xl:text-6xl font-bold tracking-tight leading-[1.05]">
              Run your <span className="text-green-500">snooker</span> club like a champion.
            </h1>
            <p className="mt-6 text-gray-400 text-lg max-w-md">
              Live tables, locked rates, snack orders, instant billing. Every cue stroke accounted for.
            </p>
          </div>
        </div>
      </div>

      {/* Right form */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-md">
          <div className="lg:hidden mb-8 flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-green-700 flex items-center justify-center">
              <Circle className="w-5 h-5 fill-white/20" />
            </div>
            <div className="text-lg font-bold">Cue Lounge</div>
          </div>
          <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-3">Welcome back</div>
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight mb-2">Sign in to your club</h2>
          <p className="text-gray-400 mb-8 text-sm">Manage tables, sessions and revenue in real time.</p>

          {!forgotOpen ? (
            <form onSubmit={submit} className="space-y-4" data-testid="login-form">
              <div>
                <label className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Email</label>
                <input
                  data-testid="login-email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-2 w-full h-12 px-4 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700"
                  placeholder="you@cuelounge.com"
                />
              </div>
              <div>
                <label className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Password</label>
                <div className="relative mt-2">
                  <input
                    data-testid="login-password"
                    type={show ? "text" : "password"}
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full h-12 px-4 pr-12 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700"
                    placeholder="••••••••"
                  />
                  <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" data-testid="toggle-password-visibility">
                    {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>
              <div className="flex items-center justify-between text-sm">
                <label className="inline-flex items-center gap-2 text-gray-300 cursor-pointer">
                  <input data-testid="remember-me" type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="w-4 h-4 accent-green-600" />
                  Remember me
                </label>
                <button type="button" onClick={() => setForgotOpen(true)} className="text-green-500 hover:text-green-400 font-medium" data-testid="forgot-password-link">Forgot password?</button>
              </div>
              <button
                data-testid="login-submit-btn"
                type="submit"
                disabled={busy}
                className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-60"
              >
                {busy ? <Loader2 className="w-5 h-5 animate-spin" /> : "Sign in"}
              </button>
              <div className="text-xs text-center text-gray-500 mt-6">
                Demo · admin@snooker.com / admin123 &nbsp;|&nbsp; staff@snooker.com / staff123
              </div>
            </form>
          ) : (
            <div className="space-y-4">
              <p className="text-sm text-gray-400">Enter your account email. A reset link will be generated in server logs.</p>
              <input
                data-testid="forgot-email"
                type="email"
                value={forgotEmail}
                onChange={(e) => setForgotEmail(e.target.value)}
                className="w-full h-12 px-4 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700"
                placeholder="you@cuelounge.com"
              />
              <div className="flex gap-3">
                <button data-testid="forgot-submit" onClick={sendForgot} className="flex-1 h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold">Send reset link</button>
                <button onClick={() => setForgotOpen(false)} className="px-6 h-12 rounded-xl bg-[#1c1c1c] hover:bg-[#262626] text-gray-300">Back</button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
