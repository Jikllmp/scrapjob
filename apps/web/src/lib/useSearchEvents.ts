import { SearchEventDto, type SearchEventDto as SearchEvent } from '@scrapjob/schema/api';
import { useEffect, useState } from 'react';

const terminalTypes = new Set(['SEARCH_COMPLETED', 'SEARCH_FAILED', 'SEARCH_CANCELLED']);

export type StreamState = 'idle' | 'connecting' | 'open' | 'reconnecting' | 'closed';

/**
 * Follows a search's SSE stream. EventSource reconnects on its own and sends
 * Last-Event-ID, so the server replays whatever was missed.
 */
export function useSearchEvents(searchId: string | null): { events: SearchEvent[]; state: StreamState } {
  const [events, setEvents] = useState<SearchEvent[]>([]);
  const [state, setState] = useState<StreamState>('idle');

  useEffect(() => {
    setEvents([]);
    if (!searchId) {
      setState('idle');
      return;
    }
    setState('connecting');
    const source = new EventSource(`/api/searches/${encodeURIComponent(searchId)}/events`);
    source.onopen = () => setState('open');
    source.onerror = () => setState(source.readyState === EventSource.CLOSED ? 'closed' : 'reconnecting');
    source.onmessage = (message: MessageEvent<string>) => {
      const parsed = SearchEventDto.safeParse(JSON.parse(message.data));
      if (!parsed.success) return;
      const event = parsed.data;
      setEvents((prev) => (prev.length > 0 && prev[prev.length - 1]!.seq >= event.seq ? prev : [...prev, event]));
      if (terminalTypes.has(event.type)) {
        source.close();
        setState('closed');
      }
    };
    return () => source.close();
  }, [searchId]);

  return { events, state };
}

export function isTerminal(event: SearchEvent | undefined): boolean {
  return event !== undefined && terminalTypes.has(event.type);
}
