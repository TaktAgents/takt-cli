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
    const cmdArgs = agent.command.match(/(?:[^\s"']+|['"][^'"]*["'])+/g)?.map(arg => {
        if (arg.startsWith('"') && arg.endsWith('"')) return arg.slice(1, -1);
        if (arg.startsWith("'") && arg.endsWith("'")) return arg.slice(1, -1);
        return arg;
    }) || [];

    if (cmdArgs.length === 0) {
      console.error("Invalid command");
      process.exit(1);
    }

    let fullArgs = [...cmdArgs];
    if (agent.args && agent.args.length > 0) {
      fullArgs = fullArgs.concat(agent.args);
    }

    const maxAttempts = agent.retry?.enabled !== false && agent.retry ? agent.retry.max_attempts : 1;
    const delayMs = (agent.retry?.retry_delay_seconds || 5) * 1000;
    
    let lastError: any = null;
    let exitCode = 0;
    
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) {
        console.log(`[Retry] Attempt ${attempt} of ${maxAttempts} for ${agent.name} in ${delayMs / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      }
      
      try {
        exitCode = await this.spawnProcess(agent, fullArgs, env);
        if (exitCode === 0) {
          lastError = null;
          break;
        }
        lastError = new Error(`Process exited with non-zero code: ${exitCode}`);
      } catch (err) {
        lastError = err;
      }
    }
    
    if (lastError) {
      console.error(`Agent ${agent.name} failed with error/exitCode: ${lastError.message || lastError}`);
      process.exit(10);
    }

    console.log(`Agent ${agent.name} finished successfully.`);
  }

  private async spawnProcess(agent: AgentConfig, args: string[], env: any): Promise<number> {
    const stdinOption = agent.stdin !== undefined ? "pipe" : "inherit";

    const proc = spawn(args, {
      cwd: agent.working_directory || process.cwd(),
      env: env,
      stdin: stdinOption,
      stdout: "inherit",
      stderr: "inherit",
    });

    if (agent.stdin !== undefined && proc.stdin) {
      proc.stdin.write(agent.stdin + "\n");
      proc.stdin.end();
    }

    let timeoutId: any;
    const timeoutPromise = new Promise<number>((_, reject) => {
      if (agent.timeout_seconds && agent.timeout_seconds > 0) {
        timeoutId = setTimeout(() => {
          reject(new Error("Timeout"));
        }, agent.timeout_seconds * 1000);
      }
    });

    try {
      const exitCode = await Promise.race([
        proc.exited,
        timeoutPromise
      ]);
      if (timeoutId) clearTimeout(timeoutId);
      return exitCode;
    } catch (err: any) {
      if (timeoutId) clearTimeout(timeoutId);
      if (err.message === "Timeout") {
        console.error(`[Timeout] Agent ${agent.name} timed out after ${agent.timeout_seconds} seconds. Terminating.`);
        proc.kill(); // Terminate the process
      }
      throw err;
    }
  }
}
