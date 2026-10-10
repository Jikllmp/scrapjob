import { useQuery } from '@tanstack/react-query';
import { useEffect } from 'react';
import { listSources } from '../lib/api';
import { Link } from '../lib/router';

interface Props {
  onLogSearch: (searchId: string | null, follow: boolean) => void;
}

/** The adapter registry and each source's health. */
export function SourcesPage({ onLogSearch }: Props) {
  useEffect(() => onLogSearch(null, false), [onLogSearch]);
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources });
  if (sources.isLoading) return <p className="text-sm text-neutral-500">Checking sources…</p>;
  const items = sources.data?.items ?? [];
  const last = items.find((s) => s.lastSearch)?.lastSearch;
  return (
    <div className="max-w-5xl space-y-2">
      <p className="text-sm text-neutral-600">
        Sources are switched on in <code>ENABLED_SOURCES</code>.{' '}
        {last && (
          <>
            Health is from the <Link to={`/?search=${encodeURIComponent(last.searchId)}`} className="text-blue-700 hover:underline">latest search</Link>.
          </>
        )}
      </p>
      <table className="w-full rounded border border-neutral-200 bg-white text-left text-sm">
        <caption className="sr-only">Sources and their health</caption>
        <thead className="border-b border-neutral-200 text-xs text-neutral-500">
          <tr>
            <th className="px-3 py-1.5 font-medium">Source</th>
            <th className="px-3 py-1.5 font-medium">Gives</th>
            <th className="px-3 py-1.5 font-medium">State</th>
            <th className="px-3 py-1.5 text-right font-medium">Contacts so far</th>
            <th className="px-3 py-1.5 font-medium">Latest search</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {items.map((s) => {
            const state = !s.enabled ? 'off' : s.available ? (s.lastSearch?.disabled ? 'failing' : 'ready') : 'unavailable';
            const colour = { off: 'text-neutral-400', ready: 'text-emerald-700', failing: 'text-red-700', unavailable: 'text-amber-700' }[state];
            return (
              <tr key={s.id}>
                <td className="px-3 py-1.5">
                  <div className="font-medium">{s.displayName}</div>
                  <div className="text-xs text-neutral-500">{s.id}</div>
                </td>
                <td className="px-3 py-1.5 text-neutral-600">{s.capabilities.join(', ')}</td>
                <td className={`px-3 py-1.5 ${colour}`}>
                  {state}
                  {s.enabled && s.unavailableReason && <div className="text-xs text-neutral-600">{s.unavailableReason}</div>}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums">{s.contacts}</td>
                <td className="px-3 py-1.5 text-xs text-neutral-600">
                  {s.lastSearch && s.enabled
                    ? `${s.lastSearch.failures} failure${s.lastSearch.failures === 1 ? '' : 's'}${s.lastSearch.disabled ? ', disabled' : ''}${s.lastSearch.lastError ? ` · ${s.lastSearch.lastError}` : ''}`
                    : '—'}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
