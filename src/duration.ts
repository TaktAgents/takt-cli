/** Парсит длительность вида 15m / 1h / 2h / 1d (и Ns) в секунды. */
export function parseDuration(input: string): number | undefined {
  const m = input.trim().match(/^(\d+)\s*([smhd])$/i);
  if (!m) return undefined;
  const n = parseInt(m[1], 10);
  switch (m[2].toLowerCase()) {
    case "s": return n;
    case "m": return n * 60;
    case "h": return n * 3600;
    case "d": return n * 86400;
    default: return undefined;
  }
}
