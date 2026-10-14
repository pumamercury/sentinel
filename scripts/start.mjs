import { existsSync } from 'node:fs';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { createServer } from 'vite';
let server, companion;
try {
  server = await createServer();
  await server.listen();
  server.printUrls();
  if (
    existsSync(
      resolve(process.env.SENTINEL_DATA_DIR || 'data', 'cloud-connection.json'),
    )
  ) {
    companion = fork(new URL('./cloud-companion.mjs', import.meta.url), [], {
      stdio: 'inherit',
    });
    companion.on('error', (error) =>
      console.error('Cloud companion:', error.message),
    );
  }
  console.log(
    '\nSentinel is ready. Open http://127.0.0.1:5173 in your browser.',
  );
  console.log(
    'Keep this window open while using Sentinel. Press Ctrl+C to stop.',
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      companion?.kill('SIGTERM');
      await server.close();
      process.exit(0);
    });
} catch (error) {
  await server?.close();
  console.error('Could not start Sentinel:', error.message);
  process.exitCode = 1;
}
