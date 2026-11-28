import { useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Circle, CheckCircle2, XCircle } from "lucide-react";
import api, { formatApiErrorDetail } from "@/lib/api";

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const token = searchParams.get("token") || "";

  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);

  const rules = useMemo(() => ({
    length: password.length >= 8,
    letter: /\p{L}/u.test(password),
    number: /\p{N}/u.test(password),
    symbol: /[^\p{L}\p{N}]/u.test(password),
  }), [password]);

  const validPassword = Object.values(rules).every(Boolean);
  const passwordsMatch = password.length > 0 && password === confirmPassword;

  const submit = async (e) => {
    e.preventDefault();
    if (!token) {
      toast.error("This reset link is invalid or incomplete. Request a new one.");
      return;
    }
    if (!validPassword) {
      toast.error("Your password does not meet all the requirements.");
      return;
    }
    if (!passwordsMatch) {
      toast.error("Passwords do not match.");
      return;
    }

    setBusy(true);
    try {
      await api.post("/auth/reset-password", { token, password });
      setCompleted(true);
      toast.success("Password updated successfully.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail) || "Unable to reset password. The link may have expired.");
    } finally {
      setBusy(false);
    }
  };

  const Rule = ({ passed, children }) => (
    <div className={`flex items-center gap-2 text-xs ${passed ? "text-green-400" : "text-gray-500"}`}>
      {passed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
      {children}
    </div>
  );

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0A0A0A] px-5 py-10 text-white">
      <div className="w-full max-w-md">
        <div className="flex items-center gap-3 mb-10">
          <div className="w-11 h-11 rounded-full bg-green-700 flex items-center justify-center">
            <Circle className="w-5 h-5 fill-white/20" />
          </div>
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-green-400 font-bold">Sadda Adda Snooker</div>
            <div className="text-sm text-gray-400">Account security</div>
          </div>
        </div>

        {completed ? (
          <div>
            <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-3">Password changed</div>
            <h1 className="text-3xl font-bold tracking-tight mb-3">You're all set.</h1>
            <p className="text-sm text-gray-400 mb-7">Your password has been updated. You can now sign in using your new password.</p>
            <button
              type="button"
              onClick={() => navigate("/login", { replace: true })}
              className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 font-semibold"
            >
              Back to sign in
            </button>
          </div>
        ) : !token ? (
          <div>
            <h1 className="text-3xl font-bold tracking-tight mb-3">Invalid reset link</h1>
            <p className="text-sm text-gray-400 mb-7">This link is missing its reset token. Request a new password reset email.</p>
            <Link to="/login" className="text-green-400 hover:text-green-300 text-sm font-semibold">Back to sign in</Link>
          </div>
        ) : (
          <>
            <div className="text-xs uppercase tracking-[0.25em] text-green-500 font-bold mb-3">Password recovery</div>
            <h1 className="text-3xl font-bold tracking-tight mb-2">Create a new password</h1>
            <p className="text-sm text-gray-400 mb-8">Choose a strong password for your account.</p>

            <form onSubmit={submit} className="space-y-5">
              <div>
                <label className="text-xs uppercase tracking-wider text-gray-400 font-semibold">New password</label>
                <div className="relative mt-2">
                  <input
                    type={showPassword ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className="w-full h-12 px-4 pr-12 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700"
                    placeholder="Enter new password"
                  />
                  <button type="button" onClick={() => setShowPassword((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" aria-label={showPassword ? "Hide password" : "Show password"}>
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 mt-3">
                  <Rule passed={rules.length}>At least 8 characters</Rule>
                  <Rule passed={rules.letter}>At least 1 letter</Rule>
                  <Rule passed={rules.number}>At least 1 number</Rule>
                  <Rule passed={rules.symbol}>At least 1 symbol</Rule>
                </div>
              </div>

              <div>
                <label className="text-xs uppercase tracking-wider text-gray-400 font-semibold">Confirm new password</label>
                <div className="relative mt-2">
                  <input
                    type={showConfirm ? "text" : "password"}
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    className="w-full h-12 px-4 pr-12 rounded-lg bg-[#0f0f0f] border border-[#262626] text-white placeholder-gray-600 focus:outline-none focus:border-green-700 focus:ring-1 focus:ring-green-700"
                    placeholder="Re-enter new password"
                  />
                  <button type="button" onClick={() => setShowConfirm((v) => !v)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300" aria-label={showConfirm ? "Hide password" : "Show password"}>
                    {showConfirm ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {confirmPassword.length > 0 && (
                  <p className={`text-xs mt-2 ${passwordsMatch ? "text-green-400" : "text-red-400"}`}>
                    {passwordsMatch ? "Passwords match" : "Passwords do not match"}
                  </p>
                )}
              </div>

              <button
                type="submit"
                disabled={busy || !validPassword || !passwordsMatch}
                className="w-full h-12 rounded-xl bg-green-700 hover:bg-green-800 text-white font-semibold flex items-center justify-center gap-2 transition-all disabled:opacity-50"
              >
                {busy ? <><Loader2 className="w-5 h-5 animate-spin" /> Updating...</> : "Update password"}
              </button>
            </form>
            <p className="text-xs text-gray-500 mt-6">Reset links expire after 1 hour and can only be used once.</p>
          </>
        )}
      </div>
    </div>
  );
}
