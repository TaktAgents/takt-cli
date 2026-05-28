import { spawn } from "bun";
import { AgentConfig } from "./config";
import { NetworkGuard } from "./networkGuard";

export class Runner {
  constructor(private networkGuard: NetworkGuard) {}

  async runAgent(agent: AgentConfig) {
    if (!agent.enabled) {
      console.log(`Agent ${agent.name} is disabled. Skipping.`);
      return;
    }

    const guardResult = await this.networkGuard.check();
    if (!guardResult.allowed) {
      console.error(`[NetworkGuard] Blocked execution of ${agent.name}: ${guardResult.reason}`);
      process.exit(20);
    }

    console.log(`Starting agent: ${agent.name} (${agent.id})`);
    const env = { ...process.env, ...agent.environment };
    
    // Parse the command (simplified split)
    // Wait, since we are in Bun, we can just use an array. If it's a string, we split by space.
    const cmdArgs = agent.command.match(/(?:[^\s"']+|['"][^'"]*["'])+/g)?.map(arg => {
        if (arg.startsWith('"') && arg.endsWith('"')) return arg.slice(1, -1);
        if (arg.startsWith("'") && arg.endsWith("'")) return arg.slice(1, -1);
        return arg;
    }) || [];

    if (cmdArgs.length === 0) {
      console.error("Invalid command");
      process.exit(1);
    }

    const proc = spawn(cmdArgs, {
      cwd: agent.working_directory || process.cwd(),
      env: env,
      stdout: "inherit",
      stderr: "inherit",
    });

    const exitCode = await proc.exited;
    console.log(`Agent ${agent.name} finished with exit code ${exitCode}`);
    
    if (exitCode !== 0) {
      process.exit(10);
    }
  }
}
