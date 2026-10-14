import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { recoveryLinkToken } from '../server/auth.mjs';
const directory = resolve(process.env.SENTINEL_DATA_DIR || 'data');
if (!process.argv[2])
  throw Error('Usage: pnpm auth:recover account@example.com');
const db = new DatabaseSync(resolve(directory, 'bugbook.sqlite'));
try {
  const value = recoveryLinkToken(db, process.argv[2]);
  const file = resolve(directory, 'account-recovery.txt');
  writeFileSync(
    file,
    (process.env.SENTINEL_PUBLIC_ORIGIN || 'http://127.0.0.1:5173') +
      '/#invite=' +
      value +
      '\n',
    { mode: 0o600 },
  );
  console.log('One-hour recovery link saved privately to ' + file);
} finally {
  db.close();
}
