import { useEffect, useRef } from "react";
import { toast } from "sonner";
import api from "@/lib/api";
import { NavLink, Outlet, Link, useNavigate } from "react-router-dom";
import { LayoutDashboard, CalendarPlus, CalendarCheck, Gamepad2, ArrowLeft, LogOut } from "lucide-react";
import { useAuth } from "@/lib/auth";

const links=[
 {to:"/ps5",end:true,label:"Overview",icon:LayoutDashboard},
 {to:"/ps5/bookings",label:"Bookings",icon:CalendarPlus},
 {to:"/ps5/reservations",label:"Reservations",icon:CalendarCheck},
 {to:"/ps5/live",label:"Live Sessions",icon:Gamepad2},
];
export default function PS5Layout(){
 const {user,logout,can}=useAuth();const navigate=useNavigate();const audioRef=useRef(null);
 useEffect(()=>{
  const unlock=async()=>{try{const C=window.AudioContext||window.webkitAudioContext;if(!C)return;if(!audioRef.current||audioRef.current.state==="closed")audioRef.current=new C();if(audioRef.current.state!=="running")await audioRef.current.resume();}catch(e){console.warn("PS5 alert audio unlock failed",e);}};
  window.addEventListener("cueops-unlock-timer-audio",unlock);return()=>window.removeEventListener("cueops-unlock-timer-audio",unlock);
 },[]);
 useEffect(()=>{
  if(!user?.id||!can("manage_sessions"))return undefined;let alive=true,running=false;
  const sound=()=>{if(localStorage.getItem("cueops_timer_alerts_enabled")==="false"||localStorage.getItem("cueops_timer_alert_sound")==="false")return;const C=window.AudioContext||window.webkitAudioContext;if(!C)return;try{if(!audioRef.current||audioRef.current.state==="closed")audioRef.current=new C();const ctx=audioRef.current;if(ctx.state!=="running"){ctx.resume().catch(()=>{});return;}const at=ctx.currentTime;[0,.22,.44].forEach(offset=>{const osc=ctx.createOscillator(),gain=ctx.createGain();osc.type="sine";osc.frequency.value=880;gain.gain.setValueAtTime(.0001,at+offset);gain.gain.exponentialRampToValueAtTime(.18,at+offset+.02);gain.gain.exponentialRampToValueAtTime(.0001,at+offset+.17);osc.connect(gain);gain.connect(ctx.destination);osc.start(at+offset);osc.stop(at+offset+.18);});}catch(e){console.warn("PS5 timer alert sound failed",e);}};
  const deliver=async()=>{if(!alive||running||localStorage.getItem("cueops_timer_alerts_enabled")==="false")return;running=true;try{const {data}=await api.get("/timer-alerts/pending");for(const candidate of data||[]){if(!alive||localStorage.getItem("cueops_timer_alerts_enabled")==="false")break;const claim=await api.post(`/timer-alerts/${candidate.id}/claim`);if(!claim.data?.claimed||!claim.data?.alert)continue;const a=claim.data.alert,title=`Timer Alert – ${a.remaining_display} remaining`,body=[`Game: ${a.game_type}`,`Station: ${a.table_number}`,`Remaining: ${a.remaining_display}`,"","Please inform the customer."].join("\n");toast.warning(title,{description:body,duration:15000});if(localStorage.getItem("cueops_timer_alert_desktop")==="true"&&"Notification"in window&&Notification.permission==="granted"){try{const n=new Notification(title,{body,tag:`cueops-timer-${a.timer_block_id}`,renotify:false,requireInteraction:true});n.onclick=()=>{window.focus();n.close();};}catch(e){console.warn("PS5 desktop alert failed",e);}}sound();}}catch(e){/* Keep PS5 pages usable while alerts retry. */}finally{running=false;}};
  deliver();const timer=window.setInterval(deliver,3000);return()=>{alive=false;window.clearInterval(timer);};
 },[user?.id,can]);
 return <div className="min-h-screen w-full flex bg-[#0A0A0A] text-white overflow-x-hidden">
  <aside className="w-56 shrink-0 bg-[#0d0d0d] border-r border-[#1c1c1c] min-h-screen flex flex-col">
   <div className="p-3 border-b border-[#1c1c1c]"><Link to="/dashboard" className="flex items-center gap-2 text-sm font-medium text-gray-300 hover:text-white px-3 py-2.5 rounded-lg bg-[#1c1c1c] hover:bg-[#252525]"><ArrowLeft className="w-4 h-4"/>Back to Home</Link></div>
   <div className="p-4 border-b border-[#1c1c1c]"><div className="text-xl font-bold">CUE OPS</div><div className="text-xs text-green-500 uppercase tracking-[.2em] mt-1">PS5 Management</div></div>
   <nav className="flex-1 px-3 py-4 space-y-1">{links.map(({to,label,icon:Icon,end})=><NavLink key={to} to={to} end={end} className={({isActive})=>`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium ${isActive?"bg-green-700/15 text-green-400 border border-green-700/30":"text-gray-400 hover:bg-[#1c1c1c] hover:text-white border border-transparent"}`}><Icon className="w-5 h-5 shrink-0"/><span>{label}</span></NavLink>)}</nav>
   <div className="p-3 border-t border-[#1c1c1c] space-y-2"><div className="text-xs text-gray-500 px-3">Signed in as {user?.name||"User"}</div><button onClick={()=>{logout();navigate("/login");}} className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-red-300"><LogOut className="w-4 h-4"/>Sign out</button></div>
  </aside>
  <div className="flex-1 min-w-0 w-0 flex flex-col"><header className="h-16 shrink-0 border-b border-[#1c1c1c] flex items-center px-5 sm:px-8"><h1 className="font-bold text-xl">PS5 Management</h1></header><main className="w-full min-w-0 flex-1 p-5 sm:p-8"><div className="w-full max-w-[1600px] mx-auto min-w-0"><Outlet/></div></main></div>
 </div>;
}
