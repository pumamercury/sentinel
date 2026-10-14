import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { initializeOwner } from '../server/auth.mjs';
const directory = resolve(process.env.SENTINEL_DATA_DIR || 'data');
mkdirSync(directory, { recursive: true });
const db = new DatabaseSync(resolve(directory, 'bugbook.sqlite'));
try {
  const invitation = initializeOwner(db);
  const url =
    (process.env.SENTINEL_PUBLIC_ORIGIN || 'http://127.0.0.1:5173') +
    '/#invite=' +
    invitation;
  const file = resolve(directory, 'owner-setup.txt');
  writeFileSync(
    file,
    `Open this one-time link to choose your owner email and password. It expires in 24 hours.\n\n${url}\n`,
    { mode: 0o600 },
  );
  console.log(
    `Login is now required. Your private owner setup link is in ${file}`,
  );
} finally {
  db.close();
}
