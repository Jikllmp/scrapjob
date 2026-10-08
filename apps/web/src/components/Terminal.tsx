import { eventLevels, type EventLevel } from '@scrapjob/schema/enums';
import type { SearchEventDto } from '@scrapjob/schema/api';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { StreamState } from '../lib/useSearchEvents';

interface Props {
  events: SearchEventDto[];
  state: StreamState;
}

const levelColour: Record<EventLevel, string> = {
  debug: 'text-neutral-500',
  info: 'text-neutral-200',
  warn: 'text-amber-300',
  error: 'text-red-400',
};

function formatLine(e: SearchEventDto): string {
  return `${e.createdAt.slice(11, 19)}  ${e.level.toUpperCase().padEnd(5)}  ${e.type.padEnd(24)}  ${e.message}`;
}

/** Shows only events the engine persisted. Nothing here is synthetic. */
export function Terminal({ events, state }: Props) {
  const [open, setOpen] = useState(true);
  const [minLevel, setMinLevel] = useState<EventLevel>('info');
  const [copied, setCopied] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const pinnedToBottom = useRef(true);

  const visible = useMemo(() => {
    const min = eventLevels.indexOf(minLevel);
    return events.filter((e) => eventLevels.indexOf(e.level) >= min);
  }, [events, minLevel]);

  useEffect(() => {
    const el = scroller.current;
    if (el && pinnedToBottom.current) el.scrollTop = el.scrollHeight;
  }, [visible]);

  const copy = async () => {
    await navigator.clipboard.writeText(visible.map(formatLine).join('\n'));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section aria-label="Engine log" className="border-t border-neutral-800 bg-neutral-950 text-neutral-200">
      <div className="flex items-center gap-3 px-4 py-1.5 text-xs">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          aria-controls="terminal-log"
          className="font-medium hover:text-white"
        >
          {open ? '▾' : '▸'} Log
        </button>
        <span className="text-neutral-500">
          {visible.length} lines · stream {state}
        </span>
        <label className="ml-auto flex items-center gap-1.5 text-neutral-400">
          Level
          <select
            value={minLevel}
            onChange={(e) => setMinLevel(e.target.value as EventLevel)}
            className="rounded border border-neutral-700 bg-neutral-900 px-1 py-0.5 text-neutral-200"
          >
            {eventLevels.map((l) => (
              <option key={l} value={l}>
                {l}+
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={copy} className="rounded border border-neutral-700 px-2 py-0.5 hover:bg-neutral-800">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {open && (
        <div
          id="terminal-log"
          ref={scroller}
          role="log"
          aria-live="polite"
          tabIndex={0}
          onScroll={(e) => {
            const el = e.currentTarget;
            pinnedToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          }}
          className="h-56 overflow-y-auto px-4 pb-3 font-mono text-xs leading-5"
        >
          {visible.length === 0 ? (
            <p className="text-neutral-500">No events yet.</p>
          ) : (
            visible.map((e) => (
              <div key={e.seq} className={`whitespace-pre-wrap ${levelColour[e.level]}`}>
                {formatLine(e)}
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
