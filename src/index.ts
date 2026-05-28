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

  if (existsSync(socketPath)) {
    // Connected mode
    try {
      const socketCommand = command === "agents" ? "status" : command;
      const response = await sendToSocket(socketPath, { command: socketCommand, agentId });
      
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
      console.error(`Failed to communicate with Takt app: ${err}`);
      process.exit(1);
    }
  } else {
    // Standalone Mode (Headless Engine)
    // Not implemented yet
    console.error("Takt app is not running (Standalone mode is not fully implemented yet)");
    process.exit(2);
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
