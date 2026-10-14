'use client';
import { ProjectExport } from './project-export';
import { useAccess } from './account-gate';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { statusCategory, type FieldDefinition } from '../lib/field-schema.mjs';
import { QuickField } from './quick-fields';
import Link from 'next/link';
import {
  Pencil,
  ArrowLeft,
  ArrowUpRight,
  Bug,
  Lightbulb,
  ListTodo,
  Sparkles,
} from 'lucide-react';
import { type Project, type Issue, badge } from '../lib/bugs';
import { ProjectBadge } from './project-badge';
import { IssueIdentity } from './issue-identity';

const types = [
  { name: 'Bug', label: 'Bugs', Icon: Bug },
  { name: 'Idea', label: 'Ideas', Icon: Lightbulb },
  { name: 'Task', label: 'Tasks', Icon: ListTodo },
  { name: 'Feature request', label: 'Features', Icon: Sparkles },
];
function OwnerProjectLink(props: React.ComponentProps<typeof Link>) {
  const { owner } = useAccess();
  return owner ? <Link {...props} /> : null;
}

export function ProjectsOverview({
  projects,
  issues,
  fields,
  selectedId,
  onNew,
  onQuick,
  busy,
}: {
  projects: Project[];
  issues: Issue[];
  fields: FieldDefinition[];
  selectedId: number | null;
  onNew: (name: string) => void;
  onQuick: (issue: Issue, field: 'status' | 'priority', value: string) => void;
  busy: boolean;
}) {
  const router = useRouter();
  const typeNames = [
    ...new Set([
      ...(fields.find((f) => f.key === 'issueType')?.options ?? []),
      ...issues.map((i) => i.issueType || 'Bug'),
    ]),
  ];
  const configuredTypes = typeNames.map(
    (name) =>
      types.find((t) => t.name === name) ?? {
        name,
        label: name,
        Icon: ListTodo,
      },
  );
  const [type, setType] = useState('');
  const selected = projects.find((p) => p.id === selectedId);
  const projectIssues = (name: string) =>
    issues.filter(
      (issue) => issue.project.toLowerCase() === name.toLowerCase(),
    );
  const current = selected ? projectIssues(selected.name) : [];
  return (
    <div key={selectedId ?? 'overview'} className="project-page-transition">
      <div className="breadcrumb">
        Workspace / Projects{selected ? ` / ${selected.name}` : ''}
      </div>
      <header>
        <div>
          {selected && (
            <button
              className="project-back"
              onClick={() => {
                router.push('/?view=projects');
                setType('');
              }}
            >
              <ArrowLeft size={16} /> All projects
            </button>
          )}
          <h1>
            {selected ? (
              <ProjectBadge name={selected.name} projects={projects} details />
            ) : (
              <>
                Projects <span className="count">{projects.length}</span>
              </>
            )}
          </h1>
          <p className="muted">
            {selected
              ? selected.description
              : 'Your apps and their issues at a glance.'}
          </p>
        </div>
        {selected && (
          <div className="actions">
            <OwnerProjectLink
              className="button"
              href={'/?view=admin&editProject=' + selected.id}
            >
              <Pencil size={16} /> Edit project
            </OwnerProjectLink>
            <button className="primary" onClick={() => onNew(selected.name)}>
              New issue
            </button>
          </div>
        )}
      </header>
      {selected ? (
        <>
          <ProjectExport
            key={selected.id}
            project={selected}
            types={typeNames}
          />
          <div className="project-type-filters" aria-label="Issue types">
            <button aria-pressed={!type} onClick={() => setType('')}>
              All issues <strong>{current.length}</strong>
            </button>
            {configuredTypes.map(({ name, label, Icon }) => (
              <button
                key={name}
                aria-pressed={type === name}
                onClick={() => setType(name)}
              >
                <Icon size={16} />
                {label}{' '}
                <strong>
                  {
                    current.filter((i) => (i.issueType || 'Bug') === name)
                      .length
                  }
                </strong>
              </button>
            ))}
          </div>
          <section
            className="surface project-issue-list"
            aria-label={`${selected.name} issues`}
          >
            {current
              .filter((i) => !type || (i.issueType || 'Bug') === type)
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
              .map((issue) => (
                <div className="project-issue-row" key={issue.id}>
                  <Link href={`/bugs/${issue.id}?fromProject=${selected.id}`}>
                    <span>
                      <IssueIdentity
                        id={issue.id}
                        type={issue.issueType}
                        issueKey={issue.issueKey}
                      />
                      <strong>{issue.title}</strong>
                    </span>
                  </Link>
                  <span className="project-issue-meta">
                    <QuickField
                      issue={issue}
                      field="status"
                      fields={fields}
                      busy={busy}
                      onChange={onQuick}
                    />
                    <QuickField
                      issue={issue}
                      field="priority"
                      fields={fields}
                      busy={busy}
                      onChange={onQuick}
                    />
                    <ArrowUpRight size={18} />
                  </span>
                </div>
              ))}
            {!current.some((i) => !type || (i.issueType || 'Bug') === type) && (
              <div className="empty">
                No {type ? type.toLowerCase() + ' issues' : 'issues'} in this
                project yet.
              </div>
            )}
          </section>
        </>
      ) : (
        <div className="project-overview-grid">
          {projects.map((project) => {
            const items = projectIssues(project.name);
            const open = items.filter(
              (i) => statusCategory(i.status, fields) !== 'completed',
            ).length;
            return (
              <button
                className="project-overview-card"
                key={project.id}
                onClick={() => {
                  router.push('/?view=projects&project=' + project.id);
                  setType('');
                }}
              >
                <ProjectBadge name={project.name} projects={projects} details />
                <p className="muted">
                  {project.description || 'No description yet.'}
                </p>
                <span className="project-overview-total">
                  <strong>{items.length}</strong> issues{' '}
                  <span>{open} open</span>
                </span>
                <span className="project-overview-types">
                  {configuredTypes.map(({ name, label, Icon }) => (
                    <span key={name}>
                      <Icon size={15} />
                      {
                        items.filter((i) => (i.issueType || 'Bug') === name)
                          .length
                      }{' '}
                      {label}
                    </span>
                  ))}
                </span>
                <span className="project-overview-link">
                  View issues <ArrowUpRight size={16} />
                </span>
              </button>
            );
          })}
          {!projects.length && (
            <p className="empty">
              No projects yet. Create one in Admin → Projects, or when adding an
              issue.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
