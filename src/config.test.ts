import { test, expect } from "bun:test";
import { ConfigManager } from "./config";
import { join } from "path";
import { writeFileSync, mkdirSync, rmSync } from "fs";

test("ConfigManager loads settings and agents from custom directory", () => {
  const tempDir = join(__dirname, `../temp-takt-test-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  mkdirSync(join(tempDir, "agents"), { recursive: true });

  try {
    // 1. Write settings.yaml
    const settingsYaml = `
general:
  launch_at_login: false
network_guard:
  enabled: true
  blocked_public_ips: ["1.2.3.4"]
`;
    writeFileSync(join(tempDir, "settings.yaml"), settingsYaml, "utf-8");

    // 2. Write an agent.yaml
    const agentYaml = `
id: test-agent
name: Test Agent
command: echo "hello"
enabled: true
schedule:
  - "*/5 * * * *"
`;
    writeFileSync(join(tempDir, "agents/agent-1.yaml"), agentYaml, "utf-8");

    // 3. Initialize ConfigManager
    const config = new ConfigManager(tempDir);

    // 4. Verify settings
    expect((config.settings as any).general?.launch_at_login).toBe(false);
    expect(config.settings.network_guard?.enabled).toBe(true);
    expect(config.settings.network_guard?.blocked_public_ips).toContain("1.2.3.4");

    // 5. Verify agents
    expect(config.agents.length).toBe(1);
    const agent = config.agents[0];
    expect(agent.id).toBe("test-agent");
    expect(agent.name).toBe("Test Agent");
    expect(agent.command).toBe('echo "hello"');
    expect(agent.schedule).toContain("*/5 * * * *");

    // 6. Test saveSettings
    config.settings.network_guard!.blocked_public_ips = ["1.2.3.4", "5.6.7.8"];
    config.saveSettings();

    const config2 = new ConfigManager(tempDir);
    expect(config2.settings.network_guard?.blocked_public_ips).toContain("5.6.7.8");
  } finally {
    // Cleanup
    rmSync(tempDir, { recursive: true, force: true });
  }
});
