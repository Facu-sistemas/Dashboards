import { useIsFetching } from '@tanstack/react-query';

/** Small floating indicator, visible whenever any query in this island's QueryClient is fetching in the background (filter changes, search debounce, etc.) — not the big per-section skeletons, just a subtle "something's happening" cue. */
export default function LoadingIndicator() {
  const isFetching = useIsFetching();
  if (isFetching === 0) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900/90 px-3 py-1.5 text-xs text-slate-300 shadow-lg backdrop-blur"
    >
      <span className="h-3 w-3 animate-spin rounded-full border-2 border-slate-600 border-t-brand-500" />
      Actualizando…
    </div>
  );
}
