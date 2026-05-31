import { test, expect } from "bun:test";
import { formatDuration, formatWeeklyReset } from "./limits";

test("formatDuration formats seconds to Xh Ym correctly", () => {
  expect(formatDuration(0)).toBe("now");
  expect(formatDuration(-10)).toBe("now");
  expect(formatDuration(45 * 60)).toBe("45m");
  expect(formatDuration(3600)).toBe("1h 0m");
  expect(formatDuration(7200 + 12 * 60)).toBe("2h 12m");
});

test("formatWeeklyReset formats resets correctly", () => {
  // Test resetInSeconds mapping
  expect(formatWeeklyReset(undefined, 86400)).toBe("tomorrow");
  expect(formatWeeklyReset(undefined, 172800)).toBe("in 2 days");
  
  // Test ISO Date mapping (e.g. 2026-05-31 is Sunday)
  const sunday = "2026-05-31T00:00:00Z";
  expect(formatWeeklyReset(sunday)).toBe("Sunday");
  
  const monday = "2026-06-01T00:00:00Z";
  expect(formatWeeklyReset(monday)).toBe("Monday");
});
