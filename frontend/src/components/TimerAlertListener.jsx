
import { useEffect, useRef } from "react";
import api from "@/lib/api";
import { toast } from "sonner";

const SOUND_KEY = "cueops_timer_alert_sound";
const POLL_INTERVAL = 5000;

function playAlertSound() {
  if (localStorage.getItem(SOUND_KEY) === "false") return;

  try {
    const AudioContext =
      window.AudioContext || window.webkitAudioContext;

    if (!AudioContext) return;

    const audio = new AudioContext();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.type = "sine";
    oscillator.frequency.setValueAtTime(880, audio.currentTime);
    oscillator.frequency.setValueAtTime(660, audio.currentTime + 0.2);

    gain.gain.setValueAtTime(0.2, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + 0.7
    );

    oscillator.connect(gain);
    gain.connect(audio.destination);

    oscillator.start();
    oscillator.stop(audio.currentTime + 0.7);
    oscillator.onended = () => audio.close();
  } catch (error) {
    console.error("Timer alert sound failed:", error);
  }
}

function showBrowserNotification(alert) {
  if (
    !("Notification" in window) ||
    Notification.permission !== "granted"
  ) {
    return;
  }

  try {
    const notification = new Notification(
      `${alert.game_type} Timer Alert`,
      {
        body: `${alert.table_number} · ${alert.remaining_display} remaining. Please inform the customer.`,
        tag: `cueops-timer-${alert.id}`,
        requireInteraction: true,
      }
    );

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  } catch (error) {
    console.error("Browser notification failed:", error);
  }
}

export default function TimerAlertListener() {
  const processingRef = useRef(false);

  useEffect(() => {
    let mounted = true;

    const checkAlerts = async () => {
      if (processingRef.current || !mounted) return;

      processingRef.current = true;

      try {
        const { data } = await api.get("/timer-alerts/pending");

        if (!mounted || !Array.isArray(data)) return;

        for (const alert of data) {
          if (!mounted) break;

          try {
            // Claim first so the same alert is not delivered repeatedly.
            const { data: claim } = await api.post(
              `/timer-alerts/${alert.id}/claim`
            );

            if (!claim?.claimed || !claim.alert) continue;

            const claimedAlert = claim.alert;

            playAlertSound();
            showBrowserNotification(claimedAlert);

            toast.warning(
              `${claimedAlert.game_type} · ${claimedAlert.table_number}`,
              {
                description:
                  `${claimedAlert.remaining_display} remaining. Please inform the customer.`,
                duration: 12000,
              }
            );
          } catch (error) {
            console.error("Could not process timer alert:", error);
          }
        }
      } catch (error) {
        // Keep polling even if the server is temporarily unavailable.
        console.error("Timer alert check failed:", error);
      } finally {
        processingRef.current = false;
      }
    };

    checkAlerts();

    const interval = window.setInterval(
      checkAlerts,
      POLL_INTERVAL
    );

    return () => {
      mounted = false;
      window.clearInterval(interval);
    };
  }, []);

  return null;
}
