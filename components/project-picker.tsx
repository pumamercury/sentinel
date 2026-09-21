'use client';
import { useId, useState } from 'react';
import type { Project } from '../lib/bugs';
import { ProjectBadge } from './project-badge';

export function ProjectPicker({
  projects,
  value,
  onChange,
  label,
  required,
}: {
  projects: Project[];
  value: string;
  onChange: (value: string) => void;
  label: string;
  required: boolean;
}) {
  const id = useId();
  const existing = projects.find(
    (p) => p.name.toLowerCase() === value.trim().toLowerCase(),
  );
  const [creating, setCreating] = useState(!!value && !existing);
  return (
    <div className="project-picker">
      <label htmlFor={id}>
        {label}
        {required ? ' *' : ''}
      </label>
      <select
        id={id}
        required={required}
        value={creating ? 'new' : existing ? 'project:' + existing.id : ''}
        onChange={(e) => {
          if (e.target.value === 'new') {
            setCreating(true);
            onChange('');
          } else {
            setCreating(false);
            onChange(
              projects.find((p) => 'project:' + p.id === e.target.value)
                ?.name ?? '',
            );
          }
        }}
      >
        <option value="" disabled>
          Select a project…
        </option>
        <optgroup label="Existing projects">
          {projects.map((p) => (
            <option key={p.id} value={'project:' + p.id}>
              {p.icon ? p.icon + ' ' : ''}
              {p.name}
            </option>
          ))}
        </optgroup>
        <option value="new">+ Create a new project…</option>
      </select>
      {creating ? (
        <>
          <label htmlFor={id + '-name'}>New project name</label>
          <input
            id={id + '-name'}
            required={required}
            maxLength={500}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Enter a project name"
          />
          <p className="muted">
            {existing
              ? 'This project already exists and will be used.'
              : 'The project will be created when you save the issue.'}
          </p>
        </>
      ) : existing ? (
        <ProjectBadge name={existing.name} projects={projects} />
      ) : null}
    </div>
  );
}
