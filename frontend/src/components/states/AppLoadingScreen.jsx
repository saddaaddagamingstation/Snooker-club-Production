
export default function AppLoadingScreen({
  message = "Preparing your workspace...",
}) {
  return (
    <div
      className="min-h-screen flex flex-col items-center justify-center bg-[#0A0A0A] text-white"
      role="status"
      aria-live="polite"
    >
      <div className="flex items-center gap-3 mb-8">
        <div className="w-11 h-11 rounded-full bg-white flex items-center justify-center shadow-[0_0_24px_rgba(34,197,94,0.2)]">
          <img
            src="/logo.png"
            alt=""
            className="w-8 h-8 object-contain"
          />
        </div>

        <span className="text-3xl font-bold tracking-[0.06em]">
          CUE OPS
        </span>
      </div>

      <p className="text-sm text-gray-400 mb-5">
        {message}
      </p>

      <div className="w-48 h-1 rounded-full bg-[#262626] overflow-hidden">
        <div className="h-full w-1/3 rounded-full bg-green-500 animate-[loading_1.4s_ease-in-out_infinite]" />
      </div>
    </div>
  );
}
