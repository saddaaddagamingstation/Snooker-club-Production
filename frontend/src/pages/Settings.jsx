
import { useEffect, useState } from "react";
import api, { formatApiErrorDetail } from "@/lib/api";
import { useAuth } from "@/lib/auth";
import {
  Save,
  Settings as SettingsIcon,
  CheckCircle2,
  Info,
  Bell,
  BellRing,
  Volume2,
  Power,
} from "lucide-react";
import { toast } from "sonner";

const DEFAULTS = {
  snooker: {
    players: { "2": 170, "3": 170, "4": 180, "5": 220, "6": 260 },
    extra_minute: 5,
  },
  mini_snooker: {
    players: { "2": 110, "3": 120, "4": 130, "5": 140, "6": 150 },
    extra_minute: 5,
  },
  pool: { package_30: 130, package_60: 250 },
  ps5: { players: { "1": 129, "2": 199, "3": 299, "4": 369 } },
  rd_price: 20,
};

const ALERTS_ENABLED_KEY = "cueops_timer_alerts_enabled";
const ALERT_SOUND_KEY = "cueops_timer_alert_sound";
const ALERT_DESKTOP_KEY = "cueops_timer_alert_desktop";

function readPreference(key, fallback) {
  if (typeof window === "undefined") return fallback;
  const value = window.localStorage.getItem(key);
  return value === null ? fallback : value === "true";
}

function ToggleSwitch({ checked, onChange, label, disabled = false }) {
  return (
    <button
      type="button"
      role="switch"
      aria-label={label}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative h-7 w-12 shrink-0 rounded-full border transition-colors duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-green-500 focus-visible:ring-offset-2 focus-visible:ring-offset-[#0d0d0d] disabled:cursor-not-allowed disabled:opacity-40 ${checked ? "border-green-600 bg-green-600" : "border-gray-600 bg-gray-700"}`}
    >
      <span
        aria-hidden="true"
        className="absolute top-[3px] h-5 w-5 rounded-full bg-white shadow transition-[left] duration-200"
        style={{ left: checked ? "24px" : "3px" }}
      />
    </button>
  );
}

export default function Settings() {
  const { user } = useAuth();

  const [pricing, setPricing] = useState(DEFAULTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedPricing, setSavedPricing] = useState(null);

  const [notificationPermission, setNotificationPermission] = useState(
    typeof window !== "undefined" && "Notification" in window
      ? Notification.permission
      : "unsupported"
  );

  const [alertsEnabled, setAlertsEnabled] = useState(
    () => readPreference(ALERTS_ENABLED_KEY, true)
  );
  const [soundEnabled, setSoundEnabled] = useState(
    () => readPreference(ALERT_SOUND_KEY, true)
  );
  const [desktopEnabled, setDesktopEnabled] = useState(
    () => readPreference(ALERT_DESKTOP_KEY, false)
  );

  const isAdmin = user?.role === "admin";

  useEffect(() => {
    api.get("/settings/game-pricing")
      .then(({ data }) => {
        const merged = {
          ...DEFAULTS,
          ...data,
          snooker: {
            ...DEFAULTS.snooker,
            ...data.snooker,
            players: {
              ...DEFAULTS.snooker.players,
              ...data.snooker?.players,
            },
          },
          mini_snooker: {
            ...DEFAULTS.mini_snooker,
            ...data.mini_snooker,
            players: {
              ...DEFAULTS.mini_snooker.players,
              ...data.mini_snooker?.players,
            },
          },
          pool: { ...DEFAULTS.pool, ...data.pool },
          ps5: {
            ...DEFAULTS.ps5,
            ...data.ps5,
            players: {
              ...DEFAULTS.ps5.players,
              ...data.ps5?.players,
            },
          },
        };

        setPricing(merged);
        setSavedPricing(JSON.stringify(merged));
      })
      .catch((e) =>
        toast.error(formatApiErrorDetail(e.response?.data?.detail))
      )
      .finally(() => setLoading(false));
  }, []);

  const toggleAlerts = (enabled) => {
    setAlertsEnabled(enabled);
    localStorage.setItem(ALERTS_ENABLED_KEY, String(enabled));
    toast.success(enabled ? "Timer alerts enabled." : "Timer alerts disabled.");
  };

  const toggleSound = (enabled) => {
    setSoundEnabled(enabled);
    localStorage.setItem(ALERT_SOUND_KEY, String(enabled));
    toast.success(enabled ? "Alert sound enabled." : "Alert sound muted.");
  };

  const toggleDesktop = async (enabled) => {
    if (!enabled) {
      setDesktopEnabled(false);
      localStorage.setItem(ALERT_DESKTOP_KEY, "false");
      toast.success("Desktop notifications disabled in Cue Ops.");
      return;
    }
    if (!("Notification" in window)) {
      toast.error("This browser does not support desktop notifications.");
      return;
    }
    try {
      let permission = Notification.permission;
      if (permission === "default") permission = await Notification.requestPermission();
      setNotificationPermission(permission);
      if (permission !== "granted") {
        setDesktopEnabled(false);
        localStorage.setItem(ALERT_DESKTOP_KEY, "false");
        toast.error(permission === "denied"
          ? "Notifications are blocked. Allow them in your browser site settings."
          : "Browser notification permission was not granted.");
        return;
      }
      setDesktopEnabled(true);
      localStorage.setItem(ALERT_DESKTOP_KEY, "true");
      toast.success("Desktop timer notifications enabled.");
    } catch {
      toast.error("Could not enable desktop notifications.");
    }
  };

  const testSound = async () => {
    if (!alertsEnabled) {
      toast.error("Enable Timer Alerts first.");
      return;
    }
    if (!soundEnabled) {
      toast.error("Enable Alert Sound first.");
      return;
    }
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) {
        toast.error("Audio is not supported by this browser.");
        return;
      }
      // User gesture unlocks the shared audio context used by AppLayout.
      window.dispatchEvent(new Event("cueops-unlock-timer-audio"));
      const audio = new AudioContextClass();
      if (audio.state === "suspended") await audio.resume();
      const oscillator = audio.createOscillator();
      const gain = audio.createGain();
      oscillator.type = "sine";
      oscillator.frequency.setValueAtTime(880, audio.currentTime);
      gain.gain.setValueAtTime(0.18, audio.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audio.currentTime + 0.5);
      oscillator.connect(gain);
      gain.connect(audio.destination);
      oscillator.start();
      oscillator.stop(audio.currentTime + 0.5);
      oscillator.onended = () => audio.close();
    } catch {
      toast.error("Could not play the test sound.");
    }
  };

  const setValue = (path, value) =>
    setPricing((old) => {
      const next = structuredClone(old);
      const keys = path.split(".");
      let target = next;

      for (const key of keys.slice(0, -1)) {
        target = target[key];
      }

      target[keys[keys.length - 1]] =
        value === "" ? "" : Number(value);

      return next;
    });

  const save = async () => {
    setSaving(true);

    try {
      const clean = {
        ...pricing,

        snooker: {
          players: Object.fromEntries(
            [2, 3, 4, 5, 6].map((n) => [
              String(n),
              Number(pricing.snooker.players[n]),
            ])
          ),
          extra_minute: Number(pricing.snooker.extra_minute),
        },

        mini_snooker: {
          players: Object.fromEntries(
            [2, 3, 4, 5, 6].map((n) => [
              String(n),
              Number(pricing.mini_snooker.players[n]),
            ])
          ),
          extra_minute: Number(pricing.mini_snooker.extra_minute),
        },

        pool: {
          package_30: Number(pricing.pool.package_30),
          package_60: Number(pricing.pool.package_60),
        },

        ps5: {
          players: Object.fromEntries(
            [1, 2, 3, 4].map((n) => [
              String(n),
              Number(pricing.ps5.players[n]),
            ])
          ),
        },

        rd_price: Number(pricing.rd_price),
      };

      const { data } = await api.put("/settings/game-pricing", {
        pricing: clean,
      });

      const merged = {
        ...DEFAULTS,
        ...data,
        snooker: {
          ...DEFAULTS.snooker,
          ...data.snooker,
          players: {
            ...DEFAULTS.snooker.players,
            ...data.snooker?.players,
          },
        },
        mini_snooker: {
          ...DEFAULTS.mini_snooker,
          ...data.mini_snooker,
          players: {
            ...DEFAULTS.mini_snooker.players,
            ...data.mini_snooker?.players,
          },
        },
        pool: { ...DEFAULTS.pool, ...data.pool },
        ps5: {
          ...DEFAULTS.ps5,
          ...data.ps5,
          players: {
            ...DEFAULTS.ps5.players,
            ...data.ps5?.players,
          },
        },
      };

      setPricing(merged);
      setSavedPricing(JSON.stringify(merged));
      toast.success("Game prices saved successfully.");
    } catch (e) {
      toast.error(formatApiErrorDetail(e.response?.data?.detail));
    } finally {
      setSaving(false);
    }
  };

  const hasChanges =
    savedPricing !== null &&
    JSON.stringify(pricing) !== savedPricing;

  const numberInput = (label, path, value) => (
    <label className="block space-y-1.5" key={path}>
      <span className="text-xs font-semibold text-gray-400">
        {label}
      </span>

      <div className="flex items-center rounded-lg border border-[#303030] bg-[#0d0d0d] px-3">
        <span className="text-gray-500">₹</span>

        <input
          type="number"
          min="0"
          step="1"
          value={value ?? ""}
          onChange={(e) => setValue(path, e.target.value)}
          disabled={!isAdmin}
          className="w-full h-11 bg-transparent px-2 text-white outline-none disabled:opacity-60"
        />
      </div>
    </label>
  );

  if (loading) {
    return (
      <div className="p-8 text-gray-400">
        Loading settings…
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="rounded-xl border border-red-900/40 bg-red-950/20 p-6 text-red-300">
        Only an admin can change settings.
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto space-y-6 pb-28">

      {/* PAGE HEADER */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <SettingsIcon className="w-6 h-6 text-green-400" />
            <h1 className="text-2xl font-bold text-white">
              Settings
            </h1>
          </div>

          <p className="mt-2 text-sm text-gray-400">
            Manage game pricing and timer alert preferences.
          </p>
        </div>

        <span
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold ${
            hasChanges
              ? "border-amber-500/30 bg-amber-500/10 text-amber-300"
              : "border-green-500/25 bg-green-500/10 text-green-300"
          }`}
        >
          {hasChanges ? (
            <Info className="h-3.5 w-3.5" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5" />
          )}
          {hasChanges ? "Unsaved changes" : "Prices saved"}
        </span>
      </div>

      {/* TIMER ALERT SETTINGS */}
      <section className="rounded-2xl border border-[#292929] bg-[#141414] p-5 space-y-4">
        <div className="flex items-center gap-3">
          <div className="h-11 w-11 rounded-xl bg-green-500/10 flex items-center justify-center">
            <Bell className="h-5 w-5 text-green-400" />
          </div>
          <div>
            <h2 className="text-lg font-bold text-white">Timer Alerts</h2>
            <p className="text-xs text-gray-400">Manage timer alerts, sound and desktop notifications from here.</p>
          </div>
        </div>

        <div className="flex items-center justify-between gap-4 rounded-xl border border-[#303030] bg-[#0d0d0d] p-4">
          <div className="flex items-start gap-3 min-w-0">
            <Power className="h-5 w-5 mt-0.5 text-gray-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Timer Alerts</p>
              <p className="mt-1 text-xs text-gray-400">Master switch. When off, Cue Ops will not fetch or deliver timer alerts.</p>
              <p className={`mt-2 text-xs font-medium ${alertsEnabled ? "text-green-400" : "text-gray-500"}`}>
                {alertsEnabled ? "Timer alerts are active" : "Timer alerts are turned off"}
              </p>
            </div>
          </div>
          <ToggleSwitch checked={alertsEnabled} onChange={toggleAlerts} label="Enable timer alerts" />
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#303030] bg-[#0d0d0d] p-4 ${!alertsEnabled ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-3">
            <Volume2 className="h-5 w-5 mt-0.5 text-gray-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Alert Sound</p>
              <p className="mt-1 text-xs text-gray-400">Play a sound when a timer alert is delivered.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={testSound} disabled={!alertsEnabled || !soundEnabled}
              className="h-9 rounded-lg border border-[#383838] px-3 text-xs font-semibold text-gray-300 hover:bg-[#202020] disabled:cursor-not-allowed disabled:opacity-40">
              Test sound
            </button>
            <ToggleSwitch checked={soundEnabled} onChange={toggleSound} label="Enable alert sound" disabled={!alertsEnabled} />
          </div>
        </div>

        <div className={`flex flex-wrap items-center justify-between gap-4 rounded-xl border border-[#303030] bg-[#0d0d0d] p-4 ${!alertsEnabled ? "opacity-60" : ""}`}>
          <div className="flex items-start gap-3 min-w-0">
            <BellRing className="h-5 w-5 mt-0.5 text-gray-400 shrink-0" />
            <div>
              <p className="text-sm font-semibold text-white">Desktop Notifications</p>
              <p className="mt-1 text-xs text-gray-400">Show operating-system notifications when Cue Ops is open.</p>
              <p className="mt-2 text-xs">
                {notificationPermission === "granted" ? <span className="text-green-400">Browser permission allowed</span>
                  : notificationPermission === "denied" ? <span className="text-red-400">Blocked in browser settings</span>
                  : notificationPermission === "unsupported" ? <span className="text-gray-500">Not supported by this browser</span>
                  : <span className="text-amber-400">Browser permission not requested</span>}
              </p>
            </div>
          </div>
          <ToggleSwitch checked={desktopEnabled} onChange={toggleDesktop} label="Enable desktop notifications"
            disabled={!alertsEnabled || notificationPermission === "unsupported"} />
        </div>

        <p className="text-xs text-gray-500">
          Preferences are saved on this browser. Turning desktop notifications off here stops Cue Ops from sending them; it does not revoke browser permission. If browser permission is blocked, change it in your browser's site settings.
        </p>
      </section>

      {/* GAME PRICING */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        {[
          ["Snooker", "snooker"],
          ["Mini Snooker", "mini_snooker"],
        ].map(([title, key]) => (
          <section
            key={key}
            className="rounded-2xl border border-[#292929] bg-[#141414] p-5 space-y-4"
          >
            <h2 className="font-bold text-lg">{title}</h2>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {[2, 3, 4, 5, 6].map((n) =>
                numberInput(
                  `${n} players · first 30 min`,
                  `${key}.players.${n}`,
                  pricing[key].players[n]
                )
              )}
            </div>

            {numberInput(
              "Each additional minute",
              `${key}.extra_minute`,
              pricing[key].extra_minute
            )}
          </section>
        ))}

        <section className="rounded-2xl border border-[#292929] bg-[#141414] p-5 space-y-4">
          <h2 className="font-bold text-lg">Pool Packages</h2>

          <div className="grid grid-cols-2 gap-3">
            {numberInput(
              "30-minute package",
              "pool.package_30",
              pricing.pool.package_30
            )}

            {numberInput(
              "60-minute package",
              "pool.package_60",
              pricing.pool.package_60
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-[#292929] bg-[#141414] p-5 space-y-4">
          <h2 className="font-bold text-lg">PS5 Pricing</h2>

          <p className="text-xs text-gray-400">
            Set the hourly price according to the number of players.
          </p>

          <div className="grid grid-cols-2 gap-3">
            {[1, 2, 3, 4].map((n) =>
              numberInput(
                `${n} ${n === 1 ? "Player" : "Players"} · per hour`,
                `ps5.players.${n}`,
                pricing.ps5.players[n]
              )
            )}
          </div>

          <div className="rounded-xl border border-[#303030] bg-[#0d0d0d] p-3 space-y-2">
            <p className="text-xs font-semibold text-gray-400">
              Current PS5 Rates
            </p>

            {[1, 2, 3, 4].map((n) => (
              <div
                key={n}
                className="flex items-center justify-between text-sm"
              >
                <span className="text-gray-300">
                  {n} {n === 1 ? "Player" : "Players"}
                </span>
                <span className="font-semibold text-green-400">
                  ₹{pricing.ps5.players[n] || 0}/hour
                </span>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-[#292929] bg-[#141414] p-5 space-y-4">
          <h2 className="font-bold text-lg">Add-ons</h2>

          {numberInput(
            "R.D. add-on (once per session)",
            "rd_price",
            pricing.rd_price
          )}
        </section>
      </div>

      {/* SAVE PRICING */}
      <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#292929] bg-[#0b0b0b]/95 px-4 py-3 shadow-[0_-12px_35px_rgba(0,0,0,0.45)] backdrop-blur-md lg:left-56 lg:px-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-white">
              {hasChanges
                ? "You have unsaved price changes"
                : "Your pricing is up to date"}
            </p>

            <p className="text-xs text-gray-500">
              Save your changes to apply them to new sessions.
            </p>
          </div>

          <button
            onClick={save}
            disabled={saving || !hasChanges}
            className="h-11 shrink-0 rounded-xl bg-green-700 px-6 text-sm font-semibold text-white transition-colors hover:bg-green-600 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <span className="flex items-center gap-2">
              <Save className="h-4 w-4" />
              {saving ? "Saving…" : "Save Pricing"}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
