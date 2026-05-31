import { test, expect } from "bun:test";
import { spawnSync } from "bun";
import { ExitCode } from "./exitCodes";

test("returns ExitCode 3 (INVALID_COMMAND) for unknown commands", () => {
  const proc = spawnSync(["bun", "src/index.ts", "unknowncommand"]);
  expect(proc.exitCode).toBe(ExitCode.INVALID_COMMAND);
});

test("returns ExitCode 3 (INVALID_COMMAND) for unknown options", () => {
  const proc = spawnSync(["bun", "src/index.ts", "status", "--invalidoption"]);
  expect(proc.exitCode).toBe(ExitCode.INVALID_COMMAND);
});

test("returns ExitCode 2 (APP_NOT_RUNNING) for daemon-only command when socket is not active", () => {
  const proc = spawnSync(["bun", "src/index.ts", "pause"], {
    env: { ...process.env, TAKT_SOCKET_DIR: "/tmp/nonexistent-takt-dir" }
  });
  // Standalone mode is active so it falls back and fails since app is not running
  expect(proc.exitCode).toBe(ExitCode.APP_NOT_RUNNING);
});
