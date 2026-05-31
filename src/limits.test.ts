import { test, expect } from "bun:test";
import { formatDuration, formatWeeklyReset, fetchCodexBarLimits, fetchCustomLimits } from "./limits";
import { join } from "path";

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

test("fetchCodexBarLimits parses mock output correctly", () => {
  const mockPath = join(__dirname, "../mock-codexbar.ts");
  const data = fetchCodexBarLimits(mockPath, "status");
  
  expect(data.provider).toBe("CodexBar");
  expect(data.status).toBe("available");
  expect(data.limits.length).toBe(1);
  const limit = data.limits[0];
  expect(limit.providerId).toBe("codexbar_presets");
  expect(limit.providerName).toBe("CodexBar Mock");
  expect(limit.fiveHourWindow?.usedPercent).toBe(43.2);
  expect(limit.fiveHourWindow?.remainingPercent).toBe(56.8);
  expect(limit.fiveHourWindow?.status).toBe("ok");
  expect(limit.credits?.amount).toBe(150.5);
  expect(limit.credits?.currency).toBe("USD");
});

test("fetchCustomLimits executes command and parses according to mapping", () => {
  const mockCommand = `bun ${join(__dirname, "../mock-codexbar.ts")}`;
  const config = {
    limits_providers: {
      custom: {
        enabled: true,
        command: mockCommand,
        mapping: {
          provider_id_path: "providerID",
          provider_name_path: "providerName",
          used_path: "fiveHourWindow.usedPercent",
          total_path: "fiveHourWindow.remainingPercent",
          resets_at_path: "fiveHourWindow.resetInSeconds"
        }
      }
    }
  };
  
  const data = fetchCustomLimits(config);
  expect(data.provider).toBe("CodexBar Mock");
  expect(data.limits.length).toBe(1);
  const limit = data.limits[0];
  expect(limit.providerId).toBe("codexbar_presets");
  expect(limit.fiveHourWindow?.usedPercent).toBeCloseTo(76.056, 3);
});
