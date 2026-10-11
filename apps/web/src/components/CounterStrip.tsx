import type { ContactRowDto, SearchEventDto } from '@scrapjob/schema/api';
import type { QuickFilter } from './ResultsTable';

interface Props {
  events: SearchEventDto[];
  rows: ContactRowDto[];
  targetCount: number;
  quickFilter: QuickFilter;
  onQuickFilter: (filter: QuickFilter) => void;
}

function countersFrom(events: SearchEventDto[]) {
  const active = new Set<string>();
  let companies = 0;
  let duplicates = 0;
  let requests = 0;
  for (const e of events) {
    const adapter = typeof e.metadata.adapter === 'string' ? e.metadata.adapter : null;
    if (e.type === 'SOURCE_INITIALIZED' && adapter) active.add(adapter);
    if (e.type === 'SOURCE_DISABLED' && adapter) active.delete(adapter);
    if (e.type === 'COMPANY_DISCOVERED') companies += 1;
    if (e.type === 'DUPLICATE_MERGED') duplicates += 1;
    // Same count as the History page: page requests plus search API calls.
    const spent = e.metadata.budgetSpent as { httpRequests?: number; searchApiCalls?: number } | undefined;
    if (typeof spent?.httpRequests === 'number') requests = spent.httpRequests + (spent.searchApiCalls ?? 0);
  }
  return { companies, sources: active.size, duplicates, requests };
}

export function CounterStrip({ events, rows, targetCount, quickFilter, onQuickFilter }: Props) {
  const c = countersFrom(events);
  const leads = rows.filter((r) => r.lead).length;
  const filters: [QuickFilter, string, string][] = [
    ['all', 'Contacts', `${rows.length} / ${targetCount}`],
    ['confirmed', 'Confirmed', String(rows.length - leads)],
    ['leads', 'Unconfirmed leads', String(leads)],
  ];
  const stats: [string, string][] = [
    ['Companies', String(c.companies)],
    ['Sources active', String(c.sources)],
    ['Duplicates merged', String(c.duplicates)],
    ['Requests spent', String(c.requests)],
  ];
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-200 bg-neutral-200 sm:grid-cols-7">
      {filters.map(([filter, label, value]) => (
        <div key={label} className={quickFilter === filter ? 'bg-neutral-100' : 'bg-white'}>
          <button
            type="button"
            aria-pressed={quickFilter === filter}
            onClick={() => onQuickFilter(filter)}
            className="w-full px-3 py-2 text-left hover:bg-neutral-100"
            title={`Show ${label.toLowerCase()} in the table`}
          >
            <span className={`block text-xs ${quickFilter === filter ? 'font-semibold text-neutral-900' : 'text-neutral-500'}`}>{label}</span>
            <span className="block text-lg font-semibold tabular-nums text-neutral-900">{value}</span>
          </button>
        </div>
      ))}
      {stats.map(([label, value]) => (
        <dl key={label} className="bg-white px-3 py-2">
          <dt className="text-xs text-neutral-500">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-neutral-900">{value}</dd>
        </dl>
      ))}
    </div>
  );
}
