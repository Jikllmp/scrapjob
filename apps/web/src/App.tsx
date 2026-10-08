import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { CounterStrip } from './components/CounterStrip';
import { SearchForm } from './components/SearchForm';
import { Terminal } from './components/Terminal';
import { ApiError, cancelSearch, createSearch } from './lib/api';
import { isTerminal, useSearchEvents } from './lib/useSearchEvents';

export function App() {
  const [searchId, setSearchId] = useState<string | null>(null);
  const { events, state } = useSearchEvents(searchId);
  const start = useMutation({
    mutationFn: ({ location, position }: { location: string; position: string }) => createSearch({ location, position }),
    onSuccess: ({ searchId }) => setSearchId(searchId),
  });

  const last = events.at(-1);
  const finished = isTerminal(last);
  const running = searchId !== null && !finished;
  const startEvent = events.find((e) => e.type === 'SEARCH_STARTED');
  const targetCount = typeof startEvent?.metadata.targetCount === 'number' ? startEvent.metadata.targetCount : 20;

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
        {searchId && <CounterStrip events={events} targetCount={targetCount} />}
        {finished && last && (
          <p className={`text-sm ${last.level === 'error' ? 'text-red-700' : 'text-neutral-700'}`}>{last.message}</p>
        )}
      </main>
      <Terminal events={events} state={state} />
    </div>
  );
}
