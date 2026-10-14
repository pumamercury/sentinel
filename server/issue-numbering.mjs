const codes = {
  Bug: 'BUG',
  Idea: 'IDEA',
  Task: 'TASK',
  'Feature request': 'FEAT',
};
export function issueNumbering(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS project_keys(project_id INTEGER PRIMARY KEY REFERENCES projects(id), prefix TEXT NOT NULL UNIQUE);
    CREATE TABLE IF NOT EXISTS issue_sequences(project_id INTEGER NOT NULL REFERENCES projects(id), type TEXT NOT NULL, last_number INTEGER NOT NULL, PRIMARY KEY(project_id,type));`);
  function prefixFor(project) {
    const saved = db
      .prepare('SELECT prefix FROM project_keys WHERE project_id=?')
      .get(project.id);
    if (saved) return saved.prefix;
    const words =
      project.name
        .split(/\s+[-–—|]\s+/)[0]
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/([a-z])([A-Z])/g, '$1 $2')
        .toUpperCase()
        .match(/[A-Z0-9]+/g) ?? [];
    const base =
      (words.length > 1
        ? words.map((w) => w[0]).join('')
        : words[0]?.slice(0, 3)) || 'P';
    let prefix = base,
      suffix = 2;
    while (db.prepare('SELECT 1 FROM project_keys WHERE prefix=?').get(prefix))
      prefix = base + suffix++;
    db.prepare('INSERT INTO project_keys(project_id,prefix) VALUES (?,?)').run(
      project.id,
      prefix,
    );
    return prefix;
  }
  for (const project of db
    .prepare('SELECT id,name FROM projects ORDER BY id')
    .all())
    prefixFor(project);
  return (bug) => {
    const project = db
      .prepare('SELECT id,name FROM projects WHERE name=? COLLATE NOCASE')
      .get(bug.project);
    if (!project) throw Error('Project not found for issue numbering.');
    const type = codes[bug.issueType || 'Bug'] ?? 'ISSUE';
    const prefix = prefixFor(project);
    if (
      bug.numberingProjectId !== project.id ||
      bug.numberingType !== type ||
      !Number.isSafeInteger(bug.issueNumber) ||
      bug.issueNumber < 1
    ) {
      const row = db
        .prepare(`INSERT INTO issue_sequences(project_id,type,last_number) VALUES (?,?,1)
        ON CONFLICT(project_id,type) DO UPDATE SET last_number=last_number+1 RETURNING last_number`)
        .get(project.id, type);
      bug.issueNumber = row.last_number;
      bug.numberingProjectId = project.id;
      bug.numberingType = type;
    }
    bug.issueKey = `${prefix}-${type}-${bug.issueNumber}`;
  };
}
