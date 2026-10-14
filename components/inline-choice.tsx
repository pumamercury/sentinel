'use client';
import { useEffect, useRef, useState } from 'react';
import { Pencil } from 'lucide-react';
import { api, type Member } from '../lib/bugs';
import { priorityLabel } from '../lib/priority';
import type { FieldDefinition } from '../lib/field-schema.mjs';

export function InlineChoice({
  issueId,
  field,
  value,
  accounts = false,
  onRefresh,
}: {
  issueId: number;
  field: FieldDefinition;
  value: string;
  accounts?: boolean;
  onRefresh: () => Promise<void>;
}) {
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(accounts);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const saving = useRef(false);
  useEffect(() => {
    if (!accounts) return;
    let active = true;
    api<Member[]>('members')
      .then((data) => {
        if (active) setMembers(data);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [accounts]);
  const options = accounts
    ? members
        .filter((m) => !m.disabled || m.email === value)
        .map((m) => m.email)
    : field.options;
  const label = (option: string) =>
    field.key === 'priority' ? priorityLabel(option) : option;
  return (
    <div className="inline-choice-container">
      <div className="inline-field-text inline-choice" aria-busy={busy}>
        <span aria-hidden="true">
          {value ? (
            label(value)
          ) : (
            <span className="muted">
              {field.key === 'assignee' ? 'Unassigned' : 'Choose…'}
            </span>
          )}
        </span>
        <Pencil className="inline-edit-cue" size={14} aria-hidden="true" />
        <select
          aria-label={field.label}
          title={value || field.label}
          value={value}
          required={field.required}
          disabled={busy || loading}
          onChange={async (e) => {
            const next = e.target.value;
            if (saving.current || next === value) return;
            saving.current = true;
            setBusy(true);
            setError('');
            try {
              await api(`bugs/${issueId}`, 'PATCH', {
                field: field.key,
                previous: value,
                value: next,
              });
              await onRefresh();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              saving.current = false;
              setBusy(false);
            }
          }}
        >
          <option value="" disabled={field.required}>
            {field.key === 'assignee' ? 'Unassigned' : 'Choose…'}
          </option>
          {[...new Set([...options, ...(value ? [value] : [])])].map(
            (option) => (
              <option
                key={option}
                value={option}
                disabled={
                  accounts &&
                  !!members.find((m) => m.email === option)?.disabled
                }
              >
                {label(option)}
              </option>
            ),
          )}
        </select>
      </div>
      <span className="sr-only" role="status">
        {busy ? `Saving ${field.label}…` : ''}
      </span>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
