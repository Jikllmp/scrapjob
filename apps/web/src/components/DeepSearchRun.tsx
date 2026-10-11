import type { ContactSnapshotDto, DeepSearchDto } from '@scrapjob/schema/api';
import type { Confidence } from '@scrapjob/schema/enums';
import { fieldOrder, label } from '../lib/fields';
import { ConfidenceChip } from './ConfidenceChip';

const changeStyle: Record<string, string> = {
  added: 'text-emerald-700',
  updated: 'text-sky-700',
  corroborated: 'text-neutral-700',
  contradicted: 'text-red-700',
};

function SnapshotValue({ snap, field }: { snap: ContactSnapshotDto | null; field: string }) {
  const v = snap?.fields[field];
  if (!v) return <span className="text-neutral-400">—</span>;
  return (
    <span className="flex items-center gap-1.5">
      <span>{v.value}</span>
      <ConfidenceChip value={v.confidence as Confidence} />
    </span>
  );
}

export function DeepSearchRun({ run }: { run: DeepSearchDto }) {
  const changed = new Map(run.changes.map((c) => [c.field, c.kind]));
  const fields = fieldOrder.filter((f) => run.before?.fields[f] || run.after?.fields[f]);
  return (
    <li className="rounded border border-neutral-200 bg-white">
      <div className="flex flex-wrap items-center gap-2 border-b border-neutral-100 px-3 py-2 text-xs text-neutral-600">
        <span className="font-medium text-neutral-900">{run.status}</span>
        <span>{(run.finishedAt ?? run.startedAt ?? run.createdAt ?? '').replace('T', ' ').slice(0, 16)}</span>
        <span>· {run.requestsSpent} requests</span>
        {run.message && <span className="w-full text-neutral-700">{run.message}</span>}
      </div>
      {run.before && run.after && (
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Before and after this deep search</caption>
          <thead className="text-xs text-neutral-500">
            <tr>
              <th className="px-3 py-1 font-medium">Field</th>
              <th className="px-3 py-1 font-medium">Before</th>
              <th className="px-3 py-1 font-medium">After</th>
              <th className="px-3 py-1 font-medium">Change</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {fields.map((f) => (
              <tr key={f} className={changed.has(f) ? 'bg-neutral-50' : ''}>
                <td className="px-3 py-1 text-neutral-600">{label(f)}</td>
                <td className="px-3 py-1">
                  <SnapshotValue snap={run.before} field={f} />
                </td>
                <td className="px-3 py-1">
                  <SnapshotValue snap={run.after} field={f} />
                </td>
                <td className={`px-3 py-1 text-xs font-medium ${changeStyle[changed.get(f) ?? ''] ?? 'text-neutral-400'}`}>
                  {changed.get(f) ?? 'unchanged'}
                </td>
              </tr>
            ))}
            <tr>
              <td className="px-3 py-1 text-neutral-600">Score</td>
              <td className="px-3 py-1 tabular-nums">{run.before.score}</td>
              <td className="px-3 py-1 tabular-nums">{run.after.score}</td>
              <td className="px-3 py-1 text-xs text-neutral-500">
                {run.before.lead && !run.after.lead ? 'no longer an unconfirmed lead' : ''}
              </td>
            </tr>
          </tbody>
        </table>
      )}
    </li>
  );
}

