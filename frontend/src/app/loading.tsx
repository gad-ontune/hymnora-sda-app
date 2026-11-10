/**
 * Route-transition placeholder. Content pages fetch on the client right after
 * mount, so navigation is never held hostage by a slow API call; when a route
 * is still streaming in, this quiet skeleton keeps the transition calm instead
 * of flashing the previous page or an empty frame.
 */
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-[1440px] p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="h-3 w-24 rounded-full bg-ink/10" />
          <div className="mt-3 h-8 w-72 rounded-full bg-ink/10" />
          <div className="mt-2 h-4 w-48 rounded-full bg-ink/[0.07]" />
          <div className="mt-9 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, at) => (
              <div key={at} className="overflow-hidden rounded-[22px] border border-line bg-surface p-5 shadow-soft">
                <div className="aspect-[1.4] rounded-2xl bg-ink/[0.06]" />
                <div className="mt-4 h-4 w-3/4 rounded-full bg-ink/10" />
                <div className="mt-2 h-3 w-1/2 rounded-full bg-ink/[0.07]" />
              </div>
            ))}
          </div>
        </div>
        <aside className="hidden lg:block">
          <div className="rounded-[22px] border border-line bg-surface p-5 shadow-soft">
            <div className="h-3 w-20 rounded-full bg-ink/10" />
            <div className="mt-3 h-4 w-full rounded-full bg-ink/[0.07]" />
            <div className="mt-2 h-4 w-5/6 rounded-full bg-ink/[0.07]" />
          </div>
        </aside>
      </div>
    </main>
  );
}