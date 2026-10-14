'use client';
import { useId, useState } from 'react';

export function ComponentPicker({
  label,
  required,
  value,
  onChange,
  options,
  kind = 'component',
}: {
  label: string;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  kind?: 'component' | 'version';
}) {
  const id = useId();
  const existing = options.find(
    (name) => name.toLowerCase() === value.trim().toLowerCase(),
  );
  const [creating, setCreating] = useState(false);
  const showInput = creating || (!!value && !existing);
  return (
    <div className="project-picker">
      <label htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      <select
        id={id}
        value={showInput ? 'new' : existing ? 'component:' + existing : ''}
        required={required}
        aria-describedby={id + '-hint'}
        onChange={(e) => {
          const next = e.target.value;
          setCreating(next === 'new');
          onChange(next.startsWith('component:') ? next.slice(10) : '');
        }}
      >
        <option value="" disabled={required}>
          {required ? `Select a ${kind}…` : `No ${kind}`}
        </option>
        {options.map((name) => (
          <option key={name} value={'component:' + name}>
            {name}
          </option>
        ))}
        <option value="new">+ Create a new {kind}…</option>
      </select>
      {showInput && (
        <>
          <label htmlFor={id + '-name'}>
            {kind === 'version' ? 'Version' : 'Component name'}
          </label>
          <input
            id={id + '-name'}
            value={value}
            required={required}
            maxLength={500}
            autoComplete="off"
            placeholder={
              kind === 'version'
                ? 'Enter a version, e.g. 1.2.0'
                : 'Enter a component name'
            }
            aria-describedby={id + '-hint'}
            onChange={(e) => onChange(e.target.value)}
          />
        </>
      )}
      <p className="muted" id={id + '-hint'}>
        {value.trim() && !existing
          ? `This ${kind} will be saved for this project when you save the issue.`
          : existing
            ? `This saved ${kind} will be used.`
            : options.length
              ? `Select a saved ${kind} or choose “Create a new ${kind}”.`
              : `No ${kind}s saved for this project yet. Choose “Create a new ${kind}” to add one.`}
      </p>
    </div>
  );
}
