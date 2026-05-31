export interface LogEntry {
  timestamp: string;
  level: string;
  agentName: string;
  agentId?: string;
  event: string;
  details?: Record<string, string>;
}

/** Парсит JSONL-лог (по объекту в строке), пропуская битые строки. */
export function parseLogLines(text: string): LogEntry[] {
  const out: LogEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    try {
      out.push(JSON.parse(line) as LogEntry);
    } catch {
      // пропускаем нераспарсиваемую строку
    }
  }
  return out;
}

/** Фильтрация по агенту и уровню. */
export function filterLogs(entries: LogEntry[], opts: { agent?: string; level?: string }): LogEntry[] {
  return entries.filter(
    (e) =>
      (!opts.agent || e.agentName === opts.agent) &&
      (!opts.level || e.level === opts.level)
  );
}
