import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { CounterStrip } from './components/CounterStrip';
import { ResultsTable, type QuickFilter } from './components/ResultsTable';
import { SearchForm } from './components/SearchForm';
import { Terminal } from './components/Terminal';
import { ApiError, cancelSearch, createSearch, exportContacts, listContacts } from './lib/api';
import { isTerminal, useSearchEvents } from './lib/useSearchEvents';

const contactChanges = new Set(['CONTACT_VALIDATED', 'DUPLICATE_MERGED']);

export function App() {
  const [searchId, setSearchId] = useState<string | null>(null);
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const { events, state } = useSearchEvents(searchId);
  const start = useMutation({
    mutationFn: ({ location, position }: { location: string; position: string }) => createSearch({ location, position }),
    onSuccess: ({ searchId }) => {
      setQuickFilter('all');
      setSearchId(searchId);
    },
  });

  const last = events.at(-1);
  const finished = isTerminal(last);
  const running = searchId !== null && !finished;
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

  const exporter = useMutation({
    mutationFn: (ids?: string[]) => exportContacts(searchId!, ids),
  });

  return (
    <div className="flex h-screen flex-col bg-neutral-50 font-sans text-neutral-900">
      <header className="border-b border-neutral-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold">ScrapJob — professional contact finder</h1>
      </header>
      <main className="flex-1 space-y-4 overflow-y-auto p-4">
        <SearchForm
          disabled={start.isPending}
          running={running}
          onSubmit={(location, position) => start.mutate({ location, position })}
          onCancel={() => searchId && void cancelSearch(searchId)}
        />
        {start.error && (
          <p role="alert" className="text-sm text-red-700">
            {start.error instanceof ApiError
              ? (start.error.problem.errors?.map((e) => `${e.path}: ${e.message}`).join(' · ') ?? start.error.message)
              : start.error.message}
          </p>
        )}
        {searchId && (
          <CounterStrip
            events={events}
            rows={rows}
            targetCount={targetCount}
            quickFilter={quickFilter}
            onQuickFilter={setQuickFilter}
          />
        )}
        {finished && last && (
          <p className={`text-sm ${last.level === 'error' ? 'text-red-700' : 'text-neutral-700'}`}>{last.message}</p>
        )}
        {exporter.error && (
          <p role="alert" className="text-sm text-red-700">
            Export failed: {exporter.error.message}
          </p>
        )}
        {searchId && (
          <ResultsTable
            rows={rows}
            loading={contacts.isLoading}
            quickFilter={quickFilter}
            onExport={(ids) => exporter.mutate(ids)}
            exporting={exporter.isPending}
          />
        )}
      </main>
      <Terminal events={events} state={state} />
    </div>
  );
}
