import { useState, type FormEvent } from 'react';

interface Props {
  disabled: boolean;
  running: boolean;
  onSubmit: (location: string, position: string) => void;
  onCancel: () => void;
}

const inputClass =
  'h-9 w-full rounded border border-neutral-300 bg-white px-2 text-sm text-neutral-900 placeholder:text-neutral-400';

export function SearchForm({ disabled, running, onSubmit, onCancel }: Props) {
  const [location, setLocation] = useState('');
  const [position, setPosition] = useState('');

  const submit = (e: FormEvent) => {
    e.preventDefault();
    onSubmit(location.trim(), position.trim());
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-3">
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-neutral-700">
        City
        <input
          className={inputClass}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Charleroi"
          required
          minLength={2}
          maxLength={100}
          autoComplete="off"
        />
      </label>
      <label className="flex min-w-48 flex-1 flex-col gap-1 text-xs font-medium text-neutral-700">
        Position
        <input
          className={inputClass}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
          placeholder="Développeur .NET"
          required
          minLength={2}
          maxLength={120}
          autoComplete="off"
        />
      </label>
      {running ? (
        <button type="button" onClick={onCancel} className="h-9 rounded border border-neutral-400 bg-white px-4 text-sm font-medium text-neutral-900 hover:bg-neutral-100">
          Cancel
        </button>
      ) : (
        <button type="submit" disabled={disabled} className="h-9 rounded bg-neutral-900 px-4 text-sm font-medium text-white hover:bg-neutral-700 disabled:opacity-50">
          Start search
        </button>
      )}
    </form>
  );
}
