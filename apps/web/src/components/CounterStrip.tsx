import type { SearchEventDto } from '@scrapjob/schema/api';

interface Props {
  events: SearchEventDto[];
  targetCount: number;
}

function countersFrom(events: SearchEventDto[]) {
  const active = new Set<string>();
  let contacts = 0;
  let companies = 0;
  let duplicates = 0;
  let requests = 0;
  for (const e of events) {
    const adapter = typeof e.metadata.adapter === 'string' ? e.metadata.adapter : null;
    if (e.type === 'SOURCE_INITIALIZED' && adapter) active.add(adapter);
    if (e.type === 'SOURCE_DISABLED' && adapter) active.delete(adapter);
    if (e.type === 'CONTACT_VALIDATED') contacts += 1;
    if (e.type === 'COMPANY_DISCOVERED') companies += 1;
    if (e.type === 'DUPLICATE_MERGED') duplicates += 1;
    const spent = e.metadata.budgetSpent as { httpRequests?: number } | undefined;
    if (typeof spent?.httpRequests === 'number') requests = spent.httpRequests;
  }
  return { contacts, companies, sources: active.size, duplicates, requests };
}

export function CounterStrip({ events, targetCount }: Props) {
  const c = countersFrom(events);
  const items: [string, string][] = [
    ['Contacts', `${c.contacts} / ${targetCount}`],
    ['Companies', String(c.companies)],
    ['Sources active', String(c.sources)],
    ['Duplicates merged', String(c.duplicates)],
    ['Requests spent', String(c.requests)],
  ];
  return (
    <dl aria-live="polite" className="grid grid-cols-2 gap-px overflow-hidden rounded border border-neutral-200 bg-neutral-200 sm:grid-cols-5">
      {items.map(([label, value]) => (
        <div key={label} className="bg-white px-3 py-2">
          <dt className="text-xs text-neutral-500">{label}</dt>
          <dd className="text-lg font-semibold tabular-nums text-neutral-900">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
