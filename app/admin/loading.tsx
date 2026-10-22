export default function AdminLoading() {
  return (
    <div className="animate-pulse space-y-4" aria-busy aria-label="Loading">
      <div className="h-7 w-48 rounded-apple-sm bg-apple-fill-secondary" />
      <div className="h-4 w-72 max-w-full rounded-apple-sm bg-apple-fill-secondary" />
      <div className="grid grid-cols-1 gap-4 pt-2 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-28 rounded-apple border border-apple-divider bg-white" />
        ))}
      </div>
    </div>
  );
}
