import { parse, stringify } from "yaml";
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface AgentConfig {
  id: string;
  name: string;
  command: string;
  args?: string[];
  stdin?: string;
  working_directory?: string;
  enabled: boolean;
  schedule: string[];
  execution_mode?: "pipe" | "interactiveTTY";
  timeout_seconds?: number;
  retry?: {
    enabled?: boolean;
    max_attempts: number;
    retry_delay_seconds: number;
    backoff_multiplier?: number;
  };
  environment?: Record<string, string>;
  limits?: Record<string, any>;
  providerRef?: string;
}

export interface SettingsConfig {
  network_guard?: {
    enabled: boolean;
    blocked_public_ips: string[];
    ip_check_timeout_seconds: number;
    cache_ttl_seconds: number;
    behavior_on_check_failure: "block" | "allow";
    ip_check_urls: string[];
  };
  limits_providers?: {
    codexbar?: {
      enabled: boolean;
      cli_path: string;
      status_command: string;
    };
    custom?: {
      enabled: boolean;
      command: string;
      mapping: {
        provider_id_path?: string;
        provider_name_path?: string;
        used_path?: string;
        total_path?: string;
        resets_at_path?: string;
      };
    };
  };
  limits_guard?: {
    enabled: boolean;
    provider: string;
    behavior_on_unknown: "allow" | "block";
    rules?: Array<{
      provider_agent: string;
      local_agent: string;
      skip_if_five_hour_exhausted: boolean;
      skip_if_weekly_exhausted: boolean;
      skip_if_reset_within_minutes: number;
    }>;
  };
}

export class ConfigManager {
  public readonly configDir: string;
  public settings: SettingsConfig = {};
  public agents: AgentConfig[] = [];

  constructor(customConfigDir?: string) {
    this.configDir = customConfigDir || join(homedir(), "Library/Application Support/Takt");
    this.loadSettings();
    this.loadAgents();
  }

  /** Записывает текущие настройки в settings.yaml. */
  saveSettings() {
    if (!existsSync(this.configDir)) {
      mkdirSync(this.configDir, { recursive: true });
    }
    const settingsPath = join(this.configDir, "settings.yaml");
    writeFileSync(settingsPath, stringify(this.settings), "utf-8");
  }

  private loadSettings() {
    const settingsPath = join(this.configDir, "settings.yaml");
    if (existsSync(settingsPath)) {
      try {
        const content = readFileSync(settingsPath, "utf-8");
        this.settings = parse(content) || {};
      } catch (err) {
        console.error(`Failed to load settings.yaml: ${err}`);
      }
    }
  }

  private loadAgents() {
    const agentsDir = join(this.configDir, "agents");
    if (!existsSync(agentsDir)) return;

    try {
      const files = readdirSync(agentsDir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
      for (const file of files) {
        const content = readFileSync(join(agentsDir, file), "utf-8");
        const parsed = parse(content);
        if (parsed && parsed.id) {
          this.agents.push(parsed as AgentConfig);
        }
      }
    } catch (err) {
      console.error(`Failed to load agents: ${err}`);
    }
  }
}
