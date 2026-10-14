import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
  existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createApi } from '../server/api.mjs';
import { prepareCloudMigration } from '../scripts/prepare-cloud-migration.mjs';
test('private cloud export preserves IDs, counters, bytes and Trash without exporting account secrets', async () => {
  const root = mkdtempSync(join(tmpdir(), 'sentinel-cloud-export-'));
  try {
    const path = join(root, 'test.sqlite');
    const api = createApi(path);
    await api.close();
    const db = new DatabaseSync(path);
    db.prepare('INSERT INTO projects(id,name) VALUES(?,?)').run(
      7,
      'Ferment Tracker',
    );
    db.prepare('INSERT INTO project_keys VALUES(?,?)').run(7, 'FT');
    db.prepare('INSERT INTO issue_sequences VALUES(?,?,?)').run(7, 'BUG', 12);
    db.prepare('INSERT INTO bugs(id,data) VALUES(?,?)').run(
      12,
      JSON.stringify({
        project: 'Ferment Tracker',
        issueKey: 'FT-BUG-12',
        deletedAt: '2026-10-01T00:00:00Z',
        creationToken: 'secret-token',
        creationAccountId: 1,
      }),
    );
    db.prepare('INSERT INTO auth_users VALUES(?,?,?,?,?)').run(
      1,
      'owner@example.com',
      'secret-password-hash',
      'owner',
      0,
    );
    db.prepare('INSERT INTO auth_sessions(hash,user_id,expires) VALUES(?,?,?)').run(
      'secret-session',
      1,
      9999999999,
    );
    const bytes = Buffer.from('issue attachment');
    db.prepare(
      'INSERT INTO attachments(id,bug_id,name,bytes,created_at) VALUES(?,?,?,?,?)',
    ).run('file-1', 12, 'file.txt', bytes, '2026-10-01');
    const capture = Buffer.from('inbox capture');
    mkdirSync(join(root, 'attachments'), { recursive: true });
    writeFileSync(join(root, 'attachments', 'capture-1'), capture);
    db.prepare('INSERT INTO capture_inbox VALUES(?,?,?,?,?,?,?,?)').run(
      'capture-1',
      'capture.png',
      null,
      capture.length,
      '2026-10-01',
      '/private/photos/path',
      '2026-10-01',
      'capture-hash',
    );
    db.close();
    const output = join(root, 'export');
    assert.equal(prepareCloudMigration(path, output).files, 2);
    const serialized = readFileSync(join(output, 'manifest.json'), 'utf8');
    for (const secret of [
      'secret-token',
      'secret-password-hash',
      'secret-session',
      '/private/photos/path',
    ])
      assert.ok(!serialized.includes(secret));
    const manifest = JSON.parse(serialized);
    assert.equal(manifest.bugs[0].id, 12);
    assert.equal(manifest.bugs[0].issueKey, 'FT-BUG-12');
    assert.ok(manifest.bugs[0].deletedAt);
    assert.equal(manifest.issueSequences[0].last_number, 12);
    for (const file of manifest.files) {
      const copied = readFileSync(join(output, 'files', file.id));
      assert.equal(
        createHash('sha256').update(copied).digest('hex'),
        file.sha256,
      );
      assert.equal(copied.length, file.size);
    }
    assert.deepEqual(readFileSync(join(output, 'files', 'file-1')), bytes);
    assert.deepEqual(readFileSync(join(output, 'files', 'capture-1')), capture);
    rmSync(join(root, 'attachments', 'capture-1'));
    assert.throws(() => prepareCloudMigration(path, join(root, 'failed')));
    assert.equal(existsSync(join(root, 'failed')), false);
    assert.ok(existsSync(path));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
