import { test, expect } from "bun:test";
import { isValidCron } from "./cron";

test("accepts valid cron expressions", () => {
  expect(isValidCron("0 8 * * *")).toBe(true);
  expect(isValidCron("0 */5 * * *")).toBe(true);
  expect(isValidCron("30 22 * * 1-5")).toBe(true);
  expect(isValidCron("0 8,13,18,23 * * *")).toBe(true);
});

test("rejects invalid cron expressions", () => {
  expect(isValidCron("0 8 * *")).toBe(false);       // 4 fields
  expect(isValidCron("0 8 * * * *")).toBe(false);   // 6 fields
  expect(isValidCron("abc 8 * * *")).toBe(false);
  expect(isValidCron("")).toBe(false);
});
