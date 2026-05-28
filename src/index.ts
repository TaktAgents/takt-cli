import { parseArgs } from "util";
import { join } from "path";
import { homedir } from "os";
import { existsSync } from "fs";
import { connect } from "bun";

async function main() {
  const { positionals, values } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      json: {
        type: "boolean",
      },
    },
    strict: false,
    allowPositionals: true,
  });

  const command = positionals[0] || "status";
  const agentId = positionals[1];

  // Try to find the UNIX socket
  const socketPath = join(homedir(), "Library/Application Support/Takt/takt.sock");
  let connected = false;

  if (existsSync(socketPath)) {
    try {
      const socketCommand = command === "agents" ? "status" : command;
      const response = await sendToSocket(socketPath, { command: socketCommand, agentId });
      connected = true;
      
      if (values.json) {
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
          } else {
            console.log("Success");
          }
        } else {
          console.error(`Error: ${response.error}`);
          process.exit(1);
        }
      }
    } catch (err) {
      // Failed to connect, socket might be stale. Fall through to Standalone mode.
    }
  }

  if (!connected) {
    // Standalone Mode (Headless Engine)
    console.log("Running in Standalone mode (Takt App is not running).");
    
    // Lazy imports so we don't load everything if connected
    const { ConfigManager } = await import("./config");
    const { NetworkGuard } = await import("./networkGuard");
    const { Runner } = await import("./runner");
    
    const config = new ConfigManager();
    const networkGuard = new NetworkGuard(config.settings.network_guard);
    const runner = new Runner(networkGuard);

    if (command === "status") {
      console.log("Takt CLI Standalone Status: running");
      console.log(`Loaded ${config.agents.length} agents`);
    } else if (command === "agents") {
      console.log("Agents:");
      for (const agent of config.agents) {
        console.log(`- [${agent.enabled ? "enabled" : "disabled"}] ${agent.name} (${agent.id})`);
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
    } else {
      console.error(`Unknown command: ${command}`);
      process.exit(1);
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
