import { HydrationBoundary, QueryClient, QueryClientProvider, type DehydratedState } from '@tanstack/react-query';
import { useState, type PropsWithChildren } from 'react';

interface Props extends PropsWithChildren {
  dehydratedState?: DehydratedState;
}

/**
 * One QueryClient per mounted island (created lazily in state, not at
 * module scope) so SSR never shares a client/cache across requests.
 * staleTime is short: the whole point of this dashboard is fresh Odoo
 * data, so we lean on refetch-on-filter-change rather than long caching.
 *
 * `dehydratedState`, when provided, seeds the cache with data the Astro
 * page already fetched server-side (see lib/dashboard-ssr.ts) so the first
 * paint has real numbers instead of skeletons.
 */
export default function QueryProvider({ children, dehydratedState }: Props) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 10_000,
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      })
  );

  return (
    <QueryClientProvider client={client}>
      <HydrationBoundary state={dehydratedState}>{children}</HydrationBoundary>
    </QueryClientProvider>
  );
}
