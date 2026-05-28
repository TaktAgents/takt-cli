import { SettingsConfig } from "./config";

export class NetworkGuard {
  private settings: SettingsConfig["network_guard"];

  constructor(settings?: SettingsConfig["network_guard"]) {
    this.settings = settings;
  }

  async check(): Promise<{ allowed: boolean; reason?: string; currentIp?: string }> {
    if (!this.settings || !this.settings.enabled) {
      return { allowed: true };
    }

    const currentIp = await this.getCurrentPublicIP();
    
    if (!currentIp) {
      if (this.settings.behavior_on_check_failure === "block") {
        return { allowed: false, reason: "Unable to verify IP", currentIp: undefined };
      }
      return { allowed: true };
    }

    if (this.settings.blocked_public_ips?.includes(currentIp)) {
      return { allowed: false, reason: "IP matches blocked list", currentIp };
    }

    return { allowed: true, currentIp };
  }

  private async getCurrentPublicIP(): Promise<string | null> {
    const urls = this.settings?.ip_check_urls || [
      "https://api.ipify.org",
      "https://ifconfig.me",
      "https://icanhazip.com"
    ];
    const timeoutMs = (this.settings?.ip_check_timeout_seconds || 5) * 1000;

    for (const url of urls) {
      try {
        const response = await fetch(url, {
          headers: {
            "User-Agent": "curl/8",
          },
          signal: AbortSignal.timeout(timeoutMs),
        });
        
        if (response.ok) {
          const ip = (await response.text()).trim();
          if (this.isValidIp(ip)) {
            return ip;
          }
        }
      } catch (err) {
        // Continue to the next URL
      }
    }
    return null;
  }

  private isValidIp(ip: string): boolean {
    const ipv4Regex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    const ipv6Regex = /^(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}$/i; // simplified
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }
}
