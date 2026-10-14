import { createServer } from 'node:http';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomUUID } from 'node:crypto';
import { createApi } from '../../../server/api.mjs';
import { initializeOwner } from '../../../server/auth.mjs';
const directory = mkdtempSync(join(tmpdir(), 'sentinel-native-test-'));
const file = join(directory, 'test.sqlite');
const authenticated = process.argv.includes('--authenticated');
let token;
if (authenticated) { const db = new DatabaseSync(file); token = initializeOwner(db); db.close(); }
const api = createApi(file);
const server = createServer((req, res) => api.handler(req, res, () => { res.writeHead(404); res.end(); }));
server.listen(0, '127.0.0.1', async () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  if (authenticated) {
    const accepted = await fetch(origin + '/api/auth/accept', { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'native-test@example.com', password: 'Native test passphrase 123!', token }) });
    if (!accepted.ok) throw Error('Could not initialize the temporary test account');
    // Seed a real inbox capture to exercise its separately authenticated media route.
    const db = new DatabaseSync(file);
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX9sAAAAASUVORK5CYII=', 'base64');
    db.prepare('INSERT INTO capture_inbox(id,name,bytes,created_at,source_path,source_modified,hash) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), 'native-inbox-test.png', png, new Date().toISOString(), '', '', createHash('sha256').update(png).digest('hex'));
    console.log('AUTHENTICATED_TEST_SERVER=true');
    db.close();
  }
  console.log(`SENTINEL_TEST_URL=${origin}`);
});
async function close() { await new Promise(resolve => server.close(resolve)); await api.close(); rmSync(directory, { recursive: true, force: true }); process.exit(); }
process.on('SIGTERM', close);
process.on('SIGINT', close);
