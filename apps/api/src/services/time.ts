/**
 * Date-time formatting for the database conventions: every stored date-time is
 * `YYYY-MM-DD HH:MM:SS` in Asia/Kuala_Lumpur (schema.ts convention 3).
 * KL is a fixed UTC+08:00 with no DST, so shifting by whole hours is exact.
 */
export function formatKlDateTime(date: Date): string {
  const shifted = new Date(date.getTime() + 8 * 60 * 60 * 1000);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())} ` +
    `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}`
  );
}

/** Now in Asia/Kuala_Lumpur, `YYYY-MM-DD HH:MM:SS`. */
export function klNow(): string {
  return formatKlDateTime(new Date());
}
