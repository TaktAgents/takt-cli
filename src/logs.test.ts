import { test, expect } from "bun:test";
import { parseLogLines, filterLogs } from "./logs";

const sample = [
  '{"timestamp":"2026-05-28T13:00:00Z","level":"info","agentName":"Claude Code","event":"executionCompleted"}',
  "garbage line",
  '{"timestamp":"2026-05-28T13:05:00Z","level":"error","agentName":"Codex","event":"executionFailed"}',
  "",
].join("\n");

test("parses valid JSONL and skips broken lines", () => {
  const entries = parseLogLines(sample);
  expect(entries.length).toBe(2);
  expect(entries[0].agentName).toBe("Claude Code");
});

test("filters by agent and level", () => {
  const entries = parseLogLines(sample);
  expect(filterLogs(entries, { agent: "Codex" }).length).toBe(1);
  expect(filterLogs(entries, { level: "error" })[0].agentName).toBe("Codex");
  expect(filterLogs(entries, { agent: "Nope" }).length).toBe(0);
});
