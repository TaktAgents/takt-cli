#!/usr/bin/env bun
import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { connect } from "bun";
import { parseDuration } from "./duration";
import { ExitCode } from "./exitCodes";

const program = new Command();

program
  .name("takt")
  .description("Takt Agents CLI")
  .version("1.0.0")
  .option("--json", "Output response in JSON format");

async function main() {
  program
    .command("status")
    .description("Show Takt app and agents status")
    .action(async () => {
      await executeCommand("status");
    });

  program
    .command("agents")
    .description("List all configured agents")
    .action(async () => {
      await executeCommand("agents");
    });

  program
    .command("run <agentId>")
    .description("Run a specific agent")
    .action(async (agentId) => {
      await executeCommand("run", { agentId });
    });

  program
    .command("run-all")
    .description("Run all enabled agents")
    .action(async () => {
      await executeCommand("run-all");
    });

  const limitsCmd = program.command("limits").description("Show Limits Guard status");

  limitsCmd
    .command("refresh")
    .description("Force Takt to refresh limits status immediately")
    .action(async () => {
      await executeCommand("limits-refresh");
    });

  const providerCmd = limitsCmd.command("provider").description("Limits provider controls");
  providerCmd
    .command("test <provider-name>")
    .description("Verify the integration of a specific limits provider")
    .action(async (providerName: string) => {
      await executeCommand("limits-provider-test", { providerName });
    });

  limitsCmd.action(async () => {
    await executeCommand("limits");
  });

  program
    .command("next")
    .description("Show upcoming scheduled agent runs")
    .action(async () => {
      await executeCommand("next");
    });

  program
    .command("pause [duration]")
    .description("Pause the scheduler (optionally for a duration, e.g. 15m, 1h, 2h, 1d)")
    .action(async (duration?: string) => {
      let durationSeconds: number | undefined;
      if (duration) {
        durationSeconds = parseDuration(duration);
        if (durationSeconds === undefined) {
          console.error(`Invalid duration: ${duration} (use 15m, 1h, 2h, 1d)`);
          process.exit(3);
        }
      }
      await executeCommand("pause", { durationSeconds });
    });

  program
    .command("resume")
    .description("Resume the scheduler")
    .action(async () => {
      await executeCommand("resume");
    });

  program
    .command("logs")
    .description("Show structured Takt logs")
    .option("--agent <name>", "Filter by agent name")
    .option("--tail <count>", "Number of recent entries", "20")
    .option("--level <level>", "Filter by level (info|warning|error)")
    .action((opts) => showLogs(opts));

  const configCmd = program.command("config").description("Configuration controls");
  configCmd.command("open").description("Open the config folder in Finder").action(() => configOpen());
  configCmd.command("validate").description("Validate settings.yaml and agents/*.yaml").action(() => configValidate());

  const guard = program.command("guard").description("Network Guard controls");
  guard.command("status").description("Show Network Guard status").action(() => guardStatus());
  guard.command("check").description("Force a fresh public IP check").action(() => guardStatus());
  guard.command("add-ip <ip>").description("Add an IP to the blocked list").action((ip: string) => guardModifyIP(ip, true));
  guard.command("remove-ip <ip>").description("Remove an IP from the blocked list").action((ip: string) => guardModifyIP(ip, false));

  await program.parseAsync(Bun.argv);
}

/** logs — чтение JSONL-логов напрямую из файлов (standalone). */
async function showLogs(opts: { agent?: string; tail?: string; level?: string }) {
  const { parseLogLines, filterLogs } = await import("./logs");
  const { readFileSync, existsSync } = await import("fs");
  const logsDir = join(homedir(), "Library/Application Support/Takt/logs");

  // Читаем ротированные файлы от старых к новым, затем текущий.
  let text = "";
  for (let i = 5; i >= 1; i--) {
    const f = join(logsDir, `takt.${i}.log`);
    if (existsSync(f)) text += readFileSync(f, "utf-8");
  }
  const current = join(logsDir, "takt.log");
  if (existsSync(current)) text += readFileSync(current, "utf-8");

  const tail = Math.max(1, parseInt(opts.tail ?? "20", 10) || 20);
  let entries = filterLogs(parseLogLines(text), { agent: opts.agent, level: opts.level });
  entries = entries.slice(-tail);

  if (program.opts().json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }
  if (entries.length === 0) {
    console.log("No logs yet.");
    return;
  }
  for (const e of entries) {
    const t = new Date(e.timestamp).toLocaleString();
    const extra = e.details && Object.keys(e.details).length
      ? " · " + Object.entries(e.details).map(([k, v]) => `${k}=${v}`).join(" ")
      : "";
    console.log(`[${t}] ${e.level.toUpperCase()} ${e.agentName} · ${e.event}${extra}`);
  }
}

/** config open — открыть каталог конфигурации в Finder. */
async function configOpen() {
  const { ConfigManager } = await import("./config");
  const dir = new ConfigManager().configDir;
  Bun.spawn(["open", dir]);
  console.log(`Opened ${dir}`);
}

/** config validate — офлайн-валидация settings + агентов (включая cron). exit 4 при ошибках. */
async function configValidate() {
  const options = program.opts();
  const { ConfigManager } = await import("./config");
  const { isValidCron } = await import("./cron");
  const config = new ConfigManager();
  const errors: string[] = [];

  for (const agent of config.agents) {
    const label = agent.name || agent.id || "<unnamed>";
    if (!agent.id) errors.push(`Agent "${label}": missing id`);
    if (!agent.name) errors.push(`Agent "${label}": missing name`);
    if (!agent.command) errors.push(`Agent "${label}": missing command`);
    for (const cron of agent.schedule ?? []) {
      if (!isValidCron(cron)) errors.push(`Agent "${label}": invalid cron "${cron}"`);
    }
  }

  if (options.json) {
    console.log(JSON.stringify({ valid: errors.length === 0, agents: config.agents.length, errors }, null, 2));
  } else if (errors.length === 0) {
    console.log("Configuration is valid.");
    console.log(`Loaded ${config.agents.length} agents.`);
  } else {
    console.error("Configuration has errors:");
    for (const e of errors) console.error(`  - ${e}`);
  }
  if (errors.length > 0) process.exit(4);
}

/** guard status / check — свежая проверка публичного IP и решение (работает офлайн). */
async function guardStatus() {
  const options = program.opts();
  const { ConfigManager } = await import("./config");
  const { NetworkGuard } = await import("./networkGuard");
  const config = new ConfigManager();
  const ngCfg = config.settings.network_guard;
  // Принудительно включаем, чтобы всегда получить IP и оценить блок-лист.
  const forced = { ...(ngCfg ?? { blocked_public_ips: [] as string[] }), enabled: true } as any;
  const result = await new NetworkGuard(forced).check();
  const blockedCount = ngCfg?.blocked_public_ips?.length ?? 0;
  const decision = result.allowed ? "allowed" : "blocked";

  if (options.json) {
    console.log(JSON.stringify({
      enabled: ngCfg?.enabled ?? false,
      currentPublicIP: result.currentIp ?? null,
      blockedIPs: blockedCount,
      decision,
      reason: result.reason,
    }, null, 2));
  } else {
    console.log(`Network Guard: ${ngCfg?.enabled ? "enabled" : "disabled"}`);
    console.log(`Current public IP: ${result.currentIp ?? "unknown"}`);
    console.log(`Blocked IPs: ${blockedCount}`);
    console.log(`Decision: ${decision}`);
    if (!result.allowed && result.reason) console.log(`Reason: ${result.reason}`);
  }
  if (!result.currentIp) process.exit(21); // Network Guard error: IP undetermined
}

/** guard add-ip / remove-ip — правка блок-листа в settings.yaml. */
async function guardModifyIP(ip: string, add: boolean) {
  const { isValidIP } = await import("./ip");
  if (!isValidIP(ip)) {
    console.error(`Invalid IP address: ${ip}`);
    process.exit(3);
  }
  const { ConfigManager } = await import("./config");
  const config = new ConfigManager();
  if (!config.settings.network_guard) {
    config.settings.network_guard = {
      enabled: true, blocked_public_ips: [], ip_check_timeout_seconds: 5,
      cache_ttl_seconds: 60, behavior_on_check_failure: "block", ip_check_urls: [],
    };
  }
  const ng = config.settings.network_guard;
  const list = ng.blocked_public_ips ?? [];
  if (add) {
    if (!list.includes(ip)) list.push(ip);
    ng.blocked_public_ips = list;
  } else {
    ng.blocked_public_ips = list.filter((x) => x !== ip);
  }
  config.saveSettings();
  const verb = add ? "Added" : "Removed";
  const prep = add ? "to" : "from";
  if (program.opts().json) {
    console.log(JSON.stringify({ status: "ok", blockedIPs: ng.blocked_public_ips }, null, 2));
  } else {
    console.log(`${verb} ${ip} ${prep} blocked list (${ng.blocked_public_ips.length} total)`);
  }
}

// Команды, которым нужен запущенный демон (Takt.app). Без него — exit 2.
const DAEMON_ONLY = new Set(["pause", "resume", "next"]);

async function executeCommand(command: string, extra: { agentId?: string; durationSeconds?: number; providerName?: string } = {}) {
  const options = program.opts();
  const { agentId, durationSeconds, providerName } = extra;
  const socketDir = process.env.TAKT_SOCKET_DIR || join(homedir(), "Library/Application Support/Takt");
  const socketPath = join(socketDir, "takt.sock");
  let connected = false;

  const { ConfigManager } = await import("./config");
  const config = new ConfigManager();

  if (existsSync(socketPath)) {
    try {
      const socketCommand = command === "agents" ? "status" : command;
      const response = await sendToSocket(socketPath, { command: socketCommand, agentId, durationSeconds, providerName });
      connected = true;

      if (response.status === "ok") {
        if (command === "limits" || command === "limits-refresh") {
          const { printLimitsText } = await import("./limits");
          const activeProvider = config.settings.limits_guard?.provider || "codexbar";
          const statusObj = response.data?.providerStatuses?.[activeProvider];
          
          if (!statusObj) {
            if (options.json) {
              console.log(JSON.stringify({ provider: activeProvider, status: "unavailable", limits: [] }, null, 2));
            } else {
              console.log(`Provider: ${activeProvider}\nStatus: unavailable\nNo data. Please configure and run limits refresh.`);
            }
            return;
          }
          
          const fiveHour = statusObj.fiveHourWindow || statusObj.five_hour_window;
          const weekly = statusObj.weeklyWindow || statusObj.weekly_window;
          const credits = statusObj.credits;
          
          const usedPercent5 = fiveHour?.usedPercent ?? fiveHour?.used_percent;
          const status5 = fiveHour?.status ?? "unknown";
          const usedPercentW = weekly?.usedPercent ?? weekly?.used_percent;
          const statusW = weekly?.status ?? "unknown";
          
          let status: "available" | "exhausted" | "unavailable" = "available";
          if (status5 === "exhausted" || statusW === "exhausted") {
            status = "exhausted";
          }
          
          const limitsData = {
            provider: statusObj.providerName || statusObj.provider_name || activeProvider,
            status,
            checkedAt: statusObj.checkedAt || statusObj.checked_at || new Date().toISOString(),
            limits: [
              {
                providerId: statusObj.providerID || statusObj.provider_id || activeProvider,
                providerName: statusObj.providerName || statusObj.provider_name || activeProvider,
                fiveHourWindow: fiveHour ? {
                  usedPercent: usedPercent5,
                  remainingPercent: fiveHour.remainingPercent ?? fiveHour.remaining_percent,
                  resetAt: fiveHour.resetAt ?? fiveHour.reset_at,
                  resetInSeconds: fiveHour.resetInSeconds ?? fiveHour.reset_in_seconds,
                  status: status5
                } : undefined,
                weeklyWindow: weekly ? {
                  usedPercent: usedPercentW,
                  remainingPercent: weekly.remainingPercent ?? weekly.remaining_percent,
                  resetAt: weekly.resetAt ?? weekly.reset_at,
                  resetInSeconds: weekly.resetInSeconds ?? weekly.reset_in_seconds,
                  status: statusW
                } : undefined,
                credits: credits ? {
                  amount: credits.amount,
                  currency: credits.currency
                } : undefined
              }
            ]
          };
          
          if (options.json) {
            console.log(JSON.stringify(limitsData, null, 2));
          } else {
            if (command === "limits-refresh") {
              console.log("Forcing limits refresh...");
            }
            printLimitsText(limitsData);
          }
          return;
        }

        if (command === "status") {
          const data = response.data;
          if (options.json) {
            const jsonOutput = {
              app: "Takt",
              running: true,
              scheduler: data.schedulerStatus || "active",
              networkGuard: {
                enabled: data.networkGuardEnabled ?? true,
                lastDecision: "allowed", // connected mode means allowed
                currentPublicIP: data.currentPublicIP || null
              },
              agents: (data.agents || []).map((a: any) => ({
                name: a.name,
                enabled: a.enabled,
                state: a.status,
                nextRun: a.nextRun || null,
                lastSuccess: a.lastSuccess || null
              }))
            };
            console.log(JSON.stringify(jsonOutput, null, 2));
          } else {
            console.log("Takt is running\n");
            console.log(`Scheduler: ${data.schedulerStatus || "active"}`);
            console.log(`Network Guard: ${data.networkGuardEnabled ? "enabled" : "disabled"}`);
            console.log(`Current public IP: ${data.currentPublicIP || "unknown"}`);
            
            const enabledCount = (data.agents || []).filter((a: any) => a.enabled).length;
            const runningCount = (data.agents || []).filter((a: any) => a.status === "running").length;
            console.log(`Agents: ${enabledCount} enabled, ${runningCount} running`);
            
            // Find next run
            let nextRunText = "-";
            const sortedAgents = [...(data.agents || [])]
              .filter((a: any) => a.enabled && a.nextRun)
              .sort((a, b) => new Date(a.nextRun).getTime() - new Date(b.nextRun).getTime());
            if (sortedAgents.length > 0) {
              const earliest = sortedAgents[0];
              const date = new Date(earliest.nextRun);
              const hh = String(date.getHours()).padStart(2, "0");
              const mm = String(date.getMinutes()).padStart(2, "0");
              nextRunText = `${earliest.name} at ${hh}:${mm}`;
            }
            console.log(`Next run: ${nextRunText}`);
          }
          return;
        }

        if (command === "agents") {
          const data = response.data;
          const agents = data.agents || [];
          if (options.json) {
            const jsonOutput = agents.map((a: any) => ({
              name: a.name,
              enabled: a.enabled,
              state: a.status,
              nextRun: a.nextRun || null,
              lastSuccess: a.lastSuccess || null
            }));
            console.log(JSON.stringify(jsonOutput, null, 2));
          } else {
            if (agents.length === 0) {
              console.log("No agents configured.");
            } else {
              const { formatWeeklyReset } = await import("./limits");
              const formatTimeOrDay = (isoString?: string) => {
                if (!isoString) return "-";
                const date = new Date(isoString);
                if (isNaN(date.getTime())) return "-";
                const now = new Date();
                if (date.toDateString() === now.toDateString()) {
                  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
                }
                const yesterday = new Date();
                yesterday.setDate(now.getDate() - 1);
                if (date.toDateString() === yesterday.toDateString()) {
                  return `yesterday ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
                }
                return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
              };

              for (const a of agents) {
                const nameCol = a.name.padEnd(20);
                const stateCol = (a.enabled ? "enabled" : "disabled").padEnd(10);
                const nextCol = `next: ${formatTimeOrDay(a.nextRun)}`.padEnd(18);
                const lastCol = `last success: ${formatTimeOrDay(a.lastSuccess)}`;
                console.log(`${nameCol}${stateCol}${nextCol}${lastCol}`);
              }
            }
          }
          return;
        }

        if (options.json) {
          console.log(JSON.stringify(response, null, 2));
        } else {
          if (command === "next") {
            const runs = response.data?.runs || [];
            if (runs.length === 0) {
              console.log("No upcoming runs.");
            } else {
              for (const r of runs) {
                const t = new Date(r.fireDate).toLocaleString();
                console.log(`${t}  ${r.name}`);
              }
            }
          } else if (command === "pause") {
            console.log(durationSeconds ? `Scheduler paused for ${durationSeconds}s` : "Scheduler paused");
          } else if (command === "resume") {
            console.log("Scheduler resumed");
          } else {
            console.log("Success");
          }
        }
      } else {
        console.error(`Error: ${response.error}`);
        process.exit(ExitCode.GENERIC_ERROR);
      }
    } catch (err) {
      // Failed to connect, fallback
    }
  }

  if (!connected) {
    if (command === "limits-provider-test") {
      const { testLimitsProvider } = await import("./limits");
      if (!providerName) {
        console.error("Missing provider name");
        process.exit(ExitCode.INVALID_COMMAND);
      }
      testLimitsProvider(providerName, config);
      return;
    }

    // Команды, требующие демона, в standalone недоступны → exit 2.
    if (DAEMON_ONLY.has(command)) {
      console.error("Takt app is not running (required for this command).");
      process.exit(ExitCode.APP_NOT_RUNNING);
    }
    
    // Standalone Mode (Headless Engine)
    if (!options.json && command !== "limits" && command !== "limits-refresh") {
      console.log("Running in Standalone mode (Takt App is not running).");
    }
    
    const { NetworkGuard } = await import("./networkGuard");
    const { Runner } = await import("./runner");
    
    const networkGuard = new NetworkGuard(config.settings.network_guard);
    const runner = new Runner(networkGuard);

    if (command === "status") {
      if (options.json) {
        const jsonOutput = {
          app: "Takt",
          running: false,
          scheduler: "inactive",
          networkGuard: {
            enabled: config.settings.network_guard?.enabled ?? false,
            lastDecision: "unknown",
            currentPublicIP: null
          },
          agents: config.agents.map(a => ({
            name: a.name,
            enabled: a.enabled,
            state: "idle",
            nextRun: null,
            lastSuccess: null
          }))
        };
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        console.log("Takt Standalone Status: running\n");
        console.log("Scheduler: inactive (Takt App is not running)");
        console.log(`Network Guard: ${config.settings.network_guard?.enabled ? "enabled" : "disabled"}`);
        console.log("Current public IP: unknown");
        
        const enabledCount = config.agents.filter(a => a.enabled).length;
        console.log(`Agents: ${enabledCount} enabled, 0 running`);
        console.log("Next run: -");
      }
    } else if (command === "agents") {
      if (options.json) {
        const jsonOutput = config.agents.map(a => ({
          name: a.name,
          enabled: a.enabled,
          state: "idle",
          nextRun: null,
          lastSuccess: null
        }));
        console.log(JSON.stringify(jsonOutput, null, 2));
      } else {
        if (config.agents.length === 0) {
          console.log("No agents configured.");
        } else {
          for (const a of config.agents) {
            const nameCol = a.name.padEnd(20);
            const stateCol = (a.enabled ? "enabled" : "disabled").padEnd(10);
            const nextCol = "next: -".padEnd(18);
            const lastCol = "last success: -";
            console.log(`${nameCol}${stateCol}${nextCol}${lastCol}`);
          }
        }
      }
    } else if (command === "run") {
      if (!agentId) {
        console.error("Missing agent ID");
        process.exit(ExitCode.INVALID_COMMAND);
      }
      const agent = config.agents.find(a => a.id === agentId);
      if (!agent) {
        console.error("Agent not found");
        process.exit(ExitCode.AGENT_NOT_FOUND);
      }
      await runner.runAgent(agent);
    } else if (command === "run-all") {
      for (const agent of config.agents) {
        if (agent.enabled) {
          await runner.runAgent(agent);
        }
      }
    } else if (command === "limits" || command === "limits-refresh") {
      const { fetchLimitsStandalone, printLimitsText } = await import("./limits");
      const limitsData = fetchLimitsStandalone(config);
      if (options.json) {
        console.log(JSON.stringify(limitsData, null, 2));
      } else {
        if (command === "limits-refresh") {
          console.log("Forcing limits refresh...");
        }
        printLimitsText(limitsData);
      }
    }
  }
}

async function sendToSocket(socketPath: string, payload: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let rawResponse = "";
    connect({
      unix: socketPath,
      socket: {
        data(socket, data) {
          rawResponse += data.toString();
        },
        open(socket) {
          socket.write(JSON.stringify(payload));
        },
        close(socket) {
          try {
            resolve(JSON.parse(rawResponse.trim()));
          } catch (e) {
            reject(new Error(`Failed to parse response: ${rawResponse}`));
          }
        },
        error(socket, error) {
          reject(error);
        },
      },
    }).catch(reject);
  });
}

async function run() {
  program.exitOverride();
  try {
    await main();
  } catch (err: any) {
    if (
      err.code === "commander.unknownCommand" ||
      err.code === "commander.unknownOption" ||
      err.code === "commander.missingArgument" ||
      err.code === "commander.missingMandatoryOptionValue"
    ) {
      process.exit(ExitCode.INVALID_COMMAND);
    }
    process.exit(ExitCode.INVALID_COMMAND);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(ExitCode.GENERIC_ERROR);
});
