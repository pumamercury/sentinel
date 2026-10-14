'use client';
/* oxlint-disable jsx-a11y/prefer-tag-over-role -- Rich issue rows use the ARIA combobox/listbox pattern. */

import { useEffect, useId, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import type { Issue } from '../lib/bugs';
import { issueLabel } from './issue-identity';
import styles from './issue-search-picker.module.css';

function issueSearchLabel(issue: Issue) {
  return `${issueLabel(issue.id, issue.issueType, issue.issueKey)} · ${issue.title} · ${issue.project}`;
}

export function IssueSearchPicker({
  issues,
  value,
  onChange,
  disabled = false,
}: {
  issues: Issue[];
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
}) {
  const selected = issues.find((issue) => String(issue.id) === value) ?? null;
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const id = useId();
  const words = query.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const matches = issues.filter((issue) => {
    const label = issueSearchLabel(issue).toLocaleLowerCase();
    return words.every((word) => label.includes(word));
  });
  const highlightedIndex = Math.min(activeIndex, matches.length - 1);
  const highlightedIssue = matches[highlightedIndex];

  useEffect(() => {
    if (dialogRef.current?.open && highlightedIndex >= 0) {
      listRef.current?.children[highlightedIndex]?.scrollIntoView({
        block: 'nearest',
      });
    }
  }, [highlightedIndex, query]);

  function close() {
    dialogRef.current?.close();
    triggerRef.current?.focus();
  }

  function choose(issue: Issue) {
    if (disabled || !issues.some((candidate) => candidate.id === issue.id))
      return;
    onChange(String(issue.id));
    close();
  }

  return (
    <div className={styles.picker}>
      <button
        type="button"
        ref={triggerRef}
        className={styles.trigger}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-controls={`${id}-dialog`}
        aria-label={
          selected
            ? `Existing issue for captures: ${issueSearchLabel(selected)}`
            : 'Existing issue for captures'
        }
        title={selected ? issueSearchLabel(selected) : undefined}
        onClick={() => {
          setQuery('');
          setActiveIndex(0);
          dialogRef.current?.showModal();
          inputRef.current?.focus();
        }}
      >
        <Search size={16} aria-hidden="true" />
        <span>
          {selected
            ? `${issueLabel(selected.id, selected.issueType, selected.issueKey)} · ${selected.title}`
            : 'Find an existing issue…'}
        </span>
        <ChevronDown size={15} aria-hidden="true" />
      </button>
      <dialog
        id={`${id}-dialog`}
        ref={dialogRef}
        className={styles.dialog}
        aria-labelledby={`${id}-title`}
      >
        <div className={styles.heading}>
          <h2 id={`${id}-title`}>Choose an existing issue</h2>
          <button type="button" aria-label="Close issue search" onClick={close}>
            <X size={17} aria-hidden="true" />
          </button>
        </div>
        <div className={styles.search}>
          <Search size={17} aria-hidden="true" />
          <input
            ref={inputRef}
            role="combobox"
            aria-expanded="true"
            aria-autocomplete="list"
            aria-controls={`${id}-results`}
            aria-activedescendant={
              highlightedIssue
                ? `${id}-issue-${highlightedIssue.id}`
                : undefined
            }
            aria-describedby={`${id}-count`}
            aria-label="Search issues by title, ID or project"
            placeholder="Search title, ID or project…"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (matches.length) {
                  const direction = event.key === 'ArrowDown' ? 1 : -1;
                  setActiveIndex(
                    (highlightedIndex + direction + matches.length) %
                      matches.length,
                  );
                }
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (highlightedIssue) choose(highlightedIssue);
              }
            }}
          />
        </div>
        <output id={`${id}-count`} className={styles.count}>
          {matches.length} {matches.length === 1 ? 'issue' : 'issues'}
          {query.trim() ? ' matching your search' : ' available'}
        </output>
        {!matches.length && (
          <p className={styles.empty}>
            {issues.length
              ? 'No matching issues. Try another title, ID or project.'
              : 'No issues available. Create an issue with your captures or choose another project.'}
          </p>
        )}
        <div
          id={`${id}-results`}
          ref={listRef}
          role="listbox"
          className={styles.list}
          aria-label="Existing issues"
        >
          {matches.map((issue, index) => (
            <button
              type="button"
              id={`${id}-issue-${issue.id}`}
              key={issue.id}
              role="option"
              tabIndex={-1}
              disabled={disabled}
              aria-selected={selected?.id === issue.id}
              className={styles.item}
              data-highlighted={index === highlightedIndex || undefined}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(issue)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault();
                  choose(issue);
                }
              }}
            >
              <div>
                <small>
                  {issueLabel(issue.id, issue.issueType, issue.issueKey)} ·{' '}
                  {issue.project}
                </small>
                <span>{issue.title}</span>
              </div>
              {selected?.id === issue.id && (
                <Check
                  className={styles.indicator}
                  size={16}
                  aria-hidden="true"
                />
              )}
            </button>
          ))}
        </div>
      </dialog>
      {selected && (
        <button
          type="button"
          className={styles.clear}
          disabled={disabled}
          aria-label="Clear selected issue"
          title="Clear selected issue"
          onClick={() => {
            onChange('');
            triggerRef.current?.focus();
          }}
        >
          <X size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
