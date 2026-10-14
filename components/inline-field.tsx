'use client';
import { InlineChoice } from './inline-choice';
import { useAccess } from './account-gate';
import { AccountPicker } from './account-picker';

import { IssueTypeBadge } from './issue-identity';
import { Pencil } from 'lucide-react';
import { useRef, useState } from 'react';
import { api, type Project } from '../lib/bugs';
import type { FieldDefinition } from '../lib/field-schema.mjs';
import { ProjectPicker } from './project-picker';
import { ProjectBadge } from './project-badge';
import { ComponentPicker } from './component-picker';

export function InlineField({
  issueId,
  field,
  value,
  projects,
  project,
  onRefresh,
}: {
  issueId: number;
  field: FieldDefinition;
  value: string;
  projects: Project[];
  project: string;
  onRefresh: () => Promise<void>;
}) {
  const { enabled: accountsEnabled } = useAccess();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [previous, setPrevious] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const saving = useRef(false);
  const cancelled = useRef(false);
  if (
    field.type === 'select' ||
    (accountsEnabled && ['assignee', 'reporter'].includes(field.key))
  )
    return (
      <InlineChoice
        issueId={issueId}
        field={field}
        value={value}
        accounts={
          accountsEnabled && ['assignee', 'reporter'].includes(field.key)
        }
        onRefresh={onRefresh}
      />
    );
  if (!editing) {
    const display = (
      <button
        type="button"
        className={
          'inline-field-text' +
          (field.key === 'project' ? ' inline-project-value' : '')
        }
        aria-label={'Edit ' + field.label}
        onClick={() => {
          cancelled.current = false;
          setDraft(value);
          setPrevious(value);
          setError('');
          setEditing(true);
        }}
      >
        <span>
          {field.key === 'project' && value ? (
            <ProjectBadge name={value} projects={projects} />
          ) : field.key === 'issueType' && value ? (
            <IssueTypeBadge type={value} />
          ) : (
            value || (
              <span className="muted">Add {field.label.toLowerCase()}…</span>
            )
          )}
        </span>
        <Pencil className="inline-edit-cue" size={14} aria-hidden="true" />
      </button>
    );
    return field.key === 'title' ? <h1>{display}</h1> : display;
  }
  return (
    <form
      className={
        'inline-field-editor' +
        (field.key === 'title' ? ' inline-title-editor' : '') +
        (['text', 'textarea'].includes(field.type) &&
        !['title', 'project', 'component'].includes(field.key)
          ? ' inline-text-editor'
          : '')
      }
      onBlur={(e) => {
        if (saving.current || cancelled.current) return;
        if (
          e.relatedTarget instanceof Node &&
          e.currentTarget.contains(e.relatedTarget)
        )
          return;
        e.currentTarget.requestSubmit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          if (!busy) {
            cancelled.current = true;
            setEditing(false);
          }
        }
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
          e.preventDefault();
          e.currentTarget.requestSubmit();
        }
      }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (saving.current || cancelled.current) return;
        if (draft === previous) {
          setEditing(false);
          return;
        }
        saving.current = true;
        setBusy(true);
        setError('');
        try {
          await api('bugs/' + issueId, 'PATCH', {
            field: field.key,
            value: draft,
            previous,
          });
          setPrevious(draft);
          await onRefresh();
          setEditing(false);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Unable to save.');
        } finally {
          saving.current = false;
          setBusy(false);
        }
      }}
    >
      {field.key === 'title' && <h1 className="sr-only">{value}</h1>}
      <fieldset disabled={busy}>
        {field.key === 'title' ? (
          <div className="inline-title-input">
            <span aria-hidden="true">
              {draft || ' '}
              <br />
            </span>
            <textarea
              autoFocus
              rows={1}
              aria-label={field.label}
              value={draft}
              required={field.required}
              maxLength={500}
              onChange={(e) =>
                setDraft(e.target.value.replace(/[\r\n]+/g, ' '))
              }
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (!busy) e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
        ) : field.key === 'project' ? (
          <ProjectPicker
            projects={projects}
            value={draft}
            label={field.label}
            required={field.required}
            onChange={setDraft}
          />
        ) : ['assignee', 'reporter'].includes(field.key) ? (
          <AccountPicker
            value={draft}
            label={field.label}
            required={field.required}
            onChange={setDraft}
          />
        ) : field.key === 'version' ? (
          <ComponentPicker
            kind="version"
            options={projects.find((p) => p.name === project)?.versions ?? []}
            value={draft}
            label={field.label}
            required={field.required}
            onChange={setDraft}
          />
        ) : field.key === 'component' ? (
          <ComponentPicker
            options={projects.find((p) => p.name === project)?.components ?? []}
            value={draft}
            label={field.label}
            required={field.required}
            onChange={setDraft}
          />
        ) : ['text', 'textarea'].includes(field.type) ? (
          <div className="inline-text-input">
            <span aria-hidden="true">
              {draft || ' '}
              <br />
            </span>
            <textarea
              autoFocus
              rows={1}
              aria-label={field.label}
              value={draft}
              required={field.required}
              maxLength={
                field.type === 'textarea' || !field.builtin ? 20000 : 500
              }
              onChange={(e) =>
                setDraft(
                  field.type === 'textarea'
                    ? e.target.value
                    : e.target.value.replace(/[\r\n]+/g, ' '),
                )
              }
              onKeyDown={(e) => {
                if (field.type === 'text' && e.key === 'Enter') {
                  e.preventDefault();
                  if (!busy) e.currentTarget.form?.requestSubmit();
                }
              }}
            />
          </div>
        ) : (
          <label>
            {field.label}
            {field.required ? ' *' : ''}
            {field.type === 'textarea' ? (
              <textarea
                autoFocus
                value={draft}
                required={field.required}
                maxLength={20000}
                onChange={(e) => setDraft(e.target.value)}
              />
            ) : (
              <input
                autoFocus
                type={field.type}
                value={draft}
                required={field.required}
                maxLength={field.builtin ? 500 : 20000}
                onChange={(e) => setDraft(e.target.value)}
              />
            )}
          </label>
        )}
        <div className="actions">
          <button type="submit" className="primary">
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button
            type="button"
            onClick={() => {
              cancelled.current = true;
              setEditing(false);
            }}
          >
            Cancel
          </button>
        </div>
      </fieldset>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
