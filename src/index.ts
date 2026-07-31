import { client, start } from './discord.ts';
import { startServer } from './server.ts';

// Log in to Discord first: the HTTP server should not accept events it cannot
// act on. config.ts throws here if anything required is missing.
await start();
const server = startServer();

let shuttingDown = false;

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`[qolhelper] ${signal} received, shutting down.`);

    // Close the listener and the gateway connection, then let the event loop
    // drain on its own. Calling process.exit() with the SQLite handle and the
    // websocket still open trips a libuv assertion on Windows.
    server.close();
    void client.destroy();
  });
}
