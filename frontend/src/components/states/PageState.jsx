
import {
  Loader2,
  AlertCircle,
  Inbox,
} from "lucide-react";

import { Button } from "@/components/ui/button";

export default function PageState({
  type = "loading",
  title,
  description,
  onRetry,
  actionLabel = "Try again",
  className = "",
}) {
  const config = {
    loading: {
      icon: Loader2,
      title: title || "Loading...",
      description: description || "Please wait while we fetch your data.",
      iconClass: "text-green-500 animate-spin",
    },
    error: {
      icon: AlertCircle,
      title: title || "Something went wrong",
      description:
        description || "We couldn't load this information. Please try again.",
      iconClass: "text-red-400",
    },
    empty: {
      icon: Inbox,
      title: title || "Nothing here yet",
      description:
        description || "There is no data to display right now.",
      iconClass: "text-gray-500",
    },
  };

  const state = config[type] || config.loading;
  const Icon = state.icon;

  return (
    <div
      role={type === "error" ? "alert" : "status"}
      aria-live={type === "error" ? "assertive" : "polite"}
      className={`flex min-h-[220px] flex-col items-center justify-center text-center px-6 py-10 ${className}`}
    >
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-[#262626] bg-[#141414]">
        <Icon className={`h-6 w-6 ${state.iconClass}`} />
      </div>

      <h3 className="text-base font-semibold text-white">
        {state.title}
      </h3>

      <p className="mt-2 max-w-md text-sm leading-relaxed text-gray-400">
        {state.description}
      </p>

      {type === "error" && onRetry && (
        <Button
          type="button"
          variant="outline"
          className="mt-5 border-[#333] text-white hover:bg-[#1c1c1c]"
          onClick={onRetry}
        >
          {actionLabel}
        </Button>
      )}
    </div>
  );
}
