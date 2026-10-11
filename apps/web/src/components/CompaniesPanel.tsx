import type { SearchCompanyDto } from '@scrapjob/schema/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { addContact, ApiError } from '../lib/api';

interface Props {
  searchId: string;
  companies: SearchCompanyDto[];
  loading: boolean;
  running: boolean;
}

const inputClass =
  'h-8 w-full rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900 placeholder:text-neutral-400';

/**
 * The employers a search looked at. "Search on LinkedIn" opens a people search
 * in the user's own browser and account; the app itself never opens LinkedIn.
 * A person found there is added back with "Add a person".
 */
export function CompaniesPanel({ searchId, companies, loading, running }: Props) {
  const [openFor, setOpenFor] = useState<string | null>(null);

  return (
    <section aria-labelledby="companies-heading" className="space-y-2">
      <h2 id="companies-heading" className="text-sm font-semibold text-neutral-900">
        Employers ({companies.length})
      </h2>
      {loading && companies.length === 0 && <p className="text-sm text-neutral-500">Loading…</p>}
      {!loading && companies.length === 0 && (
        <p className="text-sm text-neutral-500">No employer yet. Add employers to config/employers.yaml to search without an API key.</p>
      )}
      <ul className="divide-y divide-neutral-200 rounded border border-neutral-200 bg-white">
        {companies.map((c) => (
          <li key={c.id} className="space-y-2 px-3 py-2">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium text-neutral-900">
                {c.website ? (
                  <a href={c.website} target="_blank" rel="noopener noreferrer" className="hover:underline">
                    {c.name}
                  </a>
                ) : (
                  c.name
                )}
              </span>
              {c.city && <span className="text-xs text-neutral-600">{c.city}</span>}
              {c.hasPosting && <span className="rounded bg-green-100 px-1.5 text-xs text-green-800">open posting</span>}
              <span className="text-xs text-neutral-600">
                {c.contacts} contact{c.contacts === 1 ? '' : 's'}
              </span>
              <span className="ml-auto flex gap-2">
                <a
                  href={c.linkedinSearchUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded border border-neutral-400 bg-white px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-neutral-100"
                >
                  Search on LinkedIn
                </a>
                <button
                  type="button"
                  aria-expanded={openFor === c.id}
                  onClick={() => setOpenFor(openFor === c.id ? null : c.id)}
                  className="rounded border border-neutral-400 bg-white px-2 py-1 text-xs font-medium text-neutral-900 hover:bg-neutral-100"
                >
                  Add a person
                </button>
              </span>
            </div>
            {openFor === c.id && (
              <AddPersonForm searchId={searchId} company={c} running={running} onDone={() => setOpenFor(null)} />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function AddPersonForm({
  searchId,
  company,
  running,
  onDone,
}: {
  searchId: string;
  company: SearchCompanyDto;
  running: boolean;
  onDone: () => void;
}) {
  const queryClient = useQueryClient();
  const [profileUrl, setProfileUrl] = useState('');
  const [fullName, setFullName] = useState('');
  const [title, setTitle] = useState('');
  const add = useMutation({
    mutationFn: () => addContact(searchId, { companyId: company.id, profileUrl: profileUrl.trim(), fullName, title }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['contacts', searchId] }),
        queryClient.invalidateQueries({ queryKey: ['companies', searchId] }),
      ]);
      onDone();
    },
  });
  const submit = (e: FormEvent) => {
    e.preventDefault();
    add.mutate();
  };
  const error = add.error
    ? add.error instanceof ApiError
      ? (add.error.problem.errors?.map((e) => e.message).join(' · ') ?? add.error.message)
      : add.error.message
    : null;

  return (
    <form onSubmit={submit} aria-label={`Add a person at ${company.name}`} className="space-y-2 rounded bg-neutral-50 p-2">
      <div className="grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
          LinkedIn profile URL
          <input
            className={inputClass}
            type="url"
            value={profileUrl}
            onChange={(e) => setProfileUrl(e.target.value)}
            placeholder="https://www.linkedin.com/in/…"
            pattern="https://([a-z]{2,3}\.)?linkedin\.com/in/.+"
            required
          />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
          Full name
          <input className={inputClass} value={fullName} onChange={(e) => setFullName(e.target.value)} required minLength={3} maxLength={100} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-700">
          Job title
          <input
            className={inputClass}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Talent Acquisition Specialist"
            required
            minLength={2}
            maxLength={150}
          />
        </label>
      </div>
      <p className="text-xs text-neutral-600">Copy these from the profile you have open. The app stores the link but never opens it.</p>
      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={running || add.isPending}
          className="h-8 rounded bg-neutral-900 px-3 text-xs font-medium text-white hover:bg-neutral-700 disabled:opacity-50"
        >
          Add contact
        </button>
        {running && <span className="text-xs text-neutral-600">Wait for the search to finish.</span>}
        {error && (
          <span role="alert" className="text-xs text-red-700">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
