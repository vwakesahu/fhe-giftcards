export default function Loading() {
  return (
    <div className="space-y-8 animate-pulse">
      <div>
        <div className="h-10 w-48 bg-muted rounded" />
        <div className="h-4 w-72 bg-muted rounded mt-3" />
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-px">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-muted" />
        ))}
      </div>
      <div className="space-y-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-14 border-t border-border" />
        ))}
      </div>
    </div>
  );
}
