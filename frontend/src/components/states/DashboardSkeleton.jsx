
function Skeleton({ className = "" }) {
  return (
    <div
      className={`animate-pulse rounded-xl bg-[#1c1c1c] ${className}`}
    />
  );
}

export default function DashboardSkeleton() {
  return (
    <div className="space-y-8" aria-label="Loading dashboard" role="status">
      {/* Header */}
      <div className="flex justify-between items-start gap-4">
        <div className="space-y-3">
          <Skeleton className="h-10 w-72" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>

        <div className="hidden sm:flex gap-3">
          <Skeleton className="h-12 w-32" />
          <Skeleton className="h-12 w-36" />
          <Skeleton className="h-12 w-36" />
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr] gap-6">
        <Skeleton className="h-[360px] sm:col-span-2 lg:col-span-1 lg:row-span-2" />
        <Skeleton className="h-[168px]" />
        <Skeleton className="h-[168px]" />
        <Skeleton className="h-[168px]" />
        <Skeleton className="h-[168px]" />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Skeleton className="h-[340px] lg:col-span-2" />
        <Skeleton className="h-[340px]" />
      </div>

      {/* Peak hours */}
      <Skeleton className="h-[280px]" />

      {/* Recent activity */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <Skeleton className="h-[260px]" />
        <Skeleton className="h-[260px]" />
      </div>
    </div>
  );
}
