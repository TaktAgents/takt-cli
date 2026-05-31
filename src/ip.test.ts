import { test, expect } from "bun:test";
import { isValidIP } from "./ip";

test("accepts valid IPv4", () => {
  expect(isValidIP("203.0.113.45")).toBe(true);
  expect(isValidIP("0.0.0.0")).toBe(true);
  expect(isValidIP("255.255.255.255")).toBe(true);
});

test("rejects invalid IPv4", () => {
  expect(isValidIP("256.0.0.1")).toBe(false);
  expect(isValidIP("1.2.3")).toBe(false);
  expect(isValidIP("01.2.3.4")).toBe(false);
  expect(isValidIP("abc")).toBe(false);
  expect(isValidIP("")).toBe(false);
});

test("accepts valid IPv6", () => {
  expect(isValidIP("2001:db8::1")).toBe(true);
  expect(isValidIP("::1")).toBe(true);
});
