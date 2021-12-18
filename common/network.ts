import { assertUnreachable } from './assert-unreachable'

/** User-controllable ingame latency settings. */
export enum BwUserLatency {
  Low,
  High,
  ExtraHigh,
}

export function userLatencyToTurnBuffer(latency: BwUserLatency): number {
  switch (latency) {
    case BwUserLatency.Low:
      return 3
    case BwUserLatency.High:
      return 4
    case BwUserLatency.ExtraHigh:
      return 5
    default:
      return assertUnreachable(latency)
  }
}

/**
 * Returns the amount of time between a turn starting and it playing back ingame, given a
 * particular turn rate and user latency setting.
 */
export function turnRateToMaxLatency(
  turnRate: BwTurnRate,
  userLatency: BwUserLatency = BwUserLatency.Low,
): number {
  if (turnRate > 24 || turnRate < 8) {
    throw new Error('turnRate must be between 8 and 24')
  }

  return (1000 * userLatencyToTurnBuffer(userLatency)) / turnRate
}

export type BwTurnRate = 8 | 10 | 12 | 14 | 16 | 20 | 24

export const ALL_TURN_RATES: ReadonlyArray<BwTurnRate> = [8, 10, 12, 14, 16, 20, 24]
export const TURN_RATE_DYNAMIC = 0
