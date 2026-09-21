'use client';
import { useId, useState } from 'react';

export function ComponentPicker({
  label,
  required,
  value,
  onChange,
  options,
}: {
  label: string;
  required: boolean;
  value: string;
  onChange: (value: string) => void;
  options: string[];
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
          {required ? 'Select a component…' : 'No component'}
        </option>
        {options.map((name) => (
          <option key={name} value={'component:' + name}>
            {name}
          </option>
        ))}
        <option value="new">+ Create a new component…</option>
      </select>
      {showInput && (
        <>
          <label htmlFor={id + '-name'}>Component name</label>
          <input
            id={id + '-name'}
            value={value}
            required={required}
            maxLength={500}
            autoComplete="off"
            placeholder="Enter a component name"
            aria-describedby={id + '-hint'}
            onChange={(e) => onChange(e.target.value)}
          />
        </>
      )}
      <p className="muted" id={id + '-hint'}>
        {value.trim() && !existing
          ? 'This component will be created for this project when you save the issue.'
          : existing
            ? 'This saved component will be used.'
            : options.length
              ? 'Select a saved component or choose “Create a new component”.'
              : 'No components saved for this project yet. Choose “Create a new component” to add one.'}
      </p>
    </div>
  );
}
