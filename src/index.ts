#!/usr/bin/env bun
import { Command } from "commander";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { connect } from "bun";
import { parseDuration } from "./duration";

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

  program
    .command("limits")
    .description("Show Limits Guard status")
    .action(async () => {
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

  const guard = program.command("guard").description("Network Guard controls");
  guard.command("status").description("Show Network Guard status").action(() => guardStatus());
  guard.command("check").description("Force a fresh public IP check").action(() => guardStatus());
  guard.command("add-ip <ip>").description("Add an IP to the blocked list").action((ip: string) => guardModifyIP(ip, true));
  guard.command("remove-ip <ip>").description("Remove an IP from the blocked list").action((ip: string) => guardModifyIP(ip, false));

  await program.parseAsync(Bun.argv);
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

async function executeCommand(command: string, extra: { agentId?: string; durationSeconds?: number } = {}) {
  const options = program.opts();
  const { agentId, durationSeconds } = extra;
  const socketPath = join(homedir(), "Library/Application Support/Takt/takt.sock");
  let connected = false;

  if (existsSync(socketPath)) {
    try {
      const socketCommand = command === "agents" ? "status" : command;
      const response = await sendToSocket(socketPath, { command: socketCommand, agentId, durationSeconds });
      connected = true;

      if (options.json) {
        console.log(JSON.stringify(response, null, 2));
      } else {
        if (response.status === "ok") {
          if (command === "status") {
            console.log(`Takt App Status: ${response.data?.appStatus}`);
          } else if (command === "agents") {
            console.log("Agents:");
            for (const agent of response.data?.agents || []) {
              console.log(`- [${agent.status}] ${agent.name} (${agent.id})`);
            }
          } else if (command === "next") {
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
          } else if (command === "limits") {
             console.log("Limits status is not fully implemented in Takt Core yet.");
          } else {
            console.log("Success");
          }
        } else {
          console.error(`Error: ${response.error}`);
          process.exit(1);
        }
      }
    } catch (err) {
      // Failed to connect, fallback
    }
  }

  if (!connected) {
    // Команды, требующие демона, в standalone недоступны → exit 2.
    if (DAEMON_ONLY.has(command)) {
      console.error("Takt app is not running (required for this command).");
      process.exit(2);
    }
    // Standalone Mode (Headless Engine)
    if (!options.json) {
      console.log("Running in Standalone mode (Takt App is not running).");
    }
    
    const { ConfigManager } = await import("./config");
    const { NetworkGuard } = await import("./networkGuard");
    const { Runner } = await import("./runner");
    
    const config = new ConfigManager();
    const networkGuard = new NetworkGuard(config.settings.network_guard);
    const runner = new Runner(networkGuard);

    if (command === "status") {
      if (options.json) {
        console.log(JSON.stringify({ status: "ok", data: { appStatus: "running (standalone)", agents: config.agents } }, null, 2));
      } else {
        console.log("Takt CLI Standalone Status: running");
        console.log(`Loaded ${config.agents.length} agents`);
      }
    } else if (command === "agents") {
      if (options.json) {
        console.log(JSON.stringify({ status: "ok", data: { agents: config.agents } }, null, 2));
      } else {
        console.log("Agents:");
        for (const agent of config.agents) {
          console.log(`- [${agent.enabled ? "enabled" : "disabled"}] ${agent.name} (${agent.id})`);
        }
      }
    } else if (command === "run") {
      if (!agentId) {
        console.error("Missing agent ID");
        process.exit(1);
      }
      const agent = config.agents.find(a => a.id === agentId);
      if (!agent) {
        console.error("Agent not found");
        process.exit(1);
      }
      await runner.runAgent(agent);
    } else if (command === "run-all") {
      for (const agent of config.agents) {
        if (agent.enabled) {
          await runner.runAgent(agent);
        }
      }
    } else if (command === "limits") {
      console.log("Limits Standalone Check: Not Implemented");
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

main().catch(console.error);
