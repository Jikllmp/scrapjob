import type { Confidence } from '@scrapjob/schema/enums';

const styles: Record<Confidence, string> = {
  VERIFIED: 'bg-emerald-50 text-emerald-800 ring-emerald-300',
  HIGH: 'bg-sky-50 text-sky-800 ring-sky-300',
  MEDIUM: 'bg-amber-50 text-amber-800 ring-amber-300',
  LOW: 'bg-neutral-100 text-neutral-700 ring-neutral-300',
  UNKNOWN: 'bg-white text-neutral-500 ring-neutral-300',
};

export function ConfidenceChip({ value }: { value: Confidence }) {
  return (
    <span className={`inline-block rounded px-1.5 py-px text-[11px] font-medium ring-1 ring-inset ${styles[value]}`}>{value}</span>
  );
}
