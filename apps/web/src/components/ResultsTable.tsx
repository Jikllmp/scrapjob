import type { ContactRowDto } from '@scrapjob/schema/api';
import {
  createColumnHelper,
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnFiltersState,
  type FilterFn,
  type RowSelectionState,
  type SortingState,
} from '@tanstack/react-table';
import { useMemo, useState } from 'react';
import { Link } from '../lib/router';
import { ConfidenceChip } from './ConfidenceChip';

export type QuickFilter = 'all' | 'confirmed' | 'leads';

interface Props {
  rows: ContactRowDto[];
  loading: boolean;
  quickFilter: QuickFilter;
  onExport: (ids?: string[]) => void;
  exporting: boolean;
}

const col = createColumnHelper<ContactRowDto>();
const equals: FilterFn<ContactRowDto> = (row, id, value) => value === '' || String(row.getValue(id) ?? '') === value;
const includesSource: FilterFn<ContactRowDto> = (row, _id, value) => value === '' || row.original.sources.includes(value);
const sourceNames: Record<string, string> = {
  'company-site': 'Employer site',
  'linkedin-public': 'LinkedIn title',
  'web-search': 'Web search',
  manual: 'Added by you',
};

function cityOf(r: ContactRowDto): string {
  return r.city ?? r.company?.city ?? '';
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export function ResultsTable({ rows, loading, quickFilter, onExport, exporting }: Props) {
  const [sorting, setSorting] = useState<SortingState>([{ id: 'score', desc: true }]);
  const [globalFilter, setGlobalFilter] = useState('');
  const [columnFilters, setColumnFilters] = useState<ColumnFiltersState>([]);
  const [selection, setSelection] = useState<RowSelectionState>({});

  const visibleRows = useMemo(
    () => (quickFilter === 'all' ? rows : rows.filter((r) => (quickFilter === 'leads' ? r.lead : !r.lead))),
    [rows, quickFilter],
  );

  const columns = useMemo(
    () => [
      col.display({
        id: 'select',
        header: ({ table }) => (
          <input
            type="checkbox"
            aria-label="Select all rows"
            checked={table.getIsAllRowsSelected()}
            onChange={table.getToggleAllRowsSelectedHandler()}
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            aria-label={`Select ${row.original.fullName ?? 'row'}`}
            checked={row.getIsSelected()}
            onChange={row.getToggleSelectedHandler()}
          />
        ),
      }),
      col.accessor((r) => r.fullName ?? '', {
        id: 'name',
        header: 'Name',
        cell: ({ row }) => (
          <div>
            <Link to={`/contacts/${row.original.id}`} className="font-medium hover:underline">
              {row.original.fullName ?? '(no name)'}
            </Link>
            {row.original.lead && (
              <span className="ml-1.5 rounded bg-neutral-200 px-1 text-[10px] font-medium uppercase text-neutral-700" title="Seen only in search results; confirm before writing">
                Lead
              </span>
            )}
            {row.original.contradicted.length > 0 && (
              <span className="ml-1.5 rounded bg-red-100 px-1 text-[10px] font-medium uppercase text-red-800" title={`Contradicted: ${row.original.contradicted.join(', ')}`}>
                Contradicted
              </span>
            )}
            {row.original.possibleDuplicateOf && (
              <span className="ml-1.5 rounded bg-amber-100 px-1 text-[10px] font-medium uppercase text-amber-800" title="May be the same person as another row">
                Duplicate?
              </span>
            )}
          </div>
        ),
      }),
      col.accessor((r) => r.title ?? '', { id: 'title', header: 'Title', cell: (c) => c.getValue() || <span className="text-neutral-400">—</span> }),
      col.accessor((r) => (r.roleTier === null ? '' : String(r.roleTier)), { id: 'tier', header: 'Tier', filterFn: equals }),
      col.accessor((r) => r.company?.name ?? '', {
        id: 'company',
        header: 'Company',
        filterFn: equals,
        cell: ({ row }) => (
          <span>
            {row.original.company?.website ? (
              <a className="hover:underline" href={row.original.company.website} target="_blank" rel="noreferrer">
                {row.original.company.name}
              </a>
            ) : (
              row.original.company?.name
            )}
            {row.original.company?.isAgency && <span className="ml-1 text-[10px] uppercase text-neutral-500">agency</span>}
          </span>
        ),
      }),
      col.accessor(cityOf, { id: 'city', header: 'City', filterFn: equals }),
      col.accessor('confidence', {
        header: 'Confidence',
        filterFn: equals,
        cell: (c) => <ConfidenceChip value={c.getValue()} />,
      }),
      col.accessor((r) => r.relevanceScore ?? 0, {
        id: 'score',
        header: 'Score',
        cell: ({ row }) => (
          <span className="tabular-nums" title={row.original.relevanceReasons.join('\n')}>
            {row.original.relevanceScore}
          </span>
        ),
      }),
      col.accessor((r) => r.sources.join(', '), {
        id: 'source',
        header: 'Sources',
        filterFn: includesSource,
        cell: ({ row }) => row.original.sources.map((s) => sourceNames[s] ?? s).join(', '),
      }),
      col.display({
        id: 'links',
        header: 'Reach / proof',
        cell: ({ row }) => {
          const r = row.original;
          return (
            <span className="flex flex-wrap gap-x-2">
              {r.email && (
                <a className="text-blue-700 hover:underline" href={`mailto:${r.email}`}>
                  {r.email}
                </a>
              )}
              {r.profileUrl && (
                <a className="text-blue-700 hover:underline" href={r.profileUrl} target="_blank" rel="noreferrer">
                  profile
                </a>
              )}
              {r.primarySourceUrl && (
                <a className="text-neutral-500 hover:underline" href={r.primarySourceUrl} target="_blank" rel="noreferrer" title={r.primarySourceUrl}>
                  source: {hostOf(r.primarySourceUrl)}
                </a>
              )}
            </span>
          );
        },
      }),
    ],
    [],
  );

  const table = useReactTable({
    data: visibleRows,
    columns,
    state: { sorting, globalFilter, columnFilters, rowSelection: selection },
    getRowId: (r) => r.id,
    onSortingChange: setSorting,
    onGlobalFilterChange: setGlobalFilter,
    onColumnFiltersChange: setColumnFilters,
    onRowSelectionChange: setSelection,
    globalFilterFn: 'includesString',
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  });

  const options = (pick: (r: ContactRowDto) => string[]) => [...new Set(rows.flatMap(pick).filter(Boolean))].sort();
  const filterSelects: [string, string, string[], (v: string) => string][] = [
    ['company', 'Company', options((r) => [r.company?.name ?? '']), (v) => v],
    ['tier', 'Tier', options((r) => [r.roleTier === null ? '' : String(r.roleTier)]), (v) => `Tier ${v}`],
    ['city', 'City', options((r) => [cityOf(r)]), (v) => v],
    ['confidence', 'Confidence', options((r) => [r.confidence]), (v) => v],
    ['source', 'Source', options((r) => r.sources), (v) => sourceNames[v] ?? v],
  ];
  // Only rows on screen: a quick filter or column filter hides rows that stay selected underneath.
  const selectedIds = table.getFilteredSelectedRowModel().rows.map((r) => r.id);

  return (
    <section aria-label="Contacts" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <input
          value={globalFilter}
          onChange={(e) => setGlobalFilter(e.target.value)}
          placeholder="Filter…"
          aria-label="Filter contacts"
          className="h-7 w-44 rounded border border-neutral-300 bg-white px-2"
        />
        {filterSelects.map(([id, label, values, display]) => (
          <select
            key={id}
            aria-label={`Filter by ${label.toLowerCase()}`}
            value={(table.getColumn(id)?.getFilterValue() as string | undefined) ?? ''}
            onChange={(e) => table.getColumn(id)?.setFilterValue(e.target.value)}
            className="h-7 rounded border border-neutral-300 bg-white px-1"
          >
            <option value="">{label}: all</option>
            {values.map((v) => (
              <option key={v} value={v}>
                {display(v)}
              </option>
            ))}
          </select>
        ))}
        <span className="ml-auto flex gap-2">
          <button
            type="button"
            disabled={exporting || selectedIds.length === 0}
            onClick={() => onExport(selectedIds)}
            className="h-7 rounded border border-neutral-400 bg-white px-2 font-medium hover:bg-neutral-100 disabled:opacity-40"
          >
            Export selection ({selectedIds.length})
          </button>
          <button
            type="button"
            disabled={exporting || rows.length === 0}
            onClick={() => onExport()}
            className="h-7 rounded bg-neutral-900 px-2 font-medium text-white hover:bg-neutral-700 disabled:opacity-40"
          >
            {exporting ? 'Exporting…' : 'Export all (.xlsx)'}
          </button>
        </span>
      </div>
      <div className="overflow-x-auto rounded border border-neutral-200 bg-white">
        <table className="w-full border-collapse text-left text-xs">
          <thead className="bg-neutral-100 text-neutral-600">
            {table.getHeaderGroups().map((hg) => (
              <tr key={hg.id}>
                {hg.headers.map((h) => (
                  <th
                    key={h.id}
                    scope="col"
                    className="whitespace-nowrap border-b border-neutral-200 px-2 py-1.5 font-medium"
                    aria-sort={h.column.getIsSorted() === 'asc' ? 'ascending' : h.column.getIsSorted() === 'desc' ? 'descending' : undefined}
                  >
                    {h.column.getCanSort() ? (
                      <button type="button" onClick={h.column.getToggleSortingHandler()} className="hover:text-neutral-900">
                        {flexRender(h.column.columnDef.header, h.getContext())}
                        {{ asc: ' ▲', desc: ' ▼' }[h.column.getIsSorted() as string] ?? ''}
                      </button>
                    ) : (
                      flexRender(h.column.columnDef.header, h.getContext())
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {loading && rows.length === 0
              ? [0, 1, 2].map((i) => (
                  <tr key={i}>
                    {columns.map((_, j) => (
                      <td key={j} className="border-b border-neutral-100 px-2 py-1.5">
                        <div className="h-3 animate-pulse rounded bg-neutral-200" />
                      </td>
                    ))}
                  </tr>
                ))
              : table.getRowModel().rows.map((row) => (
                  <tr key={row.id} className={`border-b border-neutral-100 hover:bg-neutral-50 ${row.original.lead ? 'text-neutral-600' : ''}`}>
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-2 py-1 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
            {!loading && table.getRowModel().rows.length === 0 && (
              <tr>
                <td colSpan={columns.length} className="px-2 py-3 text-neutral-500">
                  {rows.length === 0 ? 'No contacts yet.' : 'No contact matches these filters.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
