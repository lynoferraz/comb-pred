// Loading placeholders with the shared shimmer (.skeleton in globals.css).

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

// Placeholder matching MarketCard's layout while the summary loads.
export function MarketCardSkeleton() {
  return (
    <div className="bg-surface rounded-card p-[22px] border border-line flex flex-col gap-4 h-full">
      <div className="flex justify-between items-start gap-3.5">
        <div className="flex flex-col gap-2.5 flex-1">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-5 w-1/2" />
        </div>
        <Skeleton className="w-16 h-16 rounded-full" />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-10 rounded-xl" />
        <Skeleton className="h-10 rounded-xl" />
      </div>
      <Skeleton className="h-3.5 w-2/3" />
    </div>
  );
}

export function MarketGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid gap-3.5 [grid-template-columns:repeat(auto-fill,minmax(min(380px,100%),1fr))] stagger-children">
      {Array.from({ length: count }, (_, i) => (
        <MarketCardSkeleton key={i} />
      ))}
    </div>
  );
}
