'use client';
import { useEffect, useState } from 'react';
import { api, type Member } from '../lib/bugs';
import { useAccess } from './account-gate';

export function AccountPicker({
  value,
  onChange,
  label,
  required = false,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  required?: boolean;
}) {
  const { enabled } = useAccess();
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (enabled)
      api<Member[]>('members')
        .then(setMembers)
        .catch((e) => setError(e.message));
  }, [enabled]);
  return (
    <label>
      {label}
      {required ? ' *' : ''}
      {enabled ? (
        <select
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        >
          <option value="">
            {label === 'Assignee' ? 'Unassigned' : 'Choose account…'}
          </option>
          {value && !members.some((m) => m.email === value) && (
            <option value={value}>{value} (older name)</option>
          )}
          {members
            .filter((m) => !m.disabled || m.email === value)
            .map((m) => (
              <option key={m.id} value={m.email} disabled={!!m.disabled}>
                {m.email}
                {m.disabled ? ' (disabled)' : ''}
              </option>
            ))}
        </select>
      ) : (
        <input
          value={value}
          required={required}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {error && (
        <span role="alert" className="error">
          {error}
        </span>
      )}
    </label>
  );
}
