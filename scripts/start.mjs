import { createServer } from 'vite';
let server;
try {
  server = await createServer();
  await server.listen();
  server.printUrls();
  console.log(
    '\nSentinel is ready. Open http://127.0.0.1:5173 in your browser.',
  );
  console.log(
    'Keep this window open while using Sentinel. Press Ctrl+C to stop.',
  );
  for (const signal of ['SIGINT', 'SIGTERM'])
    process.on(signal, async () => {
      await server.close();
      process.exit(0);
    });
} catch (error) {
  await server?.close();
  console.error('Could not start Sentinel:', error.message);
  process.exitCode = 1;
}
