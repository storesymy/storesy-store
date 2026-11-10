/**
 * `Y-m-d H:i:s` (Asia/Kuala_Lumpur wall-clock) → "6 November 2026 at 2:11 pm".
 * The stored convention is fixed UTC+08:00, so the parse is explicit.
 */
export function fullTime(stored: string | null): string {
  if (!stored) return "—";
  const date = new Date(`${stored.replace(" ", "T")}+08:00`);
  if (!Number.isFinite(date.getTime())) return stored;
  const day = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Asia/Kuala_Lumpur",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
    timeZone: "Asia/Kuala_Lumpur",
  })
    .format(date)
    .toLowerCase();
  return `${day} at ${time}`;
}
