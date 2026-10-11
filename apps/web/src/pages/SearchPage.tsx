import type { SearchEventDto } from '@scrapjob/schema/api';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { CompaniesPanel } from '../components/CompaniesPanel';
import { CounterStrip } from '../components/CounterStrip';
import { ResultsTable, type QuickFilter } from '../components/ResultsTable';
import { SearchForm } from '../components/SearchForm';
import { ApiError, cancelSearch, createSearch, exportContacts, listCompanies, listContacts } from '../lib/api';
import { navigate } from '../lib/router';
import { hasEnded } from '../lib/useSearchEvents';

const contactChanges = new Set(['CONTACT_VALIDATED', 'DUPLICATE_MERGED']);
const terminalTypes = new Set(['SEARCH_COMPLETED', 'SEARCH_FAILED', 'SEARCH_CANCELLED']);

interface Props {
  searchId: string | null;
  events: SearchEventDto[];
  onLogSearch: (searchId: string | null, follow: boolean) => void;
}

export function SearchPage({ searchId, events, onLogSearch }: Props) {
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  useEffect(() => onLogSearch(searchId, false), [searchId, onLogSearch]);
  // Filters belong to one search; Back, Forward or a new search starts clean.
  useEffect(() => setQuickFilter('all'), [searchId]);

  const start = useMutation({
    mutationFn: ({ location, position }: { location: string; position: string }) => createSearch({ location, position }),
    onSuccess: ({ searchId }) => {
      navigate(`/?search=${encodeURIComponent(searchId)}`);
    },
  });

  const finished = hasEnded(events);
  const last = events.findLast((e) => terminalTypes.has(e.type));
  const running = searchId !== null && events.length > 0 && !finished;
  const startEvent = events.find((e) => e.type === 'SEARCH_STARTED');
  const targetCount = typeof startEvent?.metadata.targetCount === 'number' ? startEvent.metadata.targetCount : 20;

  // The table reloads from the database whenever the stream says a contact changed, and once more at the end.
  const revision = events.filter((e) => contactChanges.has(e.type)).length;
  const contacts = useQuery({
    queryKey: ['contacts', searchId, revision, finished],
    queryFn: () => listContacts(searchId!),
    enabled: searchId !== null,
    placeholderData: (previous, query) => (query?.queryKey[1] === searchId ? previous : undefined),
  });
  const rows = contacts.data?.items ?? [];
  const companyRevision = events.filter((e) => e.type === 'COMPANY_DISCOVERED').length;
  const companies = useQuery({
    queryKey: ['companies', searchId, companyRevision, finished],
    queryFn: () => listCompanies(searchId!),
    enabled: searchId !== null,
    placeholderData: (previous, query) => (query?.queryKey[1] === searchId ? previous : undefined),
  });

  const exporter = useMutation({ mutationFn: (ids?: string[]) => exportContacts(searchId!, ids) });
  const cancel = useMutation({ mutationFn: (id: string) => cancelSearch(id) });
  const missing = contacts.error instanceof ApiError && contacts.error.problem.status === 404;

  return (
    <div className="space-y-4">
      <SearchForm
        disabled={start.isPending}
        running={running}
        onSubmit={(location, position) => start.mutate({ location, position })}
        onCancel={() => searchId && cancel.mutate(searchId)}
      />
      {start.error && (
        <p role="alert" className="text-sm text-red-700">
          {start.error instanceof ApiError
            ? (start.error.problem.errors?.map((e) => `${e.path}: ${e.message}`).join(' · ') ?? start.error.message)
            : start.error.message}
        </p>
      )}
      {searchId && (
        <CounterStrip events={events} rows={rows} targetCount={targetCount} quickFilter={quickFilter} onQuickFilter={setQuickFilter} />
      )}
      {last && <p className={`text-sm ${last.level === 'error' ? 'text-red-700' : 'text-neutral-700'}`}>{last.message}</p>}
      {cancel.error && (
        <p role="alert" className="text-sm text-red-700">
          {cancel.error.message}
        </p>
      )}
      {missing && (
        <p role="alert" className="text-sm text-red-700">
          This search does not exist or was deleted.
        </p>
      )}
      {exporter.error && (
        <p role="alert" className="text-sm text-red-700">
          Export failed: {exporter.error.message}
        </p>
      )}
      {searchId && !missing && (
        <ResultsTable
          key={searchId}
          rows={rows}
          loading={contacts.isLoading}
          quickFilter={quickFilter}
          onExport={(ids) => exporter.mutate(ids)}
          exporting={exporter.isPending}
        />
      )}
      {searchId && !missing && (
        <CompaniesPanel
          key={`companies-${searchId}`}
          searchId={searchId}
          companies={companies.data?.items ?? []}
          loading={companies.isLoading}
          running={running}
        />
      )}
    </div>
  );
}
