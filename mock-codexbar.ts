#!/usr/bin/env bun
import { argv } from "bun";

const json = {
  providerID: "codexbar_presets",
  providerName: "CodexBar Mock",
  isAvailable: true,
  isAuthenticated: true,
  fiveHourWindow: {
    usedPercent: 43.2,
    remainingPercent: 56.8,
    resetAt: new Date(Date.now() + 7200 * 1000).toISOString(),
    resetInSeconds: 7200,
    status: "ok"
  },
  weeklyWindow: {
    usedPercent: 68.0,
    remainingPercent: 32.0,
    resetAt: new Date(Date.now() + 172800 * 1000).toISOString(),
    resetInSeconds: 172800,
    status: "warning"
  },
  credits: {
    amount: 150.5,
    currency: "USD"
  },
  raw: "raw_output_here",
  checkedAt: new Date().toISOString()
};

if (argv.includes("fail")) {
  console.error("Mock CodexBar failed");
  process.exit(1);
} else {
  console.log(JSON.stringify(json));
  process.exit(0);
}
