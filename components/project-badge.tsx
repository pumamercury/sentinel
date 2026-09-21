import { AppWindow } from 'lucide-react';
import type { Project } from '../lib/bugs';
export function ProjectBadge({
  name,
  projects,
  details = false,
}: {
  name: string;
  projects: Project[];
  details?: boolean;
}) {
  const p = projects.find((p) => p.name.toLowerCase() === name.toLowerCase());
  return (
    <span
      className={'project-badge ' + (details ? 'project-large' : '')}
      title={p?.description || name}
    >
      {p?.image ? (
        <img src={p.image} alt="" className="project-avatar" />
      ) : (
        <span className="project-avatar">
          {p?.icon || <AppWindow size={18} />}
        </span>
      )}
      <span>{name}</span>
    </span>
  );
}
