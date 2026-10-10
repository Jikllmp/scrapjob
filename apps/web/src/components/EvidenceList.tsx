import type { EvidenceDto } from '@scrapjob/schema/api';
import { label, sourceKindLabel } from '../lib/fields';

function host(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/** The snippet with the value marked, so "where did this come from?" is answered at a glance. */
function Snippet({ snippet, value }: { snippet: string; value: string }) {
  const at = snippet.toLowerCase().indexOf(value.toLowerCase());
  if (at === -1) return <>{snippet}</>;
  return (
    <>
      {snippet.slice(0, at)}
      <mark className="bg-yellow-100 px-0.5 text-neutral-900">{snippet.slice(at, at + value.length)}</mark>
      {snippet.slice(at + value.length)}
    </>
  );
}

export function EvidenceList({ items, idPrefix }: { items: EvidenceDto[]; idPrefix: string }) {
  const groups = new Map<string, EvidenceDto[]>();
  for (const e of items) groups.set(e.field, [...(groups.get(e.field) ?? []), e]);
  return (
    <div className="space-y-3">
      {[...groups.entries()].map(([field, list]) => (
        <section key={field} id={`${idPrefix}-${field}`} aria-label={`Evidence for ${label(field)}`} className="scroll-mt-4">
          <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-500">{label(field)}</h3>
          <ul className="divide-y divide-neutral-100 rounded border border-neutral-200 bg-white">
            {list.map((e) => (
              <li key={e.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline gap-x-2 text-xs text-neutral-500">
                  <span className="font-medium text-neutral-800">“{e.value}”</span>
                  <span>·</span>
                  <span>{e.sourceAdapter}</span>
                  <span>·</span>
                  <span>{sourceKindLabel[e.sourceKind]}</span>
                  <span>·</span>
                  <a className="text-blue-700 hover:underline" href={e.sourceUrl} target="_blank" rel="noreferrer">
                    {host(e.sourceUrl)}
                  </a>
                  <span className="ml-auto">
                    retrieved {e.retrievedAt.slice(0, 10)}
                    {e.publishedAt ? ` · published ${e.publishedAt.slice(0, 10)}` : ''}
                  </span>
                </div>
                <p className="mt-1 text-neutral-700">
                  <Snippet snippet={e.snippet} value={e.value} />
                </p>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

