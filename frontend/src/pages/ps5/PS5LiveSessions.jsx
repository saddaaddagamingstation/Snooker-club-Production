import Sessions from "@/pages/Sessions";

// Reuse the existing session controls, billing modal, pause/resume and timer UI,
// but scope the list to PS5 so Snooker sessions stay on their original page.
export default function PS5LiveSessions(){ return <Sessions gameType="ps5" />; }
