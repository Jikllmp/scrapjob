import type { SearchDto } from '@scrapjob/schema/api';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';
import { deleteSearch, listSearches } from '../lib/api';
import { Link } from '../lib/router';

const statusStyle: Record<SearchDto['status'], string> = {
  queued: 'text-neutral-500',
  running: 'text-sky-700',
  completed: 'text-emerald-700',
  failed: 'text-red-700',
  cancelled: 'text-neutral-500',
};

interface Props {
  onLogSearch: (searchId: string | null, follow: boolean) => void;
}

/** Every search run so far, newest first. */
export function HistoryPage({ onLogSearch }: Props) {
  useEffect(() => onLogSearch(null, false), [onLogSearch]);
  const queryClient = useQueryClient();
  const searches = useQuery({ queryKey: ['searches'], queryFn: () => listSearches(100) });
  const remove = useMutation({
    mutationFn: deleteSearch,
    onSuccess: (_data, id) => {
      queryClient.removeQueries({ queryKey: ['contacts', id] });
      void queryClient.invalidateQueries({ queryKey: ['privacy'] });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['searches'] }),
  });

  if (searches.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  const items = searches.data?.items ?? [];
  if (items.length === 0) {
    return (
      <p className="text-sm text-neutral-600">
        No search yet. <Link to="/" className="text-blue-700 hover:underline">Start one</Link>.
      </p>
    );
  }
  return (
    <div className="max-w-5xl space-y-2">
      {remove.error && (
        <p role="alert" className="text-sm text-red-700">
          Could not delete the search: {remove.error.message}
        </p>
      )}
      <table className="w-full rounded border border-neutral-200 bg-white text-left text-sm">
        <caption className="sr-only">Search history</caption>
        <thead className="border-b border-neutral-200 text-xs text-neutral-500">
          <tr>
            <th className="px-3 py-1.5 font-medium">Started</th>
            <th className="px-3 py-1.5 font-medium">Position</th>
            <th className="px-3 py-1.5 font-medium">Location</th>
            <th className="px-3 py-1.5 font-medium">Status</th>
            <th className="px-3 py-1.5 text-right font-medium">Contacts</th>
            <th className="px-3 py-1.5 text-right font-medium">Companies</th>
            <th className="px-3 py-1.5 text-right font-medium">Requests</th>
            <th className="px-3 py-1.5" />
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {items.map((s) => (
            <tr key={s.id}>
              <td className="px-3 py-1.5 tabular-nums text-neutral-600">{s.createdAt.replace('T', ' ').slice(0, 16)}</td>
              <td className="px-3 py-1.5">
                <Link to={`/?search=${encodeURIComponent(s.id)}`} className="font-medium hover:underline">
                  {s.position}
                </Link>
              </td>
              <td className="px-3 py-1.5">{s.location}</td>
              <td className={`px-3 py-1.5 ${statusStyle[s.status]}`} title={s.error ?? s.stopReason ?? ''}>
                {s.status}
                {s.stopReason && <span className="text-neutral-500"> · {s.stopReason.replace(/_/g, ' ')}</span>}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">
                {s.counters.contactsValidated} / {s.targetCount}
              </td>
              <td className="px-3 py-1.5 text-right tabular-nums">{s.counters.companies}</td>
              <td className="px-3 py-1.5 text-right tabular-nums">{s.budgetSpent.httpRequests + s.budgetSpent.searchApiCalls}</td>
              <td className="px-3 py-1.5 text-right">
                {s.status !== 'running' && s.status !== 'queued' && (
                  <button
                    type="button"
                    onClick={() => remove.mutate(s.id)}
                    disabled={remove.isPending}
                    className="text-xs text-red-700 hover:underline disabled:opacity-40"
                    aria-label={`Delete the search ${s.position} in ${s.location} and its contacts`}
                  >
                    Delete
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
