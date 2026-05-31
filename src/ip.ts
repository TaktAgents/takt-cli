/** Проверяет, что строка — валидный IPv4 или (упрощённо) IPv6 адрес. */
export function isValidIP(ip: string): boolean {
  const s = ip.trim();
  return isValidIPv4(s) || isValidIPv6(s);
}

export function isValidIPv4(ip: string): boolean {
  const parts = ip.split(".");
  if (parts.length !== 4) return false;
  return parts.every((p) => {
    if (!/^\d{1,3}$/.test(p)) return false;
    if (p.length > 1 && p[0] === "0") return false; // запрет ведущих нулей
    const n = Number(p);
    return n >= 0 && n <= 255;
  });
}

export function isValidIPv6(ip: string): boolean {
  // Упрощённая проверка: hex-группы, допускаем "::" один раз.
  if (!ip.includes(":")) return false;
  if ((ip.match(/::/g) || []).length > 1) return false;
  const groups = ip.split(":");
  if (groups.length > 8) return false;
  return groups.every((g) => g === "" || /^[0-9a-fA-F]{1,4}$/.test(g));
}
