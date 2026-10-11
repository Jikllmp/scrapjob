import type { ContactDetailDto } from '@scrapjob/schema/api';
import type { Confidence } from '@scrapjob/schema/enums';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ConfidenceChip } from '../components/ConfidenceChip';
import { DeepSearchRun } from '../components/DeepSearchRun';
import { EvidenceList } from '../components/EvidenceList';
import { fieldOrder, label } from '../lib/fields';
import { ApiError, eraseContact, getContact, startDeepSearch } from '../lib/api';
import { Link, navigate } from '../lib/router';

function valueOf(contact: ContactDetailDto, field: string): string | null {
  const map: Record<string, string | null> = {
    full_name: contact.fullName,
    first_name: contact.firstName,
    last_name: contact.lastName,
    title: contact.title,
    department: contact.department,
    company: contact.company?.name ?? null,
    email: contact.email,
    phone: contact.phone,
    profile_url: contact.profileUrl,
    city: contact.city,
    country: contact.country,
  };
  return map[field] ?? null;
}

interface Props {
  contactId: string;
  onLogSearch: (searchId: string | null, follow: boolean) => void;
}

export function ContactPage({ contactId, onLogSearch }: Props) {
  const queryClient = useQueryClient();
  const [confirmErase, setConfirmErase] = useState(false);
  const detail = useQuery({
    queryKey: ['contact', contactId],
    queryFn: () => getContact(contactId),
    refetchInterval: (q) => (q.state.data?.deepSearches.some((d) => d.status === 'queued' || d.status === 'running') ? 1000 : false),
  });
  const contact = detail.data;
  useEffect(() => onLogSearch(contact?.search.id ?? null, true), [contact?.search.id, onLogSearch]);

  const deep = useMutation({
    mutationFn: () => startDeepSearch(contactId),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['contact', contactId] }),
  });
  const erase = useMutation({
    mutationFn: () => eraseContact(contactId),
    onSuccess: () => navigate(contact ? `/?search=${encodeURIComponent(contact.search.id)}` : '/'),
  });

  if (detail.isLoading) return <p className="text-sm text-neutral-500">Loading…</p>;
  if (!contact) {
    return (
      <p role="alert" className="text-sm text-red-700">
        {detail.error instanceof ApiError && detail.error.problem.status === 404 ? 'This contact does not exist or was erased.' : 'Could not load this contact.'}
      </p>
    );
  }
  const busy = deep.isPending || contact.deepSearches.some((d) => d.status === 'queued' || d.status === 'running');
  const fields = fieldOrder.filter((f) => valueOf(contact, f) !== null);

  return (
    <div className="max-w-5xl space-y-6">
      <Link to={`/?search=${encodeURIComponent(contact.search.id)}`} className="text-sm text-blue-700 hover:underline">
        ← {contact.search.position} in {contact.search.location}
      </Link>

      <header className="space-y-1">
        <h2 className="text-xl font-semibold">
          {contact.fullName}
          {contact.lead && (
            <span className="ml-2 rounded bg-neutral-200 px-1.5 align-middle text-xs font-medium uppercase text-neutral-700">Unconfirmed lead</span>
          )}
        </h2>
        <p className="text-sm text-neutral-700">
          {contact.title ?? 'No title found'}
          {contact.company && (
            <>
              {' · '}
              {contact.company.website ? (
                <a className="hover:underline" href={contact.company.website} target="_blank" rel="noreferrer">
                  {contact.company.name}
                </a>
              ) : (
                contact.company.name
              )}
              {contact.company.isAgency && ' (staffing agency)'}
            </>
          )}
          {(contact.city ?? contact.company?.city) && ` · ${contact.city ?? contact.company?.city}`}
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <ConfidenceChip value={contact.confidence} />
          <span className="tabular-nums" title={contact.relevanceReasons.join('\n')}>
            Score {contact.relevanceScore}
          </span>
          <span className="text-neutral-500">· collected {contact.collectedAt.slice(0, 10)}</span>
        </p>
        <ul className="text-xs text-neutral-600">
          {contact.relevanceReasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      </header>

      <section aria-labelledby="fields-heading">
        <h2 id="fields-heading" className="mb-2 text-sm font-semibold">
          Fields
        </h2>
        <table className="w-full rounded border border-neutral-200 bg-white text-left text-sm">
          <tbody className="divide-y divide-neutral-100">
            {fields.map((f) => {
              const value = valueOf(contact, f)!;
              const count = contact.evidence.filter((e) => e.field === f).length;
              const contradicted = contact.fieldFlags[f]?.includes('contradicted');
              return (
                <tr key={f}>
                  <th scope="row" className="w-40 px-3 py-1.5 font-normal text-neutral-600">
                    {label(f)}
                  </th>
                  <td className="px-3 py-1.5">
                    {f === 'email' ? (
                      <a className="text-blue-700 hover:underline" href={`mailto:${value}`}>
                        {value}
                      </a>
                    ) : f === 'profile_url' ? (
                      <a className="text-blue-700 hover:underline" href={value} target="_blank" rel="noreferrer">
                        {value}
                      </a>
                    ) : (
                      value
                    )}
                    {contradicted && <span className="ml-2 text-xs font-medium text-red-700">contradicted by a deep search</span>}
                  </td>
                  <td className="w-28 px-3 py-1.5">
                    <ConfidenceChip value={(contact.fieldConfidence[f] ?? 'UNKNOWN') as Confidence} />
                  </td>
                  <td className="w-28 px-3 py-1.5 text-right">
                    <a className="text-xs text-blue-700 hover:underline" href={`#evidence-${f}`}>
                      {count} source{count === 1 ? '' : 's'}
                    </a>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      <section aria-labelledby="deep-heading" className="space-y-2">
        <div className="flex items-center gap-3">
          <h2 id="deep-heading" className="text-sm font-semibold">
            Deep search
          </h2>
          <button
            type="button"
            disabled={busy}
            onClick={() => deep.mutate()}
            className="h-7 rounded bg-neutral-900 px-2 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {busy ? 'Running…' : 'Run deep search'}
          </button>
          <span className="text-xs text-neutral-500">Confirms the title, looks for a published work address and a posting, and adds corroboration.</span>
        </div>
        {deep.error && (
          <p role="alert" className="text-sm text-red-700">
            {deep.error instanceof ApiError ? (deep.error.problem.detail ?? deep.error.message) : deep.error.message}
          </p>
        )}
        {contact.deepSearches.length === 0 ? (
          <p className="text-sm text-neutral-500">No deep search yet.</p>
        ) : (
          <ul className="space-y-3">
            {contact.deepSearches.map((run) => (
              <DeepSearchRun key={run.id} run={run} />
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="evidence-heading" className="space-y-2">
        <h2 id="evidence-heading" className="text-sm font-semibold">
          Evidence
        </h2>
        <EvidenceList items={contact.evidence} idPrefix="evidence" />
        {contact.companyEvidence.length > 0 && (
          <details className="text-sm">
            <summary className="cursor-pointer text-neutral-600">Evidence about {contact.company?.name}</summary>
            <div className="mt-2">
              <EvidenceList items={contact.companyEvidence} idPrefix="company-evidence" />
            </div>
          </details>
        )}
      </section>

      <section aria-labelledby="erase-heading" className="space-y-2 border-t border-neutral-200 pt-4">
        <h2 id="erase-heading" className="text-sm font-semibold">
          Erase
        </h2>
        <p className="text-xs text-neutral-600">
          Deletes this contact, its evidence and the spreadsheets of this search, and blocklists {contact.fullName} at {contact.company?.name ?? 'this employer'} so no later search adds them again.
        </p>
        {confirmErase ? (
          <div className="flex gap-2">
            <button type="button" onClick={() => erase.mutate()} className="h-7 rounded bg-red-700 px-2 text-xs font-medium text-white hover:bg-red-800">
              Erase and blocklist
            </button>
            <button type="button" onClick={() => setConfirmErase(false)} className="h-7 rounded border border-neutral-300 px-2 text-xs">
              Keep
            </button>
          </div>
        ) : (
          <button type="button" onClick={() => setConfirmErase(true)} className="h-7 rounded border border-red-300 px-2 text-xs font-medium text-red-700 hover:bg-red-50">
            Erase this contact…
          </button>
        )}
        {erase.error && (
          <p role="alert" className="text-sm text-red-700">
            {erase.error.message}
          </p>
        )}
      </section>
    </div>
  );
}
