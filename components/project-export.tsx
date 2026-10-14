'use client';
import { cloudEnabled, cloudFetch } from '../lib/cloud';
import { useState } from 'react';
import { Download } from 'lucide-react';
import type { Project } from '../lib/bugs';
export function ProjectExport({
  project,
  types,
}: {
  project: Project;
  types: string[];
}) {
  const [period, setPeriod] = useState('week');
  const [basis, setBasis] = useState('createdAt');
  const [type, setType] = useState('');
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  return (
    <details className="project-export detail-panel">
      <summary>
        <Download size={16} /> Export CSV
      </summary>
      <p className="muted">
        Download this project’s issue data for Excel or another tool. Includes
        comments, activity, custom fields and attachment names. Media files and
        Trash are excluded.
      </p>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError('');
          try {
            const params = new URLSearchParams({ basis, type });
            const now = new Date();
            if (period === 'custom') {
              const start = new Date(from + 'T00:00:00'),
                end = new Date(to + 'T00:00:00');
              end.setDate(end.getDate() + 1);
              if (
                !Number.isFinite(start.getTime()) ||
                !Number.isFinite(end.getTime()) ||
                start >= end
              )
                throw Error('Choose a valid date range.');
              params.set('from', start.toISOString());
              params.set('to', end.toISOString());
            } else if (period !== 'all') {
              const start = new Date(now);
              if (period === 'day') start.setDate(start.getDate() - 1);
              if (period === 'week') start.setDate(start.getDate() - 7);
              if (period === 'month') start.setMonth(start.getMonth() - 1);
              if (period === 'year') start.setFullYear(start.getFullYear() - 1);
              params.set('from', start.toISOString());
              params.set('to', now.toISOString());
            }
            const response = cloudEnabled
              ? await cloudFetch(`projects/${project.id}/export?${params}`)
              : await fetch(`/api/projects/${project.id}/export?${params}`);
            if (response.status === 401)
              window.dispatchEvent(new Event('sentinel-session-expired'));
            if (!response.ok) {
              const data = (await response.json()) as { error?: string };
              throw Error(data.error || 'Export failed.');
            }
            const url = URL.createObjectURL(await response.blob());
            const link = document.createElement('a');
            link.href = url;
            link.download = `${project.name.replace(/[^\p{L}\p{N}_-]+/gu, '-')}-${period}-${now.toISOString().slice(0, 10)}.csv`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <fieldset disabled={busy}>
          <div className="form-grid">
            <label>
              Date range
              <select
                value={period}
                onChange={(e) => setPeriod(e.target.value)}
              >
                <option value="all">All time</option>
                <option value="day">Past day</option>
                <option value="week">Past week</option>
                <option value="month">Past month</option>
                <option value="year">Past year</option>
                <option value="custom">Custom dates</option>
              </select>
            </label>
            <label>
              Include issues by
              <select value={basis} onChange={(e) => setBasis(e.target.value)}>
                <option value="createdAt">Date created</option>
                <option value="updatedAt">Date last updated</option>
              </select>
            </label>
            <label>
              Issue type
              <select value={type} onChange={(e) => setType(e.target.value)}>
                <option value="">All types</option>
                {types.map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            {period === 'custom' && (
              <>
                <label>
                  From
                  <input
                    type="date"
                    required
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </label>
                <label>
                  Through
                  <input
                    type="date"
                    required
                    min={from}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </label>
              </>
            )}
          </div>
          <div className="actions">
            <button type="submit" className="primary">
              {busy ? 'Exporting…' : 'Download CSV'}
            </button>
          </div>
        </fieldset>
      </form>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </details>
  );
}
