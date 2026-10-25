const HOUR_MS = 60 * 60 * 1000
const MAX_BAN_MS = 100 * 365 * 24 * HOUR_MS

/** Doubles the remaining ban, with a one-hour minimum and a 100-year maximum. */
export function banEvasionEndTime(now: number, latestBanEnd?: Date): Date {
  const remaining = latestBanEnd ? Number(latestBanEnd) - now : 0
  return new Date(now + Math.max(HOUR_MS, Math.min(remaining * 2, MAX_BAN_MS)))
}
