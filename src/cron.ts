/** Базовая валидация 5-полевого cron-выражения (числа, *, шаги, диапазоны, списки). */
export function isValidCron(expr: string): boolean {
  const fields = expr.trim().split(/\s+/);
  if (fields.length !== 5) return false;
  const token = /^(\*|\d+|\d+-\d+)(\/\d+)?(,(\*|\d+|\d+-\d+)(\/\d+)?)*$/;
  return fields.every((f) => token.test(f));
}
