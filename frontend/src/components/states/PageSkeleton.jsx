
function Skeleton({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-[#1c1c1c] ${className}`}
    />
  );
}

export default function PageSkeleton() {
  return (
    <div
      className="space-y-6"
      role="status"
      aria-label="Loading page"
    >
      {/* Page heading */}
      <div className="flex items-center justify-between gap-4">
        <div className="space-y-3 flex-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64 max-w-full" />
        </div>
        <Skeleton className="h-10 w-28" />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="rounded-xl border border-[#262626] bg-[#111111] p-5 space-y-4"
          >
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        ))}
      </div>

      {/* Main content */}
      <div className="rounded-xl border border-[#262626] bg-[#111111] p-5 space-y-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
      </div>
    </div>
  );
}
