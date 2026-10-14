import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Private, read-only export. Credentials, session tokens and local Photos paths are excluded.
export function prepareCloudMigration(database, destination) {
  const db = new DatabaseSync(database, { readOnly: true });
  mkdirSync(destination, { recursive: false, mode: 0o700 });
  try {
    db.exec('BEGIN');
    const all = (table) => db.prepare(`SELECT * FROM ${table}`).all();
    const state = {
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      bugs: all('bugs').map((row) => {
        const { creationToken, creationAccountId, ...issue } = JSON.parse(
          row.data,
        );
        return { ...issue, id: row.id };
      }),
      projects: all('projects'),
      components: all('project_components'),
      versions: all('project_versions'),
      projectKeys: all('project_keys'),
      issueSequences: all('issue_sequences'),
      fields: JSON.parse(
        db.prepare("SELECT data FROM settings WHERE key='fields'").get()
          ?.data ?? 'null',
      ),
      links: all('issue_links'),
      members: db
        .prepare('SELECT id,email,role,disabled FROM auth_users ORDER BY id')
        .all(),
      capturesSeen: all('capture_hashes').map((row) => row.hash),
      files: [],
    };
    mkdirSync(join(destination, 'files'), { mode: 0o700 });
    for (const table of ['attachments', 'capture_inbox']) {
      for (const row of all(table)) {
        if (!/^[a-zA-Z0-9-]+$/.test(row.id))
          throw Error('Unexpected attachment identifier.');
        const target = join(destination, 'files', row.id);
        if (row.storage_size === null)
          writeFileSync(target, row.bytes, { flag: 'wx', mode: 0o600 });
        else
          copyFileSync(join(dirname(database), 'attachments', row.id), target);
        const bytes = readFileSync(target);
        if (bytes.length !== (row.storage_size ?? row.bytes.length))
          throw Error('Attachment size changed during export.');
        state.files.push({
          id: row.id,
          name: row.name,
          issueId: row.bug_id ?? null,
          createdAt: row.created_at,
          size: bytes.length,
          sha256: createHash('sha256').update(bytes).digest('hex'),
          source: table === 'attachments' ? 'issue' : 'inbox',
          ...(row.hash
            ? { captureHash: row.hash, sourceModified: row.source_modified }
            : {}),
        });
      }
    }
    writeFileSync(
      join(destination, 'manifest.json'),
      JSON.stringify(state, null, 2),
      { flag: 'wx', mode: 0o600 },
    );
    db.exec('COMMIT');
    return {
      projects: state.projects.length,
      issues: state.bugs.length,
      files: state.files.length,
      bytes: state.files.reduce((sum, file) => sum + file.size, 0),
    };
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {}
    rmSync(destination, { recursive: true, force: true });
    throw error;
  } finally {
    db.close();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const root = resolve('migration-private');
  mkdirSync(root, { recursive: true, mode: 0o700 });
  const destination = join(
    root,
    new Date().toISOString().replace(/[:.]/g, '-'),
  );
  console.log(
    JSON.stringify(
      {
        directory: destination,
        ...prepareCloudMigration(
          resolve(process.env.SENTINEL_DATA_DIR || 'data', 'bugbook.sqlite'),
          destination,
        ),
      },
      null,
      2,
    ),
  );
}
