import { test, expect } from "bun:test";
import { parseDuration } from "./duration";

test("parses minutes/hours/days/seconds", () => {
  expect(parseDuration("15m")).toBe(900);
  expect(parseDuration("1h")).toBe(3600);
  expect(parseDuration("2h")).toBe(7200);
  expect(parseDuration("1d")).toBe(86400);
  expect(parseDuration("30s")).toBe(30);
});

test("tolerates whitespace and case", () => {
  expect(parseDuration(" 2H ")).toBe(7200);
});

test("returns undefined for invalid input", () => {
  expect(parseDuration("5x")).toBeUndefined();
  expect(parseDuration("abc")).toBeUndefined();
  expect(parseDuration("")).toBeUndefined();
  expect(parseDuration("10")).toBeUndefined();
});
