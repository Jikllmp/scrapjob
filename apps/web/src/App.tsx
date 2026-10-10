import { useCallback, useState } from 'react';
import { Terminal } from './components/Terminal';
import { Link, useLocation } from './lib/router';
import { useSearchEvents } from './lib/useSearchEvents';
import { ContactPage } from './pages/ContactPage';
import { HistoryPage } from './pages/HistoryPage';
import { SearchPage } from './pages/SearchPage';
import { SourcesPage } from './pages/SourcesPage';

const nav: [string, string][] = [
  ['/', 'Search'],
  ['/searches', 'History'],
  ['/sources', 'Sources'],
];

export function App() {
  const { path, params } = useLocation();
  // The bottom log follows the search the current page is about.
  const [log, setLog] = useState<{ searchId: string | null; follow: boolean }>({ searchId: null, follow: false });
  const onLogSearch = useCallback((searchId: string | null, follow: boolean) => setLog({ searchId, follow }), []);
  const { events, state } = useSearchEvents(log.searchId, log.follow);

  const contactId = /^\/contacts\/([^/]+)$/.exec(path)?.[1];
  let page;
  if (contactId) page = <ContactPage contactId={decodeURIComponent(contactId)} onLogSearch={onLogSearch} />;
  else if (path === '/searches') page = <HistoryPage onLogSearch={onLogSearch} />;
  else if (path === '/sources') page = <SourcesPage onLogSearch={onLogSearch} />;
  else page = <SearchPage searchId={params.get('search')} events={events} onLogSearch={onLogSearch} />;

  return (
    <div className="flex h-screen flex-col bg-neutral-50 font-sans text-neutral-900">
      <header className="flex items-center gap-6 border-b border-neutral-200 bg-white px-4 py-2">
        <h1 className="text-sm font-semibold">ScrapJob — professional contact finder</h1>
        <nav aria-label="Main" className="flex gap-4 text-sm">
          {nav.map(([to, text]) => {
            const current = to === '/' ? path === '/' : path.startsWith(to);
            return (
              <Link key={to} to={to} aria-current={current ? 'page' : undefined} className={current ? 'font-medium text-neutral-900' : 'text-neutral-500 hover:text-neutral-900'}>
                {text}
              </Link>
            );
          })}
        </nav>
      </header>
      <main className="flex-1 overflow-y-auto p-4">{page}</main>
      <Terminal events={events} state={state} />
    </div>
  );
}
