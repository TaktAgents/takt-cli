import { existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import { ConfigManager } from "./config";

export interface UsageWindow {
  usedPercent?: number;
  remainingPercent?: number;
  resetAt?: string;
  resetInSeconds?: number;
  status: "ok" | "warning" | "exhausted" | "unknown";
}

export interface CreditBalance {
  amount: number;
  currency?: string;
}

export interface LimitInfo {
  providerId: string;
  providerName: string;
  fiveHourWindow?: UsageWindow;
  weeklyWindow?: UsageWindow;
  credits?: CreditBalance;
}

export interface LimitsStatusResponse {
  provider: string;
  status: "available" | "exhausted" | "unavailable";
  checkedAt: string;
  limits: LimitInfo[];
}

const POSSIBLE_CODEXBAR_PATHS = [
  "/opt/homebrew/bin/codexbar",
  "/usr/local/bin/codexbar",
  "~/.local/bin/codexbar",
  "/usr/bin/codexbar"
].map(p => p.startsWith("~") ? join(homedir(), p.slice(1)) : p);

/**
 * Находит путь к исполняемому файлу CodexBar.
 */
export function findCodexBarPath(customPath?: string): string | undefined {
  if (customPath) {
    const expanded = customPath.startsWith("~") ? join(homedir(), customPath.slice(1)) : customPath;
    if (existsSync(expanded)) return expanded;
  }
  for (const p of POSSIBLE_CODEXBAR_PATHS) {
    if (existsSync(p)) return p;
  }
  return undefined;
}

/**
 * Извлекает значение из объекта по точечному пути (key path).
 */
function extractValue(obj: any, path?: string): any {
  if (!path) return undefined;
  let cleanPath = path.startsWith("$.") ? path.slice(2) : path;
  if (cleanPath.startsWith("$")) cleanPath = cleanPath.slice(1);
  if (!cleanPath) return undefined;

  const keys = cleanPath.split(".");
  let current = obj;
  for (const key of keys) {
    if (current && typeof current === "object" && key in current) {
      current = current[key];
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Форматирует оставшееся время до сброса лимита.
 */
export function formatDuration(seconds: number): string {
  if (seconds <= 0) return "now";
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  if (hours > 0) {
    return `${hours}h ${mins}m`;
  }
  return `${mins}m`;
}

/**
 * Форматирует день недели для недельного лимита.
 */
export function formatWeeklyReset(resetAtStr?: string, resetInSeconds?: number): string {
  if (resetInSeconds !== undefined && resetInSeconds > 0) {
    const daysLeft = Math.ceil(resetInSeconds / 86400);
    if (daysLeft === 1) return "tomorrow";
    return `in ${daysLeft} days`;
  }
  if (!resetAtStr) return "unknown";
  const date = new Date(resetAtStr);
  if (isNaN(date.getTime())) return "unknown";
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  return days[date.getDay()];
}

/**
 * Опрашивает CodexBar напрямую через CLI.
 */
export function fetchCodexBarLimits(cliPath?: string, statusCommand?: string): LimitsStatusResponse {
  const path = findCodexBarPath(cliPath);
  if (!path) {
    console.error("limits provider unavailable: codexbar executable not found.");
    process.exit(31);
  }

  const { execSync } = require("child_process");
  let stdout: string;
  const cmd = statusCommand || "status --json";
  try {
    stdout = execSync(`"${path}" ${cmd}`, { encoding: "utf8" });
  } catch (err: any) {
    console.error(`limits provider invalid data: codexbar execution failed: ${err.message}`);
    process.exit(32);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch (err: any) {
    console.error(`limits provider invalid data: failed to parse JSON output: ${err.message}`);
    process.exit(32);
  }

  // Поддержка как camelCase, так и snake_case из CodexBar / Takt
  const providerID = parsed.providerID || parsed.provider_id || "codexbar";
  const providerName = parsed.providerName || parsed.provider_name || "CodexBar";
  const isAuth = parsed.isAuthenticated !== undefined ? parsed.isAuthenticated : parsed.is_authenticated;
  
  const rawFiveHour = parsed.fiveHourWindow || parsed.five_hour_window;
  const rawWeekly = parsed.weeklyWindow || parsed.weekly_window;
  const rawCredits = parsed.credits;
  
  const fiveHourWindow: UsageWindow | undefined = rawFiveHour ? {
    usedPercent: rawFiveHour.usedPercent ?? rawFiveHour.used_percent,
    remainingPercent: rawFiveHour.remainingPercent ?? rawFiveHour.remaining_percent,
    resetAt: rawFiveHour.resetAt ?? rawFiveHour.reset_at,
    resetInSeconds: rawFiveHour.resetInSeconds ?? rawFiveHour.reset_in_seconds,
    status: rawFiveHour.status || "unknown"
  } : undefined;

  const weeklyWindow: UsageWindow | undefined = rawWeekly ? {
    usedPercent: rawWeekly.usedPercent ?? rawWeekly.used_percent,
    remainingPercent: rawWeekly.remainingPercent ?? rawWeekly.remaining_percent,
    resetAt: rawWeekly.resetAt ?? rawWeekly.reset_at,
    resetInSeconds: rawWeekly.resetInSeconds ?? rawWeekly.reset_in_seconds,
    status: rawWeekly.status || "unknown"
  } : undefined;

  const credits: CreditBalance | undefined = rawCredits ? {
    amount: rawCredits.amount,
    currency: rawCredits.currency
  } : undefined;

  // Глобальный статус
  let status: "available" | "exhausted" | "unavailable" = "available";
  if (fiveHourWindow?.status === "exhausted" || weeklyWindow?.status === "exhausted") {
    status = "exhausted";
  }

  return {
    provider: "CodexBar",
    status,
    checkedAt: parsed.checkedAt || parsed.checked_at || new Date().toISOString(),
    limits: [
      {
        providerId: providerID,
        providerName,
        fiveHourWindow,
        weeklyWindow,
        credits
      }
    ]
  };
}

/**
 * Опрашивает кастомного провайдера лимитов через его команду CLI.
 */
export function fetchCustomLimits(config: any): LimitsStatusResponse {
  const custom = config.limits_providers?.custom;
  if (!custom || !custom.enabled || !custom.command) {
    console.error("limits provider unavailable: custom provider is not enabled or command is empty.");
    process.exit(31);
  }

  const { execSync } = require("child_process");
  const parts = custom.command.split(" ");
  const executable = parts[0];
  
  // Проверяем, существует ли исполняемый файл (если это путь) или доступен ли в PATH
  const which = require("child_process").spawnSync("which", [executable]);
  if (which.status !== 0 && !existsSync(executable)) {
    console.error(`limits provider unavailable: custom executable '${executable}' not found.`);
    process.exit(31);
  }

  let stdout: string;
  try {
    stdout = execSync(custom.command, { encoding: "utf8" });
  } catch (err: any) {
    console.error(`limits provider invalid data: custom command execution failed: ${err.message}`);
    process.exit(32);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(stdout);
  } catch (err: any) {
    console.error(`limits provider invalid data: failed to parse custom JSON: ${err.message}`);
    process.exit(32);
  }

  const mapping = custom.mapping || {};
  const providerId = extractValue(parsed, mapping.provider_id_path) || "custom";
  const providerName = extractValue(parsed, mapping.provider_name_path) || "Custom CLI";

  let fiveHourWindow: UsageWindow | undefined;
  if (mapping.used_path && mapping.total_path) {
    const used = parseFloat(extractValue(parsed, mapping.used_path));
    const total = parseFloat(extractValue(parsed, mapping.total_path));
    if (!isNaN(used) && !isNaN(total)) {
      const usedPercent = total > 0 ? (used / total) * 100 : 0;
      const remainingPercent = 100 - usedPercent;
      const isExhausted = usedPercent >= 100;
      
      let resetAt: string | undefined;
      let resetInSeconds: number | undefined;
      
      const rawReset = extractValue(parsed, mapping.resets_at_path);
      if (rawReset !== undefined) {
        if (typeof rawReset === "number") {
          // Если это timestamp или секунды
          if (rawReset > 1000000000) {
            resetAt = new Date(rawReset * 1000).toISOString();
          } else {
            resetInSeconds = rawReset;
            resetAt = new Date(Date.now() + rawReset * 1000).toISOString();
          }
        } else if (typeof rawReset === "string") {
          resetAt = new Date(rawReset).toISOString();
        }
      }

      fiveHourWindow = {
        usedPercent,
        remainingPercent,
        resetAt,
        resetInSeconds,
        status: isExhausted ? "exhausted" : "ok"
      };
    }
  }

  let status: "available" | "exhausted" | "unavailable" = "available";
  if (fiveHourWindow?.status === "exhausted") {
    status = "exhausted";
  }

  return {
    provider: providerName,
    status,
    checkedAt: new Date().toISOString(),
    limits: [
      {
        providerId,
        providerName,
        fiveHourWindow
      }
    ]
  };
}

/**
 * Главный метод для получения статуса лимитов в Standalone Mode.
 */
export function fetchLimitsStandalone(config: ConfigManager): LimitsStatusResponse {
  const provider = config.settings.limits_guard?.provider || "codexbar";
  if (provider === "codexbar") {
    const cliPath = config.settings.limits_providers?.codexbar?.cli_path;
    const statusCommand = config.settings.limits_providers?.codexbar?.status_command;
    return fetchCodexBarLimits(cliPath, statusCommand);
  } else if (provider === "custom") {
    return fetchCustomLimits(config.settings);
  } else {
    console.error(`limits provider unavailable: unknown provider '${provider}'`);
    process.exit(31);
  }
}

/**
 * Печатает статус лимитов в красивом текстовом формате.
 */
export function printLimitsText(data: LimitsStatusResponse) {
  console.log(`Provider: ${data.provider}`);
  console.log(`Status: ${data.status}\n`);

  for (const limit of data.limits) {
    console.log(limit.providerName);
    if (limit.fiveHourWindow) {
      const used = Math.round(limit.fiveHourWindow.usedPercent ?? 0);
      let resetInfo = "";
      if (limit.fiveHourWindow.resetInSeconds !== undefined) {
        resetInfo = `, resets in ${formatDuration(limit.fiveHourWindow.resetInSeconds)}`;
      } else if (limit.fiveHourWindow.resetAt) {
        const diff = new Date(limit.fiveHourWindow.resetAt).getTime() - new Date(data.checkedAt).getTime();
        if (diff > 0) {
          resetInfo = `, resets in ${formatDuration(diff / 1000)}`;
        }
      }
      console.log(`  5h window: ${used}% used${resetInfo}`);
    }
    if (limit.weeklyWindow) {
      const used = Math.round(limit.weeklyWindow.usedPercent ?? 0);
      let resetInfo = "";
      const day = formatWeeklyReset(limit.weeklyWindow.resetAt, limit.weeklyWindow.resetInSeconds);
      if (day !== "unknown") {
        resetInfo = `, resets ${day}`;
      }
      console.log(`  Weekly: ${used}% used${resetInfo}`);
    }
    if (limit.credits) {
      console.log(`  Credits: ${limit.credits.amount} ${limit.credits.currency || ""}`);
    }
  }
}

/**
 * Тестирует интеграцию с провайдером лимитов.
 */
export function testLimitsProvider(providerName: string, config: ConfigManager) {
  if (providerName !== "codexbar" && providerName !== "custom") {
    console.error(`Unknown provider: ${providerName}`);
    process.exit(3);
  }

  if (providerName === "codexbar") {
    const cliPath = config.settings.limits_providers?.codexbar?.cli_path;
    const statusCommand = config.settings.limits_providers?.codexbar?.status_command;
    const path = findCodexBarPath(cliPath);
    if (!path) {
      console.error("limits provider unavailable: codexbar executable not found.");
      process.exit(31);
    }

    console.log(`CodexBar CLI found: ${path}`);
    console.log(`Command: "${path}" ${statusCommand || "status --json"}`);
    
    // Пытаемся выполнить и распарсить
    const data = fetchCodexBarLimits(cliPath, statusCommand);
    console.log("Result: success");
    console.log(`Parsed providers: ${data.limits.map(l => l.providerId).join(", ")}`);
  } else {
    const custom = config.settings.limits_providers?.custom;
    if (!custom || !custom.enabled || !custom.command) {
      console.error("Custom provider is disabled or missing status command.");
      process.exit(31);
    }
    console.log(`Custom provider command: ${custom.command}`);
    const data = fetchCustomLimits(config.settings);
    console.log("Result: success");
    console.log(`Parsed providers: ${data.limits.map(l => l.providerId).join(", ")}`);
  }
}
