import { PORT } from "./server/config.ts";
import { closeDb } from "./server/db.ts";
import { dispatch } from "./server/routes/index.ts";

const OPEN_BROWSER = process.env.OPEN_BROWSER !== "false";

// Close the DB cleanly on shutdown so SQLite can checkpoint the WAL and we
// don't leave stale -shm / -wal files behind. Without this, Ctrl+C (SIGINT)
// or a kill from Task Manager skips SQLite's normal close path.
let shuttingDown = false;
function shutdown(reason: string, exitCode = 0): never {
  if (shuttingDown) process.exit(exitCode);
  shuttingDown = true;
  console.log(`\nShutting down (${reason})…`);
  closeDb();
  process.exit(exitCode);
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGHUP", () => shutdown("SIGHUP"));
process.on("uncaughtException", (err) => {
  console.error("Uncaught exception:", err);
  shutdown("uncaughtException", 1);
});

let server: ReturnType<typeof Bun.serve>;
try {
  server = Bun.serve({
    port: PORT,
    fetch: dispatch,
  });
} catch (err) {
  const msg = (err as Error).message ?? String(err);
  if (/EADDRINUSE|in use|EACCES/i.test(msg)) {
    console.error(
      `\nCouldn't bind to port ${PORT} — something else is using it.\n` +
        `  • If an older launch is still running, close its console window.\n` +
        `  • Or set a different port: PORT=5758 launch.bat\n` +
        `(Check via: netstat -ano | findstr :${PORT})\n`,
    );
    process.exit(1);
  }
  throw err;
}

const listeningUrl = `http://localhost:${server.port}`;
console.log(`\nAPI Catalog Explorer listening on ${listeningUrl}`);
console.log("Press Ctrl+C to stop.\n");

if (OPEN_BROWSER) {
  try {
    Bun.spawn(
      ["powershell.exe", "-NoProfile", "-Command", `Start-Process '${listeningUrl}'`],
      { stderr: "inherit" },
    );
  } catch (err) {
    console.log(`(could not auto-open browser: ${(err as Error).message})`);
  }
}
